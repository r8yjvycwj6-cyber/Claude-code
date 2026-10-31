import { h, $, $$, mount, clear, icon, toast, modal, api, ApiError, debounce, store, spinner, banner, field } from './ui.js';

const state = { tools: [], cats: [], byId: {}, catById: {}, user: null, health: { capabilities: {} }, favs: store.get('favs', []), recents: store.get('recents', []) };
const authListeners = new Set();
const pageListeners = new Set(); // 仅当前工具页使用，路由切换时清理
const onPageAuth = (f) => { authListeners.add(f); pageListeners.add(f); };
let cleanup = null;
let navToken = 0;

/* ───────── 偏好（收藏 / 最近使用）：本地保存，登录后与账号同步 ───────── */
const pushPrefs = debounce(() => {
  if (state.user) api('/api/user/prefs', { method: 'PUT', json: { favs: state.favs, recents: state.recents } }).catch(() => {});
}, 800);
function savePrefs() { store.set('favs', state.favs); store.set('recents', state.recents); pushPrefs(); }
function toggleFav(id) {
  state.favs = state.favs.includes(id) ? state.favs.filter((x) => x !== id) : [id, ...state.favs];
  savePrefs();
}
function addRecent(id) { state.recents = [id, ...state.recents.filter((x) => x !== id)].slice(0, 12); savePrefs(); }
function mergePrefs(p) {
  if (!p) return;
  const uniq = (a) => [...new Set(a)].filter((id) => state.byId[id]);
  state.favs = uniq([...state.favs, ...(p.favs || [])]);
  state.recents = uniq([...state.recents, ...(p.recents || [])]).slice(0, 12);
  savePrefs();
}

/* ───────── 路由 ───────── */
export function navigate(path, replace = false) {
  if (path === location.pathname + location.search) return render();
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  render();
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[data-link]');
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  navigate(a.getAttribute('href'));
  scrollTo({ top: 0 });
});
addEventListener('popstate', render);

/* ───────── 外壳 ───────── */
function Header() {
  const root = h('header.header');
  const draw = () => {
    const u = state.user;
    const path = location.pathname;
    const menuWrap = h('div.rel');
    const avatar = u && h('button.avatar', { 'aria-label': '账号菜单', onclick: (e) => { e.stopPropagation(); toggleMenu(); } }, u.email[0]);
    function toggleMenu() {
      const open = $('.menu', menuWrap);
      if (open) return open.remove();
      const m = h('div.menu',
        h('div.menu-head', '已登录', h('br'), h('b', { style: 'color:var(--text)' }, u.email)),
        h('button', { onclick: () => { m.remove(); changePasswordModal(); } }, icon('key-round'), '修改密码'),
        h('button', { onclick: () => { m.remove(); navigate('/?c=fav'); } }, icon('star'), '我的收藏'),
        h('div.menu-sep'),
        h('button.danger', { onclick: logout }, icon('log-out'), '退出登录'));
      menuWrap.append(m);
      setTimeout(() => document.addEventListener('click', function f(ev) { if (!m.contains(ev.target)) m.remove(); document.removeEventListener('click', f); }), 0);
    }
    mount(root, h('div.header-in',
      h('a.logo', { href: '/', 'data-link': true }, h('div.logo-mark', icon('wrench')), h('span.logo-text', '在线工具箱')),
      h('nav.header-nav', ['office', 'pdf', 'scan', 'media'].map((c) =>
        h('a', { href: `/?c=${c}`, 'data-link': true, class: location.search === `?c=${c}` && path === '/' ? 'on' : '' }, state.catById[c].name))),
      h('div.header-sp'),
      h('button.search-btn', { onclick: openPalette, 'aria-label': '搜索工具' }, icon('search'), h('span', '搜索 71 个工具…'.replace('71', state.tools.length)), h('span.kbd', navigator.platform.includes('Mac') ? '⌘K' : 'Ctrl K')),
      h('button.icon-btn', { onclick: toggleTheme, 'aria-label': '切换主题', title: '切换明暗主题' }, icon(document.documentElement.dataset.theme === 'dark' ? 'sun' : 'moon')),
      u ? (menuWrap.append(avatar), menuWrap) : h('button.btn.primary', { onclick: () => openAuth('login') }, icon('log-in'), '登录', h('span.hide-m', ' / 注册'))));
  };
  draw();
  authListeners.add(draw);
  root.redraw = draw;
  return root;
}
function toggleTheme() {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('tb_theme', t); } catch {}
  $('.header').redraw();
}

