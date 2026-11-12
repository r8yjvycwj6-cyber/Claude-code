'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createChatServer } = require('../src/app');

async function startServer() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-test-'));
  fs.mkdirSync(path.join(dataDir, 'media'));
  fs.mkdirSync(path.join(dataDir, 'avatars'));
  const config = {
    host: '127.0.0.1', port: 0, dataDir, tls: {}, corsOrigins: ['*'], tokenTtlDays: 30,
    maxMediaBytes: 1024 * 1024, mediaTtlDays: 30, queueTtlDays: 30, maxGroupSize: 256, trustProxy: false,
  };
  const srv = createChatServer(config);
  await new Promise((r) => srv.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.server.address().port}`;
  return {
    base,
    db: srv.db,
    dataDir,
    async stop() {
      await srv.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

async function api(base, method, url, { token, body, raw, headers = {} } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer());
  return { status: res.status, data };
}

// 简单的 WebSocket 测试客户端
class WsClient {
  constructor(base, token) {
    this.events = [];
    this.waiters = [];
    this.ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      this.events.push(m);
      for (const w of [...this.waiters]) {
        if (w.pred(m)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(m);
        }
      }
    };
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = () => this.send({ type: 'auth', token });
      this.ws.onerror = reject;
      this.next((m) => m.type === 'ready').then(resolve);
    });
  }
  send(obj) {
    this.ws.send(JSON.stringify(obj));
  }
  // 等待下一条（或已收到但未消费的）满足条件的消息
  next(pred, timeout = 3000) {
    const idx = this.events.findIndex((m) => !m._used && pred(m));
    if (idx >= 0) {
      this.events[idx]._used = true;
      return Promise.resolve(this.events[idx]);
    }
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('等待 WebSocket 消息超时')), timeout);
      this.waiters.push({
        pred: (m) => !m._used && pred(m),
        resolve: (m) => {
          clearTimeout(t);
          m._used = true;
          resolve(m);
        },
      });
    });
  }
  close() {
    this.ws.close();
    return new Promise((r) => setTimeout(r, 50));
  }
}

module.exports = { startServer, api, WsClient };
