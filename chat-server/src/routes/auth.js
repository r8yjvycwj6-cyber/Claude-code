'use strict';
const express = require('express');
const { HttpError, now, normalizePhone, cleanText, rateLimiter } = require('../util');
const { publicUser } = require('./users');

module.exports = function authRoutes({ db, auth, hub }) {
  const r = express.Router();
  const limit = rateLimiter({ windowMs: 15 * 60 * 1000, limit: 20 });

  const byPhone = db.prepare('SELECT * FROM users WHERE phone = ?');
  const insertUser = db.prepare('INSERT INTO users (phone, name, pass_hash, created_at) VALUES (?, ?, ?, ?)');
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');

  function checkLimit(req) {
    if (!limit(`${req.ip}`)) throw new HttpError(429, '尝试次数过多，请稍后再试');
  }

  // 注册：{ phone, name, password }
  r.post('/register', (req, res) => {
    checkLimit(req);
    const phone = normalizePhone(req.body.phone);
    const name = cleanText(req.body.name, 50);
    const password = req.body.password;
    if (!phone) throw new HttpError(400, '手机号格式不正确');
    if (!name) throw new HttpError(400, '昵称不能为空且不超过 50 字');
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
      throw new HttpError(400, '密码长度需要 8~128 位');
    }
    if (byPhone.get(phone)) throw new HttpError(409, '该手机号已注册');
    const { lastInsertRowid } = insertUser.run(phone, name, auth.hashPassword(password), now());
    const userId = Number(lastInsertRowid);
    const token = auth.createSession(userId, req.headers['user-agent']);
    res.status(201).json({ token, user: publicUser(byId.get(userId), true) });
  });

  // 登录：{ phone, password }
  r.post('/login', (req, res) => {
    checkLimit(req);
    const phone = normalizePhone(req.body.phone);
    const user = phone && byPhone.get(phone);
    if (!user || typeof req.body.password !== 'string' || !auth.verifyPassword(req.body.password, user.pass_hash)) {
      throw new HttpError(401, '手机号或密码错误');
    }
    const token = auth.createSession(user.id, req.headers['user-agent']);
    res.json({ token, user: publicUser(user, true) });
  });

  r.post('/logout', auth.requireAuth, (req, res) => {
    auth.revokeToken(req.token);
    res.json({ ok: true });
  });

  // 退出所有设备
  r.post('/logout-all', auth.requireAuth, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(req.userId);
    hub.closeUser(req.userId);
    res.json({ ok: true });
  });

  return r;
};
