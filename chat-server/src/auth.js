'use strict';
// 账号认证：scrypt 哈希密码，随机令牌（数据库里只存令牌的 SHA-256）。
// 注意：这是"登录服务器"的凭据，和端到端加密的私钥完全无关——私钥永远只在客户端。
//
// 性能：scrypt 很耗 CPU（约 50ms/次），这里使用异步版本，在线程池中计算，
// 不会卡住处理消息的主线程；令牌校验结果在内存中缓存 60 秒。
const crypto = require('crypto');
const { promisify } = require('util');
const { HttpError, now } = require('./util');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const TOKEN_CACHE_MS = 60_000;
const TOKEN_CACHE_MAX = 100_000;

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [alg, N, r, p, saltB64, hashB64] = String(stored).split('$');
  if (alg !== 'scrypt' || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024,
  });
  return crypto.timingSafeEqual(expected, actual);
}

// 用户不存在时也做一次同等耗时的计算，避免通过响应时间判断手机号是否注册
const DUMMY_HASH = `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${Buffer.alloc(16).toString('base64')}$${Buffer.alloc(64).toString('base64')}`;

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createAuth(db, config) {
  const insertSession = db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)'
  );
  const findSession = db.prepare('SELECT user_id AS userId, expires_at AS expiresAt FROM sessions WHERE token_hash = ?');
  const deleteSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const cache = new Map(); // tokenHash -> { userId, expiresAt, until }

  function createSession(userId, userAgent) {
    const token = crypto.randomBytes(32).toString('base64url');
    const t = now();
    insertSession.run(sha256(token), userId, t, t + config.tokenTtlDays * 86400000, String(userAgent || '').slice(0, 200));
    return token;
  }

  // 返回 userId 或 null
  function verifyToken(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const th = sha256(token);
    const t = now();
    const c = cache.get(th);
    if (c && c.until > t) return c.expiresAt > t ? c.userId : null;
    const row = findSession.get(th);
    if (!row || row.expiresAt < t) {
      if (row) deleteSession.run(th);
      cache.delete(th);
      return null;
    }
    if (cache.size >= TOKEN_CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(th, { userId: row.userId, expiresAt: row.expiresAt, until: t + TOKEN_CACHE_MS });
    return row.userId;
  }

  function revokeToken(token) {
    const th = sha256(token);
    cache.delete(th);
    deleteSession.run(th);
  }

  // 让某个用户的全部（或除 keepToken 外的）登录失效
  function revokeUser(userId, keepToken = null) {
    const keep = keepToken ? sha256(keepToken) : null;
    db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, keep || '');
    for (const [th, c] of cache) if (c.userId === userId && th !== keep) cache.delete(th);
  }

  function bearer(req) {
    const h = req.headers.authorization || '';
    return h.startsWith('Bearer ') ? h.slice(7).trim() : null;
  }

  // Express 中间件
  function requireAuth(req, _res, next) {
    const token = bearer(req);
    const userId = verifyToken(token);
    if (!userId) return next(new HttpError(401, '未登录或登录已过期'));
    req.userId = userId;
    req.token = token;
    next();
  }

  return { hashPassword, verifyPassword, DUMMY_HASH, createSession, verifyToken, revokeToken, revokeUser, requireAuth };
}

module.exports = { createAuth };
