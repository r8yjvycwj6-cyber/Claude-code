// 轻量 UI 工具库：hyperscript、组件、文件/下载/网络辅助
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** h('div.cls#id', {onclick, style:{}, class:'x', dataset:{}}, ...children) */
export function h(tag, props, ...children) {
  if (props != null && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) { children.unshift(props); props = null; }
  const m = /^([a-z0-9-]*)((?:[.#][\w-]+)*)$/i.exec(tag);
  const el = document.createElement(m && m[1] ? m[1] : 'div');
  if (m && m[2]) for (const part of m[2].match(/[.#][\w-]+/g)) part[0] === '.' ? el.classList.add(part.slice(1)) : (el.id = part.slice(1));
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.classList.add(...String(v).split(/\s+/).filter(Boolean));
    else if (k === 'style') typeof v === 'string' ? (el.style.cssText += v) : Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'ref') v(el);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k in el && k !== 'list' && k !== 'type' && typeof v !== 'object') { try { el[k] = v; } catch { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}
export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export const mount = (el, ...children) => append(clear(el), children);
export const icon = (name, cls = '') => h('i.ico' + (cls ? '.' + cls : ''), { style: `--i:url(/icons/${name}.svg)` });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const uid = () => Math.random().toString(36).slice(2, 10);
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmtSize(n) {
  if (!Number.isFinite(n)) return '-';
  const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)) + ' ' + u[i];
}
export function fmtTime(sec, ms = false) {
  if (!Number.isFinite(sec)) return '--:--';
  sec = Math.max(0, sec);
  const hh = Math.floor(sec / 3600), mm = Math.floor((sec % 3600) / 60), ss = Math.floor(sec % 60);
  const base = (hh ? hh + ':' + String(mm).padStart(2, '0') : mm) + ':' + String(ss).padStart(2, '0');
  return ms ? base + '.' + String(Math.floor((sec % 1) * 100)).padStart(2, '0') : base;
}
export const baseName = (name) => name.replace(/\.[^.]+$/, '');
export const extOf = (name) => (/\.([^.]+)$/.exec(name) || [, ''])[1].toLowerCase();

/* ───────── toast / modal ───────── */
export function toast(msg, type = '', ms = 2600) {
  const box = document.getElementById('toasts');
  const el = h('div.toast' + (type ? '.' + type : ''), type === 'err' ? icon('circle-alert') : type === 'ok' ? icon('circle-check') : null, msg);
  box.append(el);
  setTimeout(() => { el.style.transition = 'opacity .25s'; el.style.opacity = 0; setTimeout(() => el.remove(), 260); }, ms);
}
export function modal(content, { wide = false, cls = '', onClose, dismiss = true } = {}) {
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === 'Escape' && dismiss) close(); };
  const box = h('div.modal' + (wide ? '.wide' : '') + (cls ? '.' + cls : ''), { role: 'dialog', 'aria-modal': 'true' },
    dismiss && h('button.btn.ghost.icon.modal-x', { onclick: close, 'aria-label': '关闭' }, icon('x')), content);
  const overlay = h('div.overlay', { onmousedown: (e) => { if (e.target === overlay && dismiss) close(); } }, box);
  document.body.append(overlay);
  document.addEventListener('keydown', onKey);
  return { close, el: box, overlay };
}
export function confirmBox(title, text, okText = '确定', danger = false) {
  return new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    const m = modal(h('div.col', h('h2', title), h('p.muted', text),
      h('div.row', { style: 'justify-content:flex-end;margin-top:8px' },
        h('button.btn', { onclick: () => fin(false) }, '取消'),
        h('button.btn.primary' + (danger ? '.danger' : ''), { onclick: () => fin(true) }, okText))), { onClose: () => fin(false) });
  });
}
export function promptBox(title, value = '', placeholder = '') {
  return new Promise((resolve) => {
    let done = false;
    const input = h('input.input', { value, placeholder, onkeydown: (e) => { if (e.key === 'Enter') fin(input.value); } });
    const fin = (v) => { if (done) return; done = true; m.close(); resolve(v); };
    const m = modal(h('div.col', h('h2', title), input,
      h('div.row', { style: 'justify-content:flex-end' }, h('button.btn', { onclick: () => fin(null) }, '取消'), h('button.btn.primary', { onclick: () => fin(input.value) }, '确定'))), { onClose: () => fin(null) });
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

/* ───────── widgets ───────── */
export function field(label, input, hint) {
  return h('div.field', label && h('label', label, hint && h('span.hint', hint)), input);
}
/** 分段选择器。options: [[value,label]] 或 ['a','b'] */
export function seg(options, value, onChange) {
  const opts = options.map((o) => (Array.isArray(o) ? o : [o, o]));
  const root = h('div.seg');
  const set = (v, fire = true) => {
    value = v;
    $$('button', root).forEach((b) => b.classList.toggle('on', b.dataset.v === String(v)));
    if (fire) onChange?.(v);
  };
  opts.forEach(([v, l]) => root.append(h('button', { type: 'button', dataset: { v }, onclick: () => set(v) }, l)));
  set(value, false);
  root.get = () => value; root.set = set;
  return root;
}
export function select(options, value, onChange, cls = '') {
  const el = h('select.select' + (cls ? '.' + cls : ''), { onchange: () => onChange?.(el.value) },
    options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: String(v) === String(value) }, l); }));
  return el;
}
export function checkbox(label, checked, onChange) {
  const input = h('input', { type: 'checkbox', checked: !!checked, onchange: () => onChange?.(input.checked) });
  const el = h('label.check', input, label);
  el.input = input;
  return el;
}
export function range(min, max, step, value, onInput, fmt) {
  const out = h('span.hint', fmt ? fmt(value) : value);
  const input = h('input', { type: 'range', min, max, step, value, oninput: () => { out.textContent = fmt ? fmt(+input.value) : input.value; onInput?.(+input.value); } });
  const el = h('div.col.gap-s', { style: 'gap:2px' }, h('div.row.nw', { style: 'justify-content:flex-end;gap:0' }, out), input);
  el.input = input; el.out = out;
  return el;
}
export function progress(indeterminate = false) {
  const bar = h('i');
  const el = h('div.progress' + (indeterminate ? '.indet' : ''), bar);
  el.set = (p) => { el.classList.remove('indet'); bar.style.width = clamp(p * 100, 0, 100) + '%'; };
  return el;
}
export function spinner() { return h('span.spinner'); }
export function banner(type, ...kids) {
  const ic = { info: 'info', warn: 'triangle-alert', err: 'circle-alert', ok: 'circle-check' }[type];
  return h('div.banner.' + type, icon(ic), h('div.grow', ...kids));
}
export function tabs(items, active, onChange) {
  const root = h('div.tabs');
  const set = (v) => { $$('button', root).forEach((b) => b.classList.toggle('on', b.dataset.v === v)); onChange?.(v); };
  items.forEach(([v, l]) => root.append(h('button', { dataset: { v }, onclick: () => set(v) }, l)));
  $$('button', root).forEach((b) => b.classList.toggle('on', b.dataset.v === active));
  return root;
}
export function kv(obj) {
  const d = h('dl.kv');
  for (const [k, v] of Object.entries(obj)) d.append(h('dt', k), h('dd', v));
  return d;
}

