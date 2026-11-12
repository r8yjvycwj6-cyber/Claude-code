'use strict';
// 压力测试：启动一个独立的服务器进程，模拟大量同时在线的客户端互发消息，统计吞吐和延迟。
//
//   node bench/load.js --clients 3000 --rate 1 --duration 20
//
//   --clients   同时在线的用户数（默认 2000）
//   --rate      每个用户每秒发几条消息（默认 0.5）
//   --duration  持续秒数（默认 20）
//   --group     每 N 条消息里有 1 条是群消息（群 20 人，默认 10；0 表示不发群消息）
//
// 服务器不解析密文，所以这里用随机字节冒充 envelope，大小与真实加密消息相当（约 400 字节）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execSync } = require('child_process');
const WebSocket = require('ws');

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => (a.startsWith('--') ? [...acc, [a.slice(2), arr[i + 1]]] : acc), [])
);
const CLIENTS = Number(args.clients || 2000);
const RATE = Number(args.rate || 0.5);
const DURATION = Number(args.duration || 20);
const GROUP_EVERY = Number(args.group ?? 10);
const GROUP_SIZE = 20;
const TLS = 'tls' in args;
const PORT = 20000 + Math.floor(Math.random() * 20000);

const ROOT = path.resolve(__dirname, '..');
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chat-bench-'));
fs.mkdirSync(path.join(dataDir, 'media'));
fs.mkdirSync(path.join(dataDir, 'avatars'));

function prepareData() {
  const { openDb } = require('../src/db');
  const db = openDb(dataDir);
  const t = Date.now();
  const tokens = [];
  db.exec('BEGIN');
  const insUser = db.prepare('INSERT INTO users (phone, name, pass_hash, created_at) VALUES (?, ?, ?, ?)');
  const insSess = db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)');
  for (let i = 0; i < CLIENTS; i++) {
    const { lastInsertRowid } = insUser.run(`+1555${String(i).padStart(7, '0')}`, `u${i}`, 'scrypt$x', t);
    const token = crypto.randomBytes(32).toString('base64url');
    insSess.run(crypto.createHash('sha256').update(token).digest('hex'), Number(lastInsertRowid), t, t + 86400000);
    tokens.push({ id: Number(lastInsertRowid), token });
  }
  // 群组
  const groups = [];
  const insGroup = db.prepare('INSERT INTO groups_ (name, created_by, created_at) VALUES (?, ?, ?)');
  const insMember = db.prepare('INSERT INTO group_members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)');
  for (let g = 0; g + GROUP_SIZE <= CLIENTS; g += GROUP_SIZE) {
    const members = tokens.slice(g, g + GROUP_SIZE).map((x) => x.id);
    const gid = Number(insGroup.run(`g${g}`, members[0], t).lastInsertRowid);
    for (const m of members) insMember.run(gid, m, 'member', t);
    groups.push({ id: gid, members });
  }
  db.exec('COMMIT');
  db.close();
  return { tokens, groups };
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))];
}

function serverStats(pid) {
  try {
    if (process.platform === 'win32') return null;
    const [rss, cpu] = execSync(`ps -o rss=,pcpu= -p ${pid}`).toString().trim().split(/\s+/);
    return { rssMB: Math.round(Number(rss) / 1024), cpu: Number(cpu) };
  } catch {
    return null;
  }
}

