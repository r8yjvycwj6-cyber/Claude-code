'use strict';
// 测试辅助：启动一个临时聊天服务器 + 一个静态网页服务器（托管 app/，模拟桌面端的独立来源）
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const SERVER_DIR = path.resolve(__dirname, '..', '..', 'chat-server');
const APP_DIR = path.resolve(__dirname, '..', 'app');

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' };

async function startAll() {
  const { createChatServer } = require(path.join(SERVER_DIR, 'src', 'app.js'));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-ui-test-'));
  fs.mkdirSync(path.join(dataDir, 'media'));
  fs.mkdirSync(path.join(dataDir, 'avatars'));
  const chat = createChatServer({
    host: '127.0.0.1', port: 0, dataDir, tls: {}, corsOrigins: ['*'], tokenTtlDays: 30,
    maxMediaBytes: 64 * 1024 * 1024, mediaTtlDays: 30, queueTtlDays: 30, maxGroupSize: 256, trustProxy: false,
  });
  await new Promise((r) => chat.server.listen(0, '127.0.0.1', r));

  const stat = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p === '/') p = '/index.html';
    const file = path.normalize(path.join(APP_DIR, p));
    if (!file.startsWith(APP_DIR) || !fs.existsSync(file)) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => stat.listen(0, '127.0.0.1', r));

  return {
    api: `http://127.0.0.1:${chat.server.address().port}`,
    app: `http://127.0.0.1:${stat.address().port}`,
    db: chat.db,
    async stop() {
      stat.close();
      await chat.close();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}

module.exports = { startAll };

if (require.main === module) {
  startAll().then((s) => {
    console.log(`API: ${s.api}\nApp: ${s.app}`);
  });
}
