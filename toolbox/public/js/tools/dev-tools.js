import { h, $, mount, icon, toast, field, seg, select, tabs, copyText, download, checkbox, banner, readAs, esc, debounce, dropzone, fmtSize, store, uid } from '../ui.js';

const area = (props = {}) => h('textarea.textarea.mono', { style: 'min-height:220px', spellcheck: false, ...props });
const outArea = (props = {}) => area({ readOnly: true, style: 'min-height:220px;background:var(--surface-2)', ...props });
const copyBtn = (get, label = '复制结果') => h('button.btn.primary', { onclick: () => copyText(get()) }, icon('copy'), label);
const pad = (n, l = 2) => String(n).padStart(l, '0');

/* ───────── JSON ───────── */
function jsonTool(root) {
  let indent = '2', view = 'text'; const src = area({ placeholder: '粘贴 JSON…', value: '{"name":"工具箱","tags":["pdf","ppt"],"count":71,"nested":{"ok":true,"value":null}}', style: 'min-height:360px' }); const out = outArea({ style: 'min-height:360px;background:var(--surface-2)' }); const status = h('div'); const tree = h('div.out-box', { hidden: true, style: 'min-height:360px;max-height:520px;font-family:var(--mono)' });
  const parse = () => { try { return { v: JSON.parse(src.value) }; } catch (e) { return { err: e }; } };
  const errPos = (e) => { const m = /position (\d+)/.exec(e.message) || /line (\d+) column (\d+)/.exec(e.message); if (!m) return e.message; if (m[2]) return `第 ${m[1]} 行，第 ${m[2]} 列：${e.message}`; const p = +m[1]; const before = src.value.slice(0, p).split('\n'); return `第 ${before.length} 行，第 ${before.at(-1).length + 1} 列附近：${e.message}`; };
  const check = () => { if (!src.value.trim()) return mount(status); const r = parse(); mount(status, r.err ? h('div.banner.err', icon('circle-alert'), h('div.grow', errPos(r.err))) : h('div.banner.ok', icon('circle-check'), 'JSON 格式正确')); };
  const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
  const act = (fn) => () => { const r = parse(); if (r.err) { check(); return toast('JSON 有误，请先修正', 'err'); } out.value = fn(r.v); showText(); };
  const ind = () => (indent === 'tab' ? '\t' : +indent);
  function node(k, v, open) { const isO = v && typeof v === 'object'; const label = k !== null ? h('span', h('span', { style: 'color:#c026d3' }, JSON.stringify(k)), ': ') : ''; if (!isO) return h('div', { style: 'padding-left:18px;white-space:pre-wrap;word-break:break-all' }, label, h('span', { style: `color:${typeof v === 'string' ? '#16a34a' : typeof v === 'number' ? '#2563eb' : '#d97706'}` }, JSON.stringify(v)));
    const keys = Array.isArray(v) ? v.map((_, i) => i) : Object.keys(v); const d = h('details', { open, style: 'padding-left:18px' }, h('summary', { style: 'cursor:pointer;margin-left:-18px;padding-left:18px' }, label, Array.isArray(v) ? `[ ${keys.length} ]` : `{ ${keys.length} }`)); keys.forEach((kk) => d.append(node(Array.isArray(v) ? null : kk, v[kk], false))); return d; }
  function showTree() { const r = parse(); if (r.err) return toast('JSON 有误', 'err'); view = 'tree'; out.hidden = true; tree.hidden = false; mount(tree, node(null, r.v, true)); }
  function showText() { view = 'text'; out.hidden = false; tree.hidden = true; }
  src.addEventListener('input', debounce(check, 200));
  mount(root, h('div.col', h('div.row', h('button.btn.primary', { onclick: act((v) => JSON.stringify(v, null, ind())) }, '格式化'), h('button.btn', { onclick: act((v) => JSON.stringify(v)) }, '压缩'), h('button.btn', { onclick: act((v) => JSON.stringify(sortKeys(v), null, ind())) }, '键排序'), h('button.btn', { onclick: showTree }, icon('list-tree'), '树形查看'), h('button.btn', { onclick: () => { out.value = JSON.stringify(src.value); showText(); } }, '转义为字符串'), h('button.btn', { onclick: () => { try { const v = JSON.parse(src.value.trim()); out.value = typeof v === 'string' ? v : JSON.stringify(v); showText(); } catch { toast('不是有效的 JSON 字符串字面量', 'err'); } } }, '去转义'), h('div.sp'), field(null, select([['2', '2 空格'], ['4', '4 空格'], ['tab', 'Tab']], indent, (v) => { indent = v; }))), status, h('div.grid.g2', src, h('div', out, tree)), h('div.row', copyBtn(() => out.value), h('button.btn', { onclick: () => { src.value = out.value; check(); } }, '结果放回左侧')))); check();
}