(async () => {
  console.log(`准备 ${CLIENTS} 个用户…`);
  const { tokens, groups } = prepareData();

  const tlsEnv = { CHAT_TLS_PFX: '', CHAT_TLS_CERT: '', CHAT_TLS_KEY: '' };
  if (TLS) {
    // 自签名证书，只用于测量 HTTPS/WSS 的加密开销
    tlsEnv.CHAT_TLS_KEY = path.join(dataDir, 'key.pem');
    tlsEnv.CHAT_TLS_CERT = path.join(dataDir, 'cert.pem');
    execSync(`openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout "${tlsEnv.CHAT_TLS_KEY}" -out "${tlsEnv.CHAT_TLS_CERT}" -days 1 -subj /CN=localhost`, { stdio: 'ignore' });
  }
  const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', ...(process.env.BENCH_NODE_ARGS ? process.env.BENCH_NODE_ARGS.split(' ') : []), 'server.js'], {
    cwd: ROOT,
    env: { ...process.env, CHAT_DATA_DIR: dataDir, CHAT_PORT: String(PORT), CHAT_HOST: '127.0.0.1', ...tlsEnv },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve) => server.stdout.on('data', (d) => d.toString().includes('已启动') && resolve()));

  const latencies = [];
  let sent = 0;
  let received = 0;
  let errors = 0;
  const clients = [];
  const t0 = Date.now();
  const filler = crypto.randomBytes(300).toString('base64');

  async function connect(u) {
    return new Promise((resolve) => {
      const ws = new WebSocket(`${TLS ? 'wss' : 'ws'}://127.0.0.1:${PORT}/ws`, { perMessageDeflate: false, rejectUnauthorized: false });
      const c = { ws, id: u.id, ready: false };
      ws.on('open', () => ws.send(JSON.stringify({ type: 'auth', token: u.token })));
      ws.on('message', (raw) => {
        const m = JSON.parse(raw);
        if (m.type === 'ready') {
          c.ready = true;
          resolve(c);
        } else if (m.type === 'message') {
          received++;
          latencies.push(Date.now() - m.envelope.t);
          ws.send(JSON.stringify({ type: 'ack', qids: [m.qid] }));
        } else if (m.type === 'receipt') {
          ws.send(JSON.stringify({ type: 'ack', qids: [m.qid] }));
        } else if (m.type === 'error') errors++;
      });
      ws.on('error', () => {
        errors++;
        resolve(c);
      });
    });
  }

  for (let i = 0; i < tokens.length; i += 250) {
    clients.push(...(await Promise.all(tokens.slice(i, i + 250).map(connect))));
  }
  const ready = clients.filter((c) => c.ready);
  console.log(`${ready.length}/${CLIENTS} 个连接已建立，用时 ${((Date.now() - t0) / 1000).toFixed(1)} 秒`);
  const idle = serverStats(server.pid);
  if (idle) console.log(`空闲时服务器内存 ${idle.rssMB} MB（约 ${((idle.rssMB * 1024) / ready.length).toFixed(1)} KB/连接）`);

  // 发送阶段
  const byId = new Map(ready.map((c) => [c.id, c]));
  const perTick = (CLIENTS * RATE) / 100; // 每 10ms
  let carry = 0;
  let expected = 0;
  let n = 0;
  const cpuSamples = [];
  const sampler = setInterval(() => {
    const s = serverStats(server.pid);
    if (s) cpuSamples.push(s);
  }, 1000);
  const start = Date.now();
  const cpu0 = process.cpuUsage();
  await new Promise((resolve) => {
    const timer = setInterval(() => {
      if (Date.now() - start > DURATION * 1000) {
        clearInterval(timer);
        return resolve();
      }
      carry += perTick;
      while (carry >= 1) {
        carry--;
        const from = ready[Math.floor(Math.random() * ready.length)];
        const env = { v: 1, type: 'msg', t: Date.now(), header: { dh: filler.slice(0, 44), pn: 0, n: 0 }, ct: filler };
        n++;
        if (GROUP_EVERY && n % GROUP_EVERY === 0) {
          const g = groups.find((x) => x.members.includes(from.id));
          if (!g) continue;
          const envelopes = {};
          for (const m of g.members) if (m !== from.id) envelopes[m] = env;
          from.ws.send(JSON.stringify({ type: 'send_group', id: `g${n}`, groupId: g.id, envelopes }));
          expected += g.members.filter((m) => m !== from.id && byId.has(m)).length;
        } else {
          let to = ready[Math.floor(Math.random() * ready.length)];
          if (to === from) to = ready[(ready.indexOf(from) + 1) % ready.length];
          from.ws.send(JSON.stringify({ type: 'send', id: `m${n}`, to: to.id, envelope: env }));
          expected++;
        }
        sent++;
      }
    }, 10);
  });
  // 等待剩余消息到达
  const waitStart = Date.now();
  while (received < expected && Date.now() - waitStart < 15000) await new Promise((r) => setTimeout(r, 100));
  clearInterval(sampler);
  const elapsed = (Date.now() - start) / 1000;
  const cu = process.cpuUsage(cpu0);
  const benchCpu = ((cu.user + cu.system) / 1000 / (elapsed * 1000)) * 100;

  latencies.sort((a, b) => a - b);
  const cpuAvg = cpuSamples.length ? cpuSamples.reduce((a, s) => a + s.cpu, 0) / cpuSamples.length : null;
  const peakMem = cpuSamples.length ? Math.max(...cpuSamples.map((s) => s.rssMB)) : null;
  console.log('\n结果');
  console.log(`  在线连接     ${ready.length}${TLS ? '（WSS / TLS 加密）' : ''}`);
  console.log(`  发送请求     ${sent}（${(sent / DURATION).toFixed(0)} 条/秒，其中约 1/${GROUP_EVERY || '∞'} 为 ${GROUP_SIZE} 人群消息）`);
  console.log(`  实际投递     ${received}/${expected}（${(received / elapsed).toFixed(0)} 条/秒）`);
  console.log(`  投递延迟     p50 ${pct(latencies, 50)} ms · p95 ${pct(latencies, 95)} ms · p99 ${pct(latencies, 99)} ms · 最大 ${latencies[latencies.length - 1] || 0} ms`);
  if (cpuAvg !== null) console.log(`  服务器 CPU   平均 ${cpuAvg.toFixed(0)}%（单核 = 100%） · 内存峰值 ${peakMem} MB`);
  console.log(`  压测端 CPU   ${benchCpu.toFixed(0)}%（若接近 100% 说明瓶颈在压测程序本身）`);
  console.log(`  错误         ${errors}`);

  for (const c of clients) c.ws.terminate();
  server.kill('SIGINT');
  await new Promise((r) => server.on('exit', r));
  fs.rmSync(dataDir, { recursive: true, force: true });
  process.exit(0);
})();
