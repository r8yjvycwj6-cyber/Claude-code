'use strict';
// SecureChat 桌面端 —— Electron 主进程
//
// * 界面代码打包在本地（app/ 目录），通过自定义的 app:// 协议加载，而不是从服务器下载。
//   这对端到端加密很重要：即使服务器被攻破，也无法给客户端塞入窃取密钥的代码。
// * 加密私钥、登录令牌、本地数据库密钥用 Electron safeStorage 保存
//   （Windows 上即 DPAPI，与当前 Windows 用户账户绑定）。
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const {
  app, BrowserWindow, protocol, net, ipcMain, safeStorage, Tray, Menu, nativeImage, shell, session,
} = require('electron');

const APP_DIR = path.join(__dirname, 'app');
const APP_ORIGIN = 'app://securechat';
const APP_ID = 'com.securechat.desktop';

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } },
]);

// 便携 / 多开调试：--user-data-dir=xxx 可以在同一台电脑上登录两个账号
const udArg = process.argv.find((a) => a.startsWith('--securechat-profile='));
if (udArg) app.setPath('userData', path.resolve(udArg.split('=')[1]));

if (process.platform === 'win32') app.setAppUserModelId(APP_ID); // Windows 通知需要

let win = null;
let tray = null;
let quitting = false;
let unread = 0;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => showWindow());
}

function iconPath(name) {
  return path.join(__dirname, 'build', name);
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

// ---------------------------------------------------------------- 窗口状态（大小/位置）记忆
const stateFile = () => path.join(app.getPath('userData'), 'window-state.json');
function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
  } catch {
    return { width: 1200, height: 800 };
  }
}
function saveWindowState() {
  if (!win || win.isMinimized()) return;
  const b = win.getNormalBounds();
  try {
    fs.writeFileSync(stateFile(), JSON.stringify({ ...b, maximized: win.isMaximized() }));
  } catch {}
}

function createWindow() {
  const st = loadWindowState();
  win = new BrowserWindow({
    x: st.x, y: st.y, width: st.width || 1200, height: st.height || 800,
    minWidth: 760, minHeight: 520,
    title: 'SecureChat',
    icon: iconPath('icon.png'),
    backgroundColor: '#f0f2f5',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  if (st.maximized) win.maximize();
  Menu.setApplicationMenu(null);

  win.once('ready-to-show', () => {
    if (!process.argv.includes('--hidden')) win.show();
  });
  win.loadURL(`${APP_ORIGIN}/index.html`);

  // 外部链接用系统浏览器打开；禁止页面跳转到别处
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(APP_ORIGIN)) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  // 开发者工具：Ctrl+Shift+I；刷新：Ctrl+R
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.control && input.shift && input.key.toLowerCase() === 'i') win.webContents.toggleDevTools();
    if (input.control && !input.shift && input.key.toLowerCase() === 'r') win.webContents.reload();
  });

  win.on('focus', () => win.flashFrame(false));
  win.on('resize', saveWindowState);
  win.on('move', saveWindowState);
  // 关闭窗口时最小化到托盘（托盘菜单里选"退出"才真正退出）
  win.on('close', (e) => {
    saveWindowState();
    if (!quitting && tray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => (win = null));
}

function createTray() {
  try {
    tray = new Tray(nativeImage.createFromPath(iconPath('tray.png')));
  } catch {
    tray = null;
    return;
  }
  tray.setToolTip('SecureChat');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '打开 SecureChat', click: showWindow },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit(); } },
    ])
  );
  tray.on('click', showWindow);
}

// ---------------------------------------------------------------- 安全存储（DPAPI）
const SECURE_NAME = /^[A-Za-z0-9_.-]{1,120}$/;
const secureDir = () => path.join(app.getPath('userData'), 'secure');

function secureFile(name) {
  if (!SECURE_NAME.test(name)) throw new Error('invalid name');
  return path.join(secureDir(), `${name}.bin`);
}

ipcMain.handle('secure:get', (e, name) => {
  checkSender(e);
  const f = secureFile(name);
  if (!fs.existsSync(f)) return null;
  const buf = fs.readFileSync(f);
  if (buf[0] === 0x01) return safeStorage.decryptString(buf.subarray(1));
  return buf.subarray(1).toString('utf8'); // 系统不支持加密时的明文回退（少见：Linux 无密钥环）
});

ipcMain.handle('secure:set', (e, name, value) => {
  checkSender(e);
  const f = secureFile(name);
  fs.mkdirSync(secureDir(), { recursive: true });
  if (value === null || value === undefined) {
    fs.rmSync(f, { force: true });
    return true;
  }
  const s = String(value);
  const buf = safeStorage.isEncryptionAvailable()
    ? Buffer.concat([Buffer.from([0x01]), safeStorage.encryptString(s)])
    : Buffer.concat([Buffer.from([0x00]), Buffer.from(s, 'utf8')]);
  // 先写临时文件再改名，避免写到一半断电导致密钥损坏
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, f);
  return true;
});

ipcMain.handle('secure:info', (e) => {
  checkSender(e);
  return { encrypted: safeStorage.isEncryptionAvailable(), platform: process.platform };
});

// 未读数：任务栏图标角标 + 托盘提示 + 闪烁
ipcMain.on('app:badge', (e, count, dataUrl) => {
  checkSender(e);
  const n = Math.max(0, Number(count) || 0);
  const increased = n > unread;
  unread = n;
  if (!win) return;
  if (process.platform === 'win32') {
    win.setOverlayIcon(n && dataUrl ? nativeImage.createFromDataURL(String(dataUrl)) : null, n ? `${n} 条未读消息` : '');
  } else {
    app.setBadgeCount(n);
  }
  if (tray) tray.setToolTip(n ? `SecureChat - ${n} 条未读消息` : 'SecureChat');
  if (increased && !win.isFocused()) win.flashFrame(true);
});

ipcMain.on('app:focus', (e) => {
  checkSender(e);
  showWindow();
});

ipcMain.handle('app:version', () => app.getVersion());

function checkSender(e) {
  if (!e.senderFrame || !e.senderFrame.url.startsWith(APP_ORIGIN)) throw new Error('forbidden');
}

// ---------------------------------------------------------------- 启动
app.whenReady().then(() => {
  // app://securechat/... -> 本地 app/ 目录中的文件
  protocol.handle('app', (req) => {
    const url = new URL(req.url);
    if (url.host !== 'securechat') return new Response('not found', { status: 404 });
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/' || rel === '') rel = '/index.html';
    const file = path.normalize(path.join(APP_DIR, rel));
    if (!file.startsWith(APP_DIR + path.sep)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });

  // 只允许通知、剪贴板等必要权限
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
    cb(['notifications', 'clipboard-sanitized-write', 'clipboard-read', 'media'].includes(permission));
  });

  createWindow();
  createTray();
});

app.on('before-quit', () => (quitting = true));
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', showWindow);