/* ───────── 登录 / 注册（仅邮箱 + 密码） ───────── */
function setUser(data) {
  state.user = data.user || null;
  if (data.prefs) mergePrefs(data.prefs);
  authListeners.forEach((f) => f());
}
export function openAuth(mode = 'login', hint) {
  let isLogin = mode === 'login';
  const err = h('div.banner.err', { hidden: true });
  const email = h('input.input', { type: 'email', placeholder: 'you@example.com', autocomplete: 'email', required: true, style: 'height:46px' });
  const pw = h('input.input', { type: 'password', placeholder: '至少 8 位', autocomplete: isLogin ? 'current-password' : 'new-password', required: true, style: 'height:46px;padding-right:44px' });
  const eye = h('button.btn.ghost.icon.sm', { type: 'button', style: 'position:absolute;right:7px;top:7px', 'aria-label': '显示密码', onclick: () => { pw.type = pw.type === 'password' ? 'text' : 'password'; } }, icon('eye'));
  const submit = h('button.btn.primary.lg.block', { type: 'submit' });
  const title = h('h2'); const sub = h('p.muted.small'); const switcher = h('div.center.small.muted', { style: 'margin-top:4px' });
  const form = h('form.col', { onsubmit: async (e) => {
    e.preventDefault();
    err.hidden = true; submit.disabled = true; const old = submit.textContent; submit.replaceChildren(spinner(), isLogin ? '登录中…' : '注册中…');
    try {
      const data = await api(isLogin ? '/api/auth/login' : '/api/auth/register', { method: 'POST', json: { email: email.value, password: pw.value } });
      setUser(data); m.close(); toast(isLogin ? '登录成功，欢迎回来' : '注册成功，已自动登录', 'ok');
    } catch (ex) { err.hidden = false; err.replaceChildren(icon('circle-alert'), ex.message); submit.disabled = false; submit.textContent = old; }
  } }, hint && banner('info', hint), err, field('邮箱', email), field('密码', h('div.rel', pw, eye)), submit, switcher);
  const paint = () => {
    title.textContent = isLogin ? '登录账号' : '创建账号';
    sub.textContent = isLogin ? '登录后可使用音视频 / Office 转换，并同步收藏。' : '只需邮箱和密码，无需验证，注册即用。';
    submit.textContent = isLogin ? '登录' : '注册并登录';
    pw.autocomplete = isLogin ? 'current-password' : 'new-password';
    switcher.replaceChildren(isLogin ? '还没有账号？' : '已有账号？', h('a', { href: '#', onclick: (e) => { e.preventDefault(); isLogin = !isLogin; err.hidden = true; paint(); } }, isLogin ? ' 立即注册' : ' 去登录'));
  };
  paint();
  const m = modal(h('div.col', h('div.row', { style: 'gap:12px' }, h('div.logo-mark', icon('wrench')), h('div', title, sub)), form));
  setTimeout(() => email.focus(), 40);
}
function changePasswordModal() {
  const o = h('input.input', { type: 'password', autocomplete: 'current-password' }), n = h('input.input', { type: 'password', autocomplete: 'new-password', placeholder: '至少 8 位' });
  const err = h('div.banner.err', { hidden: true });
  const m = modal(h('form.col', { onsubmit: async (e) => {
    e.preventDefault();
    try { await api('/api/auth/password', { method: 'POST', json: { oldPassword: o.value, newPassword: n.value } }); m.close(); toast('密码已更新', 'ok'); }
    catch (ex) { err.hidden = false; err.replaceChildren(icon('circle-alert'), ex.message); }
  } }, h('h2', '修改密码'), err, field('当前密码', o), field('新密码', n), h('button.btn.primary.block', { type: 'submit' }, '保存')));
}
async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  state.user = null; authListeners.forEach((f) => f()); toast('已退出登录');
}
/** 工具内调用：未登录则弹出登录框并返回 false */
function requireLogin(hint = '此功能需要登录后使用') {
  if (state.user) return true;
  openAuth('login', hint);
  return false;
}