/** 拖拽/点击选择文件。onFiles(File[]) */
export function dropzone({ accept = '*/*', multiple = false, onFiles, title = '点击选择文件，或拖拽到此处', hint = '', icon: ic = 'upload', compact = false, capture } = {}) {
  const input = h('input', { type: 'file', accept, multiple, capture });
  const acceptList = accept.split(',').map((s) => s.trim().toLowerCase()).filter((s) => s && s !== '*/*');
  const ok = (f) => !acceptList.length || acceptList.some((a) => a.startsWith('.') ? f.name.toLowerCase().endsWith(a) : a.endsWith('/*') ? f.type.startsWith(a.slice(0, -1)) : f.type === a);
  const handle = (list) => {
    let files = [...list].filter(ok);
    if (!files.length && list.length) return toast('文件类型不支持', 'err');
    if (!multiple) files = files.slice(0, 1);
    if (files.length) onFiles?.(files);
  };
  const el = h('div.dz' + (compact ? '.compact' : ''), {
    tabindex: 0, role: 'button',
    onclick: () => input.click(),
    onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } },
    ondragover: (e) => { e.preventDefault(); el.classList.add('over'); },
    ondragleave: () => el.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); el.classList.remove('over'); handle(e.dataTransfer.files); },
  }, h('div.dz-ico', icon(ic)), h('b', title), hint && h('p', hint), input);
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('change', () => { handle(input.files); input.value = ''; });
  // 支持粘贴图片
  return el;
}

/** 让列表项可拖拽排序。container 的直接子元素需带 data-id；完成后回调新顺序 */
export function sortable(container, onSort, handleSel) {
  let drag = null;
  container.addEventListener('dragstart', (e) => {
    const it = e.target.closest?.('[data-id]');
    if (!it || it.parentElement !== container) return;
    if (handleSel && !e.target.closest(handleSel) && !it.dataset.dragok) { /* allow whole item */ }
    drag = it; it.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', it.dataset.id); } catch {}
  });
  container.addEventListener('dragover', (e) => {
    if (!drag) return;
    e.preventDefault();
    const over = e.target.closest('[data-id]');
    if (!over || over === drag || over.parentElement !== container) return;
    const r = over.getBoundingClientRect();
    const horiz = getComputedStyle(container).display.includes('grid') || getComputedStyle(container).flexDirection === 'row';
    const after = horiz ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
    container.insertBefore(drag, after ? over.nextSibling : over);
  });
  const end = () => { if (!drag) return; drag.classList.remove('dragging'); drag = null; onSort([...container.children].map((c) => c.dataset.id)); };
  container.addEventListener('drop', (e) => { e.preventDefault(); end(); });
  container.addEventListener('dragend', end);
}

