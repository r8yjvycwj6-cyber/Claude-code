// DOM 小工具。所有用户内容都通过 textContent / createTextNode 插入，不使用 innerHTML，防止 XSS。
import { icon } from './icons.js';

export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (['value', 'checked', 'disabled', 'textContent', 'placeholder', 'type', 'title', 'accept', 'multiple', 'rows', 'maxLength', 'autofocus', 'spellcheck', 'src', 'alt', 'href', 'download', 'target', 'rel', 'id', 'name', 'autocomplete', 'open'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, children);
  return el;
}

export function add(el, children) {
  for (const c of [children].flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function iconBtn(name, title, onClick, extra = {}) {
  return h('button', { class: `icon-btn ${extra.class || ''}`, title, 'aria-label': title, onClick, type: 'button', ...extra.attrs }, icon(name, extra.size || 24));
}

// ---------------------------------------------------------------- 提示、菜单、弹窗
export function toast(text, ms = 3200) {
  const t = h('div', { class: 'toast' }, text);
  document.getElementById('toasts').append(t);
  setTimeout(() => t.remove(), ms);
}

let openMenu = null;
export function closeMenu() {
  if (openMenu) {
    openMenu.el.remove();
    openMenu.onClose?.();
    openMenu = null;
  }
}
document.addEventListener('mousedown', (e) => {
  if (openMenu && !openMenu.el.contains(e.target)) closeMenu();
}, true);
window.addEventListener('blur', closeMenu);
window.addEventListener('resize', closeMenu);

/** items: [{ label, icon?, danger?, onClick }]，anchor 为元素或 {x,y} */
export function showMenu(anchor, items, { onClose, align = 'right' } = {}) {
  closeMenu();
  const el = h('div', { class: 'menu', role: 'menu' },
    items.filter(Boolean).map((it) =>
      h('button', {
        class: it.danger ? 'danger' : '',
        type: 'button',
        onClick: () => {
          closeMenu();
          it.onClick();
        },
      }, it.icon ? icon(it.icon, 20) : null, it.label)
    )
  );
  document.getElementById('overlay-root').append(el);
  const r = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const mw = el.offsetWidth;
  const mh = el.offsetHeight;
  let x = align === 'right' ? r.right - mw : r.left;
  let y = r.bottom + 4;
  if (y + mh > innerHeight - 8) y = Math.max(8, r.top - mh - 4);
  x = Math.min(Math.max(8, x), innerWidth - mw - 8);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  openMenu = { el, onClose };
}

/** actions: [{ label, primary?, danger?, onClick? }]；onClick 返回 false 则不关闭 */
export function showModal({ title, body, actions = [], onClose, wide }) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);
  const modal = h('div', { class: 'modal', role: 'dialog', style: wide ? { width: 'min(640px, calc(100vw - 40px))' } : null },
    title ? h('h3', {}, title) : null,
    body,
    actions.length
      ? h('div', { class: 'actions' }, actions.map((a) =>
          h('button', {
            type: 'button',
            class: `btn ${a.primary ? '' : a.danger ? 'danger' : 'secondary'}`,
            onClick: async (e) => {
              const btn = e.currentTarget;
              btn.disabled = true;
              try {
                const r = a.onClick ? await a.onClick() : undefined;
                if (r !== false) close();
              } finally {
                btn.disabled = false;
              }
            },
          }, a.label)))
      : null
  );
  backdrop.append(modal);
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) close();
  });
  document.getElementById('overlay-root').append(backdrop);
  const first = modal.querySelector('input, textarea');
  if (first) setTimeout(() => first.focus(), 30);
  return { close, modal };
}

export function confirmDialog(title, text, okLabel = '确定', danger = false) {
  return new Promise((resolve) => {
    let ok = false;
    showModal({
      title,
      body: h('p', {}, text),
      actions: [
        { label: '取消' },
        { label: okLabel, primary: !danger, danger, onClick: () => { ok = true; } },
      ],
      onClose: () => resolve(ok),
    });
  });
}