/* ───────── 搜索（首页 & 命令面板） ───────── */
function search(q) {
  q = q.trim().toLowerCase();
  if (!q) return state.tools;
  const words = q.split(/\s+/);
  return state.tools
    .map((t) => {
      const hay = (t.name + ' ' + t.desc + ' ' + t.tags + ' ' + state.catById[t.cat].name).toLowerCase();
      if (!words.every((w) => hay.includes(w))) return null;
      return { t, s: (t.name.toLowerCase().includes(q) ? 0 : 2) + (t.tags.toLowerCase().includes(q) ? 0 : 1) + (t.hot ? -0.5 : 0) };
    })
    .filter(Boolean).sort((a, b) => a.s - b.s).map((x) => x.t);
}
function openPalette() {
  if ($('.pal')) return;
  let results = search(''), idx = 0;
  const list = h('div.pal-list');
  const input = h('input', { placeholder: '搜索工具，例如：pdf、视频转换、二维码…', oninput: () => { results = search(input.value).slice(0, 30); idx = 0; paint(); }, onkeydown: (e) => {
    if (e.key === 'ArrowDown') { idx = Math.min(results.length - 1, idx + 1); paint(true); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); paint(true); e.preventDefault(); }
    else if (e.key === 'Enter' && results[idx]) go(results[idx]);
  } });
  const go = (t) => { m.close(); navigate('/tool/' + t.id); scrollTo({ top: 0 }); };
  function paint(scroll) {
    mount(list, results.length ? results.map((t, i) => h('div.pal-item' + (i === idx ? '.on' : ''), { onclick: () => go(t), onmousemove: () => { if (idx !== i) { idx = i; $$('.pal-item', list).forEach((e, j) => e.classList.toggle('on', j === i)); } } },
      toolIcon(t, 'sm'), h('div.grow', h('div.t', t.name), h('div.d.ellipsis', t.desc)), h('span.chip', state.catById[t.cat].name)))
      : h('div.empty', '没有找到相关工具，换个关键词试试'));
    if (scroll) $('.pal-item.on', list)?.scrollIntoView({ block: 'nearest' });
  }
  results = state.tools.slice(0, 30); paint();
  const m = modal(h('div', h('div.pal-in', icon('search'), input, h('span.kbd', 'Esc')), list,
    h('div.pal-foot', h('span', '↑↓ 选择'), h('span', '↵ 打开'), h('span.sp'), h('span', `共 ${state.tools.length} 个工具`))), { cls: 'pal' });
  m.overlay.style.paddingTop = '12vh';
  setTimeout(() => input.focus(), 30);
}
addEventListener('keydown', (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); }
  else if (e.key === '/' && !typing && !$('.overlay')) { e.preventDefault(); const hs = $('.hero-search input'); hs ? hs.focus() : openPalette(); }
});

/* ───────── 组件：工具卡片 ───────── */
const toolIcon = (t, size = '') => h('div.tile-ico' + (size ? '.' + size : ''), { style: `--h:${state.catById[t.cat].hue}` }, icon(t.icon));
function ToolCard(t, i = 0) {
  const fav = h('button.fav' + (state.favs.includes(t.id) ? '.on' : ''), { title: '收藏', 'aria-label': '收藏', onclick: (e) => {
    e.preventDefault(); e.stopPropagation(); toggleFav(t.id); fav.classList.toggle('on', state.favs.includes(t.id));
    if (new URLSearchParams(location.search).get('c') === 'fav') render();
  } }, icon('star'));
  return h('div.card', { style: `--h:${state.catById[t.cat].hue};animation-delay:${Math.min(i, 12) * 25}ms` },
    toolIcon(t),
    h('div.grow',
      h('div.c-name', h('a', { href: '/tool/' + t.id, 'data-link': true }, t.name), t.hot && h('span.badge.hot', '热门'), t.server && h('span.badge.lock', icon('lock', ''), '登录')),
      h('div.c-desc', t.desc)),
    fav);
}

