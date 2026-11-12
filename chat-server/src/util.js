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

module.exports = { HttpError, now, isB64, isB64Len, normalizePhone, cleanText, isId, rateLimiter };
