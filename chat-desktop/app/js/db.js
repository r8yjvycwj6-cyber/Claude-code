// 本地数据库（IndexedDB）。
// 聊天记录只保存在本机（服务器在送达后就删除了密文），并且用本地密钥 AES-256-GCM 加密后再写入磁盘；
// 本地密钥本身由系统安全存储（Windows DPAPI）保护。
import { secureGet, secureSet } from './platform.js';
import { b64e, b64d } from '../lib/e2ee.mjs';

const te = new TextEncoder();
const td = new TextDecoder();

function req2p(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class LocalDB {
  static async open(ns) {
    let keyB64 = await secureGet(`localkey-${ns}`);
    if (!keyB64) {
      keyB64 = b64e(crypto.getRandomValues(new Uint8Array(32)));
      await secureSet(`localkey-${ns}`, keyB64);
    }
    const key = await crypto.subtle.importKey('raw', b64d(keyB64), 'AES-GCM', false, ['encrypt', 'decrypt']);
    const idb = await new Promise((resolve, reject) => {
      const r = indexedDB.open(`securechat-${ns}`, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        db.createObjectStore('kv');
        db.createObjectStore('chats');
        const m = db.createObjectStore('messages', { keyPath: 'k' });
        m.createIndex('byChat', ['chatId', 'ts']);
        db.createObjectStore('media');
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
    return new LocalDB(idb, key);
  }

  constructor(idb, key) {
    this.idb = idb;
    this.key = key;
  }

  async seal(obj) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = obj instanceof Uint8Array ? obj : te.encode(JSON.stringify(obj));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, this.key, data));
    const out = new Uint8Array(12 + ct.length);
    out.set(iv);
    out.set(ct, 12);
    return out;
  }
  async open(buf, binary = false) {
    const u8 = new Uint8Array(buf);
    const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: u8.slice(0, 12) }, this.key, u8.slice(12)));
    return binary ? pt : JSON.parse(td.decode(pt));
  }

  tx(stores, mode = 'readonly') {
    return this.idb.transaction(stores, mode);
  }

  // ---- 简单键值
  async getKV(k) {
    const v = await req2p(this.tx('kv').objectStore('kv').get(k));
    return v ? this.open(v) : null;
  }
  async setKV(k, v) {
    const sealed = await this.seal(v);
    await req2p(this.tx('kv', 'readwrite').objectStore('kv').put(sealed, k));
  }

  // ---- 会话列表
  async allChats() {
    const store = this.tx('chats').objectStore('chats');
    const vals = await req2p(store.getAll());
    return Promise.all(vals.map((v) => this.open(v)));
  }
  async putChat(chat) {
    const sealed = await this.seal(chat);
    await req2p(this.tx('chats', 'readwrite').objectStore('chats').put(sealed, chat.id));
  }
  async deleteChat(chatId) {
    const tx = this.tx(['chats', 'messages'], 'readwrite');
    tx.objectStore('chats').delete(chatId);
    const idx = tx.objectStore('messages').index('byChat');
    const range = IDBKeyRange.bound([chatId, 0], [chatId, Number.MAX_SAFE_INTEGER]);
    await new Promise((resolve, reject) => {
      const c = idx.openCursor(range);
      c.onsuccess = () => {
        if (c.result) {
          c.result.delete();
          c.result.continue();
        } else resolve();
      };
      c.onerror = () => reject(c.error);
    });
  }

  // ---- 消息（chatId、ts 不加密以便排序查询，内容加密）
  async putMessage(msg) {
    const sealed = await this.seal(msg);
    await req2p(
      this.tx('messages', 'readwrite').objectStore('messages').put({ k: `${msg.chatId}|${msg.id}`, chatId: msg.chatId, ts: msg.ts, v: sealed })
    );
  }
  async deleteMessage(chatId, id) {
    await req2p(this.tx('messages', 'readwrite').objectStore('messages').delete(`${chatId}|${id}`));
  }
  async getMessage(chatId, id) {
    const r = await req2p(this.tx('messages').objectStore('messages').get(`${chatId}|${id}`));
    return r ? this.open(r.v) : null;
  }
  // 取某个会话中 beforeTs 之前最近的 limit 条，按时间正序返回
  async messages(chatId, limit = 60, beforeTs = Number.MAX_SAFE_INTEGER) {
    const idx = this.tx('messages').objectStore('messages').index('byChat');
    const range = IDBKeyRange.bound([chatId, 0], [chatId, beforeTs], false, true);
    const rows = [];
    await new Promise((resolve, reject) => {
      const c = idx.openCursor(range, 'prev');
      c.onsuccess = () => {
        if (c.result && rows.length < limit) {
          rows.push(c.result.value);
          c.result.continue();
        } else resolve();
      };
      c.onerror = () => reject(c.error);
    });
    const out = await Promise.all(rows.map((r) => this.open(r.v)));
    return out.reverse();
  }

  // ---- 已解密的附件缓存（同样加密存放）
  async getMedia(id) {
    const v = await req2p(this.tx('media').objectStore('media').get(id));
    return v ? this.open(v, true) : null;
  }
  async putMedia(id, bytes) {
    const sealed = await this.seal(bytes);
    await req2p(this.tx('media', 'readwrite').objectStore('media').put(sealed, id));
  }

  close() {
    this.idb.close();
  }

  static async destroy(ns) {
    await secureSet(`localkey-${ns}`, null);
    await new Promise((resolve) => {
      const r = indexedDB.deleteDatabase(`securechat-${ns}`);
      r.onsuccess = r.onerror = r.onblocked = () => resolve();
    });
  }
}
