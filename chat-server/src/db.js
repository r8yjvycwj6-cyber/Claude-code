'use strict';
// 数据库：使用 Node 内置的 node:sqlite（Node >= 22.13），无需编译原生模块，Windows 开箱即用。
// 注意：服务器上只保存公钥和密文，任何消息明文都不会出现在这里。
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function openDb(dataDir) {
  const db = new DatabaseSync(dataDir === ':memory:' ? ':memory:' : path.join(dataDir, 'chat.db'));

  // 预编译语句缓存：同一条 SQL 只编译一次（路由里大量临时 prepare 的开销就没了）
  const rawPrepare = db.prepare.bind(db);
  const stmtCache = new Map();
  db.prepare = (sql) => {
    let s = stmtCache.get(sql);
    if (!s) stmtCache.set(sql, (s = rawPrepare(sql)));
    return s;
  };

  // 性能设置：
  //   WAL + synchronous=NORMAL：每次提交不再 fsync（只在检查点时刷盘），写入速度提升数十倍；
  //   断电时最多丢失最近一瞬间的提交，但数据库不会损坏。
  //   64MB 页缓存 + 256MB 内存映射读取。
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA cache_size = -65536;
    PRAGMA temp_store = MEMORY;
    PRAGMA mmap_size = 268435456;
    PRAGMA wal_autocheckpoint = 4000;

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      phone         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      about         TEXT NOT NULL DEFAULT '你好，我正在使用 SecureChat。',
      avatar        TEXT,
      pass_hash     TEXT NOT NULL,
      created_at    INTEGER NOT NULL,
      last_seen     INTEGER
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token_hash    TEXT PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at    INTEGER NOT NULL,
      expires_at    INTEGER NOT NULL,
      user_agent    TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

    CREATE TABLE IF NOT EXISTS contacts (
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      contact_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      alias         TEXT,
      created_at    INTEGER NOT NULL,
      PRIMARY KEY (user_id, contact_id)
    );
    CREATE INDEX IF NOT EXISTS idx_contacts_contact ON contacts(contact_id);

    CREATE TABLE IF NOT EXISTS blocks (
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      blocked_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, blocked_id)
    );

    -- 端到端加密公钥目录（只有公钥）
    CREATE TABLE IF NOT EXISTS identity_keys (
      user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      dh_key        TEXT NOT NULL,   -- X25519 身份公钥 (base64)
      sig_key       TEXT NOT NULL,   -- Ed25519 签名公钥 (base64)
      updated_at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS signed_prekeys (
      user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      key_id        INTEGER NOT NULL,
      public_key    TEXT NOT NULL,
      signature     TEXT NOT NULL,
      updated_at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS one_time_prekeys (
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key_id        INTEGER NOT NULL,
      public_key    TEXT NOT NULL,
      PRIMARY KEY (user_id, key_id)
    );

    CREATE TABLE IF NOT EXISTS groups_ (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      description   TEXT NOT NULL DEFAULT '',
      avatar        TEXT,
      created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at    INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS group_members (
      group_id      INTEGER NOT NULL REFERENCES groups_(id) ON DELETE CASCADE,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role          TEXT NOT NULL DEFAULT 'member',   -- 'admin' | 'member'
      joined_at     INTEGER NOT NULL,
      PRIMARY KEY (group_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);

    -- 投递队列：离线消息、回执、群事件。客户端确认(ack)后立即删除。
    CREATE TABLE IF NOT EXISTS queue (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      recipient_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind          TEXT NOT NULL,
      payload       TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_queue_recipient ON queue(recipient_id, id);
    CREATE INDEX IF NOT EXISTS idx_queue_created ON queue(created_at);

    -- 媒体文件：客户端加密后上传的二进制密文，服务器不知道内容和密钥
    CREATE TABLE IF NOT EXISTS media (
      id            TEXT PRIMARY KEY,
      owner_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      size          INTEGER NOT NULL,
      created_at    INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_media_created ON media(created_at);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  `);

  // 升级旧数据库：queue 表增加 ref / sender / group_id 列（确认收到时无需解析密文 JSON）
  const qcols = new Set(db.prepare('PRAGMA table_info(queue)').all().map((c) => c.name));
  if (!qcols.has('ref')) {
    db.exec('ALTER TABLE queue ADD COLUMN ref TEXT; ALTER TABLE queue ADD COLUMN sender INTEGER; ALTER TABLE queue ADD COLUMN group_id INTEGER;');
    db.exec(`UPDATE queue SET ref = json_extract(payload, '$.id'), sender = json_extract(payload, '$.from'),
             group_id = json_extract(payload, '$.groupId') WHERE kind = 'message'`);
  }
  return db;
}

// 简单事务包装
// 事务包装。可嵌套：内层用 SAVEPOINT，内层失败只回滚内层，不影响外层。
// 批量写入放在一个事务里，只提交一次。
function tx(db, fn) {
  if (db._txDepth) {
    const sp = `sp${db._txDepth}`;
    db.exec(`SAVEPOINT ${sp}`);
    db._txDepth++;
    try {
      const r = fn();
      db._txDepth--;
      db.exec(`RELEASE ${sp}`);
      return r;
    } catch (e) {
      db._txDepth--;
      db.exec(`ROLLBACK TO ${sp}`);
      db.exec(`RELEASE ${sp}`);
      throw e;
    }
  }
  db.exec('BEGIN IMMEDIATE');
  db._txDepth = 1;
  try {
    const r = fn();
    db._txDepth = 0;
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db._txDepth = 0;
    db.exec('ROLLBACK');
    throw e;
  }
}

// 组提交（group commit）：同一轮事件循环里的所有写入共用一个事务，
// 在本轮 I/O 处理完后（setImmediate）一次性提交。高并发时把每秒上万次提交合并成几百次。
// 在批次中调用 tx() 会自动变成 SAVEPOINT，互不影响。
function batch(db) {
  if (db._txDepth) return;
  db.exec('BEGIN IMMEDIATE');
  db._txDepth = 1;
  db._batchOpen = true;
  setImmediate(() => flushBatch(db));
}

function flushBatch(db) {
  if (!db._batchOpen) return;
  db._batchOpen = false;
  db._txDepth = 0;
  try {
    db.exec('COMMIT');
  } catch (e) {
    console.error('[db] 批量提交失败', e);
    try {
      db.exec('ROLLBACK');
    } catch {}
  }
}

module.exports = { openDb, tx, batch, flushBatch };
