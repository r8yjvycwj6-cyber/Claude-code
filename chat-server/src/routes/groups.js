'use strict';
// 群组管理。群名称、成员列表等元数据服务器可见（与 WhatsApp 相同）；
// 群消息内容由发送方对每个成员分别端到端加密后经 WebSocket 发送，服务器看不到内容。
const express = require('express');
const { HttpError, now, cleanText, isId } = require('../util');
const dbTx = require('../db').tx;
const { publicUser } = require('./users');

module.exports = function groupsRoutes({ db, auth, hub, config }) {
  const r = express.Router();
  r.use(auth.requireAuth);

  const getGroup = db.prepare('SELECT * FROM groups_ WHERE id = ?');
  const getMember = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?');
  const listMembers = db.prepare(
    `SELECT u.*, gm.role, gm.joined_at FROM group_members gm JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = ? ORDER BY gm.joined_at`
  );
  const addMember = db.prepare(
    'INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'
  );
  const countMembers = db.prepare('SELECT COUNT(*) AS n FROM group_members WHERE group_id = ?');
  const userExists = db.prepare('SELECT 1 FROM users WHERE id = ?');

  function groupView(g) {
    return {
      id: g.id,
      name: g.name,
      description: g.description,
      createdBy: g.created_by,
      createdAt: g.created_at,
      members: listMembers.all(g.id).map((u) => ({ ...publicUser(u), role: u.role, joinedAt: u.joined_at })),
    };
  }

  function load(req, needAdmin = false) {
    const g = getGroup.get(Number(req.params.id));
    const m = g && getMember.get(g.id, req.userId);
    if (!g || !m) throw new HttpError(404, '群组不存在或你不在群中');
    if (needAdmin && m.role !== 'admin') throw new HttpError(403, '只有管理员可以执行此操作');
    return g;
  }

  // 通知群成员（以及被移除的人）群信息变化
  function notify(groupId, action, actor, targets = [], extraRecipients = []) {
    const g = getGroup.get(groupId);
    const view = g ? groupView(g) : null;
    const recipients = new Set([...(view ? view.members.map((m) => m.id) : []), ...extraRecipients]);
    for (const uid of recipients) hub.deliver(uid, 'group_update', { groupId, action, actor, targets, group: view });
  }

  function validUserIds(list) {
    if (!Array.isArray(list)) throw new HttpError(400, '成员列表必须是数组');
    const ids = [...new Set(list)].filter(isId);
    for (const id of ids) if (!userExists.get(id)) throw new HttpError(404, `用户 ${id} 不存在`);
    return ids;
  }

  r.get('/', (req, res) => {
    const rows = db
      .prepare('SELECT g.* FROM groups_ g JOIN group_members gm ON gm.group_id = g.id WHERE gm.user_id = ? ORDER BY g.id')
      .all(req.userId);
    res.json(rows.map(groupView));
  });

  // { name, description?, members: [userId...] }
  r.post('/', (req, res) => {
    const name = cleanText(req.body.name, 100);
    if (!name) throw new HttpError(400, '群名称不能为空且不超过 100 字');
    const members = validUserIds(req.body.members || []).filter((id) => id !== req.userId);
    if (members.length + 1 > config.maxGroupSize) throw new HttpError(400, `群成员最多 ${config.maxGroupSize} 人`);
    const t = now();
    const groupId = dbTx(db, () => {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO groups_ (name, description, created_by, created_at) VALUES (?, ?, ?, ?)')
        .run(name, String(req.body.description || '').slice(0, 500), req.userId, t);
      const id = Number(lastInsertRowid);
      addMember.run(id, req.userId, 'admin', t);
      for (const m of members) addMember.run(id, m, 'member', t);
      return id;
    });
    notify(groupId, 'created', req.userId, members);
    res.status(201).json(groupView(getGroup.get(groupId)));
  });

  r.get('/:id', (req, res) => res.json(groupView(load(req))));

  r.patch('/:id', (req, res) => {
    const g = load(req, true);
    const name = req.body.name !== undefined ? cleanText(req.body.name, 100) : g.name;
    if (!name) throw new HttpError(400, '群名称不能为空且不超过 100 字');
    const description = req.body.description !== undefined ? String(req.body.description).slice(0, 500) : g.description;
    db.prepare('UPDATE groups_ SET name = ?, description = ? WHERE id = ?').run(name, description, g.id);
    notify(g.id, 'updated', req.userId);
    res.json(groupView(getGroup.get(g.id)));
  });

  // 添加成员 { userIds: [...] }
  r.post('/:id/members', (req, res) => {
    const g = load(req, true);
    const ids = validUserIds(req.body.userIds).filter((id) => !getMember.get(g.id, id));
    if (countMembers.get(g.id).n + ids.length > config.maxGroupSize) {
      throw new HttpError(400, `群成员最多 ${config.maxGroupSize} 人`);
    }
    const t = now();
    dbTx(db, () => {
      for (const id of ids) addMember.run(g.id, id, 'member', t);
    });
    if (ids.length) notify(g.id, 'members_added', req.userId, ids);
    res.json(groupView(getGroup.get(g.id)));
  });

  // 移除成员（管理员）或退出群（自己）
  r.delete('/:id/members/:userId', (req, res) => {
    const target = Number(req.params.userId);
    const g = load(req, target !== req.userId);
    if (!getMember.get(g.id, target)) throw new HttpError(404, '该用户不在群中');
    dbTx(db, () => {
      db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(g.id, target);
      const left = countMembers.get(g.id).n;
      if (left === 0) {
        db.prepare('DELETE FROM groups_ WHERE id = ?').run(g.id);
        return;
      }
      // 没有管理员了：把最早入群的成员设为管理员
      const admins = db.prepare("SELECT COUNT(*) AS n FROM group_members WHERE group_id = ? AND role = 'admin'").get(g.id).n;
      if (admins === 0) {
        db.prepare(
          `UPDATE group_members SET role = 'admin' WHERE group_id = ? AND user_id =
             (SELECT user_id FROM group_members WHERE group_id = ? ORDER BY joined_at, user_id LIMIT 1)`
        ).run(g.id, g.id);
      }
    });
    notify(g.id, target === req.userId ? 'member_left' : 'member_removed', req.userId, [target], [target]);
    res.json({ ok: true });
  });

  // 设为管理员 / 取消管理员
  r.put('/:id/admins/:userId', (req, res) => setRole(req, res, 'admin'));
  r.delete('/:id/admins/:userId', (req, res) => setRole(req, res, 'member'));

  function setRole(req, res, role) {
    const g = load(req, true);
    const target = Number(req.params.userId);
    if (!getMember.get(g.id, target)) throw new HttpError(404, '该用户不在群中');
    if (role === 'member') {
      const admins = db.prepare("SELECT COUNT(*) AS n FROM group_members WHERE group_id = ? AND role = 'admin'").get(g.id).n;
      if (admins <= 1 && getMember.get(g.id, target).role === 'admin') throw new HttpError(400, '群里至少要有一个管理员');
    }
    db.prepare('UPDATE group_members SET role = ? WHERE group_id = ? AND user_id = ?').run(role, g.id, target);
    notify(g.id, role === 'admin' ? 'admin_added' : 'admin_removed', req.userId, [target]);
    res.json(groupView(getGroup.get(g.id)));
  }

  return r;
};
