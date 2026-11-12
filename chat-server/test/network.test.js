'use strict';
// IPv6 地址处理、HTTPS、证书热更新、启动时的 IPv6 回退
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync, spawn } = require('child_process');
const WebSocket = require('ws');
const { clientKey, expandIPv6 } = require('../src/util');
const { createChatServer } = require('../src/app');

test('IPv6 地址展开与限流分组（/64）', () => {
  assert.deepEqual(expandIPv6('2001:db8::1'), ['2001', '0db8', '0000', '0000', '0000', '0000', '0000', '0001']);
  assert.deepEqual(expandIPv6('::1'), ['0000', '0000', '0000', '0000', '0000', '0000', '0000', '0001']);
  assert.equal(expandIPv6('::ffff:1.2.3.4').join(':'), '0000:0000:0000:0000:0000:ffff:0102:0304');
  // 同一个 /64 里的不同地址（隐私扩展地址会经常变）算同一个来源
  assert.equal(clientKey('240e:3b4:1234:5678:a:b:c:d'), clientKey('240e:3b4:1234:5678::99'));
  assert.notEqual(clientKey('240e:3b4:1234:5678::1'), clientKey('240e:3b4:1234:5679::1'));
  assert.equal(clientKey('240e:3b4:1234:5678::1'), '240e:03b4:1234:5678::/64');
  assert.equal(clientKey('::ffff:192.168.1.5'), '192.168.1.5');
  assert.equal(clientKey('10.0.0.1'), '10.0.0.1');
  assert.equal(clientKey('fe80::1%eth0'), 'fe80:0000:0000:0000::/64');
});

function hasOpenssl() {
  try {
    execFileSync('openssl', ['version']);
    return true;
  } catch {
    return false;
  }
}

function makeCert(dir, name, cn) {
  const key = path.join(dir, `${name}-key.pem`);
  const cert = path.join(dir, `${name}-cert.pem`);
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
    '-keyout', key, '-out', cert, '-days', '30', '-subj', `/CN=${cn}`,
    '-addext', `subjectAltName=DNS:${cn},DNS:localhost,IP:127.0.0.1`], { stdio: 'ignore' });
  return { key, cert };
}

function peerCertCN(port) {
  return new Promise((resolve, reject) => {
    const req = https.get({ host: '127.0.0.1', port, path: '/api/health', rejectUnauthorized: false, agent: false }, (res) => {
      const cn = res.socket.getPeerCertificate().subject.CN;
      res.resume();
      res.on('end', () => resolve({ cn, status: res.statusCode }));
    });
    req.on('error', reject);
  });
}

test('HTTPS + WSS，证书文件替换后自动热更新', { skip: !hasOpenssl() && '需要 openssl' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-tls-'));
  fs.mkdirSync(path.join(dir, 'media'));
  fs.mkdirSync(path.join(dir, 'avatars'));
  const a = makeCert(dir, 'a', 'first.neonhost.test');
  const b = makeCert(dir, 'b', 'second.neonhost.test');
  const live = { cert: path.join(dir, 'live-cert.pem'), key: path.join(dir, 'live-key.pem') };
  fs.copyFileSync(a.cert, live.cert);
  fs.copyFileSync(a.key, live.key);

  const srv = createChatServer({
    host: '127.0.0.1', port: 0, dataDir: dir, corsOrigins: ['*'], tokenTtlDays: 30, maxMediaBytes: 1 << 20,
    mediaTtlDays: 30, queueTtlDays: 30, maxGroupSize: 256, trustProxy: false,
    tls: { enabled: true, cert: live.cert, key: live.key, watchMs: 100 },
  });
  assert.equal(srv.protocol, 'https');
  await new Promise((r) => srv.server.listen(0, '127.0.0.1', r));
  const port = srv.server.address().port;
  try {
    const first = await peerCertCN(port);
    assert.equal(first.status, 200);
    assert.equal(first.cn, 'first.neonhost.test');

    // WebSocket over TLS
    const ws = new WebSocket(`wss://127.0.0.1:${port}/ws`, { rejectUnauthorized: false });
    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    // 模拟续期：替换证书文件
    await new Promise((r) => setTimeout(r, 1100)); // 确保修改时间不同
    fs.copyFileSync(b.cert, live.cert);
    fs.copyFileSync(b.key, live.key);
    let cn = null;
    for (let i = 0; i < 40 && cn !== 'second.neonhost.test'; i++) {
      await new Promise((r) => setTimeout(r, 150));
      cn = (await peerCertCN(port)).cn;
    }
    assert.equal(cn, 'second.neonhost.test', '证书没有热更新');
    assert.equal(ws.readyState, WebSocket.OPEN, '已有连接不应被断开');
    ws.close();
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('证书文件不存在时拒绝启动（不会悄悄退回 HTTP）', () => {
  assert.throws(() => createChatServer({
    host: '127.0.0.1', port: 0, dataDir: ':memory:', corsOrigins: ['*'], tokenTtlDays: 30, maxMediaBytes: 1,
    mediaTtlDays: 30, queueTtlDays: 30, maxGroupSize: 2, trustProxy: false,
    tls: { enabled: true, pfx: path.join(os.tmpdir(), 'no-such-cert.pfx'), watchMs: 1000 },
  }), /找不到证书文件/);
});

test('默认监听 [::] 双栈；系统没有 IPv6 时自动退回 IPv4', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-v6-'));
  const port = 30000 + Math.floor(Math.random() * 20000);
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, CHAT_DATA_DIR: dir, CHAT_PORT: String(port), CHAT_HOST: '', CHAT_CONFIG: path.join(dir, 'none.json') },
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  try {
    for (let i = 0; i < 50 && !out.includes('监听地址'); i++) await new Promise((r) => setTimeout(r, 100));
    assert.match(out, /监听地址/);
    const v6 = out.includes('双栈');
    // 无论哪种情况，IPv4 都必须能连上
    const res = await fetch(`http://127.0.0.1:${port}/api/health`);
    assert.equal(res.status, 200);
    if (v6) {
      const r6 = await fetch(`http://[::1]:${port}/api/health`);
      assert.equal(r6.status, 200, 'IPv6 回环地址应能访问');
    } else {
      assert.match(out, /不支持 IPv6/);
    }
  } finally {
    child.kill();
    await new Promise((r) => child.on('exit', r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
