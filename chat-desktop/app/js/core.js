// 客户端核心：登录、密钥管理、端到端加解密、收发消息、本地存储、离线发件箱。
// 界面（ui.js）只订阅这里发出的事件并调用这里的方法。
import { E2EEAccount, encryptAttachment, decryptAttachment, b64e } from '../lib/e2ee.mjs';
import { Api, ApiError, normalizeServer } from './api.js';
import { LocalDB } from './db.js';
import { secureGet, secureSet } from './platform.js';

const OTK_MIN = 30;
const OTK_BATCH = 50;
const SPK_MAX_AGE = 7 * 86400000;

export const randomId = () => b64e(crypto.getRandomValues(new Uint8Array(16))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function nsFor(server, userId) {
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(server)));
  return `${[...h.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('')}-${userId}`;
}

export function previewOf(msg) {
  if (!msg) return '';
  switch (msg.type) {
    case 'text': return msg.body;
    case 'image': return `📷 ${msg.caption || '图片'}`;
    case 'file': return `📄 ${msg.media?.name || '文件'}`;
    case 'deleted': return msg.mine ? '你删除了此消息' : '此消息已删除';
    case 'undecryptable': return '⚠ 无法解密此消息';
    case 'system': return msg.body;
    default: return '';
  }
}

export class ChatCore extends EventTarget {
  // ------------------------------------------------------------ 登录 / 恢复
  static async restore() {
    const raw = await secureGet('session');
    if (!raw) return null;
    const s = JSON.parse(raw);
    const core = new ChatCore(s.server, s.token, s.user);
    try {
      core.me = await core.api.get('/api/me');
    } catch (e) {
      if (e.status === 401) {
        await secureSet('session', null);
        return null;
      }
      // 服务器暂时连不上：用缓存的资料先进入，稍后自动重连
    }
    await core.start();
    return core;
  }

  /** opts: { server, phone, password, name?, register?, backup?: {data, passphrase} } */
  static async login(opts) {
    const server = normalizeServer(opts.server);
    if (!server) throw new Error('请填写服务器地址');
    const api = new Api(server);
    const r = opts.register ? await api.register(opts.phone, opts.name, opts.password) : await api.login(opts.phone, opts.password);
    const core = new ChatCore(server, r.token, r.user);
    try {
      await core.start(opts.backup);
    } catch (e) {
      await api.logout().catch(() => {});
      throw e;
    }
    await secureSet('session', JSON.stringify({ server, token: r.token, user: r.user }));
    return core;
  }

  constructor(server, token, user) {
    super();
    this.api = new Api(server, token);
    this.api.onUnauthorized = () => this.forceLogout('登录已过期，请重新登录');
    this.me = user;
    this.chats = new Map();
    this.users = new Map();
    this.contacts = new Map(); // userId -> alias
    this.groups = new Map();
    this.blocked = new Set();
    this.presence = new Map(); // userId -> { online, lastSeen }
    this.outbox = [];
    this.inflight = new Set();
    this.inq = Promise.resolve();
    this.ws = null;
    this.connState = 'connecting';
    this.activeChat = null;
    this.mediaUrls = new Map();
    this.closed = false;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }
  toast(text) {
    this.emit('toast', { text });
  }

  async start(backup) {
    this.ns = await nsFor(this.api.server, this.me.id);
    this.db = await LocalDB.open(this.ns);

    // 1) 加密账号：本机已有就用本机的；否则从备份恢复或新建
    const saved = await secureGet(`account-${this.ns}`);
    if (saved) this.acc = E2EEAccount.fromJSON(saved);
    else if (backup) this.acc = await E2EEAccount.importEncrypted(backup.data, backup.passphrase);
    else this.acc = await E2EEAccount.create({ oneTimePreKeys: 100 });
    await this.saveAccount();

    // 2) 缓存
    for (const u of (await this.db.getKV('users')) || []) this.users.set(u.id, u);
    for (const c of await this.db.allChats()) this.chats.set(c.id, c);
    this.outbox = (await this.db.getKV('outbox')) || [];
    this.settings = { notifyPreview: true, notify: true, enterToSend: true, ...((await this.db.getKV('settings')) || {}) };
    this.users.set(this.me.id, this.me);

    // 3) 与服务器同步（失败不阻止进入界面，连上后会再同步）
    await this.syncServer().catch((e) => {
      if (e.status === 401) throw e;
      console.warn('sync failed', e);
    });
    this.connect();
  }

