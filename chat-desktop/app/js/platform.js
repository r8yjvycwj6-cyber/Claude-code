// 平台抽象：在 Electron 中使用 preload 暴露的 DPAPI 安全存储；
// 在普通浏览器中（开发调试 / 由服务器托管网页版时）退化为 IndexedDB。
const d = globalThis.desktop;

let fallbackDb = null;
function fallback() {
  if (!fallbackDb) {
    fallbackDb = new Promise((resolve, reject) => {
      const req = indexedDB.open('securechat-secure', 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return fallbackDb;
}
async function fbOp(mode, fn) {
  const db = await fallback();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', mode);
    const req = fn(tx.objectStore('kv'));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const isDesktop = !!d?.isDesktop;

export async function secureGet(name) {
  if (d) return d.secureGet(name);
  return (await fbOp('readonly', (s) => s.get(name))) ?? null;
}

// 同名写入串行化，保证最后一次写入生效
const writeChains = new Map();
export function secureSet(name, value) {
  const prev = writeChains.get(name) || Promise.resolve();
  const next = prev.catch(() => {}).then(() => {
    if (d) return d.secureSet(name, value);
    return fbOp('readwrite', (s) => (value === null ? s.delete(name) : s.put(value, name)));
  });
  writeChains.set(name, next);
  return next;
}

export async function secureInfo() {
  if (d) return d.secureInfo();
  return { encrypted: false, platform: 'browser' };
}

// 任务栏未读角标（Windows 用叠加图标）
export function setBadge(count) {
  document.title = count ? `(${count}) SecureChat` : 'SecureChat';
  if (!d) return;
  let url = null;
  if (count) {
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#e53935';
    g.beginPath();
    g.arc(16, 16, 16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    g.font = `bold ${count > 99 ? 13 : 18}px Segoe UI, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(count > 99 ? '99+' : String(count), 16, 17);
    url = c.toDataURL();
  }
  d.setBadge(count, url);
}

export function focusWindow() {
  if (d) d.focus();
  else window.focus();
}

export async function notify(title, body, onClick) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission !== 'granted') return;
  const n = new Notification(title, { body, silent: false });
  n.onclick = () => {
    focusWindow();
    onClick?.();
  };
}
