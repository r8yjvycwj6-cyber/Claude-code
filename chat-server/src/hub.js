'use strict';
// 实时投递中心：维护在线连接。所有需要可靠送达的事件都先写入 queue 表再推送，
// 客户端 ack 之后才删除——保证离线用户上线后也能收到。
//
// 性能要点：
//   * 写库走组提交（见 db.batch），一轮事件循环只提交一次；
//   * 同一轮里发给同一个连接的多帧数据先"塞住"（cork），本轮结束时一次系统调用写出；
//   * 消息只序列化一次，帧头直接拼接；ack 时不再解析密文 JSON（发送者等信息存在独立列里）。
const { now } = require('./util');
const { batch } = require('./db');

function createHub(db) {
  const sockets = new Map(); // userId -> Set<ws>
  const corked = new Set();
  let uncorkScheduled = false;

  const insertQueue = db.prepare(
    'INSERT INTO queue (recipient_id, kind, payload, created_at, ref, sender, group_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const pendingFor = db.prepare(
    'SELECT id, kind, payload, created_at FROM queue WHERE recipient_id = ? AND id > ? ORDER BY id LIMIT ?'
  );
  const deleteQueued = db.prepare(
    'DELETE FROM queue WHERE id = ? AND recipient_id = ? RETURNING kind, ref, sender, group_id'
  );

  function uncorkAll() {
    uncorkScheduled = false;
    for (const ws of corked) ws._socket?.uncork();
    corked.clear();
  }

  function sendRaw(ws, data) {
    if (ws.readyState !== 1) return;
    const sock = ws._socket;
    if (sock && !corked.has(ws)) {
      sock.cork();
      corked.add(ws);
      if (!uncorkScheduled) {
        uncorkScheduled = true;
        setImmediate(uncorkAll);
      }
    }
    ws.send(data);
  }

  function send(ws, obj) {
    sendRaw(ws, JSON.stringify(obj));
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
    corked.delete(ws);
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
  const onlineCount = () => sockets.size;

  // 只推给在线用户，不入队（正在输入、在线状态等瞬时事件）
  function emit(userId, obj) {
    const set = sockets.get(userId);
    if (!set) return;
    const data = JSON.stringify(obj);
    for (const ws of set) sendRaw(ws, data);
  }

  // 可靠投递：入队 + 推送。返回队列 id（qid）。
  function deliver(userId, kind, payload) {
    const ts = now();
    const json = JSON.stringify(payload);
    const isMsg = kind === 'message';
    batch(db);
    const { lastInsertRowid } = insertQueue.run(
      userId, kind, json, ts,
      isMsg ? payload.id : null, isMsg ? payload.from : null, isMsg ? payload.groupId ?? null : null
    );
    const qid = Number(lastInsertRowid);
    const set = sockets.get(userId);
    if (set) {
      const head = `{"type":${JSON.stringify(kind)},"qid":${qid},"ts":${ts}`;
      const frame = json === '{}' ? `${head}}` : `${head},${json.slice(1)}`;
      for (const ws of set) sendRaw(ws, frame);
    }
    return qid;
  }

  // 用户上线时补发积压事件
  function flushPending(userId, ws) {
    let last = 0;
    let total = 0;
    for (;;) {
      const rows = pendingFor.all(userId, last, 500);
      for (const r of rows) {
        const head = `{"type":${JSON.stringify(r.kind)},"qid":${r.id},"ts":${r.created_at}`;
        sendRaw(ws, r.payload === '{}' ? `${head}}` : `${head},${r.payload.slice(1)}`);
      }
      total += rows.length;
      if (rows.length < 500) break;
      last = rows[rows.length - 1].id;
    }
    return total;
  }

  // 删除已确认的事件，返回被删除的条目（用于生成"已送达"回执）
  function ack(userId, qid) {
    batch(db);
    const row = deleteQueued.get(qid, userId);
    if (!row) return null;
    return { kind: row.kind, payload: { id: row.ref, from: row.sender, groupId: row.group_id ?? undefined } };
  }

  function closeUser(userId) {
    const set = sockets.get(userId);
    if (set) for (const ws of [...set]) ws.close(4001, 'logged out');
  }

  return { addSocket, removeSocket, isOnline, onlineCount, emit, deliver, flushPending, ack, closeUser, send };
}

module.exports = { createHub };