  async syncServer() {
    await this.syncKeys();
    const [me, contacts, groups, blocks] = await Promise.all([
      this.api.get('/api/me'), this.api.get('/api/contacts'), this.api.get('/api/groups'), this.api.get('/api/blocks'),
    ]);
    this.me = me;
    this.users.set(me.id, me);
    this.contacts.clear();
    for (const c of contacts) {
      this.rememberUser(c);
      this.contacts.set(c.id, c.alias || null);
      if (c.online !== undefined) this.presence.set(c.id, { online: c.online, lastSeen: c.lastSeen });
    }
    const seen = new Set();
    for (const g of groups) {
      this.setGroup(g);
      seen.add(g.id);
    }
    // 不在服务器列表里的群：说明已被移出
    for (const chat of this.chats.values()) {
      if (chat.type === 'group' && !seen.has(chat.groupId) && !chat.left) {
        chat.left = true;
        await this.db.putChat(chat);
      }
    }
    this.blocked = new Set(blocks.map((b) => b.id));
    this.persistUsers();
    this.emit('me');
    this.emit('chats');
  }

  // 保证服务器上的公钥与本机一致，一次性预密钥充足，签名预密钥不过期
  async syncKeys() {
    let serverIk = null;
    try {
      serverIk = (await this.api.get(`/api/keys/${this.me.id}/identity`)).identityKey;
    } catch (e) {
      if (e.status !== 404) throw e;
    }
    const mine = this.acc.identityKey;
    if (!serverIk || serverIk.dh !== mine.dh || serverIk.sig !== mine.sig) {
      // 新设备或其它设备覆盖过：以本机为准重新上传（"最后登录的设备生效"）
      await this.api.put('/api/keys', this.acc.publicBundle());
      return;
    }
    if (Date.now() - (this.acc.s.signedPreKey.createdAt || 0) > SPK_MAX_AGE) {
      await this.api.put('/api/keys/signed', await this.acc.rotateSignedPreKey());
      await this.saveAccount();
    }
    const { oneTimePreKeys } = await this.api.get('/api/keys/count');
    if (oneTimePreKeys < OTK_MIN) await this.replenishPreKeys();
  }

  async replenishPreKeys() {
    const list = await this.acc.generateOneTimePreKeys(OTK_BATCH);
    await this.saveAccount();
    await this.api.post('/api/keys/prekeys', { oneTimePreKeys: list });
  }

  saveAccount() {
    return secureSet(`account-${this.ns}`, JSON.stringify(this.acc.toJSON()));
  }

  async logout({ wipe = false } = {}) {
    this.closed = true;
    this.ws?.close();
    await this.api.logout().catch(() => {});
    await secureSet('session', null);
    if (wipe) {
      this.db.close();
      await secureSet(`account-${this.ns}`, null);
      await LocalDB.destroy(this.ns);
    }
    this.emit('logout', {});
  }

  async forceLogout(reason) {
    if (this.closed) return;
    this.closed = true;
    this.ws?.close();
    await secureSet('session', null);
    this.emit('logout', { reason });
  }