/* ───────── files / network ───────── */
export function download(data, filename) {
  const url = data instanceof Blob ? URL.createObjectURL(data) : data;
  const a = h('a', { href: url, download: filename });
  document.body.append(a); a.click(); a.remove();
  if (data instanceof Blob) setTimeout(() => URL.revokeObjectURL(url), 30000);
}
export const readAs = (file, kind = 'arrayBuffer') => new Promise((res, rej) => {
  const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error);
  ({ arrayBuffer: () => r.readAsArrayBuffer(file), text: () => r.readAsText(file), dataURL: () => r.readAsDataURL(file) })[kind]();
});
export async function copyText(text, msg = '已复制到剪贴板') {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = h('textarea', { value: text, style: 'position:fixed;opacity:0' }); document.body.append(ta); ta.select();
    try { document.execCommand('copy'); } catch {} ta.remove();
  }
  toast(msg, 'ok');
}
const scripts = new Map();
export function loadScript(src) {
  if (!scripts.has(src)) scripts.set(src, new Promise((res, rej) => {
    const s = h('script', { src, onload: res, onerror: () => { scripts.delete(src); rej(new Error('资源加载失败：' + src)); } });
    document.head.append(s);
  }));
  return scripts.get(src);
}

export class ApiError extends Error { constructor(msg, status, code) { super(msg); this.status = status; this.code = code; } }
export async function api(path, { method = 'GET', json, form, signal } = {}) {
  const init = { method, signal, headers: {}, credentials: 'same-origin' };
  if (json !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(json); }
  if (form) init.body = form;
  let res;
  try { res = await fetch(path, init); } catch (e) { if (e.name === 'AbortError') throw e; throw new ApiError('网络连接失败，请检查服务是否在运行'); }
  const ct = res.headers.get('content-type') || '';
  const body = ct.includes('json') ? await res.json().catch(() => ({})) : res;
  if (!res.ok) throw new ApiError(body.error || `请求失败 (${res.status})`, res.status, body.code);
  return body;
}
/** 带进度的表单上传，返回解析后的 JSON 或 Blob */
export function upload(url, form, { onProgress, signal, expect = 'json' } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.responseType = expect === 'blob' ? 'blob' : 'text';
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError('网络连接失败'));
    xhr.onabort = () => reject(new DOMException('aborted', 'AbortError'));
    xhr.onload = async () => {
      const ok = xhr.status >= 200 && xhr.status < 300;
      if (ok && expect === 'blob') {
        const cd = xhr.getResponseHeader('content-disposition') || '';
        const m = /filename\*=UTF-8''([^;]+)/i.exec(cd) || /filename="?([^";]+)"?/i.exec(cd);
        return resolve({ blob: xhr.response, name: m ? decodeURIComponent(m[1]) : null });
      }
      let body = {};
      try { body = JSON.parse(expect === 'blob' ? await xhr.response.text() : xhr.responseText); } catch {}
      if (!ok) return reject(new ApiError(body.error || `请求失败 (${xhr.status})`, xhr.status, body.code));
      resolve(body);
    };
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(form);
  });
}

/** 把任意元素的内容转成高 DPI 图片的便捷函数 */
export const canvasToBlob = (canvas, type = 'image/png', q = 0.92) => new Promise((res) => canvas.toBlob(res, type, q));

/** localStorage（容错） */
export const store = {
  get(k, d) { try { const v = localStorage.getItem('tb_' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tb_' + k, JSON.stringify(v)); } catch {} },
};

/** 批量结果列表（图片处理类工具复用）：items: [{name, blob, before}] */
export function resultList(items) {
  return h('div.file-list', items.map((it) => h('div.file-item',
    it.blob.type.startsWith('image/') ? h('img', { src: URL.createObjectURL(it.blob), style: 'width:46px;height:46px;object-fit:cover;border-radius:8px;background:#fff' }) : h('div.fi-ico', icon('file')),
    h('div.grow', h('div.fi-name.ellipsis', it.name), h('div.fi-meta', it.before != null ? `${fmtSize(it.before)} → ${fmtSize(it.blob.size)}` + (it.before ? `（${it.blob.size <= it.before ? '节省' : '增加'} ${Math.abs(Math.round((1 - it.blob.size / it.before) * 100))}%）` : '') : fmtSize(it.blob.size))),
    h('button.btn.sm', { onclick: () => download(it.blob, it.name) }, icon('download'), '下载'))));
}
