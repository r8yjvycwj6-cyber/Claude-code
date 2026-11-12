// 服务器 HTTP 接口封装
export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// 规范化服务器地址。支持：
//   neonhost.top:8443              → https://neonhost.top:8443
//   https://neonhost.top:8443/     → https://neonhost.top:8443
//   240e:3b4::1                    → https://[240e:3b4::1]      （裸 IPv6 地址自动加方括号）
//   [240e:3b4::1]:8443             → https://[240e:3b4::1]:8443
//   http://192.168.1.10:3000       → http://192.168.1.10:3000  （明确写 http:// 才用不加密连接）
export function normalizeServer(input) {
  let s = String(input || '').trim();
  if (!s) return '';
  let scheme = 'https://';
  const m = s.match(/^(https?):\/\//i);
  if (m) {
    scheme = `${m[1].toLowerCase()}://`;
    s = s.slice(m[0].length);
  }
  s = s.replace(/\/.*$/, '');
  // 没有方括号、却有两个以上冒号 → 裸 IPv6 地址（此时无法再带端口）
  if (!s.startsWith('[') && (s.match(/:/g) || []).length >= 2) s = `[${s}]`;
  let u;
  try {
    u = new URL(scheme + s);
  } catch {
    throw new Error('服务器地址格式不正确');
  }
  return u.origin;
}

export class Api {
  constructor(server, token = null) {
    this.server = normalizeServer(server);
    this.token = token;
    this.onUnauthorized = null;
  }

  get wsUrl() {
    return `${this.server.replace(/^http/, 'ws')}/ws`;
  }

  url(path) {
    return this.server + path;
  }

  async req(method, path, body, { raw, contentType } = {}) {
    const headers = {};
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let payload;
    if (raw !== undefined) {
      payload = raw;
      headers['Content-Type'] = contentType || 'application/octet-stream';
    } else if (body !== undefined) {
      payload = JSON.stringify(body);
      headers['Content-Type'] = 'application/json';
    }
    let res;
    try {
      res = await fetch(this.server + path, { method, headers, body: payload });
    } catch {
      throw new ApiError(0, '无法连接服务器，请检查服务器地址和网络');
    }
    const ct = res.headers.get('content-type') || '';
    const data = ct.includes('json') ? await res.json() : new Uint8Array(await res.arrayBuffer());
    if (!res.ok) {
      if (res.status === 401 && this.token && this.onUnauthorized && !path.startsWith('/api/auth/')) this.onUnauthorized();
      throw new ApiError(res.status, data?.error || `请求失败 (${res.status})`);
    }
    return data;
  }

  get(p) { return this.req('GET', p); }
  post(p, b) { return this.req('POST', p, b ?? {}); }
  put(p, b) { return this.req('PUT', p, b ?? {}); }
  patch(p, b) { return this.req('PATCH', p, b ?? {}); }
  del(p, b) { return this.req('DELETE', p, b); }

  register(phone, name, password) { return this.post('/api/auth/register', { phone, name, password }); }
  login(phone, password) { return this.post('/api/auth/login', { phone, password }); }
  logout() { return this.post('/api/auth/logout'); }

  uploadMedia(bytes) { return this.req('POST', '/api/media', undefined, { raw: bytes }); }
  downloadMedia(id) { return this.req('GET', `/api/media/${encodeURIComponent(id)}`); }
  uploadAvatar(bytes, mime) { return this.req('PUT', '/api/me/avatar', undefined, { raw: bytes, contentType: mime }); }

  avatarUrl(path) {
    return path ? this.server + path : null;
  }
}