/* ───────── 首页 ───────── */
function Home() {
  const params = new URLSearchParams(location.search);
  let cat = params.get('c') || 'all';
  let q = params.get('q') || '';
  const grid = h('div');
  const catBar = h('div.cat-bar');
  const input = h('input', { placeholder: '搜索：pdf 合并 / 视频转 mp4 / 二维码 / 房贷…', value: q, autocomplete: 'off', oninput: () => { q = input.value; paintGrid(); } });
  function paintBar() {
    const pill = (id, label, ic, hue = 255) => h('button.cat-pill' + (cat === id ? '.on' : ''), { style: `--h:${hue}`, onclick: () => { cat = id; history.replaceState({}, '', id === 'all' ? '/' : `/?c=${id}`); paintBar(); paintGrid(); $('.header').redraw(); } }, icon(ic), label);
    mount(catBar, pill('all', '全部', 'layout-grid'), pill('fav', `收藏${state.favs.length ? ' ' + state.favs.length : ''}`, 'star', 45), state.cats.map((c) => pill(c.id, c.name, c.icon, c.hue)));
  }
  function section(title, tools, { ic, hue, sub } = {}) {
    return h('section.section', h('div.section-h', ic && h('div.tile-ico', { style: `--h:${hue}` }, icon(ic)), h('h2', title), sub && h('span.muted', sub)),
      h('div.cards', tools.map(ToolCard)));
  }
  function paintGrid() {
    const query = q.trim();
    if (query) {
      const r = search(query);
      return mount(grid, r.length ? section(`搜索结果`, r, { ic: 'search', hue: 255, sub: `${r.length} 个工具` }) : h('div.noresult', icon('search-x'), h('p', { style: 'margin-top:10px' }, `没有找到“${query}”相关的工具`)));
    }
    if (cat === 'fav') {
      const favs = state.favs.map((id) => state.byId[id]).filter(Boolean);
      return mount(grid, favs.length ? section('我的收藏', favs, { ic: 'star', hue: 45 }) : h('div.noresult', icon('star'), h('p', { style: 'margin-top:10px' }, '还没有收藏，点击工具卡片右上角的星标即可收藏')));
    }
    if (cat !== 'all') {
      const c = state.catById[cat]; if (!c) { cat = 'all'; return paintGrid(); }
      return mount(grid, section(c.name, state.tools.filter((t) => t.cat === cat), { ic: c.icon, hue: c.hue, sub: c.desc }));
    }
    const recents = state.recents.map((id) => state.byId[id]).filter(Boolean).slice(0, 6);
    mount(grid,
      recents.length > 0 && section('最近使用', recents, { ic: 'history', hue: 200 }),
      section('热门工具', state.tools.filter((t) => t.hot), { ic: 'flame', hue: 15, sub: '大家最常用的' }),
      state.cats.map((c) => section(c.name, state.tools.filter((t) => t.cat === c.id), { ic: c.icon, hue: c.hue, sub: c.desc })));
  }
  paintBar(); paintGrid();
  const view = h('div',
    h('div.hero',
      h('div.pill', h('span.dot'), '多数工具在浏览器本地运行 · 文件不上传'),
      h('h1', '办公、文档、音视频', h('br'), h('em', '一个工具箱全搞定')),
      h('p.sub', 'PPT / Word / PDF 制作与转换、全能扫描、OCR、音视频格式转换、音频播放器，以及日常生活办公所需的各种小工具。'),
      h('div.hero-search', icon('search'), input, h('span.kbd.hide-m', '/')),
      h('div.hero-stats', h('span', h('b', state.tools.length), '个工具'), h('span', h('b', state.cats.length), '大分类'), h('span', h('b', '0'), '广告 · 免费使用'))),
    h('div.wrap', catBar, grid));
  return view;
}

