'use strict';

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const now = () => Date.now();

const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
function isB64(s, minBytes = 1, maxBytes = 1 << 20) {
  if (typeof s !== 'string' || !B64_RE.test(s) || s.length % 4 !== 0) return false;
  const n = Buffer.from(s, 'base64').length;
  return n >= minBytes && n <= maxBytes;
}
function isB64Len(s, bytes) {
  return isB64(s, bytes, bytes);
}

function normalizePhone(p) {
  if (typeof p !== 'string') return null;
  const s = p.replace(/[\s\-()]/g, '');
  return /^\+?[0-9]{5,20}$/.test(s) ? s : null;
}

function cleanText(s, max) {
  if (typeof s !== 'string') return null;
  const t = s.trim();
  if (!t || t.length > max) return null;
  return t;
}

const isId = (v) => Number.isSafeInteger(v) && v > 0;

// 极简内存限流：每个 key 在 windowMs 内最多 limit 次
function rateLimiter({ windowMs, limit }) {
  const hits = new Map();
  setInterval(() => {
    const t = now();
    for (const [k, v] of hits) if (v.reset < t) hits.delete(k);
  }, windowMs).unref();
  return (key) => {
    const t = now();
    let h = hits.get(key);
    if (!h || h.reset < t) {
      h = { count: 0, reset: t + windowMs };
      hits.set(key, h);
    }
    h.count++;
    return h.count <= limit;
  };
}

// 把 IPv6 地址展开成 8 段完整形式
function expandIPv6(ip) {
  let [head, tail = null] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== null && tail !== '' ? tail.split(':') : [];
  // 末尾是内嵌 IPv4（如 ::ffff:1.2.3.4）
  const fix = (arr) => arr.flatMap((p) => {
    if (!p.includes('.')) return [p];
    const b = p.split('.').map(Number);
    return [((b[0] << 8) | b[1]).toString(16), ((b[2] << 8) | b[3]).toString(16)];
  });
  const hh = fix(h);
  const tt = fix(t);
  const fill = tail === null ? [] : new Array(8 - hh.length - tt.length).fill('0');
  return [...hh, ...fill, ...tt].map((p) => p.padStart(4, '0').toLowerCase());
}

// 限流用的客户端标识：IPv4 按单个地址；IPv6 按 /64 网段（一个家庭/设备通常拥有整个 /64，可随意换地址）
function clientKey(ip) {
  if (!ip) return 'unknown';
  let s = String(ip);
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  if (s.startsWith('::ffff:') && s.includes('.')) return s.slice(7); // IPv4 映射地址
  if (!s.includes(':')) return s;
  try {
    return `${expandIPv6(s).slice(0, 4).join(':')}::/64`;
  } catch {
    return s;
  }
}

// 并发执行异步处理器时把异常交给 Express 的错误处理
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, now, isB64, isB64Len, normalizePhone, cleanText, isId, rateLimiter, clientKey, expandIPv6, ah };
