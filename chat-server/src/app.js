'use strict';
// 组装 Express 应用 + WebSocket，导出 createChatServer 方便测试时启动临时实例。
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const express = require('express');
const { openDb } = require('./db');
const { createAuth } = require('./auth');
const { createHub } = require('./hub');
const { attachWebSocket } = require('./ws');
const { HttpError, now } = require('./util');

function createChatServer(config) {
  const db = openDb(config.dataDir);
  const auth = createAuth(db, config);
  const hub = createHub(db);
  const ctx = { db, auth, hub, config };

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', true);

  // CORS（前端单独部署时需要）
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (config.corsOrigins.includes('*') || config.corsOrigins.includes(origin))) {
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Max-Age': '86400',
        Vary: 'Origin',
      });
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use((req, res, next) => {
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    next();
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true, time: now() }));

  // 媒体上传是原始二进制流，必须在 JSON 解析器之前挂载
  app.use('/api/media', require('./routes/media')(ctx));
  app.use(express.json({ limit: '1mb' }));
  app.use('/api/auth', require('./routes/auth')(ctx));
  app.use('/api/keys', require('./routes/keys')(ctx));
  app.use('/api/groups', require('./routes/groups')(ctx));
  app.use('/api/avatars', express.static(path.join(config.dataDir, 'avatars'), { maxAge: '7d', fallthrough: false }));
  app.use('/api', require('./routes/users')(ctx));

  // 前端（以后做好的 WhatsApp 风格界面）放在 public/ 目录即可直接由本服务托管
  const publicDir = path.join(__dirname, '..', 'public');
  if (fs.existsSync(publicDir)) app.use(express.static(publicDir));
  // 共享的加密库，前端可以直接 <script type="module" src="/shared/e2ee.js">
  app.use('/shared', express.static(path.join(__dirname, '..', 'shared')));

  app.use('/api', (_req, _res, next) => next(new HttpError(404, '接口不存在')));
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? '服务器内部错误' : err.message });
  });

  const useTls = (config.tls.pfx && fs.existsSync(config.tls.pfx)) || (config.tls.cert && config.tls.key);
  const server = useTls
    ? https.createServer(
        config.tls.pfx
          ? { pfx: fs.readFileSync(config.tls.pfx), passphrase: config.tls.passphrase || undefined }
          : { cert: fs.readFileSync(config.tls.cert), key: fs.readFileSync(config.tls.key) },
        app
      )
    : http.createServer(app);

  const wss = attachWebSocket(server, ctx);

  // 定时清理：过期登录、过期离线消息、过期媒体
  const cleanup = () => {
    const t = now();
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);
    db.prepare('DELETE FROM queue WHERE created_at < ?').run(t - config.queueTtlDays * 86400000);
    const old = db.prepare('DELETE FROM media WHERE created_at < ? RETURNING id').all(t - config.mediaTtlDays * 86400000);
    for (const { id } of old) fs.rm(path.join(config.dataDir, 'media', id), { force: true }, () => {});
  };
  cleanup();
  const timer = setInterval(cleanup, 3600_000);
  timer.unref();

  function close() {
    clearInterval(timer);
    for (const ws of wss.clients) ws.terminate();
    wss.close();
    return new Promise((resolve) => server.close(() => {
      db.close();
      resolve();
    }));
  }

  return { app, server, db, close, protocol: useTls ? 'https' : 'http' };
}

module.exports = { createChatServer };