  // ------------------------------------------------------------ 用户 / 联系人
  rememberUser(u) {
    const old = this.users.get(u.id) || {};
    this.users.set(u.id, { id: u.id, phone: u.phone, name: u.name, about: u.about, avatar: u.avatar ?? old.avatar ?? null });
  }
  persistUsers() {
    clearTimeout(this._pu);
    this._pu = setTimeout(() => this.db.setKV('users', [...this.users.values()]), 500);
  }
  async ensureUser(id, refresh = false) {
    if (this.users.has(id) && !refresh) return this.users.get(id);
    try {
      const u = await this.api.get(`/api/users/${id}`);
      this.rememberUser(u);
      if (u.online !== undefined) this.presence.set(id, { online: u.online, lastSeen: u.lastSeen });
      this.persistUsers();
    } catch {
      if (!this.users.has(id)) this.users.set(id, { id, name: `用户 ${id}`, phone: '' });
    }
    return this.users.get(id);
  }
  displayName(id) {
    if (id === this.me.id) return '你';
    const alias = this.contacts.get(id);
    const u = this.users.get(id);
    return alias || u?.name || u?.phone || `用户 ${id}`;
  }
  async findByPhone(phone) {
    const u = await this.api.get(`/api/users?phone=${encodeURIComponent(phone)}`);
    this.rememberUser(u);
    this.persistUsers();
    return u;
  }
  async addContact(userId, alias) {
    const c = await this.api.post('/api/contacts', { userId, alias: alias || undefined });
    this.rememberUser(c);
    this.contacts.set(c.id, c.alias || null);
    this.emit('chats');
    return c;
  }
  async removeContact(userId) {
    await this.api.del(`/api/contacts/${userId}`);
    this.contacts.delete(userId);
    this.emit('chats');
  }
  async setBlocked(userId, block) {
    if (block) await this.api.post('/api/blocks', { userId });
    else await this.api.del(`/api/blocks/${userId}`);
    if (block) this.blocked.add(userId);
    else this.blocked.delete(userId);
    this.emit('chats');
  }
  async updateProfile(fields) {
    this.me = await this.api.patch('/api/me', fields);
    this.users.set(this.me.id, this.me);
    await this.saveSessionUser();
    this.emit('me');
  }
  async setAvatar(file) {
    if (file) this.me = await this.api.uploadAvatar(new Uint8Array(await file.arrayBuffer()), file.type);
    else this.me = await this.api.del('/api/me/avatar');
    this.users.set(this.me.id, this.me);
    await this.saveSessionUser();
    this.emit('me');
  }
  async saveSessionUser() {
    await secureSet('session', JSON.stringify({ server: this.api.server, token: this.api.token, user: this.me }));
  }
  async saveSettings(patch) {
    Object.assign(this.settings, patch);
    await this.db.setKV('settings', this.settings);
  }

  // ------------------------------------------------------------ 会话列表
  chatTitle(chat) {
    if (chat.type === 'group') return this.groups.get(chat.groupId)?.name || chat.name || '群组';
    return this.displayName(chat.peerId);
  }
  sortedChats() {
    return [...this.chats.values()].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  }
  totalUnread() {
    let n = 0;
    for (const c of this.chats.values()) n += c.unread || 0;
    return n;
  }
  getOrCreateChat(chatId, { touch = false } = {}) {
    let chat = this.chats.get(chatId);
    if (!chat) {
      const [kind, id] = chatId.split(':');
      chat = kind === 'g'
        ? { id: chatId, type: 'group', groupId: Number(id), unread: 0, updatedAt: Date.now(), lastMsg: null }
        : { id: chatId, type: 'direct', peerId: Number(id), unread: 0, updatedAt: Date.now(), lastMsg: null };
      this.chats.set(chatId, chat);
      touch = true;
    }
    if (touch) this.db.putChat(chat);
    return chat;
  }
  async openDirectChat(userId) {
    await this.ensureUser(userId);
    const chat = this.getOrCreateChat(`u:${userId}`);
    this.emit('chats');
    return chat;
  }
  async deleteChat(chatId) {
    this.chats.delete(chatId);
    await this.db.deleteChat(chatId);
    this.emit('chats');
  }
  async clearChat(chatId) {
    const chat = this.chats.get(chatId);
    await this.db.deleteChat(chatId);
    if (chat) {
      chat.lastMsg = null;
      chat.unread = 0;
      await this.db.putChat(chat);
    }
    this.emit('chats');
    this.emit('reload', { chatId });
  }

  setActiveChat(chatId) {
    const prev = this.activeChat;
    this.activeChat = chatId;
    const prevChat = prev && this.chats.get(prev);
    if (prevChat?.type === 'direct') this.wsSend({ type: 'presence_unsubscribe', userIds: [prevChat.peerId] });
    const chat = chatId && this.chats.get(chatId);
    if (chat?.type === 'direct') this.wsSend({ type: 'presence_subscribe', userIds: [chat.peerId] });
  }

