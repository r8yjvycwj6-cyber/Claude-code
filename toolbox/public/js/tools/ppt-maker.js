import { h, $, $$, mount, clear, icon, toast, download, field, seg, select, modal, confirmBox, promptBox, uid, clamp, store, loadScript, debounce, fmtSize, canvasToBlob, banner, readAs } from '../ui.js';
import { toCanvas } from '../lib/img.js';
import { PDFLib, canvasJpgBytes, pdfBlob } from '../lib/pdf.js';

const W = 960;
const FONT = '"Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif';
const FONTS = [['Microsoft YaHei', '微软雅黑'], ['SimSun', '宋体'], ['SimHei', '黑体'], ['KaiTi', '楷体'], ['Arial', 'Arial'], ['Georgia', 'Georgia'], ['Courier New', 'Courier New']];
const THEMES = {
  aurora: { name: '极光紫', bg: { g: ['#1e1b4b', '#6d28d9'], a: 135 }, title: '#ffffff', body: '#e0e7ff', accent: '#a78bfa' },
  clean: { name: '简洁白', bg: { c: '#ffffff' }, title: '#111827', body: '#374151', accent: '#4f46e5' },
  ocean: { name: '海洋蓝', bg: { g: ['#0c4a6e', '#0e7490'], a: 135 }, title: '#ffffff', body: '#e0f2fe', accent: '#67e8f9' },
  sunset: { name: '日落橙', bg: { g: ['#9a3412', '#be185d'], a: 120 }, title: '#ffffff', body: '#ffedd5', accent: '#fdba74' },
  forest: { name: '森林绿', bg: { g: ['#052e16', '#15803d'], a: 135 }, title: '#ffffff', body: '#dcfce7', accent: '#86efac' },
  paper: { name: '暖纸张', bg: { c: '#faf5ea' }, title: '#3b2a1a', body: '#5c4a3a', accent: '#c2410c' },
  mono: { name: '极简黑', bg: { c: '#0b0b0f' }, title: '#fafafa', body: '#a1a1aa', accent: '#facc15' },
};
const SHAPES = [['rect', '矩形', 'square'], ['roundRect', '圆角矩形', 'rectangle-horizontal'], ['ellipse', '圆形', 'circle'], ['triangle', '三角形', 'triangle'], ['rightArrow', '箭头', 'arrow-right'], ['star5', '五角星', 'star'], ['line', '直线', 'minus']];
const PPT_SHAPE = { rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', rightArrow: 'rightArrow', star5: 'star5', line: 'line' };

const hex = (c) => c.replace('#', '').toUpperCase();
function bgCss(bg) { return bg.g ? `linear-gradient(${bg.a}deg, ${bg.g[0]}, ${bg.g[1]})` : bg.c; }
function bgFill(ctx, bg, w, hh) { if (bg.g) { const a = ((bg.a - 90) * Math.PI) / 180, cx = w / 2, cy = hh / 2, r = Math.abs(Math.cos(a) * w / 2) + Math.abs(Math.sin(a) * hh / 2); const g = ctx.createLinearGradient(cx - Math.cos(a) * r, cy - Math.sin(a) * r, cx + Math.cos(a) * r, cy + Math.sin(a) * r); g.addColorStop(0, bg.g[0]); g.addColorStop(1, bg.g[1]); ctx.fillStyle = g; } else ctx.fillStyle = bg.c; ctx.fillRect(0, 0, w, hh); }

/* ───────── 版式 ───────── */
function layoutItems(kind, th, H) {
  const T = (o) => ({ type: 'text', id: uid(), font: 'Microsoft YaHei', size: 24, bold: false, italic: false, align: 'left', bullet: false, ...o });
  const S = (o) => ({ type: 'shape', id: uid(), shape: 'rect', fill: th.accent, line: '', lineW: 0, ...o });
  if (kind === 'title') return [
    T({ role: 'title', text: '演示文稿标题', x: 80, y: H / 2 - 110, w: 800, h: 100, size: 54, bold: true, align: 'center', color: th.title }),
    S({ role: 'accent', x: 430, y: H / 2 + 10, w: 100, h: 5 }),
    T({ role: 'body', text: '副标题 · 演讲人 · 日期', x: 80, y: H / 2 + 36, w: 800, h: 50, size: 24, align: 'center', color: th.body })];
  if (kind === 'content') return [
    T({ role: 'title', text: '页面标题', x: 60, y: 36, w: 840, h: 64, size: 36, bold: true, color: th.title }),
    S({ role: 'accent', x: 60, y: 104, w: 80, h: 5 }),
    T({ role: 'body', text: '第一个要点\n第二个要点\n第三个要点', x: 60, y: 136, w: 840, h: H - 190, size: 26, bullet: true, color: th.body })];
  if (kind === 'two') return [
    T({ role: 'title', text: '对比 / 双栏', x: 60, y: 36, w: 840, h: 64, size: 36, bold: true, color: th.title }),
    S({ role: 'accent', x: 60, y: 104, w: 80, h: 5 }),
    T({ role: 'body', text: '左侧要点一\n左侧要点二', x: 60, y: 136, w: 410, h: H - 190, size: 24, bullet: true, color: th.body }),
    T({ role: 'body', text: '右侧要点一\n右侧要点二', x: 490, y: 136, w: 410, h: H - 190, size: 24, bullet: true, color: th.body })];
  if (kind === 'end') return [
    T({ role: 'title', text: '谢谢观看', x: 80, y: H / 2 - 70, w: 800, h: 100, size: 60, bold: true, align: 'center', color: th.title }),
    T({ role: 'body', text: 'Thank you', x: 80, y: H / 2 + 40, w: 800, h: 50, size: 26, align: 'center', color: th.body })];
  return [];
}
const LAYOUTS = [['title', '标题页'], ['content', '标题 + 内容'], ['two', '双栏'], ['end', '结束页'], ['blank', '空白页']];

/* ───────── Canvas 渲染（缩略图 / 放映 / PDF 共用） ───────── */
const imgCache = new Map();
function getImg(src, done) { let im = imgCache.get(src); if (!im) { im = new Image(); im.src = src; imgCache.set(src, im); im.onload = () => done?.(); } return im; }
function wrapLines(ctx, text, maxW, bullet) {
  const out = [];
  for (const para of text.split('\n')) {
    const indent = bullet ? ctx.measureText('• ').width : 0, avail = maxW - indent; let line = '', lastSp = -1;
    if (!para) { out.push({ t: '', first: true }); continue; }
    let first = true;
    for (const ch of para) {
      const test = line + ch;
      if (ctx.measureText(test).width > avail && line) {
        if (lastSp > 0 && ch !== ' ' && /[A-Za-z0-9]/.test(ch)) { out.push({ t: line.slice(0, lastSp), first }); line = line.slice(lastSp + 1) + ch; } else { out.push({ t: line, first }); line = ch; }
        first = false; lastSp = -1;
      } else line = test;
      if (ch === ' ') lastSp = line.length - 1;
    }
    out.push({ t: line, first });
  }
  return out;
}
export function drawSlide(canvas, slide, deck, width = 480, onImg) {
  const H = deck.H, k = width / W; canvas.width = Math.round(width); canvas.height = Math.round(H * k);
  const ctx = canvas.getContext('2d'); ctx.save(); ctx.scale(k, k);
  bgFill(ctx, slide.bg || THEMES[deck.theme].bg, W, H);
  for (const it of slide.items) {
    if (it.type === 'text') {
      ctx.save(); ctx.font = `${it.italic ? 'italic ' : ''}${it.bold ? '700 ' : ''}${it.size}px "${it.font}",${FONT}`; ctx.fillStyle = it.color; ctx.textBaseline = 'top';
      const lh = it.size * 1.3, lines = wrapLines(ctx, it.text, it.w, it.bullet), ind = it.bullet ? ctx.measureText('• ').width : 0;
      ctx.beginPath(); ctx.rect(it.x, it.y - 2, it.w, it.h + 4); ctx.clip();
      lines.forEach((l, i) => { const tw = ctx.measureText(l.t).width, off = it.bullet ? ind : 0; let x = it.x + off; if (it.align === 'center') x = it.x + off + (it.w - off - tw) / 2; else if (it.align === 'right') x = it.x + it.w - tw;
        const y = it.y + i * lh + (lh - it.size) / 2 - 1; if (it.bullet && l.first && l.t) ctx.fillText('•', it.x, y); ctx.fillText(l.t, x, y); });
      ctx.restore();
    } else if (it.type === 'shape') {
      ctx.save(); ctx.beginPath(); const { x, y, w, h: hh } = it;
      if (it.shape === 'ellipse') ctx.ellipse(x + w / 2, y + hh / 2, w / 2, hh / 2, 0, 0, 7);
      else if (it.shape === 'roundRect') ctx.roundRect(x, y, w, hh, Math.min(w, hh) * 0.18);
      else if (it.shape === 'triangle') { ctx.moveTo(x + w / 2, y); ctx.lineTo(x + w, y + hh); ctx.lineTo(x, y + hh); ctx.closePath(); }
      else if (it.shape === 'rightArrow') { const b = hh * 0.28, hd = Math.min(w * 0.45, hh * 0.9); ctx.moveTo(x, y + b); ctx.lineTo(x + w - hd, y + b); ctx.lineTo(x + w - hd, y); ctx.lineTo(x + w, y + hh / 2); ctx.lineTo(x + w - hd, y + hh); ctx.lineTo(x + w - hd, y + hh - b); ctx.lineTo(x, y + hh - b); ctx.closePath(); }
      else if (it.shape === 'star5') { const cx = x + w / 2, cy = y + hh / 2; for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.4 : 1, a = (i * Math.PI) / 5 - Math.PI / 2; const px = cx + Math.cos(a) * (w / 2) * r, py = cy + Math.sin(a) * (hh / 2) * r; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); } ctx.closePath(); }
      else if (it.shape === 'line') { ctx.moveTo(x, y + hh / 2); ctx.lineTo(x + w, y + hh / 2); ctx.strokeStyle = it.fill; ctx.lineWidth = Math.max(1, it.lineW || hh); ctx.stroke(); ctx.restore(); continue; }
      else ctx.rect(x, y, w, hh);
      if (it.fill) { ctx.fillStyle = it.fill; ctx.fill(); } if (it.line && it.lineW) { ctx.strokeStyle = it.line; ctx.lineWidth = it.lineW; ctx.stroke(); }
      ctx.restore();
    } else if (it.type === 'image') { const im = getImg(it.src, onImg); if (im.complete && im.naturalWidth) ctx.drawImage(im, it.x, it.y, it.w, it.h); }
  }
  ctx.restore();
  return canvas;
}

