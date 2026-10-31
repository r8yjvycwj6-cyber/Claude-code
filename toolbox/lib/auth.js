'use strict';
const crypto = require('crypto');
const { promisify } = require('util');
const path = require('path');
const Store = require('./store');

const scrypt = promisify(crypto.scrypt);
const SESSION_DAYS = 30;
const COOKIE = 'tb_sid';

function createAuth(dataDir, { isToolId = () => true } = {}) {
  const users = new Store(path.join(dataDir, 'users.json'), { users: {}, byEmail: {} });
  const sessions = new Store(path.join(dataDir, 'sessions.json'), { s: {} });
  const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

  // 清理过期会话
  const now = () => Date.now();
  for (const [k, v] of Object.entries(sessions.data.s)) if (v.exp < now()) delete sessions.data.s[k];

  async function hashPassword(pw) {
    const salt = crypto.randomBytes(16);
    const key = await scrypt(pw, salt, 64);
    return `${salt.toString('hex')}:${key.toString('hex')}`;
  }
  async function verifyPassword(pw, stored) {
    const [saltHex, keyHex] = stored.split(':');
    const key = await scrypt(pw, Buffer.from(saltHex, 'hex'), 64);
    const want = Buffer.from(keyHex, 'hex');
    return want.length === key.length && crypto.timingSafeEqual(key, want);
  }

  // 简单的内存限流：key -> {n, reset}
  const hits = new Map();
  function limited(key, max, windowMs, consume = true) {
    const t = now();
    let h = hits.get(key);
    if (!h || h.reset < t) { h = { n: 0, reset: t + windowMs }; hits.set(key, h); }
    if (consume) h.n++;
    return h.n > max ? Math.ceil((h.reset - t) / 1000) : 0;
  }
  setInterval(() => { const t = now(); for (const [k, v] of hits) if (v.reset < t) hits.delete(k); }, 60000).unref();

  function parseCookies(req) {
    const out = {};
    for (const part of (req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }
  function setCookie(req, res, value, maxAgeSec) {
    const parts = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSec}`];
    if (req.secure) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }
  function startSession(req, res, uid) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.data.s[sha(token)] = { uid, exp: now() + SESSION_DAYS * 864e5 };
    sessions.save();
    setCookie(req, res, token, SESSION_DAYS * 86400);
  }

  const publicUser = (u) => ({ id: u.id, email: u.email, created: u.created });

  // 解析登录态的中间件
  function attach(req, _res, next) {
    const token = parseCookies(req)[COOKIE];
    req.user = null;
    if (token) {
      const key = sha(token);
      const s = sessions.data.s[key];
      if (s && s.exp > now()) req.user = users.data.users[s.uid] || null;
      else if (s) { delete sessions.data.s[key]; sessions.save(); }
      req.sessionKey = key;
    }
    next();
  }
  function requireUser(req, res, next) {
    if (req.user) return next();
    res.status(401).json({ error: '请先登录后再使用此功能', code: 'LOGIN_REQUIRED' });
  }

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function routes(app) {
    app.post('/api/auth/register', async (req, res) => {
      const wait = limited('reg:' + req.ip, 10, 3600e3);
      if (wait) return res.status(429).json({ error: `注册过于频繁，请 ${wait} 秒后再试` });
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: '请输入有效的邮箱地址' });
      if (password.length < 8) return res.status(400).json({ error: '密码至少 8 位' });
      if (password.length > 200) return res.status(400).json({ error: '密码过长' });
      if (users.data.byEmail[email]) return res.status(409).json({ error: '该邮箱已注册，请直接登录' });
      const id = crypto.randomUUID();
      const user = { id, email, pw: await hashPassword(password), created: now(), prefs: { favs: [], recents: [] } };
      users.data.users[id] = user; users.data.byEmail[email] = id; users.save();
      startSession(req, res, id);
      res.json({ user: publicUser(user), prefs: user.prefs });
    });

    app.post('/api/auth/login', async (req, res) => {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const password = String(req.body?.password || '');
      const key = `login:${req.ip}:${email}`;
      const wait = limited(key, 8, 15 * 60e3, false);
      if (wait) return res.status(429).json({ error: `尝试次数过多，请 ${Math.ceil(wait / 60)} 分钟后再试` });
      const u = users.data.users[users.data.byEmail[email]];
      // 即使用户不存在也做一次 scrypt，避免通过耗时枚举邮箱
      const ok = u ? await verifyPassword(password, u.pw) : (await scrypt(password, 'x'.repeat(16), 64), false);
      if (!ok) { limited(key, 8, 15 * 60e3); return res.status(401).json({ error: '邮箱或密码错误' }); }
      hits.delete(key);
      startSession(req, res, u.id);
      res.json({ user: publicUser(u), prefs: u.prefs });
    });

    app.post('/api/auth/logout', (req, res) => {
      if (req.sessionKey) { delete sessions.data.s[req.sessionKey]; sessions.save(); }
      setCookie(req, res, '', 0);
      res.json({ ok: true });
    });

    app.get('/api/auth/me', (req, res) => {
      res.json(req.user ? { user: publicUser(req.user), prefs: req.user.prefs } : { user: null });
    });

    app.post('/api/auth/password', requireUser, async (req, res) => {
      const { oldPassword = '', newPassword = '' } = req.body || {};
      if (String(newPassword).length < 8) return res.status(400).json({ error: '新密码至少 8 位' });
      if (!(await verifyPassword(String(oldPassword), req.user.pw))) return res.status(401).json({ error: '原密码不正确' });
      req.user.pw = await hashPassword(String(newPassword));
      // 修改密码后使其它设备下线
      for (const [k, v] of Object.entries(sessions.data.s)) if (v.uid === req.user.id && k !== req.sessionKey) delete sessions.data.s[k];
      users.save(); sessions.save();
      res.json({ ok: true });
    });

    app.put('/api/user/prefs', requireUser, (req, res) => {
      const clean = (a, n) => (Array.isArray(a) ? [...new Set(a.filter((x) => typeof x === 'string' && isToolId(x)))].slice(0, n) : []);
      req.user.prefs = { favs: clean(req.body?.favs, 200), recents: clean(req.body?.recents, 30) };
      users.save();
      res.json({ prefs: req.user.prefs });
    });
  }

  return { attach, requireUser, routes, flush: () => { users.flushSync(); sessions.flushSync(); } };
}
module.exports = { createAuth };