  async storeMessage(msg, { bump = true, countUnread = false } = {}) {
    await this.db.putMessage(msg);
    const chat = this.getOrCreateChat(msg.chatId);
    if (bump && (!chat.lastMsg || msg.ts >= chat.lastMsg.ts || chat.lastMsg.id === msg.id)) {
      chat.lastMsg = { id: msg.id, ts: msg.ts, mine: msg.mine, from: msg.from, status: msg.status, text: previewOf(msg), type: msg.type };
      chat.updatedAt = Math.max(chat.updatedAt || 0, msg.ts);
    }
    if (countUnread) chat.unread = (chat.unread || 0) + 1;
    await this.db.putChat(chat);
    this.emit('message', { chatId: msg.chatId, msg });
    this.emit('chats');
  }

  async systemMessage(chatId, body, ts = Date.now()) {
    await this.storeMessage({ id: `sys-${randomId()}`, chatId, type: 'system', body, ts, mine: false, from: 0 });
  }

  // ------------------------------------------------------------ 群组
  setGroup(g) {
    for (const m of g.members) this.rememberUser(m);
    this.groups.set(g.id, g);
    const chat = this.chats.get(`g:${g.id}`);
    if (chat) {
      chat.name = g.name;
      const inGroup = g.members.some((m) => m.id === this.me.id);
      if (chat.left === inGroup) {
        chat.left = !inGroup;
        this.db.putChat(chat);
      }
    }
  }
  isGroupAdmin(groupId) {
    return this.groups.get(groupId)?.members.some((m) => m.id === this.me.id && m.role === 'admin');
  }
  async createGroup(name, memberIds) {
    const g = await this.api.post('/api/groups', { name, members: memberIds });
    this.setGroup(g);
    this.getOrCreateChat(`g:${g.id}`);
    this.emit('chats');
    return g;
  }
  async updateGroup(groupId, fields) {
    this.setGroup(await this.api.patch(`/api/groups/${groupId}`, fields));
    this.emit('chats');
  }
  async addGroupMembers(groupId, userIds) {
    this.setGroup(await this.api.post(`/api/groups/${groupId}/members`, { userIds }));
    this.emit('chats');
  }
  async removeGroupMember(groupId, userId) {
    await this.api.del(`/api/groups/${groupId}/members/${userId}`);
    if (userId === this.me.id) {
      const chat = this.chats.get(`g:${groupId}`);
      if (chat) {
        chat.left = true;
        await this.db.putChat(chat);
      }
      this.groups.delete(groupId);
    } else {
      this.setGroup(await this.api.get(`/api/groups/${groupId}`));
    }
    this.emit('chats');
  }
  async setGroupAdmin(groupId, userId, admin) {
    const path = `/api/groups/${groupId}/admins/${userId}`;
    this.setGroup(admin ? await this.api.put(path) : await this.api.del(path));
    this.emit('chats');
  }

