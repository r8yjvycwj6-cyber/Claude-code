'use strict';
// HTTPS 证书加载与热更新。
// 证书续期工具（如 win-acme）替换证书文件后，服务器在 tlsWatchMs 内自动换用新证书，不需要重启，现有连接不受影响。
const fs = require('fs');
const crypto = require('crypto');

function readTlsOptions(tls) {
  if (tls.pfx) {
    if (!fs.existsSync(tls.pfx)) throw new Error(`找不到证书文件 ${tls.pfx}`);
    return { pfx: fs.readFileSync(tls.pfx), passphrase: tls.passphrase || undefined };
  }
  for (const f of [tls.cert, tls.key]) if (!fs.existsSync(f)) throw new Error(`找不到证书文件 ${f}`);
  return { cert: fs.readFileSync(tls.cert), key: fs.readFileSync(tls.key) };
}

// 返回证书的到期时间和域名，用于日志
function describe(opts) {
  if (!opts.cert) return null; // .pfx 格式无法直接读取到期时间，只打印"已加载"
  try {
    const x = new crypto.X509Certificate(opts.cert);
    return { subject: x.subjectAltName || x.subject, validTo: new Date(x.validTo) };
  } catch {
    return null;
  }
}

function logCert(prefix, opts) {
  const d = describe(opts);
  if (!d) return console.log(prefix);
  const days = Math.floor((d.validTo - Date.now()) / 86400000);
  console.log(`${prefix}（${d.subject}，${d.validTo.toLocaleDateString()} 到期，剩余 ${days} 天）`);
  if (days < 14) console.warn('⚠ 证书即将过期，请检查自动续期是否正常');
}

// 监视证书文件，变化后重新加载
function watchTls(server, tls, onReload) {
  const files = (tls.pfx ? [tls.pfx] : [tls.cert, tls.key]).filter(Boolean);
  let timer = null;
  const reload = () => {
    clearTimeout(timer);
    // 等待写入完成（续期工具可能分几次写文件）
    timer = setTimeout(() => {
      try {
        const opts = readTlsOptions(tls);
        server.setSecureContext(opts);
        logCert('已加载新的 HTTPS 证书', opts);
        onReload?.();
      } catch (e) {
        console.error(`重新加载证书失败，继续使用旧证书：${e.message}`);
      }
    }, Math.min(2000, tls.watchMs));
  };
  for (const f of files) fs.watchFile(f, { interval: tls.watchMs, persistent: false }, (cur, prev) => {
    if (cur.mtimeMs !== prev.mtimeMs || cur.size !== prev.size) reload();
  });
  return () => {
    clearTimeout(timer);
    for (const f of files) fs.unwatchFile(f);
  };
}

module.exports = { readTlsOptions, watchTls, logCert };
