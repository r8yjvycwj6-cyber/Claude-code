'use strict';
// WebSocket 实时通道：/ws
//
// 连接后 10 秒内必须先发送 { type: "auth", token }。
// 服务器只转发 "envelope"（端到端加密后的密文对象），从不解析其中内容。
// 详细协议见 README.md。
const { WebSocketServer } = require('ws');
const { now, isId, rateLimiter, clientKey } = require('./util');
const { tx } = require('./db');

const MAX_ENVELOPE_BYTES = 256 * 1024;
const TYPING_STATES = new Set(['composing', 'recording', 'paused']);

function validMsgId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(id);
}

function validEnvelope(env) {
  if (!env || typeof env !== 'object' || Array.isArray(env)) return false;
  return JSON.stringify(env).length <= MAX_ENVELOPE_BYTES;
}

function attachWebSocket(server, { db, auth, hub }) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4 * 1024 * 1024, perMessageDeflate: false });
  // ws 会把 HTTP 服务器的监听错误（如端口占用、不支持 IPv6）转发到这里；由 server.js 统一处理，这里不能让它变成未捕获异常
  wss.on('error', () => {});
  const limit = rateLimiter({ windowMs: 10_000, limit: 300 });
  const watchers = new Map(); // userId -> Set<ws>，订阅了该用户在线状态的连接

  const userExists = db.prepare('SELECT 1 FROM users WHERE id = ?');
  const isBlocked = db.prepare('SELECT 1 FROM blocks WHERE user_id = ? AND blocked_id = ?'); // (屏蔽者, 被屏蔽者)
  const memberRole = db.prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?');
  const groupMembers = db.prepare('SELECT user_id FROM group_members WHERE group_id = ?');
  const contactsOf = db.prepare('SELECT user_id FROM contacts WHERE contact_id = ?'); // 把我加为联系人的人
  const setLastSeen = db.prepare('UPDATE users SET last_seen = ? WHERE id = ?');
  const getLastSeen = db.prepare('SELECT last_seen FROM users WHERE id = ?');

  function presenceOf(userId, viewerId) {
    if (isBlocked.get(userId, viewerId)) return { type: 'presence', userId, online: false, lastSeen: null };
    return { type: 'presence', userId, online: hub.isOnline(userId), lastSeen: getLastSeen.get(userId)?.last_seen ?? null };
  }

  function broadcastPresence(userId) {
    const sent = new Set();
    const push = (ws) => {
      if (sent.has(ws) || !ws.userId) return;
      sent.add(ws);
      hub.send(ws, presenceOf(userId, ws.userId));
    };
    for (const ws of watchers.get(userId) || []) push(ws);
    for (const { user_id } of contactsOf.all(userId)) {
      if (!hub.isOnline(user_id) || isBlocked.get(userId, user_id)) continue;
      hub.emit(user_id, presenceOf(userId, user_id));
    }
  }

  function unwatchAll(ws) {
    for (const uid of ws.watching || []) {
      const set = watchers.get(uid);
      if (set) {
        set.delete(ws);
        if (!set.size) watchers.delete(uid);
      }
    }
  }

  const reply = (ws, obj) => hub.send(ws, obj);
  const error = (ws, ref, message) => reply(ws, { type: 'error', ref, message });

  // ---------------- 各种消息的处理 ----------------
  const handlers = {
    // 单聊：{ type:'send', id, to, envelope }
    send(ws, me, m) {
      if (!validMsgId(m.id)) return error(ws, m.id, 'id 格式错误');
      if (!isId(m.to) || !userExists.get(m.to)) return error(ws, m.id, '接收者不存在');
      if (!validEnvelope(m.envelope)) return error(ws, m.id, 'envelope 无效或过大');
      // 被对方屏蔽时：照常回复"已发送"，但不投递（与 WhatsApp 行为一致，只显示一个勾）
      if (!isBlocked.get(m.to, me)) hub.deliver(m.to, 'message', { id: m.id, from: me, envelope: m.envelope });
      reply(ws, { type: 'sent', id: m.id, ts: now() });
    },

    // 群聊：{ type:'send_group', id, groupId, envelopes: { [userId]: envelope } }
    // 发送方对每个成员分别加密（成对会话扇出），服务器按成员分发。
    send_group(ws, me, m) {
      if (!validMsgId(m.id)) return error(ws, m.id, 'id 格式错误');
      if (!isId(m.groupId) || !memberRole.get(m.groupId, me)) return error(ws, m.id, '你不在该群中');
      if (!m.envelopes || typeof m.envelopes !== 'object') return error(ws, m.id, 'envelopes 无效');
      const members = groupMembers.all(m.groupId).map((r) => r.user_id).filter((u) => u !== me);
      const missing = [];
      for (const uid of members) {
        const env = m.envelopes[uid];
        if (!env) {
          missing.push(uid);
          continue;
        }
        if (!validEnvelope(env)) return error(ws, m.id, `给 ${uid} 的 envelope 无效或过大`);
      }
      // 整个群的投递放在一个事务里，只提交一次
      tx(db, () => {
        for (const uid of members) {
          const env = m.envelopes[uid];
          if (env && !isBlocked.get(uid, me)) {
            hub.deliver(uid, 'message', { id: m.id, from: me, groupId: m.groupId, envelope: env });
          }
        }
      });
      // missing：群里有但你没给加密副本的成员（例如刚入群），客户端应补发
      reply(ws, { type: 'sent', id: m.id, groupId: m.groupId, ts: now(), missing });
    },

    // 确认收到：{ type:'ack', qids:[...] }。服务器删除这些离线事件，并给发送方回"已送达"。
    ack(ws, me, m) {
      if (!Array.isArray(m.qids)) return;
      const receipts = new Map(); // "from|groupId" -> msgIds
      tx(db, () => {
        for (const qid of m.qids.slice(0, 1000)) {
          if (!isId(qid)) continue;
          const row = hub.ack(me, qid);
          if (row && row.kind === 'message') {
            const key = `${row.payload.from}|${row.payload.groupId || ''}`;
            if (!receipts.has(key)) receipts.set(key, []);
            receipts.get(key).push(row.payload.id);
          }
        }
        for (const [key, msgIds] of receipts) {
          const [from, groupId] = key.split('|');
          hub.deliver(Number(from), 'receipt', {
            status: 'delivered', from: me, msgIds, ...(groupId ? { groupId: Number(groupId) } : {}),
          });
        }
      });
    },

    // 已读回执：{ type:'read', to, msgIds:[...], groupId? }
    read(ws, me, m) {
      if (!isId(m.to) || !userExists.get(m.to) || !Array.isArray(m.msgIds)) return;
      const msgIds = m.msgIds.filter(validMsgId).slice(0, 1000);
      if (!msgIds.length || isBlocked.get(m.to, me)) return;
      hub.deliver(m.to, 'receipt', { status: 'read', from: me, msgIds, ...(isId(m.groupId) ? { groupId: m.groupId } : {}) });
    },

    // 正在输入：{ type:'typing', to | groupId, state:'composing'|'recording'|'paused' }
    typing(ws, me, m) {
      const state = TYPING_STATES.has(m.state) ? m.state : 'composing';
      if (isId(m.groupId)) {
        if (!memberRole.get(m.groupId, me)) return;
        for (const { user_id } of groupMembers.all(m.groupId)) {
          if (user_id !== me) hub.emit(user_id, { type: 'typing', from: me, groupId: m.groupId, state });
        }
      } else if (isId(m.to) && !isBlocked.get(m.to, me)) {
        hub.emit(m.to, { type: 'typing', from: me, state });
      }
    },

    // 订阅某些用户的在线状态（打开聊天窗口时）：{ type:'presence_subscribe', userIds:[...] }
    presence_subscribe(ws, me, m) {
      if (!Array.isArray(m.userIds)) return;
      for (const uid of m.userIds.slice(0, 200)) {
        if (!isId(uid) || !userExists.get(uid)) continue;
        ws.watching.add(uid);
        if (!watchers.has(uid)) watchers.set(uid, new Set());
        watchers.get(uid).add(ws);
        reply(ws, presenceOf(uid, me));
      }
    },

    presence_unsubscribe(ws, me, m) {
      if (!Array.isArray(m.userIds)) return;
      for (const uid of m.userIds) {
        ws.watching.delete(uid);
        watchers.get(uid)?.delete(ws);
      }
    },

    ping(ws) {
      reply(ws, { type: 'pong', ts: now() });
    },
  };

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.watching = new Set();
    ws.on('pong', () => (ws.isAlive = true));

    const authTimer = setTimeout(() => {
      if (!ws.userId) ws.close(4000, 'auth timeout');
    }, 10_000);

    ws.on('message', (raw, isBinary) => {
      if (isBinary) return;
      let m;
      try {
        m = JSON.parse(raw.toString('utf8'));
      } catch {
        return error(ws, null, 'JSON 格式错误');
      }
      if (!m || typeof m.type !== 'string') return;

      if (!ws.userId) {
        if (m.type !== 'auth') return ws.close(4000, 'auth required');
        const userId = auth.verifyToken(m.token);
        if (!userId) return ws.close(4001, 'invalid token');
        clearTimeout(authTimer);
        ws.userId = userId;
        const firstConnection = hub.addSocket(userId, ws);
        reply(ws, { type: 'ready', userId, ts: now() });
        hub.flushPending(userId, ws);
        if (firstConnection) broadcastPresence(userId);
        return;
      }

      if (!limit(ws.userId)) return error(ws, m.id, '发送过于频繁');
      const h = Object.prototype.hasOwnProperty.call(handlers, m.type) && handlers[m.type];
      if (!h) return error(ws, m.id, `未知的消息类型 ${m.type}`);
      try {
        h(ws, ws.userId, m);
      } catch (e) {
        console.error('[ws]', e);
        error(ws, m.id, '服务器内部错误');
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      unwatchAll(ws);
      if (ws.userId && hub.removeSocket(ws.userId, ws)) {
        setLastSeen.run(now(), ws.userId);
        broadcastPresence(ws.userId);
      }
    });
    ws.on('error', () => {});
  });

  // 心跳：30 秒无响应的连接直接断开（防止 NAT/代理留下的僵尸连接）
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);
  heartbeat.unref();
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

module.exports = { attachWebSocket };
