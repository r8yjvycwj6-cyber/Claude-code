'use strict';
// 实时投递中心：维护在线连接。所有需要可靠送达的事件都先写入 queue 表再推送，
// 客户端 ack 之后才删除——保证离线用户上线后也能收到。
const { now } = require('./util');

function createHub(db) {
  const sockets = new Map(); // userId -> Set<ws>

  const insertQueue = db.prepare('INSERT INTO queue (recipient_id, kind, payload, created_at) VALUES (?, ?, ?, ?)');
  const pendingFor = db.prepare(
    'SELECT id, kind, payload, created_at FROM queue WHERE recipient_id = ? AND id > ? ORDER BY id LIMIT ?'
  );
  const deleteQueued = db.prepare('DELETE FROM queue WHERE id = ? AND recipient_id = ? RETURNING kind, payload');

  function send(ws, obj) {
    if (ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  // 返回 true 表示这是该用户的第一个连接（刚上线）
  function addSocket(userId, ws) {
    let set = sockets.get(userId);
    if (!set) sockets.set(userId, (set = new Set()));
    set.add(ws);
    return set.size === 1;
  }

  // 返回 true 表示该用户已没有任何连接（刚下线）
  function removeSocket(userId, ws) {
    const set = sockets.get(userId);
    if (!set) return false;
    set.delete(ws);
    if (set.size === 0) {
      sockets.delete(userId);
      return true;
    }
    return false;
  }

  const isOnline = (userId) => sockets.has(userId);

  // 只推给在线用户，不入队（正在输入、在线状态等瞬时事件）
  function emit(userId, obj) {
    const set = sockets.get(userId);
    if (set) for (const ws of set) send(ws, obj);
  }

  // 可靠投递：入队 + 推送。返回队列 id（qid）。
  function deliver(userId, kind, payload) {
    const ts = now();
    const { lastInsertRowid } = insertQueue.run(userId, kind, JSON.stringify(payload), ts);
    const qid = Number(lastInsertRowid);
    emit(userId, { ...payload, type: kind, qid, ts });
    return qid;
  }

  // 用户上线时补发积压事件
  function flushPending(userId, ws) {
    let last = 0;
    let total = 0;
    for (;;) {
      const rows = pendingFor.all(userId, last, 500);
      for (const r of rows) send(ws, { ...JSON.parse(r.payload), type: r.kind, qid: r.id, ts: r.created_at });
      total += rows.length;
      if (rows.length < 500) break;
      last = rows[rows.length - 1].id;
    }
    return total;
  }

  // 删除已确认的事件，返回被删除的条目（用于生成"已送达"回执）
  function ack(userId, qid) {
    const row = deleteQueued.get(qid, userId);
    return row ? { kind: row.kind, payload: JSON.parse(row.payload) } : null;
  }

  function closeUser(userId) {
    const set = sockets.get(userId);
    if (set) for (const ws of [...set]) ws.close(4001, 'logged out');
  }

  return { addSocket, removeSocket, isOnline, emit, deliver, flushPending, ack, closeUser, send };
}

module.exports = { createHub };