  // ------------------------------------------------------------ WebSocket
  connect() {
    if (this.closed) return;
    this.setConn('connecting');
    const ws = new WebSocket(this.api.wsUrl);
    this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: this.api.token }));
    ws.onmessage = (e) => {
      let m;
      try {
        m = JSON.parse(e.data);
      } catch {
        return;
      }
      this.lastPong = Date.now();
      this.onWs(m);
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      clearInterval(this.pingTimer);
      this.inflight.clear();
      this.setConn('offline');
      if (e.code === 4001) return this.forceLogout('登录已失效，请重新登录');
      if (this.closed) return;
      this.retry = Math.min((this.retry || 0) + 1, 6);
      const delay = Math.min(30000, 1000 * 2 ** (this.retry - 1)) * (0.75 + Math.random() / 2);
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = setTimeout(() => this.connect(), delay);
    };
    ws.onerror = () => {};
  }

  reconnectNow() {
    clearTimeout(this.reconnectTimer);
    if (this.ws && this.ws.readyState <= 1) return;
    this.retry = 0;
    this.connect();
  }

  setConn(state) {
    this.connState = state;
    this.emit('conn', { state });
  }

  wsSend(obj) {
    if (this.ws?.readyState === 1 && this.connState === 'online') {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  onWs(m) {
    if (m.type === 'ready') {
      this.retry = 0;
      this.setConn('online');
      this.lastPong = Date.now();
      clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (Date.now() - this.lastPong > 70000) return this.ws?.close();
        this.wsSend({ type: 'ping' });
      }, 30000);
      this.setActiveChat(this.activeChat);
      // 重新连上后：再同步一次资料/群组，然后发送离线期间写好的消息
      this.syncServer().catch(() => {}).finally(() => this.flushOutbox());
      return;
    }
    if (m.type === 'typing') {
      const chatId = m.groupId ? `g:${m.groupId}` : `u:${m.from}`;
      this.emit('typing', { chatId, from: m.from, state: m.state });
      return;
    }
    if (m.type === 'presence') {
      this.presence.set(m.userId, { online: m.online, lastSeen: m.lastSeen });
      this.emit('presence', { userId: m.userId });
      return;
    }
    if (m.type === 'prekeys_low') {
      this.replenishPreKeys().catch(() => {});
      return;
    }
    if (m.type === 'pong') return;
    // 需要按顺序处理的事件（解密依赖顺序）
    this.inq = this.inq.then(() => this.handleEvent(m)).catch((e) => console.error('event failed', m.type, e));
  }

  ack(qid) {
    if (qid) this.wsSend({ type: 'ack', qids: [qid] });
  }

  async handleEvent(m) {
    switch (m.type) {
      case 'message': await this.onIncomingMessage(m); break;
      case 'receipt': await this.onReceipt(m); break;
      case 'group_update': await this.onGroupUpdate(m); break;
      case 'identity_changed': await this.onIdentityChanged(m); break;
      case 'sent': await this.onSent(m); break;
      case 'error': this.onServerError(m); break;
      default: if (m.qid) this.ack(m.qid);
    }
  }

  // ------------------------------------------------------------ 接收
  async onIncomingMessage(m) {
    const chatId = m.groupId ? `g:${m.groupId}` : `u:${m.from}`;
    if (await this.db.getMessage(chatId, m.id)) return this.ack(m.qid); // 重复投递

    let payload = null;
    let identityChanged = false;
    try {
      ({ payload, identityChanged } = await this.acc.decrypt(m.from, m.envelope));
      await this.saveAccount();
    } catch (e) {
      console.warn('decrypt failed', e);
    }
    await this.ensureUser(m.from);
    if (m.groupId && !this.groups.has(m.groupId)) {
      try {
        this.setGroup(await this.api.get(`/api/groups/${m.groupId}`));
      } catch {}
    }
    if (identityChanged && this.chats.has(`u:${m.from}`)) {
      await this.systemMessage(`u:${m.from}`, `${this.displayName(m.from)} 的安全码已更改。点击联系人信息可核对安全码。`, m.ts - 1);
    }

    // 控制消息：对所有人删除
    if (payload?.t === 'delete') {
      const target = await this.db.getMessage(chatId, String(payload.target));
      if (target && target.from === m.from) {
        Object.assign(target, { type: 'deleted', body: '', media: null, caption: '', thumb: null, replyTo: null });
        await this.storeMessage(target, { bump: true });
      }
      return this.ack(m.qid);
    }

    const msg = { id: m.id, chatId, from: m.from, mine: false, ts: m.ts, sentTs: payload?.ts, readSent: false };
    if (!payload) {
      msg.type = 'undecryptable';
    } else if (payload.t === 'text') {
      msg.type = 'text';
      msg.body = String(payload.body ?? '');
    } else if ((payload.t === 'image' || payload.t === 'file') && payload.media) {
      msg.type = payload.t;
      msg.media = payload.media;
      msg.caption = String(payload.caption || '');
      msg.thumb = typeof payload.thumb === 'string' && payload.thumb.startsWith('data:image/') ? payload.thumb : null;
    } else {
      msg.type = 'text';
      msg.body = '[此版本不支持的消息类型]';
    }
    if (payload?.replyTo && typeof payload.replyTo === 'object') {
      msg.replyTo = { id: String(payload.replyTo.id), from: Number(payload.replyTo.from), text: String(payload.replyTo.text || '').slice(0, 200) };
    }

    const viewing = this.activeChat === chatId && document.hasFocus() && document.visibilityState === 'visible';
    await this.storeMessage(msg, { countUnread: !viewing });
    this.ack(m.qid);
    if (viewing) this.markRead(chatId);
    this.emit('incoming', { chatId, msg, viewing });
  }

  async onReceipt(m) {
    const chatId = m.groupId ? `g:${m.groupId}` : `u:${m.from}`;
    const rank = { pending: 0, sent: 1, delivered: 2, read: 3 };
    for (const id of m.msgIds || []) {
      const msg = await this.db.getMessage(chatId, id);
      if (!msg || !msg.mine) continue;
      let status = m.status;
      if (m.groupId) {
        msg.deliveredBy = [...new Set([...(msg.deliveredBy || []), m.from])];
        if (m.status === 'read') msg.readBy = [...new Set([...(msg.readBy || []), m.from])];
        const rcpts = msg.recipients || [];
        const all = (list) => rcpts.length > 0 && rcpts.every((u) => list.includes(u));
        status = all(msg.readBy || []) ? 'read' : all([...(msg.deliveredBy || []), ...(msg.readBy || [])]) ? 'delivered' : 'sent';
      }
      if (rank[status] > rank[msg.status || 'sent']) msg.status = status;
      await this.storeMessage(msg, { bump: true });
    }
    this.ack(m.qid);
  }

  async onGroupUpdate(m) {
    const g = m.group;
    const chatId = `g:${m.groupId}`;
    const iAmTarget = (m.targets || []).includes(this.me.id);
    if (g) this.setGroup(g);
    if (!g || ((m.action === 'member_removed' || m.action === 'member_left') && iAmTarget)) {
      this.groups.delete(m.groupId);
      const chat = this.chats.get(chatId);
      if (chat) {
        chat.left = true;
        await this.db.putChat(chat);
      }
    }
    if (m.action === 'created' || (m.action === 'members_added' && iAmTarget)) this.getOrCreateChat(chatId, { touch: true });
    if (this.chats.has(chatId)) {
      const actor = this.displayName(m.actor);
      const targets = (m.targets || []).map((t) => this.displayName(t)).join('、');
      const text = {
        created: `${actor} 创建了群组"${g?.name || ''}"`,
        updated: `${actor} 修改了群组信息`,
        members_added: `${actor} 添加了 ${targets}`,
        member_removed: `${actor} 移除了 ${targets}`,
        member_left: `${targets} 退出了群组`,
        admin_added: `${targets} 成为了管理员`,
        admin_removed: `${targets} 不再是管理员`,
      }[m.action];
      if (text) await this.systemMessage(chatId, text, m.ts);
    }
    this.ack(m.qid);
    this.emit('chats');
    this.emit('group', { groupId: m.groupId });
  }

  async onIdentityChanged(m) {
    this.acc.deleteSession(m.userId);
    await this.saveAccount();
    if (this.chats.has(`u:${m.userId}`)) {
      await this.ensureUser(m.userId);
      await this.systemMessage(`u:${m.userId}`, `${this.displayName(m.userId)} 的安全码已更改（可能换了设备）。点击联系人信息可核对安全码。`, m.ts);
    }
    this.ack(m.qid);
  }

  async onSent(m) {
    const entry = this.outbox.find((o) => o.id === m.id);
    if (!entry) return;
    // 群里有成员没收到加密副本（例如刚入群）：补发给他们
    if (m.groupId && m.missing?.length && !entry.retriedMissing) {
      entry.retriedMissing = true;
      await this.sendGroupEnvelopes(entry, m.missing).catch(() => {});
    }
    this.outbox = this.outbox.filter((o) => o.id !== m.id);
    this.inflight.delete(m.id);
    await this.db.setKV('outbox', this.outbox);
    const msg = await this.db.getMessage(entry.chatId, m.id);
    if (msg && (msg.status === 'pending' || !msg.status)) {
      msg.status = 'sent';
      await this.storeMessage(msg, { bump: true });
    }
  }

  onServerError(m) {
    const entry = m.ref && this.outbox.find((o) => o.id === m.ref);
    if (entry) {
      this.inflight.delete(entry.id);
      this.outbox = this.outbox.filter((o) => o.id !== entry.id);
      this.db.setKV('outbox', this.outbox);
      this.db.getMessage(entry.chatId, entry.id).then((msg) => {
        if (msg) {
          msg.status = 'failed';
          this.storeMessage(msg);
        }
      });
    }
    this.toast(m.message || '服务器返回错误');
  }

  // ------------------------------------------------------------ 发送
  canSend(chatId) {
    const chat = this.chats.get(chatId);
    if (!chat) return false;
    if (chat.type === 'group') return !chat.left && this.groups.has(chat.groupId);
    return !this.blocked.has(chat.peerId);
  }

  // local 为 null 时表示控制消息（如撤回），不在本地显示
  async sendPayload(chatId, payload, local) {
    const chat = this.getOrCreateChat(chatId);
    const id = randomId();
    const ts = Date.now();
    payload = { ...payload, ts };
    const msg = { id, chatId, from: this.me.id, mine: true, ts, status: 'pending', ...local };
    if (chat.type === 'group') msg.recipients = (this.groups.get(chat.groupId)?.members || []).map((u) => u.id).filter((u) => u !== this.me.id);
    if (local) await this.storeMessage(msg);
    this.outbox.push({ id, chatId, payload });
    await this.db.setKV('outbox', this.outbox);
    this.flushOutbox();
    return msg;
  }

  async sendText(chatId, text, replyTo) {
    const body = text.trim();
    if (!body) return;
    const payload = { t: 'text', body };
    const local = { type: 'text', body };
    if (replyTo) payload.replyTo = local.replyTo = { id: replyTo.id, from: replyTo.from, text: previewOf(replyTo).slice(0, 200) };
    return this.sendPayload(chatId, payload, local);
  }

  async sendFile(chatId, file, caption = '', replyTo = null) {
    if (file.size > 64 * 1024 * 1024) throw new Error('文件不能超过 64 MB');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const isImage = /^image\/(png|jpeg|gif|webp|bmp)$/.test(file.type);
    let thumb = null;
    let dims = {};
    if (isImage) ({ thumb, ...dims } = await makeThumb(file).catch(() => ({ thumb: null })));
    const enc = await encryptAttachment(bytes);
    const up = await this.api.uploadMedia(enc.ciphertext);
    const media = { id: up.id, key: enc.key, sha256: enc.sha256, mime: file.type || 'application/octet-stream', size: file.size, name: file.name, ...dims };
    await this.db.putMedia(up.id, bytes);
    const t = isImage ? 'image' : 'file';
    const payload = { t, media, caption, thumb };
    const local = { type: t, media, caption, thumb };
    if (replyTo) payload.replyTo = local.replyTo = { id: replyTo.id, from: replyTo.from, text: previewOf(replyTo).slice(0, 200) };
    return this.sendPayload(chatId, payload, local);
  }

  async deleteMessage(msg, forEveryone) {
    if (forEveryone && msg.mine) {
      await this.sendPayload(msg.chatId, { t: 'delete', target: msg.id }, null);
      Object.assign(msg, { type: 'deleted', body: '', media: null, caption: '', thumb: null, replyTo: null });
      await this.storeMessage(msg, { bump: true });
    } else {
      await this.db.deleteMessage(msg.chatId, msg.id);
      const chat = this.chats.get(msg.chatId);
      if (chat?.lastMsg?.id === msg.id) {
        const rest = await this.db.messages(msg.chatId, 5);
        const last = rest[rest.length - 1];
        chat.lastMsg = last ? { id: last.id, ts: last.ts, mine: last.mine, from: last.from, status: last.status, text: previewOf(last), type: last.type } : null;
        await this.db.putChat(chat);
      }
      this.emit('reload', { chatId: msg.chatId });
      this.emit('chats');
    }
  }

  async flushOutbox() {
    if (this.connState !== 'online' || this.flushing) return;
    this.flushing = true;
    try {
      for (const entry of [...this.outbox]) {
        if (this.connState !== 'online') break;
        if (this.inflight.has(entry.id)) continue;
        const chat = this.chats.get(entry.chatId);
        if (!chat) continue;
        try {
          this.inflight.add(entry.id);
          if (chat.type === 'group') await this.sendGroupEnvelopes(entry);
          else await this.sendDirect(entry, chat.peerId);
        } catch (e) {
          this.inflight.delete(entry.id);
          if (e instanceof ApiError && e.status === 404) {
            // 对方没有上传密钥（从未登录客户端），无法加密
            this.outbox = this.outbox.filter((o) => o.id !== entry.id);
            await this.db.setKV('outbox', this.outbox);
            const msg = await this.db.getMessage(entry.chatId, entry.id);
            if (msg) {
              msg.status = 'failed';
              await this.storeMessage(msg);
            }
            this.toast('对方还没有登录过客户端，暂时无法发送加密消息');
          } else {
            console.warn('send failed, will retry', e);
          }
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  async ensureSession(userId) {
    if (this.acc.hasSession(userId)) return;
    const bundle = await this.api.get(`/api/keys/${userId}`);
    const { identityChanged } = await this.acc.initSession(userId, bundle);
    await this.saveAccount();
    if (identityChanged && this.chats.has(`u:${userId}`)) {
      await this.systemMessage(`u:${userId}`, `${this.displayName(userId)} 的安全码已更改。点击联系人信息可核对安全码。`);
    }
  }

  async sendDirect(entry, peerId) {
    await this.ensureSession(peerId);
    const envelope = await this.acc.encrypt(peerId, entry.payload);
    await this.saveAccount();
    if (!this.wsSend({ type: 'send', id: entry.id, to: peerId, envelope })) this.inflight.delete(entry.id);
  }

  async sendGroupEnvelopes(entry, only = null) {
    const chat = this.chats.get(entry.chatId);
    const g = this.groups.get(chat.groupId);
    if (!g) throw new Error('不在群中');
    const targets = (only || g.members.map((u) => u.id)).filter((u) => u !== this.me.id);
    const envelopes = {};
    for (const uid of targets) {
      try {
        await this.ensureSession(uid);
        envelopes[uid] = await this.acc.encrypt(uid, entry.payload);
      } catch (e) {
        console.warn('skip member', uid, e); // 没有密钥的成员跳过
      }
    }
    await this.saveAccount();
    if (!this.wsSend({ type: 'send_group', id: entry.id, groupId: chat.groupId, envelopes })) this.inflight.delete(entry.id);
  }

  // ------------------------------------------------------------ 已读、正在输入
  async markRead(chatId) {
    const chat = this.chats.get(chatId);
    if (!chat) return;
    const msgs = await this.db.messages(chatId, 200);
    const bySender = new Map();
    for (const msg of msgs) {
      if (msg.mine || msg.readSent || msg.type === 'system') continue;
      msg.readSent = true;
      await this.db.putMessage(msg);
      if (!bySender.has(msg.from)) bySender.set(msg.from, []);
      bySender.get(msg.from).push(msg.id);
    }
    for (const [from, msgIds] of bySender) {
      this.wsSend({ type: 'read', to: from, msgIds, ...(chat.type === 'group' ? { groupId: chat.groupId } : {}) });
    }
    if (chat.unread) {
      chat.unread = 0;
      await this.db.putChat(chat);
      this.emit('chats');
    }
  }

  sendTyping(chatId, state) {
    const chat = this.chats.get(chatId);
    if (!chat) return;
    this.wsSend(chat.type === 'group' ? { type: 'typing', groupId: chat.groupId, state } : { type: 'typing', to: chat.peerId, state });
  }

  // ------------------------------------------------------------ 附件
  async mediaUrl(media) {
    if (this.mediaUrls.has(media.id)) return this.mediaUrls.get(media.id);
    let bytes = await this.db.getMedia(media.id);
    if (!bytes) {
      const ct = await this.api.downloadMedia(media.id);
      bytes = await decryptAttachment(ct, media.key, media.sha256);
      await this.db.putMedia(media.id, bytes);
    }
    const url = URL.createObjectURL(new Blob([bytes], { type: media.mime || 'application/octet-stream' }));
    this.mediaUrls.set(media.id, url);
    return url;
  }

  // ------------------------------------------------------------ 安全
  async safetyNumber(userId) {
    if (!this.acc.knownIdentity(String(userId))) {
      try {
        await this.ensureSession(userId);
      } catch {
        return null;
      }
    }
    return this.acc.safetyNumber(this.me.id, userId);
  }

  async exportKeyBackup(passphrase) {
    return this.acc.exportEncrypted(passphrase);
  }

  async changePassword(oldPassword, newPassword) {
    await this.api.post('/api/me/password', { oldPassword, newPassword });
  }
}

// 生成图片缩略图（随消息一起加密发送，对方无需下载原图即可预览）
async function makeThumb(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 96 / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const res = { thumb: c.toDataURL('image/jpeg', 0.6), w: bmp.width, h: bmp.height };
  bmp.close();
  return res;
}
