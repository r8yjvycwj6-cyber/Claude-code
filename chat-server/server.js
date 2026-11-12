'use strict';
// 启动入口：node server.js（Windows 上可直接双击 start.bat）
const os = require('os');
// 密码哈希等耗时运算在线程池里执行，线程数跟随 CPU 核数（必须在任何异步操作之前设置）
process.env.UV_THREADPOOL_SIZE ||= String(Math.min(16, Math.max(4, os.cpus().length)));

const config = require('./src/config');
const { createChatServer } = require('./src/app');

let srv;
try {
  srv = createChatServer(config);
} catch (e) {
  console.error(`启动失败：${e.message}`);
  if (config.tls.enabled) console.error('HTTPS 证书配置有误。请检查 config.json 中的 tlsPfx / tlsCert / tlsKey 路径（申请证书的方法见 README.md）。');
  process.exit(1);
}
const { server, close, protocol } = srv;

// 本机的公网 IPv6 地址（2000::/3 全球单播地址），方便设置域名的 AAAA 记录
function globalIPv6() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv6' && !a.internal && /^[23][0-9a-f]{3}:/i.test(a.address)) out.push(`${a.address}（${name}）`);
    }
  }
  return out;
}

function onListening() {
  const addr = server.address();
  const dualStack = addr.family === 'IPv6' && addr.address === '::';
  const ws = protocol === 'https' ? 'wss' : 'ws';
  const local = `${protocol}://localhost:${config.port}`;
  console.log(`聊天服务器已启动: ${local}`);
  console.log(`WebSocket:        ${ws}://localhost:${config.port}/ws`);
  console.log(`监听地址:         ${dualStack ? `[::]:${config.port}（IPv6 + IPv4 双栈）` : `${addr.address}:${config.port}（仅 IPv4）`}`);
  if (config.domain) console.log(`对外地址:         ${protocol}://${config.domain}:${config.port}`);
  const v6 = globalIPv6();
  if (v6.length) {
    console.log('本机公网 IPv6:');
    for (const a of v6) console.log(`                  ${a}`);
    console.log('                  （域名的 AAAA 记录应指向其中的固定地址，而不是"临时 IPv6 地址"，可用 ipconfig 区分）');
  } else if (dualStack) {
    console.log('提示：没有检测到公网 IPv6 地址');
  }
  console.log(`数据目录:         ${config.dataDir}`);
  if (protocol === 'http') console.log('提示：生产环境请配置 HTTPS（见 README.md）');
}

let triedFallback = false;
server.on('error', (err) => {
  // 系统没有启用 IPv6 时自动退回 IPv4
  if (!triedFallback && config.host === '::' && ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EINVAL'].includes(err.code)) {
    triedFallback = true;
    console.warn(`本机不支持 IPv6（${err.code}），改为只监听 IPv4`);
    server.listen(config.port, '0.0.0.0');
    return;
  }
  if (err.code === 'EADDRINUSE') console.error(`端口 ${config.port} 已被占用，请在 config.json 中修改 port`);
  else if (err.code === 'EACCES') console.error(`没有权限监听端口 ${config.port}`);
  else console.error(err);
  process.exit(1);
});

// "::" 在 Windows / Linux 上默认就是双栈（同时接受 IPv4 连接）
server.once('listening', onListening);
server.listen({ port: config.port, host: config.host, ipv6Only: false });

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