/** fields: [{ name, label, type?, value?, placeholder?, hint? }] → Promise<object|null> */
export function formDialog(title, fields, { okLabel = '确定', text, validate } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const inputs = {};
    const err = h('div', { class: 'form-error' });
    const body = h('div', {},
      text ? h('p', {}, text) : null,
      fields.map((f) => {
        inputs[f.name] = h('input', { type: f.type || 'text', value: f.value || '', placeholder: f.placeholder || '', autocomplete: 'off' });
        return h('div', { class: 'field' }, h('label', {}, f.label), inputs[f.name], f.hint ? h('div', { class: 'hint' }, f.hint) : null);
      }),
      err
    );
    const submit = async () => {
      const vals = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
      const msg = validate ? await validate(vals) : null;
      if (msg) {
        err.textContent = msg;
        return false;
      }
      result = vals;
    };
    const m = showModal({ title, body, actions: [{ label: '取消' }, { label: okLabel, primary: true, onClick: submit }], onClose: () => resolve(result) });
    body.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if ((await submit()) !== false) m.close();
      }
    });
  });
}

// ---------------------------------------------------------------- 格式化
const pad = (n) => String(n).padStart(2, '0');
const WEEK = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function hhmm(ts) {
  const d = new Date(ts);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export function listTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (days === 0) return hhmm(ts);
  if (days === 1) return '昨天';
  if (days < 7) return WEEK[d.getDay()];
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}
export function dayLabel(ts) {
  const d = new Date(ts);
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86400000);
  if (days === 0) return '今天';
  if (days === 1) return '昨天';
  if (days < 7) return WEEK[d.getDay()];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}
export function sameDay(a, b) {
  return startOfDay(new Date(a)) === startOfDay(new Date(b));
}
export function lastSeenText(p) {
  if (!p) return '';
  if (p.online) return '在线';
  if (!p.lastSeen) return '';
  const day = dayLabel(p.lastSeen);
  return `最后上线于 ${day === '今天' ? '' : `${day} `}${hhmm(p.lastSeen)}`;
}
export function formatSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'）)】]+/gi;
export function linkify(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(h('a', { href: m[0], target: '_blank', rel: 'noopener noreferrer' }, m[0]));
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function isOnlyEmoji(text) {
  const t = text.trim();
  if (!t || t.length > 24) return false;
  return /^(\p{Extended_Pictographic}|\p{Emoji_Component}|‍|️|\s)+$/u.test(t) && !/^[\d#*\s]+$/.test(t);
}

// ---------------------------------------------------------------- 头像
const COLORS = ['#e17076', '#7bc862', '#65aadd', '#a695e7', '#ee7aae', '#6ec9cb', '#faa774', '#d4a253', '#56b1a3', '#8a8de0', '#e88d5f', '#5fb8e8'];
export function colorFor(id) {
  return COLORS[Math.abs(Number(id) || 0) % COLORS.length];
}

export function avatarEl(src, { size = 49, kind = 'person', seed = 0 } = {}) {
  const el = h('div', { class: 'avatar', style: { width: `${size}px`, height: `${size}px` } });
  const fallback = () => {
    el.classList.add('placeholder');
    el.replaceChildren(icon(kind === 'group' ? 'group' : 'person', Math.round(size * 0.62)));
    el.style.background = seed ? colorFor(seed) : '';
    if (seed) el.style.color = '#fff';
  };
  if (src) {
    const img = h('img', { src, alt: '', draggable: 'false' });
    img.onerror = fallback;
    el.append(img);
  } else fallback();
  return el;
}

export function pickFile({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, multiple });
    input.addEventListener('change', () => resolve(multiple ? [...input.files] : input.files[0] || null));
    input.click();
  });
}

export function saveBlobAs(url, name) {
  const a = h('a', { href: url, download: name || 'file' });
  document.body.append(a);
  a.click();
  a.remove();
}