/* ───────── Base64 ───────── */
function base64(root) {
  let mode = 'enc', urlSafe = false; const src = area({ placeholder: '输入文本', value: '你好，工具箱！Hello 123' }); const out = outArea(); const st = h('div');
  const enc = (s) => { const b = new TextEncoder().encode(s); let bin = ''; b.forEach((x) => (bin += String.fromCharCode(x))); let r = btoa(bin); if (urlSafe) r = r.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); return r; };
  const dec = (s) => { s = s.replace(/\s/g, '').replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const bin = atob(s); return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))); };
  const run = () => { try { out.value = mode === 'enc' ? enc(src.value) : dec(src.value); mount(st); } catch (e) { out.value = ''; mount(st, banner('err', mode === 'dec' ? '不是有效的 Base64（或解码结果不是 UTF-8 文本）' : e.message)); } };
  src.addEventListener('input', run);
  mount(root, h('div.col', h('div.row', seg([['enc', '编码'], ['dec', '解码']], mode, (v) => { mode = v; run(); }), checkbox('URL 安全（- _ 无填充）', false, (v) => { urlSafe = v; run(); })), st, h('div.grid.g2', src, out), h('div.row', copyBtn(() => out.value), h('button.btn', { onclick: () => { src.value = out.value; mode = mode === 'enc' ? 'dec' : 'enc'; $$s().forEach((b) => b.classList.toggle('on', b.dataset.v === mode)); run(); } }, icon('arrow-left-right'), '结果作为输入')))); run();
  function $$s() { return [...root.querySelectorAll('.seg button')]; }
}

/* ───────── URL ───────── */
function urlCodec(root) {
  let mode = 'enc', full = false; const src = area({ placeholder: '输入文本或 URL', value: 'https://example.com/search?q=在线 工具箱&lang=zh-CN#top' }); const out = outArea({ style: 'min-height:120px;background:var(--surface-2)' }); const params = h('div');
  const run = () => { try { out.value = mode === 'enc' ? (full ? encodeURI(src.value) : encodeURIComponent(src.value)) : (full ? decodeURI(src.value) : decodeURIComponent(src.value.replace(/\+/g, ' '))); } catch { out.value = '（解码失败：包含非法的百分号编码）'; }
    try { const u = new URL(src.value.trim()); const rows = [...u.searchParams.entries()]; mount(params, h('div.panel', h('b', 'URL 解析'), h('table.table.mt-s', h('tbody', [['协议', u.protocol], ['主机', u.host], ['路径', u.pathname], ['锚点', u.hash]].filter((r) => r[1]).map((r) => h('tr', h('td.muted', r[0]), h('td.mono', r[1]))), rows.map(([k, v]) => h('tr', h('td.muted', '参数 ' + k), h('td.mono', v))))))); } catch { mount(params); } };
  src.addEventListener('input', run);
  mount(root, h('div.col', h('div.row', seg([['enc', '编码'], ['dec', '解码']], mode, (v) => { mode = v; run(); }), checkbox('保留 URL 结构字符（encodeURI，不编码 : / ? & =）', false, (v) => { full = v; run(); })), h('div.grid.g2', src, out), h('div.row', copyBtn(() => out.value)), params)); run();
}

