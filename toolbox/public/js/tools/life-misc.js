import { h, $, $$, mount, icon, toast, field, seg, select, range, tabs, copyText, store, banner, uid, debounce, confirmBox, download, checkbox } from '../ui.js';

const rnd = (n) => { const a = new Uint32Array(1); const lim = Math.floor(2 ** 32 / n) * n; do crypto.getRandomValues(a); while (a[0] >= lim); return a[0] % n; };
const stat = (k, v, cls = '') => h('div.stat' + cls, h('div.k', k), h('div.v', v));

/* ───────── 随机抽取 ───────── */
function randomPick(root) {
  let tab = 'num'; const area = h('div');
  function paint() {
    if (tab === 'num') {
      const o = { min: 1, max: 100, n: 1, uniq: true }; const out = h('div.stat.pri', h('div.k', '结果'), h('div.v', { style: 'font-size:34px;word-break:break-all' }, '—'));
      const go = () => { const span = o.max - o.min + 1; if (!(span >= 1) || !Number.isInteger(o.min) || !Number.isInteger(o.max)) return toast('请填写整数范围', 'err'); if (o.uniq && o.n > span) return toast(`范围内只有 ${span} 个数，无法不重复抽取 ${o.n} 个`, 'err'); const res = []; const pool = new Set(); while (res.length < o.n) { const v = o.min + rnd(span); if (o.uniq && pool.has(v)) continue; pool.add(v); res.push(v); } out.querySelector('.v').textContent = res.join('， '); };
      mount(area, h('div.panel.col', h('div.grid.g3', field('最小值', h('input.input', { type: 'number', value: o.min, oninput: (e) => { o.min = +e.target.value; } })), field('最大值', h('input.input', { type: 'number', value: o.max, oninput: (e) => { o.max = +e.target.value; } })), field('个数', h('input.input', { type: 'number', min: 1, max: 1000, value: o.n, oninput: (e) => { o.n = Math.min(1000, Math.max(1, +e.target.value || 1)); } }))), checkbox('不重复', true, (v) => { o.uniq = v; }), out, h('div.row', h('button.btn.primary.lg', { onclick: go }, icon('dices'), '生成'), h('button.btn.lg', { onclick: () => copyText(out.querySelector('.v').textContent) }, icon('copy'), '复制'))));
    } else if (tab === 'list') {
      const ta = h('textarea.textarea', { placeholder: '每行一个名字 / 选项', style: 'min-height:160px', value: '张三\n李四\n王五\n赵六\n钱七' }); let n = 1, noRepeat = false; const picked = new Set(); const out = h('div.stat.pri', h('div.k', '抽中'), h('div.v', { style: 'font-size:34px' }, '—'));
      const go = () => { const all = ta.value.split('\n').map((s) => s.trim()).filter(Boolean); const pool = noRepeat ? all.filter((x) => !picked.has(x)) : all; if (!pool.length) return toast(noRepeat ? '所有人都已被抽到，点击“重置”再来' : '请先输入名单', 'err'); const res = []; const p = [...pool]; for (let i = 0; i < Math.min(n, p.length); i++) res.push(p.splice(rnd(p.length), 1)[0]); res.forEach((x) => picked.add(x)); let t = 0; const v = out.querySelector('.v'); const shuf = setInterval(() => { v.textContent = all[rnd(all.length)]; if (++t > 12) { clearInterval(shuf); v.textContent = res.join('， '); } }, 60); };
      mount(area, h('div.panel.col', field('名单', ta), h('div.row', field('抽取人数', h('input.input', { type: 'number', min: 1, value: 1, style: 'width:100px', oninput: (e) => { n = Math.max(1, +e.target.value || 1); } })), checkbox('已抽中的不再抽（点名模式）', false, (v) => { noRepeat = v; }), h('button.btn.sm', { onclick: () => { picked.clear(); toast('已重置'); } }, '重置')), out, h('button.btn.primary.lg', { onclick: go }, icon('shuffle'), '开始抽取')));
    } else if (tab === 'wheel') {
      const ta = h('textarea.textarea', { style: 'min-height:200px', value: '火锅\n烧烤\n日料\n川菜\n粤菜\n麻辣烫' }); const cv = h('canvas', { width: 520, height: 520, style: 'width:100%;max-width:420px' }); const res = h('div.stat.pri', h('div.k', '今天就吃'), h('div.v', '—')); let ang = 0, spinning = false;
      const COL = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16'];
      const items = () => ta.value.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 24);
      const draw = () => { const g = cv.getContext('2d'), its = items(), n = its.length || 1, R = 250, c = 260; g.clearRect(0, 0, 520, 520); g.save(); g.translate(c, c); g.rotate(ang); its.forEach((t, i) => { const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2; g.beginPath(); g.moveTo(0, 0); g.arc(0, 0, R, a0, a1); g.closePath(); g.fillStyle = COL[i % COL.length]; g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 3; g.stroke(); g.save(); g.rotate((a0 + a1) / 2); g.fillStyle = '#fff'; g.font = '700 24px "Microsoft YaHei",sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(t.length > 8 ? t.slice(0, 8) + '…' : t, R - 22, 0); g.restore(); }); g.restore(); g.fillStyle = '#fff'; g.beginPath(); g.arc(c, c, 34, 0, 7); g.fill(); g.fillStyle = '#111'; g.beginPath(); g.moveTo(c + 262, c - 16); g.lineTo(c + 232, c); g.lineTo(c + 262, c + 16); g.closePath(); g.fill(); };
      const spin = () => { const its = items(); if (its.length < 2 || spinning) return its.length < 2 && toast('至少需要 2 个选项', 'err'); spinning = true; const target = ang + Math.PI * 2 * (6 + Math.random() * 3) + Math.random() * Math.PI * 2, t0 = performance.now(), a0 = ang, dur = 4200; const f = (now) => { const p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 4); ang = a0 + (target - a0) * e; draw(); if (p < 1) requestAnimationFrame(f); else { spinning = false; const n = its.length, idx = Math.floor((((-ang % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * n); res.querySelector('.v').textContent = its[idx]; } }; requestAnimationFrame(f); };
      ta.addEventListener('input', draw); mount(area, h('div.split', h('div.panel', { style: 'text-align:center' }, cv, h('div.row', { style: 'justify-content:center' }, h('button.btn.primary.lg', { onclick: spin }, icon('rotate-cw'), '开始转动'))), h('div.col', h('div.panel.col', field('选项（每行一个，最多 24 个）', ta)), res))); draw();
    } else {
      let count = 2; const out = h('div.row', { style: 'justify-content:center;min-height:130px' }); const sum = h('div.stat.pri', h('div.k', '点数合计'), h('div.v', '—'));
      const face = (n) => { const pos = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] }[n]; return h('div', { style: 'width:100px;height:100px;border-radius:20px;background:#fff;box-shadow:0 8px 24px rgba(0,0,0,.18),inset 0 -4px 0 #e5e7eb;display:grid;grid-template:repeat(3,1fr)/repeat(3,1fr);padding:14px;gap:2px' }, Array.from({ length: 9 }, (_, i) => h('i', { style: pos.includes(i) ? 'background:#111;border-radius:50%;margin:3px' : '' }))); };
      const roll = () => { let t = 0; const iv = setInterval(() => { const v = Array.from({ length: count }, () => 1 + rnd(6)); mount(out, v.map(face)); if (++t > 8) { clearInterval(iv); sum.querySelector('.v').textContent = v.reduce((a, b) => a + b, 0) + `（${v.join(' + ')}）`; } }, 70); };
      const coin = h('div.stat', h('div.k', '抛硬币'), h('div.v', '—')); const flip = () => { let t = 0; const iv = setInterval(() => { coin.querySelector('.v').textContent = rnd(2) ? '🪙 正面' : '🪙 反面'; if (++t > 8) clearInterval(iv); }, 70); };
      mount(area, h('div.panel.col', h('div.row', field('骰子个数', seg([1, 2, 3, 4, 5, 6].map((n) => [n, n]), count, (v) => { count = +v; })), h('button.btn.primary.lg', { onclick: roll }, icon('dices'), '掷骰子')), out, sum, h('hr.divider'), h('div.row', coin, h('button.btn', { onclick: flip }, '抛硬币'))));
    }
  }
  mount(root, h('div.col', tabs([['num', '随机数'], ['list', '名单抽取'], ['wheel', '转盘'], ['dice', '骰子 / 硬币']], tab, (v) => { tab = v; paint(); }), area)); paint();
}

/* ───────── 密码生成 ───────── */
function passwordGen(root) {
  const o = { len: 16, up: true, low: true, num: true, sym: true, amb: true, n: 5 }; const list = h('div.col.gap-s'); const meter = h('div');
  const SETS = { up: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', low: 'abcdefghijklmnopqrstuvwxyz', num: '0123456789', sym: '!@#$%^&*()-_=+[]{};:,.?/~' }; const AMB = /[O0oIl1|]/g;
  function gen() { const sets = Object.keys(SETS).filter((k) => o[k]).map((k) => (o.amb ? SETS[k].replace(AMB, '') : SETS[k])); if (!sets.length) { mount(list, banner('warn', '请至少选择一种字符类型')); return; } const all = sets.join('');
    const make = () => { const chars = sets.map((s) => s[rnd(s.length)]); while (chars.length < o.len) chars.push(all[rnd(all.length)]); for (let i = chars.length - 1; i > 0; i--) { const j = rnd(i + 1); [chars[i], chars[j]] = [chars[j], chars[i]]; } return chars.slice(0, o.len).join(''); };
    const pws = Array.from({ length: o.n }, make); const bits = Math.log2(all.length) * o.len; const [lv, col] = bits < 40 ? ['弱', '#ef4444'] : bits < 60 ? ['一般', '#f59e0b'] : bits < 80 ? ['强', '#10b981'] : ['极强', '#06b6d4'];
    mount(meter, h('div.row', h('span.chip', { style: `background:${col}22;color:${col}` }, `强度：${lv}`), h('span.muted.small', `约 ${Math.round(bits)} 位熵`)), h('div.progress', { style: 'margin-top:6px' }, h('i', { style: `width:${Math.min(100, (bits / 100) * 100)}%;background:${col}` })));
    mount(list, pws.map((p) => h('div.row.nw', { style: 'padding:10px 14px;background:var(--surface-2);border:1px solid var(--border);border-radius:12px' }, h('code.grow', { style: 'font-size:17px;word-break:break-all;letter-spacing:.5px' }, p), h('button.btn.sm.ghost.icon', { onclick: () => copyText(p) }, icon('copy'))))); }
  mount(root, h('div.col', h('div.panel.col', field('密码长度', range(4, 64, 1, o.len, (v) => { o.len = v; gen(); }, (v) => v + ' 位')), h('div.row', [['up', '大写 A-Z'], ['low', '小写 a-z'], ['num', '数字 0-9'], ['sym', '符号 !@#']].map(([k, l]) => checkbox(l, o[k], (v) => { o[k] = v; gen(); })), checkbox('排除易混淆字符 (O0oIl1)', o.amb, (v) => { o.amb = v; gen(); })), meter,
    h('div.row', field('数量', select([1, 3, 5, 10, 20], o.n, (v) => { o.n = +v; gen(); })), h('button.btn.primary', { style: 'align-self:end', onclick: gen }, icon('refresh-cw'), '重新生成')), list), h('p.hint', '使用浏览器加密级随机数生成，密码不会离开你的设备。')));
  gen();
}

/* ───────── 待办 ───────── */
function todo(root) {
  let items = store.get('todo', []), filter = 'all'; const list = h('div.col.gap-s'); const input = h('input.input', { placeholder: '添加待办，回车确认…', style: 'height:48px;font-size:16px', onkeydown: (e) => { if (e.key === 'Enter' && input.value.trim()) { items.unshift({ id: uid(), t: input.value.trim(), done: false, at: Date.now() }); input.value = ''; save(); } } }); const stat = h('span.muted.small');
  const save = () => { store.set('todo', items); paint(); };
  function paint() { const vis = items.filter((i) => filter === 'all' || (filter === 'done' ? i.done : !i.done)); stat.textContent = `${items.filter((i) => !i.done).length} 项未完成 / 共 ${items.length} 项`;
    mount(list, vis.length ? vis.map((it) => h('div.row.nw', { style: 'padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:12px' }, h('input', { type: 'checkbox', checked: it.done, style: 'width:20px;height:20px', onchange: (e) => { it.done = e.target.checked; save(); } }), h('span.grow', { style: `font-size:15px;${it.done ? 'text-decoration:line-through;color:var(--muted)' : ''};word-break:break-all`, ondblclick: (e) => { const v = prompt('修改待办', it.t); if (v?.trim()) { it.t = v.trim(); save(); } } }, it.t), h('button.btn.sm.ghost.icon', { onclick: () => { items = items.filter((x) => x !== it); save(); } }, icon('trash-2')))) : h('div.empty', icon('list-checks'), h('p', '这里空空的')));
  }
  mount(root, h('div.col', h('div.panel.col', input, h('div.row', seg([['all', '全部'], ['todo', '未完成'], ['done', '已完成']], filter, (v) => { filter = v; paint(); }), h('div.sp'), stat, h('button.btn.sm.ghost', { onclick: () => { items = items.filter((i) => !i.done); save(); } }, '清除已完成'))), list, h('p.hint', '数据保存在当前浏览器中（登录与否均不会上传）。双击文字可修改。'))); paint();
}

/* ───────── 便签 ───────── */
function notepad(root) {
  let notes = store.get('notes', [{ id: uid(), title: '', body: '', at: Date.now() }]); let cur = notes[0].id; const list = h('div.col.gap-s'); const q = h('input.input.sm', { placeholder: '搜索便签…', oninput: paintList });
  const title = h('input.input', { placeholder: '标题（可选）', style: 'font-weight:700;font-size:17px', oninput: () => { const n = note(); n.title = title.value; n.at = Date.now(); save(); } }); const body = h('textarea.textarea', { placeholder: '写点什么吧…', style: 'min-height:420px;font-size:15px;line-height:1.8', oninput: () => { const n = note(); n.body = body.value; n.at = Date.now(); save(); } }); const info = h('span.muted.small');
  const note = () => notes.find((n) => n.id === cur) || notes[0]; const save = debounce(() => { store.set('notes', notes); paintList(); info.textContent = `已自动保存 · ${body.value.length} 字`; }, 300);
  function paintList() { const k = q.value.trim().toLowerCase(); mount(list, notes.slice().sort((a, b) => b.at - a.at).filter((n) => !k || (n.title + n.body).toLowerCase().includes(k)).map((n) => h('div.pl-item' + (n.id === cur ? '.on' : ''), { onclick: () => { cur = n.id; load(); paintList(); } }, h('div.grow', h('div.ellipsis', { style: 'font-weight:600;font-size:14px' }, n.title || n.body.split('\n')[0] || '空白便签'), h('div.ellipsis.muted', { style: 'font-size:12px' }, new Date(n.at).toLocaleString('zh-CN', { hour12: false })))))); }
  function load() { const n = note(); title.value = n.title; body.value = n.body; info.textContent = `${n.body.length} 字`; }
  mount(root, h('div.split', { style: 'grid-template-columns:260px minmax(0,1fr)' }, h('div.panel.col', h('button.btn.primary', { onclick: () => { const n = { id: uid(), title: '', body: '', at: Date.now() }; notes.unshift(n); cur = n.id; load(); save(); title.focus(); } }, icon('plus'), '新建便签'), q, list),
    h('div.panel.col', title, body, h('div.row', info, h('div.sp'), h('button.btn.sm', { onclick: () => download(new Blob([body.value], { type: 'text/plain;charset=utf-8' }), (title.value || '便签') + '.txt') }, icon('download'), '导出'), h('button.btn.sm.danger', { onclick: async () => { if (!await confirmBox('删除便签', '确定删除这条便签吗？', '删除', true)) return; notes = notes.filter((n) => n.id !== cur); if (!notes.length) notes.push({ id: uid(), title: '', body: '', at: Date.now() }); cur = notes[0].id; store.set('notes', notes); load(); paintList(); } }, icon('trash-2'), '删除')))));
  load(); paintList();
}
export const tools = { 'random-pick': randomPick, 'password-gen': passwordGen, todo, notepad };
