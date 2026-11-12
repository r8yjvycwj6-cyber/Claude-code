'use strict';
// 配置：优先读环境变量，其次读 config.json（与 server.js 同目录），最后用默认值。
// 所有路径都用 path 模块拼接，Windows / Linux 通用。
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let file = {};
const cfgPath = process.env.CHAT_CONFIG || path.join(ROOT, 'config.json');
if (fs.existsSync(cfgPath)) {
  file = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
}

function pick(envName, key, def) {
  if (process.env[envName] !== undefined && process.env[envName] !== '') return process.env[envName];
  if (file[key] !== undefined) return file[key];
  return def;
}

const resolveFromRoot = (p) => (p ? path.resolve(ROOT, p) : p);

const config = {
  // "::" = 同时监听 IPv6 和 IPv4（双栈）。系统没有 IPv6 时会自动退回 0.0.0.0
  host: pick('CHAT_HOST', 'host', '::'),
  port: 0, // 下面根据是否启用 HTTPS 决定默认值
  // 对外使用的域名（只用于启动时提示）
  domain: pick('CHAT_DOMAIN', 'domain', ''),
  dataDir: resolveFromRoot(pick('CHAT_DATA_DIR', 'dataDir', 'data')),
  // HTTPS（可选）。Windows 上常见的是 .pfx 证书，也支持 PEM 格式的 cert + key。
  tls: {
    pfx: resolveFromRoot(pick('CHAT_TLS_PFX', 'tlsPfx', '')),
    passphrase: pick('CHAT_TLS_PASSPHRASE', 'tlsPassphrase', ''),
    cert: resolveFromRoot(pick('CHAT_TLS_CERT', 'tlsCert', '')),
    key: resolveFromRoot(pick('CHAT_TLS_KEY', 'tlsKey', '')),
    // 每隔多久检查一次证书文件是否更新（证书续期后自动生效，无需重启）
    watchMs: Number(pick('CHAT_TLS_WATCH_MS', 'tlsWatchMs', 30000)),
  },
  // 允许跨域访问的前端地址，逗号分隔；"*" 表示全部允许
  corsOrigins: String(pick('CHAT_CORS_ORIGINS', 'corsOrigins', '*')).split(',').map((s) => s.trim()).filter(Boolean),
  tokenTtlDays: Number(pick('CHAT_TOKEN_TTL_DAYS', 'tokenTtlDays', 30)),
  maxMediaBytes: Number(pick('CHAT_MAX_MEDIA_MB', 'maxMediaMB', 64)) * 1024 * 1024,
  mediaTtlDays: Number(pick('CHAT_MEDIA_TTL_DAYS', 'mediaTtlDays', 30)),
  // 离线消息在服务器上最多保留多少天（密文），超时未被取走则删除
  queueTtlDays: Number(pick('CHAT_QUEUE_TTL_DAYS', 'queueTtlDays', 30)),
  maxGroupSize: Number(pick('CHAT_MAX_GROUP_SIZE', 'maxGroupSize', 256)),
  trustProxy: String(pick('CHAT_TRUST_PROXY', 'trustProxy', 'false')) === 'true',
};

config.tls.enabled = !!(config.tls.pfx || (config.tls.cert && config.tls.key));
// 默认端口：启用 HTTPS 时 8443（客户端内置的 https://neonhost.top:8443），否则 3000
config.port = Number(pick('CHAT_PORT', 'port', config.tls.enabled ? 8443 : 3000));

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'media'), { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'avatars'), { recursive: true });

module.exports = config;