/* ───────── 主组件 ───────── */
export default async function pptMaker(root, ctxApp) {
  const makeDeck = () => { const th = THEMES.aurora; const H = 540; return { theme: 'aurora', ratio: '16:9', H, slides: [{ id: uid(), items: layoutItems('title', th, H) }, { id: uid(), items: layoutItems('content', th, H) }, { id: uid(), items: layoutItems('end', th, H) }] }; };
  let deck = store.get('ppt_draft', null) || makeDeck(); if (!deck.slides?.length) deck = makeDeck();
  let cur = 0, sel = null, k = 1; const hist = [], redoStack = [];
  const snap = () => JSON.stringify(deck);
  let lastSnap = snap();
  const save = debounce(() => { try { localStorage.setItem('tb_ppt_draft', snap()); } catch { /* 图片过大时放弃自动保存 */ } }, 600);
  function commit() { const s = snap(); if (s === lastSnap) return; hist.push(lastSnap); if (hist.length > 60) hist.shift(); redoStack.length = 0; lastSnap = s; save(); }
  function undo() { if (!hist.length) return; redoStack.push(snap()); deck = JSON.parse(hist.pop()); lastSnap = snap(); cur = Math.min(cur, deck.slides.length - 1); sel = null; renderAll(); save(); }
  function redo() { if (!redoStack.length) return; hist.push(snap()); deck = JSON.parse(redoStack.pop()); lastSnap = snap(); cur = Math.min(cur, deck.slides.length - 1); sel = null; renderAll(); save(); }
  const slide = () => deck.slides[cur];
  const theme = () => THEMES[deck.theme];
  const item = () => slide().items.find((i) => i.id === sel);

  /* DOM */
  const stage = h('div', { style: `position:absolute;left:0;top:0;width:${W}px;transform-origin:0 0;overflow:hidden;user-select:none` });
  const frame = h('div', { style: 'position:relative;margin:0 auto;box-shadow:var(--shadow-lg);border-radius:6px;overflow:hidden;background:#fff' }, stage);
  const wrap = h('div.canvas-wrap', { style: 'display:block;padding:18px;background:var(--surface-3)' }, frame);
  const thumbs = h('div.col', { style: 'gap:10px;max-height:calc(100vh - 220px);overflow:auto;padding:2px' });
  const props = h('div.col'); const toolbar = h('div.row', { style: 'gap:8px' });
  const info = h('span.muted.small');

  function fit() { const avail = Math.max(300, wrap.clientWidth - 36); const maxH = innerHeight * 0.72; k = Math.min(avail / W, maxH / deck.H); frame.style.width = W * k + 'px'; frame.style.height = deck.H * k + 'px'; stage.style.height = deck.H + 'px'; stage.style.transform = `scale(${k})`; }
  function renderStage() {
    const s = slide(); fit(); stage.style.background = bgCss(s.bg || theme().bg);
    mount(stage, s.items.map((it) => itemEl(it)));
    info.textContent = `第 ${cur + 1} / ${deck.slides.length} 页`;
  }
  function itemEl(it) {
    const base = `position:absolute;left:${it.x}px;top:${it.y}px;width:${it.w}px;height:${it.h}px;cursor:move;`;
    let inner;
    if (it.type === 'text') inner = h('div', { style: `width:100%;height:100%;overflow:hidden;font-family:"${it.font}",${FONT};font-size:${it.size}px;line-height:1.3;color:${it.color};font-weight:${it.bold ? 700 : 400};font-style:${it.italic ? 'italic' : 'normal'};text-align:${it.align};white-space:pre-wrap;word-break:break-word` }, it.bullet ? it.text.split('\n').map((l) => h('div', { style: 'padding-left:1.1em;text-indent:-1.1em;min-height:1.3em' }, l ? '• ' + l : '')) : it.text);
    else if (it.type === 'shape') inner = shapeSvg(it);
    else inner = h('img', { src: it.src, style: 'width:100%;height:100%;object-fit:fill;display:block', draggable: false });
    const el = h('div', { style: base + (it.id === sel ? 'outline:2px solid #5b5ff5;' : ''), dataset: { id: it.id } }, inner);
    el.onpointerdown = (e) => {
      if (el.isContentEditable) return;
      e.stopPropagation(); if (e.target.dataset.hd) return;
      if (sel !== it.id) { sel = it.id; $$('[data-id]', stage).forEach((n) => (n.style.outline = n.dataset.id === sel ? '2px solid #5b5ff5' : '')); addHandles(el, it); renderProps(); }
      const sx = e.clientX, sy = e.clientY, ox = it.x, oy = it.y; el.setPointerCapture(e.pointerId); let moved = false;
      el.onpointermove = (ev) => { moved = true; it.x = Math.round(ox + (ev.clientX - sx) / k); it.y = Math.round(oy + (ev.clientY - sy) / k); el.style.left = it.x + 'px'; el.style.top = it.y + 'px'; };
      el.onpointerup = () => { el.onpointermove = null; if (moved) { commit(); renderThumbs(); } };
    };
    if (it.type === 'text') el.ondblclick = () => editText(el, it);
    if (it.id === sel) addHandles(el, it);
    return el;
  }
  function shapeSvg(it) {
    const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', `0 0 ${it.w} ${it.h}`); svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%'); svg.style.display = 'block'; svg.style.overflow = 'visible';
    const w = it.w, hh = it.h, mk = (tag, a) => { const e = document.createElementNS(ns, tag); for (const [n, v] of Object.entries(a)) e.setAttribute(n, v); return e; };
    const common = { fill: it.fill || 'none', stroke: it.line || 'none', 'stroke-width': it.lineW || 0 }; let node;
    if (it.shape === 'ellipse') node = mk('ellipse', { cx: w / 2, cy: hh / 2, rx: w / 2, ry: hh / 2, ...common });
    else if (it.shape === 'roundRect') node = mk('rect', { width: w, height: hh, rx: Math.min(w, hh) * 0.18, ...common });
    else if (it.shape === 'triangle') node = mk('polygon', { points: `${w / 2},0 ${w},${hh} 0,${hh}`, ...common });
    else if (it.shape === 'rightArrow') { const b = hh * 0.28, hd = Math.min(w * 0.45, hh * 0.9); node = mk('polygon', { points: `0,${b} ${w - hd},${b} ${w - hd},0 ${w},${hh / 2} ${w - hd},${hh} ${w - hd},${hh - b} 0,${hh - b}`, ...common }); }
    else if (it.shape === 'star5') { const pts = []; for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.4 : 1, a = (i * Math.PI) / 5 - Math.PI / 2; pts.push(`${w / 2 + Math.cos(a) * (w / 2) * r},${hh / 2 + Math.sin(a) * (hh / 2) * r}`); } node = mk('polygon', { points: pts.join(' '), ...common }); }
    else if (it.shape === 'line') node = mk('line', { x1: 0, y1: hh / 2, x2: w, y2: hh / 2, stroke: it.fill, 'stroke-width': it.lineW || hh });
    else node = mk('rect', { width: w, height: hh, ...common });
    svg.append(node); return svg;
  }
  function addHandles(el, it) {
    $$('[data-hd]', el).forEach((n) => n.remove());
    for (const [cx, cy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const hd = h('div', { dataset: { hd: 1 }, style: `position:absolute;${cx ? 'right' : 'left'}:${-6 / k}px;${cy ? 'bottom' : 'top'}:${-6 / k}px;width:${12 / k}px;height:${12 / k}px;background:#fff;border:${2 / k}px solid #5b5ff5;border-radius:50%;cursor:${cx === cy ? 'nwse' : 'nesw'}-resize;z-index:5` });
      hd.onpointerdown = (e) => {
        e.stopPropagation(); e.preventDefault(); hd.setPointerCapture(e.pointerId); const sx = e.clientX, sy = e.clientY, o = { x: it.x, y: it.y, w: it.w, h: it.h }; const ratio = o.w / o.h;
        hd.onpointermove = (ev) => { let dx = (ev.clientX - sx) / k, dy = (ev.clientY - sy) / k; if (it.type === 'image' || ev.shiftKey) dy = (cx ? dx : -dx) / ratio * (cy ? 1 : -1);
          let nw = cx ? o.w + dx : o.w - dx, nh = cy ? o.h + dy : o.h - dy; nw = Math.max(10, nw); nh = Math.max(4, nh);
          it.w = Math.round(nw); it.h = Math.round(nh); it.x = Math.round(cx ? o.x : o.x + o.w - nw); it.y = Math.round(cy ? o.y : o.y + o.h - nh);
          Object.assign(el.style, { left: it.x + 'px', top: it.y + 'px', width: it.w + 'px', height: it.h + 'px' }); if (it.type === 'shape') { el.firstChild.replaceWith(shapeSvg(it)); } };
        hd.onpointerup = () => { hd.onpointermove = null; commit(); renderStage(); renderThumbs(); };
      };
      el.append(hd);
    }
  }
  function editText(el, it) {
    const box = el.firstChild; box.textContent = it.text; box.contentEditable = 'plaintext-only'; if (box.contentEditable !== 'plaintext-only') box.contentEditable = 'true'; box.style.cursor = 'text'; box.style.userSelect = 'text'; box.focus();
    const range = document.createRange(); range.selectNodeContents(box); const s = getSelection(); s.removeAllRanges(); s.addRange(range);
    box.onblur = () => { it.text = box.innerText.replace(/\n$/, ''); box.contentEditable = 'false'; commit(); renderStage(); renderThumbs(); renderProps(); };
    box.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Escape') box.blur(); };
  }

  /* 缩略图 */
  function renderThumbs() {
    mount(thumbs, deck.slides.map((s, i) => {
      const c = h('canvas', { style: 'width:100%;display:block;border-radius:6px' }); drawSlide(c, s, deck, 300, () => drawSlide(c, s, deck, 300));
      return h('div.thumb' + (i === cur ? '.sel' : ''), { dataset: { id: s.id }, draggable: true, style: 'padding:6px;cursor:pointer', onclick: () => { cur = i; sel = null; renderAll(); } },
        h('div.row.nw', { style: 'gap:6px;align-items:flex-start' }, h('span.muted.small', { style: 'width:16px;padding-top:2px' }, i + 1), h('div.grow', c)));
    }));
  }
  sortable2(thumbs, (ids) => { const curId = slide().id; deck.slides = ids.map((id) => deck.slides.find((s) => s.id === id)); cur = deck.slides.findIndex((s) => s.id === curId); commit(); renderAll(); });
  function sortable2(container, onSort) { let drag; container.addEventListener('dragstart', (e) => { drag = e.target.closest('[data-id]'); drag?.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', 'x'); } catch {} }); container.addEventListener('dragover', (e) => { if (!drag) return; e.preventDefault(); const o = e.target.closest('[data-id]'); if (!o || o === drag) return; const r = o.getBoundingClientRect(); container.insertBefore(drag, e.clientY > r.top + r.height / 2 ? o.nextSibling : o); }); const end = () => { if (!drag) return; drag.classList.remove('dragging'); drag = null; onSort([...container.children].map((c) => c.dataset.id)); }; container.addEventListener('drop', (e) => { e.preventDefault(); end(); }); container.addEventListener('dragend', end); }

  /* 属性面板 */
  function renderProps() {
    const it = item(); const s = slide();
    const row = (...c) => h('div.row.nw', { style: 'gap:8px' }, ...c);
    const upd = (fn, redraw = true) => { fn(); if (redraw) { renderStage(); } commit(); renderThumbs(); renderProps(); };
    const color = (val, on) => h('input', { type: 'color', value: val || '#000000', oninput: (e) => { on(e.target.value); renderStage(); renderThumbs(); }, onchange: () => commit() });
    if (!it) {
      mount(props, h('div.col', h('b', '幻灯片'), field('主题', select(Object.entries(THEMES).map(([id, t]) => [id, t.name]), deck.theme, (v) => { applyTheme(v); })),
        field('背景色', row(color(s.bg?.c || (s.bg?.g ? s.bg.g[0] : theme().bg.c || theme().bg.g[0]), (c) => { s.bg = { c }; }), h('button.btn.sm', { onclick: () => { delete s.bg; commit(); renderAll(); } }, '恢复主题背景'))),
        h('p.hint', '点击画布上的元素进行编辑；双击文字修改内容；方向键微调，Delete 删除。')));
      return;
    }
    const common = h('div.row', h('button.btn.sm', { onclick: () => arrange(1) }, icon('bring-to-front'), '上移一层'), h('button.btn.sm', { onclick: () => arrange(-1) }, icon('send-to-back'), '下移一层'), h('button.btn.sm', { onclick: dup }, icon('copy'), '复制'), h('button.btn.sm.danger', { onclick: del }, icon('trash-2'), '删除'));
    if (it.type === 'text') mount(props, h('div.col', h('b', '文字'),
      field('字体', select(FONTS, it.font, (v) => upd(() => { it.font = v; }))),
      row(field('字号', h('input.input', { type: 'number', min: 8, max: 200, value: it.size, onchange: (e) => upd(() => { it.size = clamp(+e.target.value || 24, 8, 200); }) })), field('颜色', color(it.color, (c) => { it.color = c; delete it.role; }))),
      h('div.row', h('button.btn.sm' + (it.bold ? '.primary' : ''), { onclick: () => upd(() => { it.bold = !it.bold; }) }, h('b', 'B')), h('button.btn.sm' + (it.italic ? '.primary' : ''), { onclick: () => upd(() => { it.italic = !it.italic; }) }, h('i', 'I')),
        seg([['left', '左'], ['center', '中'], ['right', '右']], it.align, (v) => upd(() => { it.align = v; }))),
      h('label.check', h('input', { type: 'checkbox', checked: it.bullet, onchange: (e) => upd(() => { it.bullet = e.target.checked; }) }), '项目符号'), common));
    else if (it.type === 'shape') mount(props, h('div.col', h('b', '形状'), row(field(it.shape === 'line' ? '线条颜色' : '填充', color(it.fill, (c) => { it.fill = c; delete it.role; })), it.shape !== 'line' && field('边框', color(it.line || '#ffffff', (c) => { it.line = c; if (!it.lineW) it.lineW = 2; }))),
      field(it.shape === 'line' ? '线宽' : '边框粗细', h('input.input', { type: 'number', min: 0, max: 40, value: it.lineW || 0, onchange: (e) => upd(() => { it.lineW = +e.target.value || 0; if (it.shape === 'line') it.h = Math.max(it.lineW, 2); }) })), common));
    else mount(props, h('div.col', h('b', '图片'), h('p.hint', '拖动四角缩放（图片保持比例）。'), common));
  }
  function arrange(d) { const a = slide().items, i = a.findIndex((x) => x.id === sel), j = clamp(i + d, 0, a.length - 1); if (i < 0 || i === j) return; [a[i], a[j]] = [a[j], a[i]]; commit(); renderStage(); renderThumbs(); }
  function dup() { const it = structuredClone(item()); it.id = uid(); it.x += 20; it.y += 20; slide().items.push(it); sel = it.id; commit(); renderAll(); }
  function del() { slide().items = slide().items.filter((x) => x.id !== sel); sel = null; commit(); renderAll(); }
  function applyTheme(id) {
    const th = THEMES[id]; deck.theme = id;
    for (const s of deck.slides) { delete s.bg; for (const it of s.items) { if (it.role === 'title' && it.type === 'text') it.color = th.title; else if (it.role === 'body' && it.type === 'text') it.color = th.body; else if (it.role === 'accent' && it.type === 'shape') it.fill = th.accent; } }
    commit(); renderAll();
  }

  /* 操作 */
  function addSlide(kind) { const s = { id: uid(), items: layoutItems(kind, theme(), deck.H) }; deck.slides.splice(cur + 1, 0, s); cur++; sel = null; commit(); renderAll(); }
  function addText() { const it = { type: 'text', id: uid(), text: '双击编辑文字', x: 120, y: 200, w: 400, h: 60, size: 28, color: theme().title === '#ffffff' ? '#ffffff' : '#111827', font: 'Microsoft YaHei', bold: false, italic: false, align: 'left', bullet: false }; slide().items.push(it); sel = it.id; commit(); renderAll(); }
  function addShape(shape) { const line = shape === 'line'; const it = { type: 'shape', id: uid(), shape, x: 200, y: 180, w: line ? 300 : 200, h: line ? 4 : 140, fill: theme().accent, line: '', lineW: line ? 4 : 0 }; slide().items.push(it); sel = it.id; commit(); renderAll(); }
  const fileIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => { const f = fileIn.files[0]; fileIn.value = ''; if (!f) return; try { const c = await toCanvas(f, { maxSide: 1600 }); const src = f.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.88); const w = Math.min(500, c.width), hh = (c.height / c.width) * w; const it = { type: 'image', id: uid(), src, x: (W - w) / 2, y: Math.max(20, (deck.H - hh) / 2), w, h: hh }; slide().items.push(it); sel = it.id; commit(); renderAll(); } catch (e) { toast(e.message, 'err'); } } });
  async function setRatio(r) { deck.ratio = r; deck.H = r === '16:9' ? 540 : 720; for (const s of deck.slides) for (const it of s.items) if (it.y + it.h > deck.H) it.y = Math.max(0, deck.H - it.h); commit(); renderAll(); }

  async function exportPptx() {
    const b = $('#ppt-export'); b.disabled = true; const t = toast('正在生成 PPTX…', '', 8000);
    try {
      await loadScript('/vendor/pptxgenjs/pptxgen.bundle.js');
      const pptx = new window.PptxGenJS(); pptx.layout = deck.ratio === '16:9' ? 'LAYOUT_16x9' : 'LAYOUT_4x3'; pptx.title = '演示文稿';
      const px = (v) => v / 96;
      for (const s of deck.slides) {
        const sl = pptx.addSlide(); const bg = s.bg || theme().bg;
        if (bg.g) { const c = document.createElement('canvas'); c.width = 1280; c.height = Math.round(1280 * deck.H / W); bgFill(c.getContext('2d'), bg, c.width, c.height); sl.background = { data: c.toDataURL('image/jpeg', 0.92) }; } else sl.background = { color: hex(bg.c) };
        for (const it of s.items) {
          const pos = { x: px(it.x), y: px(it.y), w: px(it.w), h: px(it.h) };
          if (it.type === 'text') sl.addText(it.text.split('\n').map((line, i, arr) => ({ text: line, options: { breakLine: i < arr.length - 1, bullet: it.bullet ? { indent: it.size * 0.75 } : false } })), { ...pos, fontFace: it.font, fontSize: Math.round(it.size * 0.75 * 10) / 10, color: hex(it.color), bold: it.bold, italic: it.italic, align: it.align, valign: 'top', margin: 0, fit: 'none', lineSpacingMultiple: 1.0 });
          else if (it.type === 'shape') { if (it.shape === 'line') sl.addShape(pptx.ShapeType.line, { x: pos.x, y: pos.y + pos.h / 2, w: pos.w, h: 0, line: { color: hex(it.fill), width: Math.max(0.75, (it.lineW || it.h) * 0.75) } }); else sl.addShape(pptx.ShapeType[PPT_SHAPE[it.shape]], { ...pos, fill: it.fill ? { color: hex(it.fill) } : { type: 'none' }, line: it.line && it.lineW ? { color: hex(it.line), width: it.lineW * 0.75 } : { type: 'none' }, rectRadius: it.shape === 'roundRect' ? Math.min(pos.w, pos.h) * 0.18 : undefined }); }
          else sl.addImage({ data: it.src, ...pos });
        }
      }
      const blob = await pptx.write({ outputType: 'blob' }); download(blob, '演示文稿.pptx'); toast(`已导出 PPTX（${fmtSize(blob.size)}）`, 'ok');
    } catch (e) { console.error(e); toast('导出失败：' + e.message, 'err'); }
    b.disabled = false;
  }
  async function exportPdf() {
    toast('正在生成 PDF…');
    try {
      const { PDFDocument } = await PDFLib(); const doc = await PDFDocument.create(); const pw = 720, ph = pw * deck.H / W;
      for (const s of deck.slides) { const c = document.createElement('canvas'); drawSlide(c, s, deck, 1920); await new Promise((r) => setTimeout(r)); const img = await doc.embedJpg(await canvasJpgBytes(c, 0.92)); doc.addPage([pw, ph]).drawImage(img, { x: 0, y: 0, width: pw, height: ph }); }
      download(pdfBlob(await doc.save()), '演示文稿.pdf'); toast('已导出 PDF', 'ok');
    } catch (e) { toast('导出失败：' + e.message, 'err'); }
  }
  function present(from = cur) {
    let i = from; const cv = h('canvas', { style: 'max-width:100vw;max-height:100vh;box-shadow:0 0 80px rgba(0,0,0,.6)' });
    const ov = h('div', { style: 'position:fixed;inset:0;z-index:300;background:#000;display:grid;place-items:center;cursor:none' }, cv);
    const draw = () => drawSlide(cv, deck.slides[i], deck, Math.min(innerWidth, (innerHeight * W) / deck.H, 1920) * (devicePixelRatio > 1 ? 1.5 : 1), draw); const go = (d) => { i = clamp(i + d, 0, deck.slides.length - 1); draw(); };
    const key = (e) => { if (e.key === 'Escape') close(); else if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(e.key)) go(1); else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(e.key)) go(-1); };
    const close = () => { document.removeEventListener('keydown', key, true); removeEventListener('resize', draw); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); ov.remove(); };
    ov.onclick = (e) => go(e.clientX > innerWidth / 3 ? 1 : -1); document.addEventListener('keydown', key, true); addEventListener('resize', draw);
    document.body.append(ov); ov.requestFullscreen?.().catch(() => {}); draw(); ov.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) close(); });
  }
  function exportJson() { download(new Blob([snap()], { type: 'application/json' }), '演示文稿.pptmaker.json'); }
  const jsonIn = h('input', { type: 'file', accept: '.json', hidden: true, onchange: async () => { const f = jsonIn.files[0]; jsonIn.value = ''; if (!f) return; try { const d = JSON.parse(await f.text()); if (!d.slides?.length) throw 0; deck = d; cur = 0; sel = null; commit(); renderAll(); toast('已打开工程', 'ok'); } catch { toast('不是有效的工程文件', 'err'); } } });

  /* 键盘 */
  const onKey = (e) => {
    if ($('.overlay') || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) || document.activeElement?.isContentEditable) return;
    const it = item();
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && it) { e.preventDefault(); dup(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && it) { e.preventDefault(); del(); }
    else if (it && e.key.startsWith('Arrow')) { e.preventDefault(); const d = e.shiftKey ? 10 : 1; if (e.key === 'ArrowLeft') it.x -= d; if (e.key === 'ArrowRight') it.x += d; if (e.key === 'ArrowUp') it.y -= d; if (e.key === 'ArrowDown') it.y += d; renderStage(); commitDebounced(); }
    else if (e.key === 'Escape') { sel = null; renderStage(); renderProps(); }
  };
  const commitDebounced = debounce(() => { commit(); renderThumbs(); }, 300);
  document.addEventListener('keydown', onKey);
  stage.onpointerdown = () => { if (sel) { sel = null; renderStage(); renderProps(); } };
  const onResize = debounce(() => { fit(); renderStage(); }, 100); addEventListener('resize', onResize);

  const menuBtn = (label, ic, items) => { const b = h('button.btn.sm', { onclick: (e) => { e.stopPropagation(); const m = h('div.menu', { style: 'left:0;right:auto;min-width:170px' }, items.map(([n, fn, icn]) => h('button', { onclick: () => { m.remove(); fn(); } }, icn && icon(icn), n))); w.append(m); setTimeout(() => document.addEventListener('click', () => m.remove(), { once: true }), 0); } }, icon(ic), label); const w = h('div.rel', b); return w; };
  function renderToolbar() {
    mount(toolbar, menuBtn('新建页', 'plus', LAYOUTS.map(([id, n]) => [n, () => addSlide(id), 'file-plus-2'])), h('button.btn.sm', { onclick: addText }, icon('type'), '文本'),
      menuBtn('形状', 'shapes', SHAPES.map(([id, n, ic]) => [n, () => addShape(id), ic])), h('button.btn.sm', { onclick: () => fileIn.click() }, icon('image-plus'), '图片'), fileIn, h('div', { style: 'width:1px;background:var(--border);align-self:stretch' }),
      h('button.btn.sm.icon', { onclick: undo, title: '撤销 (Ctrl+Z)' }, icon('undo-2')), h('button.btn.sm.icon', { onclick: redo, title: '重做 (Ctrl+Y)' }, icon('redo-2')), h('div.sp'),
      seg([['16:9', '16:9'], ['4:3', '4:3']], deck.ratio, setRatio), info,
      menuBtn('文件', 'folder', [['打开工程 (.json)', () => jsonIn.click(), 'folder-open'], ['保存工程 (.json)', exportJson, 'save'], ['新建演示文稿', async () => { if (await confirmBox('新建演示文稿', '当前内容将被清空（可用 Ctrl+Z 撤销）。', '新建')) { deck = makeDeck(); cur = 0; sel = null; commit(); renderAll(); } }, 'file-plus']]), jsonIn,
      h('button.btn.sm', { onclick: () => present() }, icon('play'), '放映'), h('button.btn.sm', { onclick: exportPdf }, icon('file-down'), 'PDF'), h('button.btn.sm.primary#ppt-export', { onclick: exportPptx }, icon('download'), '导出 PPTX'));
  }
  function renderAll() { renderToolbar(); renderStage(); renderThumbs(); renderProps(); }

  mount(root, h('div.col', { style: 'gap:12px' }, toolbar, h('div', { style: 'display:grid;grid-template-columns:150px minmax(0,1fr) 250px;gap:14px;align-items:start' }, thumbs, wrap, h('div.panel.stick', props))));
  const mq = document.createElement('style'); mq.textContent = '@media(max-width:1000px){.tool-body>.col>div[style*="grid-template-columns:150px"]{grid-template-columns:1fr!important}}'; root.append(mq);
  renderAll(); requestAnimationFrame(() => { fit(); renderStage(); });
  return () => { document.removeEventListener('keydown', onKey); removeEventListener('resize', onResize); };
}
