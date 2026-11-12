'use strict';
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { HttpError, now, normalizePhone, cleanText, isId, ah } = require('../util');

function publicUser(u, self = false) {
  if (!u) return null;
  const o = {
    id: u.id,
    phone: u.phone,
    name: u.name,
    about: u.about,
    avatar: u.avatar ? `/api/avatars/${u.avatar}` : null,
  };
  if (self) o.createdAt = u.created_at;
  return o;
}

const AVATAR_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

function usersRoutes({ db, auth, hub, config }) {
  const r = express.Router();
  const byId = db.prepare('SELECT * FROM users WHERE id = ?');
  const byPhone = db.prepare('SELECT * FROM users WHERE phone = ?');

  r.use(auth.requireAuth);

  // ---- 我的资料 ----
  r.get('/me', (req, res) => res.json(publicUser(byId.get(req.userId), true)));

  r.patch('/me', (req, res) => {
    const me = byId.get(req.userId);
    let name = me.name;
    let about = me.about;
    if (req.body.name !== undefined) {
      name = cleanText(req.body.name, 50);
      if (!name) throw new HttpError(400, '昵称不能为空且不超过 50 字');
    }
    if (req.body.about !== undefined) {
      about = typeof req.body.about === 'string' ? req.body.about.trim().slice(0, 140) : about;
    }
    db.prepare('UPDATE users SET name = ?, about = ? WHERE id = ?').run(name, about, req.userId);
    res.json(publicUser(byId.get(req.userId), true));
  });

  r.post('/me/password', ah(async (req, res) => {
    const { oldPassword, newPassword } = req.body;
    const me = byId.get(req.userId);
    if (typeof oldPassword !== 'string' || !(await auth.verifyPassword(oldPassword, me.pass_hash))) {
      throw new HttpError(401, '原密码错误');
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 128) {
      throw new HttpError(400, '新密码长度需要 8~128 位');
    }
    db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(await auth.hashPassword(newPassword), req.userId);
    // 其它设备上的登录全部失效，保留当前这个
    auth.revokeUser(req.userId, req.token);
    res.json({ ok: true });
  }));

  // 头像（与 WhatsApp 一样，头像不做端到端加密）。请求体直接是图片二进制，Content-Type 为图片类型。
  r.put('/me/avatar', express.raw({ type: Object.keys(AVATAR_TYPES), limit: '2mb' }), (req, res) => {
    const ext = AVATAR_TYPES[req.headers['content-type']];
    if (!ext || !Buffer.isBuffer(req.body) || req.body.length === 0) throw new HttpError(400, '请上传 jpg/png/webp/gif 图片');
    const me = byId.get(req.userId);
    const file = `${req.userId}-${crypto.randomBytes(8).toString('hex')}.${ext}`;
    fs.writeFileSync(path.join(config.dataDir, 'avatars', file), req.body);
    db.prepare('UPDATE users SET avatar = ? WHERE id = ?').run(file, req.userId);
    if (me.avatar) fs.rm(path.join(config.dataDir, 'avatars', me.avatar), { force: true }, () => {});
    res.json(publicUser(byId.get(req.userId), true));
  });

  r.delete('/me/avatar', (req, res) => {
    const me = byId.get(req.userId);
    if (me.avatar) fs.rm(path.join(config.dataDir, 'avatars', me.avatar), { force: true }, () => {});
    db.prepare('UPDATE users SET avatar = NULL WHERE id = ?').run(req.userId);
    res.json(publicUser(byId.get(req.userId), true));
  });

  // 注销账号：删除所有数据（公钥、离线消息、群成员关系等通过外键级联删除）
  r.delete('/me', ah(async (req, res) => {
    const me = byId.get(req.userId);
    if (typeof req.body.password !== 'string' || !(await auth.verifyPassword(req.body.password, me.pass_hash))) {
      throw new HttpError(401, '密码错误');
    }
    hub.closeUser(req.userId);
    auth.revokeUser(req.userId);
    if (me.avatar) fs.rm(path.join(config.dataDir, 'avatars', me.avatar), { force: true }, () => {});
    db.prepare('DELETE FROM users WHERE id = ?').run(req.userId);
    res.json({ ok: true });
  }));

  // ---- 查找用户 ----
  // GET /api/users?phone=+8613800000000 精确查找（不提供模糊搜索，防止枚举用户）
  r.get('/users', (req, res) => {
    const phone = normalizePhone(String(req.query.phone || ''));
    if (!phone) throw new HttpError(400, '请提供手机号');
    const u = byPhone.get(phone);
    if (!u) throw new HttpError(404, '该手机号尚未注册');
    res.json(withPresence(u, req.userId));
  });

  r.get('/users/:id', (req, res) => {
    const u = byId.get(Number(req.params.id));
    if (!u) throw new HttpError(404, '用户不存在');
    res.json(withPresence(u, req.userId));
  });

  function withPresence(u, viewerId) {
    const o = publicUser(u);
    // 被对方屏蔽时不显示在线状态
    const blocked = db.prepare('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?').get(u.id, viewerId);
    if (!blocked) {
      o.online = hub.isOnline(u.id);
      o.lastSeen = u.last_seen;
    }
    return o;
  }

  // ---- 联系人 ----
  r.get('/contacts', (req, res) => {
    const rows = db
      .prepare(
        `SELECT u.*, c.alias FROM contacts c JOIN users u ON u.id = c.contact_id
         WHERE c.user_id = ? ORDER BY COALESCE(c.alias, u.name)`
      )
      .all(req.userId);
    res.json(rows.map((u) => ({ ...withPresence(u, req.userId), alias: u.alias })));
  });

  // { userId } 或 { phone }，可选 alias
  r.post('/contacts', (req, res) => {
    let u = null;
    if (isId(req.body.userId)) u = byId.get(req.body.userId);
    else if (req.body.phone) u = byPhone.get(normalizePhone(String(req.body.phone)) || '');
    if (!u) throw new HttpError(404, '用户不存在');
    if (u.id === req.userId) throw new HttpError(400, '不能添加自己');
    const alias = req.body.alias ? cleanText(req.body.alias, 50) : null;
    db.prepare(
      `INSERT INTO contacts (user_id, contact_id, alias, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, contact_id) DO UPDATE SET alias = excluded.alias`
    ).run(req.userId, u.id, alias, now());
    res.status(201).json({ ...withPresence(u, req.userId), alias });
  });

  r.delete('/contacts/:id', (req, res) => {
    db.prepare('DELETE FROM contacts WHERE user_id = ? AND contact_id = ?').run(req.userId, Number(req.params.id));
    res.json({ ok: true });
  });

  // ---- 屏蔽 ----
  r.get('/blocks', (req, res) => {
    const rows = db.prepare('SELECT u.* FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = ?').all(req.userId);
    res.json(rows.map((u) => publicUser(u)));
  });

  r.post('/blocks', (req, res) => {
    if (!isId(req.body.userId) || !byId.get(req.body.userId)) throw new HttpError(404, '用户不存在');
    if (req.body.userId === req.userId) throw new HttpError(400, '不能屏蔽自己');
    db.prepare('INSERT OR IGNORE INTO blocks (user_id, blocked_id) VALUES (?, ?)').run(req.userId, req.body.userId);
    res.status(201).json({ ok: true });
  });

  r.delete('/blocks/:id', (req, res) => {
    db.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?').run(req.userId, Number(req.params.id));
    res.json({ ok: true });
  });

  return r;
}

module.exports = usersRoutes;
module.exports.publicUser = publicUser;
