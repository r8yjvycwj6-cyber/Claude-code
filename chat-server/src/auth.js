'use strict';
// 账号认证：scrypt 哈希密码，随机令牌（数据库里只存令牌的 SHA-256）。
// 注意：这是"登录服务器"的凭据，和端到端加密的私钥完全无关——私钥永远只在客户端。
const crypto = require('crypto');
const { HttpError, now } = require('./util');

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

function verifyPassword(password, stored) {
  const [alg, N, r, p, saltB64, hashB64] = String(stored).split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N), r: Number(r), p: Number(p),
  });
  return crypto.timingSafeEqual(expected, actual);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function createAuth(db, config) {
  const insertSession = db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)'
  );
  const findSession = db.prepare('SELECT user_id AS userId, expires_at AS expiresAt FROM sessions WHERE token_hash = ?');
  const deleteSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');

  function createSession(userId, userAgent) {
    const token = crypto.randomBytes(32).toString('base64url');
    const t = now();
    insertSession.run(sha256(token), userId, t, t + config.tokenTtlDays * 86400000, String(userAgent || '').slice(0, 200));
    return token;
  }

  // 返回 userId 或 null
  function verifyToken(token) {
    if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
    const row = findSession.get(sha256(token));
    if (!row) return null;
    if (row.expiresAt < now()) {
      deleteSession.run(sha256(token));
      return null;
    }
    return row.userId;
  }

  function revokeToken(token) {
    deleteSession.run(sha256(token));
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

  return { hashPassword, verifyPassword, createSession, verifyToken, revokeToken, requireAuth };
}

module.exports = { createAuth };