/* ───────── 工具页 ───────── */
async function ToolPage(id, token) {
  const tool = state.byId[id];
  if (!tool) return NotFound();
  const cat = state.catById[tool.cat];
  document.title = `${tool.name} - 在线工具箱`;
  addRecent(id);
  const body = h('div.tool-body');
  const star = h('button.btn.sm.star-btn' + (state.favs.includes(id) ? '.on' : ''), { onclick: () => { toggleFav(id); star.classList.toggle('on', state.favs.includes(id)); toast(state.favs.includes(id) ? '已收藏' : '已取消收藏'); } }, icon('star'), '收藏');
  const notices = h('div.col', { style: 'margin-bottom:16px' });
  if (tool.server) {
    const cap = state.health.capabilities[tool.server];
    if (!cap) notices.append(banner('warn', h('b', tool.server === 'media' ? '服务器未检测到 ffmpeg' : '服务器未检测到 LibreOffice'), '：此工具暂不可用。', tool.server === 'media' ? '请安装 ffmpeg 后重启服务。' : '请安装 LibreOffice 后重启服务。'));
    if (state.health.requireLogin) {
      const login = h('div'); const draw = () => mount(login, state.user ? null : h('div.banner.info', icon('lock'), h('div.grow', '此工具在服务器上处理文件，', h('b', '登录后才可使用'), '（仅需邮箱 + 密码）。'), h('button.btn.sm.primary', { onclick: () => openAuth('login') }, '登录 / 注册')));
      draw(); onPageAuth(draw); notices.append(login);
    }
  }
  const view = h('div.wrap',
    h('div.crumbs', h('a', { href: '/', 'data-link': true }, '首页'), icon('chevron-right'), h('a', { href: `/?c=${cat.id}`, 'data-link': true }, cat.name), icon('chevron-right'), h('span', tool.name)),
    h('div.tool-head', toolIcon(tool, 'lg'), h('div.grow', h('h1', tool.name), h('p', tool.desc)), star),
    notices, body,
    h('h2.more-title', `更多${cat.name}`),
    h('div.cards', state.tools.filter((t) => t.cat === tool.cat && t.id !== id).slice(0, 6).map(ToolCard)));
  // 异步加载工具模块
  body.append(h('div.loading-page', spinner(), '加载中…'));
  queueMicrotask(async () => {
    try {
      const mod = await import(`/js/tools/${tool.mod || tool.id}.js`);
      if (token !== navToken) return;
      const mountFn = mod.tools?.[id] ?? mod.default;
      clear(body);
      const ctx = { tool, state, requireLogin, toast, navigate, health: state.health, get user() { return state.user; }, onAuth: (f) => { onPageAuth(f); return () => { authListeners.delete(f); pageListeners.delete(f); }; } };
      const c = await mountFn(body, ctx);
      if (token !== navToken) { c?.(); return; }
      cleanup = typeof c === 'function' ? c : null;
    } catch (e) {
      console.error(e);
      if (token === navToken) mount(body, banner('err', '工具加载失败：' + e.message));
    }
  });
  return view;
}
function NotFound() {
  document.title = '页面不存在 - 在线工具箱';
  return h('div.wrap', h('div.noresult', icon('compass'), h('h2', { style: 'margin:10px 0' }, '页面不存在'), h('a.btn.primary', { href: '/', 'data-link': true }, '回到首页')));
}

/* ───────── 渲染入口 ───────── */
async function render() {
  const token = ++navToken;
  try { cleanup?.(); } catch (e) { console.error(e); }
  cleanup = null;
  pageListeners.forEach((f) => authListeners.delete(f)); pageListeners.clear();
  const main = $('#main');
  const m = /^\/tool\/([\w-]+)\/?$/.exec(location.pathname);
  let view;
  if (location.pathname === '/') { document.title = '在线工具箱 · 文档、PDF、音视频、图片一站搞定'; view = Home(); }
  else if (m) view = await ToolPage(m[1], token);
  else view = NotFound();
  if (token !== navToken) return;
  mount(main, view);
  $('.header').redraw?.();
}

/* ───────── 启动 ───────── */
(async function boot() {
  const app = $('#app');
  mount(app, h('div.loading-page', { style: 'min-height:100vh' }, spinner()));
  try {
    const [t, health, me] = await Promise.all([api('/api/tools'), api('/api/health'), api('/api/auth/me')]);
    state.tools = t.tools; state.cats = t.categories; state.health = health;
    state.byId = Object.fromEntries(t.tools.map((x) => [x.id, x]));
    state.catById = Object.fromEntries(t.categories.map((x) => [x.id, x]));
    state.user = me.user;
    state.favs = state.favs.filter((id) => state.byId[id]); state.recents = state.recents.filter((id) => state.byId[id]);
    if (me.prefs) mergePrefs(me.prefs);
  } catch (e) {
    return mount(app, h('div.loading-page', { style: 'min-height:100vh' }, banner('err', '无法连接服务器：' + e.message)));
  }
  mount(app, Header(), h('main#main'),
    h('footer.footer', h('div', '大部分工具在浏览器本地处理，文件不会离开你的设备；音视频 / Office 转换需上传至服务器处理，完成后 1 小时内自动删除。'), h('div', { style: 'margin-top:6px' }, '在线工具箱 · Node.js')));
  render();
})();
