'use strict';
// 数据库：使用 Node 内置的 node:sqlite（Node >= 22.13），无需编译原生模块，Windows 开箱即用。
// 注意：服务器上只保存公钥和密文，任何消息明文都不会出现在这里。
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

function openDb(dataDir) {
  const db = new DatabaseSync(dataDir === ':memory:' ? ':memory:' : path.join(dataDir, 'chat.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS users (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      phone         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      about         TEXT NOT NULL DEFAULT 'Hey there! I am using Chat.',
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

    -- 媒体文件：客户端加密后上传的二进制密文，服务器不知道内容和密钥
    CREATE TABLE IF NOT EXISTS media (
      id            TEXT PRIMARY KEY,
      owner_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      size          INTEGER NOT NULL,
      created_at    INTEGER NOT NULL
    );
  `);
  return db;
}

// 简单事务包装
function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { openDb, tx };
