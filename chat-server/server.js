'use strict';
// 启动入口：node server.js（Windows 上可直接双击 start.bat）
const config = require('./src/config');
const { createChatServer } = require('./src/app');

const { server, close, protocol } = createChatServer(config);

server.listen(config.port, config.host, () => {
  const shown = config.host === '0.0.0.0' ? 'localhost' : config.host;
  console.log(`聊天服务器已启动: ${protocol}://${shown}:${config.port}`);
  console.log(`WebSocket:        ${protocol === 'https' ? 'wss' : 'ws'}://${shown}:${config.port}/ws`);
  console.log(`数据目录:         ${config.dataDir}`);
  if (protocol === 'http') console.log('提示：生产环境请配置 HTTPS（见 README.md）');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') console.error(`端口 ${config.port} 已被占用，请在 config.json 中修改 port`);
  else if (err.code === 'EACCES') console.error(`没有权限监听端口 ${config.port}（Windows 上 443/80 可能需要管理员权限）`);
  else console.error(err);
  process.exit(1);
});

// Ctrl+C（Windows 控制台同样会触发 SIGINT）
let stopping = false;
for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK']) {
  process.on(sig, async () => {
    if (stopping) return;
    stopping = true;
    console.log('正在关闭…');
    await close();
    process.exit(0);
  });
}
