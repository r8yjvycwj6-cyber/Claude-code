'use strict';
// 流畅度测量：Alice 打开桌面界面，12 个联系人以每秒 10 条的速度轮流给她发加密消息，
// 会话列表不停重新排序（FLIP 动画）、当前聊天不停出现新消息（入场动画）。
// 记录每一帧的间隔和主线程长任务（>50ms），判断是否掉帧。
// 运行：node test/smoothness.js
const path = require('path');
const { chromium } = require('playwright');
const { startAll } = require('./serve');

const SENDERS = 12;
const RATE = 10; // 条/秒
const SECONDS = 8;

async function apiUser(s, E, i) {
  const reg = await (await fetch(`${s.api}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: `+86139${String(i).padStart(8, '0')}`, name: `联系人${i}`, password: 'password123' }),
  })).json();
  const acc = await E.E2EEAccount.create({ oneTimePreKeys: 5 });
  await fetch(`${s.api}/api/keys`, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${reg.token}` }, body: JSON.stringify(acc.publicBundle()) });
  const ws = new WebSocket(s.api.replace('http', 'ws') + '/ws');
  await new Promise((r) => (ws.onopen = r));
  ws.send(JSON.stringify({ type: 'auth', token: reg.token }));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.qid) ws.send(JSON.stringify({ type: 'ack', qids: [m.qid] }));
  };
  return { id: reg.user.id, token: reg.token, acc, ws };
}

(async () => {
  const E = await import(path.join(__dirname, '..', 'app', 'lib', 'e2ee.mjs'));
  const s = await startAll();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(s.app);
    await page.click('.server-line button');
    await page.fill('input[name=server]', s.api);
    await page.click('.tabs button:nth-child(2)');
    await page.fill('input[name=phone]', '+8613800009999');
    await page.fill('input[name=name]', 'Alice');
    await page.fill('input[name=password]', 'password123');
    await page.click('form button[type=submit]');
    await page.waitForFunction(() => globalThis.__chat?.core.connState === 'online');
    const aliceId = await page.evaluate(() => globalThis.__chat.core.me.id);

    const senders = [];
    for (let i = 0; i < SENDERS; i++) senders.push(await apiUser(s, E, i));
    // 每个联系人先发一条，建立会话并出现在列表里
    const send = async (u, text) => {
      if (!u.acc.hasSession(aliceId)) {
        const b = await (await fetch(`${s.api}/api/keys/${aliceId}`, { headers: { Authorization: `Bearer ${u.token}` } })).json();
        await u.acc.initSession(aliceId, b);
      }
      const envelope = await u.acc.encrypt(aliceId, { t: 'text', body: text, ts: Date.now() });
      u.ws.send(JSON.stringify({ type: 'send', id: `m${Math.random().toString(36).slice(2)}`, to: aliceId, envelope }));
    };
    for (const u of senders) await send(u, '你好');
    await page.waitForFunction((n) => document.querySelectorAll('.chat-item').length >= n, SENDERS);
    await page.click('.chat-item >> nth=3'); // 打开其中一个聊天
    await page.waitForTimeout(500);

    // 开始测量
    await page.evaluate(() => {
      window.__frames = [];
      window.__long = [];
      new PerformanceObserver((l) => window.__long.push(...l.getEntries().map((e) => e.duration))).observe({ type: 'longtask', buffered: false });
      let last = performance.now();
      const loop = (t) => {
        window.__frames.push(t - last);
        last = t;
        if (!window.__stop) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    const openId = await page.evaluate(() => globalThis.__chat.view.current);
    let n = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < SECONDS * 1000) {
      // 1/3 的消息发到当前打开的聊天（触发气泡入场动画），其余发到别的聊天（触发列表重排动画）
      const u = n % 3 === 0 ? senders.find((x) => `u:${x.id}` === openId) : senders[n % SENDERS];
      await send(u, `消息 ${n} ${'很长的一段文字'.repeat(n % 4)}`);
      n++;
      await new Promise((r) => setTimeout(r, 1000 / RATE));
    }
    await page.waitForTimeout(800);
    const r = await page.evaluate(() => {
      window.__stop = true;
      const f = window.__frames.slice(1).sort((a, b) => a - b);
      const p = (q) => f[Math.min(f.length - 1, Math.floor(f.length * q))];
      return {
        frames: f.length, p50: p(0.5), p95: p(0.95), p99: p(0.99), max: f[f.length - 1],
        dropped: f.filter((x) => x > 25).length, longTasks: window.__long.length, longestTask: Math.max(0, ...window.__long),
        rows: document.querySelectorAll('.chat-item').length, bubbles: document.querySelectorAll('.msg-row').length,
      };
    });
    console.log(`发送 ${n} 条加密消息（${RATE} 条/秒，${SECONDS} 秒），列表 ${r.rows} 个会话，当前聊天 ${r.bubbles} 条消息`);
    console.log(`帧间隔：p50 ${r.p50.toFixed(1)} ms · p95 ${r.p95.toFixed(1)} ms · p99 ${r.p99.toFixed(1)} ms · 最大 ${r.max.toFixed(1)} ms`);
    console.log(`超过 25ms 的帧（掉帧）：${r.dropped}/${r.frames}（${((r.dropped / r.frames) * 100).toFixed(1)}%）`);
    console.log(`主线程长任务（>50ms）：${r.longTasks} 次，最长 ${r.longestTask.toFixed(0)} ms`);

    // 第二阶段：反复打开/关闭右侧信息面板（聊天区随之收缩/展开）
    await page.evaluate(() => {
      window.__frames = [];
      window.__long = [];
      window.__stop = false;
      let last = performance.now();
      const loop = (t) => {
        window.__frames.push(t - last);
        last = t;
        if (!window.__stop) requestAnimationFrame(loop);
      };
      requestAnimationFrame(loop);
    });
    for (let i = 0; i < 6; i++) {
      await page.evaluate(() => globalThis.__chat.view.toggleInfo());
      await page.waitForTimeout(450);
    }
    const r2 = await page.evaluate(() => {
      window.__stop = true;
      const f = window.__frames.slice(1).sort((a, b) => a - b);
      return { frames: f.length, p99: f[Math.floor(f.length * 0.99)], max: f[f.length - 1], dropped: f.filter((x) => x > 25).length, longTasks: window.__long.length };
    });
    console.log(`信息面板开关 6 次：帧间隔 p99 ${r2.p99.toFixed(1)} ms · 最大 ${r2.max.toFixed(1)} ms · 掉帧 ${r2.dropped}/${r2.frames} · 长任务 ${r2.longTasks}`);
    for (const u of senders) u.ws.close();
  } finally {
    await browser.close();
    await s.stop();
  }
})();