/* ───────── 哈希 ───────── */
function md5(bytes) {
  const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0), S = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const len = bytes.length, padLen = Math.ceil((len + 9) / 64) * 64, buf = new Uint8Array(padLen); buf.set(bytes); buf[len] = 0x80; const dv = new DataView(buf.buffer); dv.setUint32(padLen - 8, (len * 8) >>> 0, true); dv.setUint32(padLen - 4, Math.floor(len / 0x20000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476; const M = new Uint32Array(16);
  for (let off = 0; off < padLen; off += 64) { for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true); let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) { let F, g; if (i < 16) { F = (B & C) | (~B & D); g = i; } else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) % 16; } else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) % 16; } else { F = C ^ (B | ~D); g = (7 * i) % 16; } F = (F + A + K[i] + M[g]) >>> 0; A = D; D = C; C = B; const s = S[(i >> 4) * 4 + (i % 4)]; B = (B + ((F << s) | (F >>> (32 - s)))) >>> 0; }
    a0 = (a0 + A) >>> 0; b0 = (b0 + B) >>> 0; c0 = (c0 + C) >>> 0; d0 = (d0 + D) >>> 0; }
  const o = new DataView(new ArrayBuffer(16)); [a0, b0, c0, d0].forEach((v, i) => o.setUint32(i * 4, v, true)); return [...new Uint8Array(o.buffer)].map((b) => pad(b.toString(16))).join('');
}
const hex = (buf) => [...new Uint8Array(buf)].map((b) => pad(b.toString(16))).join('');
/* 纯 JS SHA：仅在非 HTTPS 访问（浏览器不提供 crypto.subtle）时使用 */
function shaSmall(bytes, is1) {
  const len = bytes.length, padLen = Math.ceil((len + 9) / 64) * 64, buf = new Uint8Array(padLen); buf.set(bytes); buf[len] = 0x80; const dv = new DataView(buf.buffer); dv.setUint32(padLen - 8, Math.floor(len / 0x20000000)); dv.setUint32(padLen - 4, (len * 8) >>> 0);
  const rot = (x, n) => (x >>> n) | (x << (32 - n)), rol = (x, n) => (x << n) | (x >>> (32 - n)); const w = new Uint32Array(80);
  if (is1) { let [h0, h1, h2, h3, h4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476, 0xc3d2e1f0];
    for (let o = 0; o < padLen; o += 64) { for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4); for (let i = 16; i < 80; i++) w[i] = rol(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1); let [a, b, c, d, e] = [h0, h1, h2, h3, h4];
      for (let i = 0; i < 80; i++) { const [f, k] = i < 20 ? [(b & c) | (~b & d), 0x5a827999] : i < 40 ? [b ^ c ^ d, 0x6ed9eba1] : i < 60 ? [(b & c) | (b & d) | (c & d), 0x8f1bbcdc] : [b ^ c ^ d, 0xca62c1d6]; const t = (rol(a, 5) + f + e + k + w[i]) >>> 0; e = d; d = c; c = rol(b, 30); b = a; a = t; }
      h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0; }
    return [h0, h1, h2, h3, h4].map((x) => x.toString(16).padStart(8, '0')).join(''); }
  const K = []; for (let n = 2; K.length < 64; n++) if ([...Array(n).keys()].slice(2).every((d) => n % d)) K.push(Math.floor((Math.cbrt(n) % 1) * 2 ** 32));
  const H = []; for (let n = 2; H.length < 8; n++) if ([...Array(n).keys()].slice(2).every((d) => n % d)) H.push(Math.floor((Math.sqrt(n) % 1) * 2 ** 32));
  const W = new Uint32Array(64);
  for (let o = 0; o < padLen; o += 64) { for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + i * 4); for (let i = 16; i < 64; i++) { const s0 = rot(W[i - 15], 7) ^ rot(W[i - 15], 18) ^ (W[i - 15] >>> 3), s1 = rot(W[i - 2], 17) ^ rot(W[i - 2], 19) ^ (W[i - 2] >>> 10); W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0; }
    let [a, b, c, d, e, f, g, hh] = H; for (let i = 0; i < 64; i++) { const t1 = (hh + (rot(e, 6) ^ rot(e, 11) ^ rot(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0, t2 = ((rot(a, 2) ^ rot(a, 13) ^ rot(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0; hh = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0; }
    [a, b, c, d, e, f, g, hh].forEach((v, i) => { H[i] = (H[i] + v) >>> 0; }); }
  return H.map((x) => x.toString(16).padStart(8, '0')).join('');
}
async function hashAll(bytes) {
  const r = { MD5: md5(bytes) };
  if (crypto.subtle) { for (const n of ['SHA-1', 'SHA-256', 'SHA-384', 'SHA-512']) r[n] = hex(await crypto.subtle.digest(n, bytes)); }
  else { r['SHA-1'] = shaSmall(bytes, true); r['SHA-256'] = shaSmall(bytes, false); }
  return r;
}
function hashTool(root) {
  let upper = false, last = null; const res = h('div.col.gap-s'); const src = area({ placeholder: '输入要计算哈希的文本…', value: 'hello', style: 'min-height:110px' }); const cmp = h('input.input.mono', { placeholder: '粘贴已知哈希值进行校验（可选）' }); const cmpRes = h('div');
  const show = (r, label) => { last = r; const want = cmp.value.trim().toLowerCase(); mount(res, h('p.muted.small', label), Object.entries(r).map(([k, v]) => { const val = upper ? v.toUpperCase() : v; const match = want && v === want; return h('div.row.nw', { style: `padding:8px 12px;background:${match ? 'var(--ok-soft)' : 'var(--surface-2)'};border:1px solid ${match ? 'var(--ok)' : 'var(--border)'};border-radius:12px` }, h('b', { style: 'width:64px;flex:none;font-size:13px' }, k), h('code.grow', { style: 'word-break:break-all;font-size:12.5px' }, val), match && h('span.chip.ok', '匹配'), h('button.btn.sm.ghost.icon', { onclick: () => copyText(val) }, icon('copy'))); })); mount(cmpRes, want && !Object.values(r).includes(want) ? h('span.chip.warn', '与上述所有算法的结果均不一致') : null); };
  const text = async () => show(await hashAll(new TextEncoder().encode(src.value)), `文本（UTF-8，${new TextEncoder().encode(src.value).length} 字节）`);
  src.addEventListener('input', debounce(text, 150)); cmp.addEventListener('input', () => last && show(last, '')); 
  const dz = dropzone({ title: '或选择文件计算哈希', hint: '文件在本地读取，不会上传（最大 256MB）', compact: true, icon: 'fingerprint', onFiles: async ([f]) => { if (f.size > 256 * 1024 * 1024) return toast('文件超过 256MB', 'err'); mount(res, h('p.muted', '计算中…')); show(await hashAll(new Uint8Array(await readAs(f))), `${f.name}（${fmtSize(f.size)}）`); } });
  mount(root, h('div.col', src, dz, h('div.row', checkbox('大写输出', false, (v) => { upper = v; last && show(last, ''); }), h('div.grow', cmp), cmpRes), res)); text();
}

/* ───────── 时间戳 ───────── */
function timestamp(root) {
  const nowEl = h('div.mono', { style: 'font-size:30px;font-weight:800' }), nowMs = h('div.muted.mono'); const t = setInterval(() => { const n = Date.now(); nowEl.textContent = Math.floor(n / 1000); nowMs.textContent = n + ' 毫秒'; }, 200);
  const tsIn = h('input.input.mono', { value: Math.floor(Date.now() / 1000), oninput: calc1 }); const o1 = h('div.col.gap-s'); const dIn = h('input.input', { type: 'datetime-local', step: 1, value: new Date(Date.now() - new Date().getTimezoneOffset() * 6e4).toISOString().slice(0, 19), oninput: calc2 }); const o2 = h('div.col.gap-s');
  const row = (k, v) => h('div.row.nw', h('span.muted', { style: 'width:110px;flex:none' }, k), h('code.grow', v), h('button.btn.sm.ghost.icon', { onclick: () => copyText(v) }, icon('copy')));
  function calc1() { const raw = tsIn.value.trim(); if (!/^-?\d+(\.\d+)?$/.test(raw)) return mount(o1, h('span.muted', '请输入数字时间戳')); let n = +raw; const ms = Math.abs(n) >= 1e11 ? n : n * 1000; const d = new Date(ms); if (isNaN(d)) return mount(o1, h('span.muted', '时间戳超出范围')); const f = (tz) => new Intl.DateTimeFormat('zh-CN', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(d).replace(/\//g, '-');
    mount(o1, h('span.chip.pri', Math.abs(n) >= 1e11 ? '识别为毫秒' : '识别为秒'), row('本地时间', f(undefined)), row('UTC', f('UTC')), row('北京时间', f('Asia/Shanghai')), row('ISO 8601', d.toISOString()), row('星期', '星期' + '日一二三四五六'[d.getDay()])); }
  function calc2() { const d = new Date(dIn.value); if (isNaN(d)) return mount(o2); mount(o2, row('秒级时间戳', String(Math.floor(d / 1000))), row('毫秒级时间戳', String(d.getTime())), row('ISO 8601', d.toISOString())); }
  mount(root, h('div.col', h('div.panel.row', { style: 'justify-content:space-between' }, h('div', h('div.muted.small', '当前 Unix 时间戳（秒）'), nowEl, nowMs), h('button.btn.primary', { onclick: () => copyText(String(Math.floor(Date.now() / 1000))) }, icon('copy'), '复制')),
    h('div.grid.g2', h('div.panel.col', h('b', '时间戳 → 日期'), tsIn, o1, h('button.btn.sm', { onclick: () => { tsIn.value = Math.floor(Date.now() / 1000); calc1(); } }, '填入当前')), h('div.panel.col', h('b', '日期 → 时间戳'), dIn, o2)))); calc1(); calc2(); return () => clearInterval(t);
}

/* ───────── UUID ───────── */
const uuid4 = () => { if (crypto.randomUUID) return crypto.randomUUID(); const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128; const x = [...b].map((v) => v.toString(16).padStart(2, '0')).join(''); return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`; };
function uuidGen(root) {
  const o = { n: 5, upper: false, dash: true, brace: false }; const list = h('div.col.gap-s');
  const gen = () => { const arr = Array.from({ length: o.n }, () => { let u = uuid4(); if (!o.dash) u = u.replace(/-/g, ''); if (o.upper) u = u.toUpperCase(); if (o.brace) u = `{${u}}`; return u; }); mount(list, arr.map((u) => h('div.row.nw', { style: 'padding:9px 14px;background:var(--surface-2);border:1px solid var(--border);border-radius:12px' }, h('code.grow', { style: 'font-size:15px' }, u), h('button.btn.sm.ghost.icon', { onclick: () => copyText(u) }, icon('copy'))))); list.all = arr; };
  mount(root, h('div.col', h('div.panel.row', field('数量', select([1, 5, 10, 20, 50, 100], o.n, (v) => { o.n = +v; gen(); })), checkbox('大写', false, (v) => { o.upper = v; gen(); }), checkbox('保留连字符', true, (v) => { o.dash = v; gen(); }), checkbox('花括号', false, (v) => { o.brace = v; gen(); }), h('div.sp'), h('button.btn.primary', { onclick: gen }, icon('refresh-cw'), '重新生成'), h('button.btn', { onclick: () => copyText(list.all.join('\n')) }, icon('copy'), '复制全部')), list)); gen();
}

/* ───────── 进制 ───────── */
function baseConvert(root) {
  let base = 10; const BASES = [[2, '二进制'], [8, '八进制'], [10, '十进制'], [16, '十六进制'], [32, '32 进制'], [36, '36 进制']]; const inp = h('input.input.mono', { value: '255', style: 'font-size:18px;height:48px', oninput: run }); const out = h('div.col.gap-s');
  const parse = (s, b) => { s = s.trim().toLowerCase().replace(/^0[xob]/, '').replace(/[_\s]/g, ''); if (!s) return null; const digs = '0123456789abcdefghijklmnopqrstuvwxyz'; let neg = false; if (s[0] === '-') { neg = true; s = s.slice(1); } let v = 0n; for (const c of s) { const d = digs.indexOf(c); if (d < 0 || d >= b) throw new Error(`“${c}”不是有效的 ${b} 进制数字`); v = v * BigInt(b) + BigInt(d); } return neg ? -v : v; };
  function run() { try { const v = parse(inp.value, base); if (v === null) return mount(out); const f = (b) => v.toString(b); mount(out, [[2, '二进制'], [8, '八进制'], [10, '十进制'], [16, '十六进制'], [32, '32 进制'], [36, '36 进制']].map(([b, n]) => h('div.row.nw', { style: 'padding:9px 14px;background:var(--surface-2);border:1px solid var(--border);border-radius:12px' }, h('span.muted', { style: 'width:80px;flex:none' }, n), h('code.grow', { style: 'word-break:break-all' }, b === 16 ? f(b).toUpperCase() : f(b)), h('button.btn.sm.ghost.icon', { onclick: () => copyText(f(b)) }, icon('copy'))))); } catch (e) { mount(out, banner('err', e.message)); } }
  mount(root, h('div.col', h('div.panel.col', field('输入数值的进制', seg(BASES.map(([b, n]) => [b, n]), base, (v) => { base = +v; run(); })), inp, h('p.hint', '支持任意大整数（BigInt），可带 0x / 0b / 0o 前缀与负号。')), out)); run();
}

/* ───────── JWT ───────── */
function jwtDecode(root) {
  const src = area({ placeholder: '粘贴 JWT（xxxxx.yyyyy.zzzzz）', style: 'min-height:120px', value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IuW8oOS4iSIsImlhdCI6MTUxNjIzOTAyMiwiZXhwIjo0MTAyNDQ0ODAwfQ.signature' }); const out = h('div.col');
  const b64 = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s), (c) => c.charCodeAt(0)))); };
  const tm = (v) => new Date(v * 1000).toLocaleString('zh-CN', { hour12: false });
  const run = () => { const parts = src.value.trim().split('.'); if (parts.length < 2) return mount(out, banner('info', '请粘贴完整的 JWT')); try { const head = b64(parts[0]), pay = b64(parts[1]); const now = Date.now() / 1000; const chips = [];
    if (pay.exp) chips.push(h('span.chip' + (pay.exp < now ? '.warn' : '.ok'), pay.exp < now ? `已过期（${tm(pay.exp)}）` : `有效期至 ${tm(pay.exp)}`)); if (pay.iat) chips.push(h('span.chip', `签发于 ${tm(pay.iat)}`)); if (pay.nbf) chips.push(h('span.chip', `生效于 ${tm(pay.nbf)}`));
    mount(out, h('div.row', chips), h('div.grid.g2', h('div.panel.col', h('b', 'Header'), h('pre.out', JSON.stringify(head, null, 2))), h('div.panel.col', h('b', 'Payload'), h('pre.out', JSON.stringify(pay, null, 2)))), h('p.hint', '仅解码，不校验签名；请勿在不可信的网站粘贴生产环境的 Token（本工具在本地运行，不会上传）。')); } catch { mount(out, banner('err', '无法解析：不是有效的 JWT')); } };
  src.addEventListener('input', run); mount(root, h('div.col', src, out)); run();
}

/* ───────── 正则 ───────── */
function regexTest(root) {
  const o = { re: '(\\d{4})-(\\d{2})-(\\d{2})', flags: 'g', rep: '$3/$2/$1' }; const txt = area({ style: 'min-height:160px;font-family:var(--mono)', value: '今天是 2026-10-31，明天是 2026-11-01。\n联系电话 13800138000，邮箱 hello@example.com' }); const hl = h('div.out-box', { style: 'min-height:80px;font-family:var(--font);font-size:15px;line-height:1.8' }); const list = h('div'); const repOut = h('pre.out'); const err = h('div');
  const PRESETS = [['手机号', '1[3-9]\\d{9}'], ['邮箱', '[\\w.+-]+@[\\w-]+(?:\\.[\\w-]+)+'], ['URL', 'https?://[^\\s"<>]+'], ['日期', '\\d{4}-\\d{2}-\\d{2}'], ['IPv4', '(?:\\d{1,3}\\.){3}\\d{1,3}'], ['汉字', '[\\u4e00-\\u9fa5]+'], ['身份证（格式）', '[1-9]\\d{5}(?:18|19|20)\\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\\d|3[01])\\d{3}[\\dXx]'], ['十六进制色', '#(?:[0-9a-fA-F]{3}){1,2}\\b']];
  const reIn = h('input.input.mono', { value: o.re, oninput: (e) => { o.re = e.target.value; run(); } }); const flIn = h('input.input.mono', { value: o.flags, style: 'width:90px', oninput: (e) => { o.flags = e.target.value; run(); } }); const repIn = h('input.input.mono', { value: o.rep, oninput: (e) => { o.rep = e.target.value; run(); } });
  function run() { mount(err); let re; try { re = new RegExp(o.re, o.flags.includes('g') ? o.flags : o.flags + 'g'); } catch (e) { mount(err, banner('err', e.message)); mount(hl, txt.value); mount(list); return; } const t = txt.value; const ms = []; let m; let guard = 0; while ((m = re.exec(t)) && guard++ < 5000) { ms.push(m); if (m[0] === '') re.lastIndex++; }
    const frag = []; let last = 0; ms.forEach((x) => { frag.push(t.slice(last, x.index)); frag.push(h('mark', { style: 'background:rgba(91,95,245,.28);color:inherit;border-radius:3px;padding:0 1px' }, x[0])); last = x.index + x[0].length; }); frag.push(t.slice(last)); mount(hl, frag.length ? frag : t);
    mount(list, h('div.row', h('span.chip.pri', `${ms.length} 处匹配`)), ms.length ? h('div.scroll-y.mt-s', { style: 'max-height:260px' }, h('table.table', h('thead', h('tr', h('th', '#'), h('th', '匹配'), h('th', '位置'), h('th', '捕获组'))), h('tbody', ms.slice(0, 200).map((x, i) => h('tr', h('td', i + 1), h('td.mono', x[0]), h('td', x.index), h('td.mono', x.slice(1).map((g, k) => `$${k + 1}=${g}`).join('  '))))))) : null);
    try { repOut.textContent = t.replace(new RegExp(o.re, o.flags), o.rep); } catch { repOut.textContent = ''; } }
  txt.addEventListener('input', run);
  mount(root, h('div.col', h('div.panel.col', h('div.row.nw', h('span.muted.mono', '/'), h('div.grow', reIn), h('span.muted.mono', '/'), flIn), err, h('div.row', PRESETS.map(([n, r]) => h('button.btn.sm', { onclick: () => { o.re = r; reIn.value = r; run(); } }, n))), h('p.hint', '标志：g 全局 · i 忽略大小写 · m 多行 · s 点匹配换行 · u Unicode')), field('测试文本', txt), h('div.panel.col', h('b', '匹配高亮'), hl, list), h('div.panel.col', field('替换为（支持 $1 $2…）', repIn), h('pre.out', { style: 'display:none' }), repOut))); run();
}
export const tools = { 'json-tool': jsonTool, base64, 'url-codec': urlCodec, 'hash-tool': hashTool, timestamp, 'uuid-gen': uuidGen, 'base-convert': baseConvert, 'jwt-decode': jwtDecode, 'regex-test': regexTest };
