'use strict';
// 界面端到端测试：启动真实服务器，用两个独立的浏览器配置（Alice / Bob）完成注册、单聊、回执、群聊、图片。
// 运行：node test/ui.e2e.js [截图目录]
const assert = require('assert/strict');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');
const { startAll } = require('./serve');

const shotDir = process.argv[2];
const errors = [];

async function newUser(browser, s, { phone, name, dark = false }) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: dark ? 'dark' : 'light' });
  await ctx.grantPermissions(['notifications', 'clipboard-read', 'clipboard-write'], { origin: s.app });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[${name}] pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${name}] console: ${m.text()}`);
  });
  await page.goto(s.app);
  if (await page.isVisible('.server-line')) await page.click('.server-line button');
    await page.fill('input[name=server]', s.api);
  await page.click('.tabs button:nth-child(2)');
  await page.fill('input[name=phone]', phone);
  await page.fill('input[name=name]', name);
  await page.fill('input[name=password]', 'password123');
  await page.click('form button[type=submit]');
  await page.waitForSelector('.side-header', { timeout: 15000 });
  await page.waitForFunction(() => globalThis.__chat?.core.connState === 'online');
  return { ctx, page, name, phone };
}

async function shot(page, name) {
  if (shotDir) await page.screenshot({ path: path.join(shotDir, `${name}.png`) });
}

async function openChatWith(u, phone) {
  await u.page.click('button[title^="新的聊天"]');
  await u.page.fill('.side-panel input[type=tel]', phone);
  await u.page.keyboard.press('Enter');
  await u.page.click(`.side-panel .list-item:has-text("${phone}")`);
  await u.page.waitForSelector('.conversation textarea');
}

async function send(u, text) {
  await u.page.fill('.conversation textarea', text);
  await u.page.keyboard.press('Enter');
}

(async () => {
  if (shotDir) fs.mkdirSync(shotDir, { recursive: true });
  const s = await startAll();
  const browser = await chromium.launch();
  try {
    const alice = await newUser(browser, s, { phone: '+8613800000001', name: 'Alice 王' });
    {
      // 全新的客户端：登录页默认显示内置服务器 neonhost.top:8443
      const p = await alice.ctx.browser().newPage({ viewport: { width: 1280, height: 800 } });
      await p.goto(s.app);
      await p.waitForSelector('.login-card');
      assert.match(await p.textContent('.server-line'), /服务器：neonhost\.top:8443/);
      assert.equal(await p.isVisible('input[name=server]'), false);
      // 服务器地址解析：域名、IPv4、IPv6
      const norm = await p.evaluate(async () => {
        const { normalizeServer } = await import('./js/api.js');
        return ['neonhost.top:8443', 'https://neonhost.top:8443/', '240e:3b4::1', '[240e:3b4::1]:8443',
          'http://192.168.1.10:3000', 'https://[2001:db8::1]:8443/api'].map(normalizeServer);
      });
      assert.deepEqual(norm, ['https://neonhost.top:8443', 'https://neonhost.top:8443', 'https://[240e:3b4::1]',
        'https://[240e:3b4::1]:8443', 'http://192.168.1.10:3000', 'https://[2001:db8::1]:8443']);
      await p.waitForTimeout(600);
      await shot(p, '01-login');
      await p.close();
    }
    const bob = await newUser(browser, s, { phone: '+8613800000002', name: 'Bob 李', dark: true });
    const carol = await newUser(browser, s, { phone: '+8613800000003', name: 'Carol 张' });

    // ---- 单聊
    await openChatWith(alice, bob.phone);
    await send(alice, '你好 Bob！这条消息是端到端加密的 🔒');
    await alice.page.waitForSelector('.msg-row.out .tick.sent, .msg-row.out .tick.delivered');

    await bob.page.waitForSelector('.chat-item .badge');
    await shot(bob.page, '02-bob-unread');
    await bob.page.click('.chat-item >> nth=0');
    await bob.page.waitForSelector('.msg-row.in .text:has-text("你好 Bob")');
    // Bob 打开聊天后 Alice 看到蓝勾
    await alice.page.waitForSelector('.msg-row.out .tick.read', { timeout: 10000 });

    // 服务器上只有密文
    const leaked = s.db.prepare("SELECT COUNT(*) AS n FROM queue WHERE payload LIKE '%你好 Bob%'").get().n;
    assert.equal(leaked, 0, '服务器队列里出现了明文');

    // 正在输入
    await bob.page.fill('.conversation textarea', '正在');
    await bob.page.type('.conversation textarea', '输入');
    await alice.page.waitForSelector('.conv-header .subtitle.typing');

    // 回复（双击消息）
    await bob.page.dblclick('.msg-row.in .bubble');
    await bob.page.fill('.conversation textarea', '收到！周末一起爬山吗？\n第二行 https://example.com');
    await bob.page.keyboard.press('Enter');
    await alice.page.waitForSelector('.msg-row.in .quote');
    await alice.page.waitForSelector('.msg-row.in a[href="https://example.com/"], .msg-row.in a[href="https://example.com"]');
    await send(alice, '好啊 👍');
    await send(alice, '😀');
    await bob.page.waitForSelector('.text.big-emoji');

    // 图片（经过加密上传）
    await alice.page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 400;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 640, 400);
      grad.addColorStop(0, '#25c08f');
      grad.addColorStop(1, '#1e6fd9');
      g.fillStyle = grad;
      g.fillRect(0, 0, 640, 400);
      g.fillStyle = '#fff';
      g.font = 'bold 48px sans-serif';
      g.fillText('山顶的照片 ⛰', 150, 215);
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const { core, view } = globalThis.__chat;
      await core.sendFile(view.current, new File([blob], 'mountain.png', { type: 'image/png' }), '上次拍的');
    });
    await bob.page.waitForSelector('.msg-row.in .media-img img:not(.blur)', { timeout: 15000 });

    // 文件
    await alice.page.evaluate(async () => {
      const { core, view } = globalThis.__chat;
      await core.sendFile(view.current, new File(['路线：A -> B -> 山顶\n'.repeat(200)], '爬山路线.txt', { type: 'text/plain' }), '');
    });
    await bob.page.waitForSelector('.msg-row.in .file-card .fname:has-text("爬山路线.txt")');

    // 对所有人删除
    await send(alice, '这条发错了');
    await bob.page.waitForSelector('.msg-row.in .text:has-text("这条发错了")');
    await alice.page.click('.msg-row.out:last-child .bubble', { button: 'right' });
    await alice.page.click('.menu button:has-text("对所有人删除")');
    await alice.page.click('.modal .btn.danger');
    await bob.page.waitForSelector('.msg-row.in .bubble.deleted');

    // ---- 联系人 + 群组
    await alice.page.click('.conv-header .who');
    await alice.page.click('.info-panel .settings-item:has-text("添加到联系人")');
    await alice.page.click('.modal .btn:not(.secondary)');
    await alice.page.waitForSelector('.info-panel .settings-item:has-text("修改备注名")');
    await alice.page.click('.info-panel .settings-item:has-text("加密")');
    await alice.page.waitForSelector('.safety-number');
    const snAlice = (await alice.page.textContent('.safety-number')).replace(/\s/g, '');
    await shot(alice.page, '05-safety-number');
    await alice.page.keyboard.press('Escape');
    await bob.page.click('.conv-header .who');
    await bob.page.click('.info-panel .settings-item:has-text("加密")');
    const snBob = (await bob.page.textContent('.safety-number')).replace(/\s/g, '');
    assert.equal(snAlice, snBob, '双方安全码不一致');
    assert.equal(snAlice.length, 60);
    await bob.page.keyboard.press('Escape');
    await bob.page.click('.info-panel .panel-header button');

    // Alice 添加 Carol 为联系人，然后建群
    await alice.page.click('button[title^="新的聊天"]');
    await alice.page.fill('.side-panel input[type=tel]', carol.phone);
    await alice.page.keyboard.press('Enter');
    await alice.page.click('.side-panel button:has-text("加为联系人")');
    await alice.page.click('.side-panel .list-item:has-text("新建群组")');
    await alice.page.click('.side-panel .list-item:has-text("Bob")');
    await alice.page.click('.side-panel .list-item:has-text("Carol")');
    await alice.page.click('.side-panel .fab');
    await alice.page.fill('.side-panel input[placeholder="群名称"]', '周末爬山小分队');
    await alice.page.click('.side-panel .fab');
    await alice.page.waitForSelector('.conv-header .title:has-text("周末爬山小分队")');
    await send(alice, '大家周六早上 7 点地铁站集合 🚇');

    for (const u of [bob, carol]) {
      await u.page.click('.chat-item:has-text("周末爬山小分队")');
      await u.page.waitForSelector('.msg-row.in .text:has-text("7 点地铁站集合")');
    }
    await send(carol, '没问题！我带零食 🍫');
    await bob.page.waitForSelector('.msg-row.in .sender:has-text("Carol")');
    await send(bob, '我带水 💧');
    await alice.page.waitForSelector('.msg-row.in .text:has-text("我带水")');
    // 所有人都读了 → Alice 第一条群消息变蓝勾
    await alice.page.waitForSelector('.msg-row.out .tick.read');

    // ---- 离线消息：Carol 关闭窗口，Alice 发消息，Carol 重新打开（自动恢复登录）后收到
    await carol.page.goto('about:blank');
    await alice.page.click('.chat-item:has-text("周末爬山小分队")');
    await send(alice, 'Carol 你离线时的消息');
    await alice.page.waitForSelector('.msg-row.out:last-child .tick.sent');
    await carol.page.goto(s.app);
    await carol.page.waitForSelector('.chat-item:has-text("周末爬山小分队") .badge');
    await carol.page.click('.chat-item:has-text("周末爬山小分队")');
    await carol.page.waitForSelector('.msg-row.in .text:has-text("你离线时的消息")');

    await shot(alice.page, '03-alice-group');
    await bob.page.click('.chat-item .name:text-is("Alice 王")');
    await bob.page.waitForSelector('.media-img img:not(.blur)');
    await shot(bob.page, '04-bob-dark-direct');

    // 面板截图
    await alice.page.click('button[title="设置"]');
    await alice.page.waitForSelector('.side-panel.open');
    await alice.page.waitForTimeout(300);
    await shot(alice.page, '06-settings');
    await alice.page.keyboard.press('Escape');
    if (!(await alice.page.isVisible('.info-panel.open'))) await alice.page.click('.conv-header .who');
    await alice.page.waitForTimeout(450);
    await shot(alice.page, '07-group-info');

    // 刷新页面后会话和聊天记录还在（本地加密数据库）
    await bob.page.reload();
    await bob.page.waitForSelector('.chat-item:has-text("周末爬山小分队")');
    await bob.page.click('.chat-item .name:text-is("Alice 王")');
    await bob.page.waitForSelector('.msg-row.in .text:has-text("你好 Bob")');
    await send(bob, '刷新后还能继续聊');
    await alice.page.waitForSelector('.chat-item .ptext:has-text("刷新后还能继续聊")');

    const unexpected = errors.filter((e) => !/Failed to load resource/.test(e));
    if (unexpected.length) {
      console.log('页面错误：\n' + unexpected.join('\n'));
      process.exitCode = 1;
    } else {
      console.log('UI E2E 全部通过');
    }
  } catch (e) {
    console.error(e);
    console.log(errors.join('\n'));
    process.exitCode = 1;
  } finally {
    await browser.close();
    await s.stop();
  }
})();
