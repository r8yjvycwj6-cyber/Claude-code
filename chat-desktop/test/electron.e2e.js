'use strict';
// 在真正的 Electron 里测试：app:// 协议加载、preload 安全存储、登录、收发加密消息、重启后自动恢复登录。
// Linux 无显示器时用：xvfb-run -a node test/electron.e2e.js [截图目录]
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron: electron, chromium } = require('playwright');
const { startAll } = require('./serve');

const ROOT = path.resolve(__dirname, '..');
const shotDir = process.argv[2];

function launch(profile) {
  const args = [ROOT, `--securechat-profile=${profile}`];
  if (process.platform === 'linux') args.push('--no-sandbox', '--no-proxy-server');
  return electron.launch({ executablePath: require('electron'), args, env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
}

(async () => {
  const s = await startAll();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'securechat-profile-'));
  const errors = [];
  let app;
  const browser = await chromium.launch();
  try {
    // 对方用网页版
    const peer = await (await browser.newContext()).newPage();
    await peer.goto(s.app);
    if (await peer.isVisible('.server-line')) await peer.click('.server-line button');
    await peer.fill('input[name=server]', s.api);
    await peer.click('.tabs button:nth-child(2)');
    await peer.fill('input[name=phone]', '+8613900000009');
    await peer.fill('input[name=name]', '网页用户');
    await peer.fill('input[name=password]', 'password123');
    await peer.click('form button[type=submit]');
    await peer.waitForFunction(() => globalThis.__chat?.core.connState === 'online');

    // 桌面端
    app = await launch(profile);
    let win = await app.firstWindow();
    win.on('pageerror', (e) => errors.push(e.message));
    assert.ok(win.url().startsWith('app://securechat/'), `unexpected url ${win.url()}`);
    assert.equal(await win.evaluate(() => typeof globalThis.require), 'undefined', '页面不应能访问 Node.js');
    assert.equal(await win.evaluate(() => globalThis.desktop.isDesktop), true);

    if (await win.isVisible('.server-line')) await win.click('.server-line button');
    await win.fill('input[name=server]', s.api);
    await win.click('.tabs button:nth-child(2)');
    await win.fill('input[name=phone]', '+8613900000008');
    await win.fill('input[name=name]', '桌面用户');
    await win.fill('input[name=password]', 'password123');
    await win.click('form button[type=submit]');
    await win.waitForFunction(() => globalThis.__chat?.core.connState === 'online', null, { timeout: 20000 });

    // 密钥写到了 userData/secure/ 而不是 localStorage
    const secureFiles = fs.readdirSync(path.join(profile, 'secure'));
    assert.ok(secureFiles.some((f) => f.startsWith('account-')), '没有保存加密账号');
    assert.ok(secureFiles.includes('session.bin'));

    // 桌面 -> 网页
    await win.click('button[title^="新的聊天"]');
    await win.fill('.side-panel input[type=tel]', '+8613900000009');
    await win.keyboard.press('Enter');
    await win.click('.side-panel .list-item:has-text("+8613900000009")');
    await win.fill('.conversation textarea', '来自桌面客户端的加密消息');
    await win.keyboard.press('Enter');
    await peer.click('.chat-item >> nth=0');
    await peer.waitForSelector('.msg-row.in .text:has-text("来自桌面客户端的加密消息")');
    await peer.fill('.conversation textarea', '网页版收到 ✅');
    await peer.keyboard.press('Enter');
    await win.waitForSelector('.msg-row.in .text:has-text("网页版收到")');
    await win.waitForSelector('.msg-row.out .tick.read');
    if (shotDir) await win.screenshot({ path: path.join(shotDir, 'electron-chat.png') });

    // 关闭 → 对方继续发消息 → 重新打开自动登录并收到
    await app.close();
    await peer.fill('.conversation textarea', '你关掉客户端时发的');
    await peer.keyboard.press('Enter');
    app = await launch(profile);
    win = await app.firstWindow();
    await win.waitForSelector('.chat-item .badge', { timeout: 20000 });
    await win.click('.chat-item >> nth=0');
    await win.waitForSelector('.msg-row.in .text:has-text("你关掉客户端时发的")');
    await win.waitForSelector('.msg-row.in .text:has-text("网页版收到")'); // 历史记录仍在

    // 本地数据库里没有明文（IndexedDB 存储目录）
    await app.close();
    app = null;
    const idbDir = path.join(profile, 'IndexedDB');
    let leaked = false;
    const walk = (d) => {
      for (const f of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, f.name);
        if (f.isDirectory()) walk(p);
        else if (fs.readFileSync(p).includes(Buffer.from('来自桌面客户端'))) leaked = true;
      }
    };
    if (fs.existsSync(idbDir)) walk(idbDir);
    assert.equal(leaked, false, '本地数据库中出现了明文');

    if (errors.length) throw new Error(`页面错误：${errors.join('; ')}`);
    console.log('Electron E2E 全部通过');
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  } finally {
    if (app) await app.close().catch(() => {});
    await browser.close();
    await s.stop();
    fs.rmSync(profile, { recursive: true, force: true });
  }
})();
