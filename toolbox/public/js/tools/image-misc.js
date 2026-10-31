import { h, $, mount, icon, dropzone, toast, download, fmtSize, field, seg, select, range, banner, spinner, baseName, clamp, copyText, readAs, sortable, uid, canvasToBlob, store, debounce } from '../ui.js';
import { decode, sizeOf, toCanvas, resizeCanvas, encode, extFor, makeCanvas } from '../lib/img.js';

/* ───────── 裁剪 / 旋转 ───────── */
function imgCrop(root) {
  let work = null, name = 'image', rect = { x: 0, y: 0, w: 1, h: 1 }, ratio = 0, fmt = 'png', q = 0.92;
  const area = h('div'); const dz = dropzone({ accept: 'image/*', title: '选择要裁剪的图片', icon: 'crop', onFiles: async ([f]) => { try { work = await toCanvas(f); name = baseName(f.name); dz.hidden = true; rect = { x: 0, y: 0, w: work.width, h: work.height }; if (ratio) applyRatio(); build(); } catch (e) { toast(e.message, 'err'); } } });
  mount(root, dz, area);
  const RATIOS = [[0, '自由'], [1, '1:1'], [4 / 3, '4:3'], [3 / 4, '3:4'], [16 / 9, '16:9'], [9 / 16, '9:16'], [3 / 2, '3:2'], [2 / 3, '2:3']];
  function applyRatio() { let w = rect.w, hh = w / ratio; if (hh > work.height) { hh = work.height; w = hh * ratio; } if (w > work.width) { w = work.width; hh = w / ratio; } rect = { x: clamp(rect.x, 0, work.width - w), y: clamp(rect.y, 0, work.height - hh), w, h: hh }; }
  function build() {
    const box = h('div', { style: 'position:relative;display:inline-block;line-height:0;touch-action:none;user-select:none;max-width:100%' }); const cv = h('canvas', { style: 'max-width:100%;max-height:64vh;display:block' });
    const shade = h('div', { style: 'position:absolute;border:2px solid #fff;box-shadow:0 0 0 9999px rgba(0,0,0,.55);cursor:move;box-sizing:border-box' });
    const grid = h('div', { style: 'position:absolute;inset:0;background:linear-gradient(#fff4 1px,transparent 1px) 0 33.3%/100% 33.3%,linear-gradient(90deg,#fff4 1px,transparent 1px) 33.3% 0/33.3% 100%;pointer-events:none' }); shade.append(grid);
    const dim = h('span.chip.pri'); const wrap = h('div', { style: 'overflow:hidden;line-height:0;display:inline-block;max-width:100%' }, box); box.append(cv, shade);
    const draw = () => { cv.width = work.width; cv.height = work.height; cv.getContext('2d').drawImage(work, 0, 0); };
    const sync = () => { Object.assign(shade.style, { left: (rect.x / work.width) * 100 + '%', top: (rect.y / work.height) * 100 + '%', width: (rect.w / work.width) * 100 + '%', height: (rect.h / work.height) * 100 + '%' }); dim.textContent = `${Math.round(rect.w)} × ${Math.round(rect.h)} px`; };
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
      const hd = h('div', { style: `position:absolute;${dx < 0 ? 'left:-8px' : dx > 0 ? 'right:-8px' : 'left:calc(50% - 8px)'};${dy < 0 ? 'top:-8px' : dy > 0 ? 'bottom:-8px' : 'top:calc(50% - 8px)'};width:16px;height:16px;border-radius:50%;background:#fff;border:3px solid var(--primary);cursor:${dx && dy ? (dx * dy > 0 ? 'nwse' : 'nesw') : dx ? 'ew' : 'ns'}-resize;z-index:2` }); shade.append(hd);
      hd.onpointerdown = (e) => { e.stopPropagation(); e.preventDefault(); hd.setPointerCapture(e.pointerId); const r0 = { ...rect }, sx = e.clientX, sy = e.clientY, k = work.width / cv.getBoundingClientRect().width;
        hd.onpointermove = (ev) => { const mx = (ev.clientX - sx) * k, my = (ev.clientY - sy) * k; let x1 = r0.x, y1 = r0.y, x2 = r0.x + r0.w, y2 = r0.y + r0.h; if (dx < 0) x1 += mx; if (dx > 0) x2 += mx; if (dy < 0) y1 += my; if (dy > 0) y2 += my;
          x1 = clamp(x1, 0, work.width); x2 = clamp(x2, 0, work.width); y1 = clamp(y1, 0, work.height); y2 = clamp(y2, 0, work.height); let w = x2 - x1, hh = y2 - y1;
          if (ratio) { if (dx && !dy) hh = w / ratio; else if (dy && !dx) w = hh * ratio; else { if (Math.abs(w / ratio) > Math.abs(hh)) hh = w / ratio; else w = hh * ratio; } if (dx < 0) x1 = x2 - w; else x2 = x1 + w; if (dy < 0) y1 = y2 - hh; else y2 = y1 + hh; if (x1 < 0 || y1 < 0 || x2 > work.width || y2 > work.height) return; }
          if (w < 8 || hh < 8) return; rect = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) }; sync(); }; hd.onpointerup = () => { hd.onpointermove = null; }; };
    }
    shade.onpointerdown = (e) => { shade.setPointerCapture(e.pointerId); const r0 = { ...rect }, sx = e.clientX, sy = e.clientY, k = work.width / cv.getBoundingClientRect().width; shade.onpointermove = (ev) => { rect.x = clamp(r0.x + (ev.clientX - sx) * k, 0, work.width - rect.w); rect.y = clamp(r0.y + (ev.clientY - sy) * k, 0, work.height - rect.h); sync(); }; shade.onpointerup = () => { shade.onpointermove = null; }; };
    const transform = (fn) => { work = fn(work); rect = { x: 0, y: 0, w: work.width, h: work.height }; if (ratio) applyRatio(); draw(); sync(); };
    const rot = (deg) => transform((c) => { const o = makeCanvas(c.height, c.width), g = o.getContext('2d'); g.translate(o.width / 2, o.height / 2); g.rotate((deg * Math.PI) / 180); g.drawImage(c, -c.width / 2, -c.height / 2); return o; });
    const flip = (hz) => transform((c) => { const o = makeCanvas(c.width, c.height), g = o.getContext('2d'); if (hz) { g.translate(c.width, 0); g.scale(-1, 1); } else { g.translate(0, c.height); g.scale(1, -1); } g.drawImage(c, 0, 0); return o; });
    const save = async () => { const o = makeCanvas(rect.w, rect.h); o.getContext('2d').drawImage(work, rect.x, rect.y, rect.w, rect.h, 0, 0, o.width, o.height); try { download(await encode(o, fmt, q), `${name}_crop.${extFor(fmt)}`); } catch (e) { toast(e.message, 'err'); } };
    draw(); sync();
    mount(area, h('div.col', h('div.canvas-wrap', { style: 'background:var(--surface-3)' }, wrap), h('div.panel', h('div.col',
      h('div.row', seg(RATIOS.map(([v, l]) => [String(v), l]), String(ratio), (v) => { ratio = +v; if (ratio) { applyRatio(); sync(); } }), dim),
      h('div.row', h('button.btn.sm', { onclick: () => rot(-90) }, icon('rotate-ccw'), '左转 90°'), h('button.btn.sm', { onclick: () => rot(90) }, icon('rotate-cw'), '右转 90°'), h('button.btn.sm', { onclick: () => flip(true) }, icon('flip-horizontal-2'), '水平翻转'), h('button.btn.sm', { onclick: () => flip(false) }, icon('flip-vertical-2'), '垂直翻转'), h('button.btn.sm', { onclick: () => { rect = { x: 0, y: 0, w: work.width, h: work.height }; if (ratio) applyRatio(); sync(); } }, '重置选区')),
      h('div.grid.g3', field('输出格式', select([['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WebP']], fmt, (v) => { fmt = v; })), field('质量', range(0.5, 1, 0.01, q, (v) => { q = v; }, (v) => Math.round(v * 100) + '%'))),
      h('div.row', h('button.btn.primary.lg', { onclick: save }, icon('download'), '裁剪并下载'), h('button.btn.ghost', { onclick: () => { mount(area); dz.hidden = false; } }, '换一张'))))));
  }
}

/* ───────── 长图拼接 ───────── */
function imgStitch(root) {
  let items = []; const o = { dir: 'v', gap: 0, bg: '#ffffff', fit: true, fmt: 'jpg' };
  const list = h('div.thumb-grid', { style: '--min:110px' }); const out = h('div'); const pv = h('canvas', { style: 'max-width:100%;max-height:520px;box-shadow:var(--shadow);background:#fff' }); const pvBox = h('div.canvas-wrap', { hidden: true }, pv);
  const dz = dropzone({ accept: 'image/*', multiple: true, title: '选择多张图片拼接', hint: '可拖动调整顺序，适合拼接聊天截图、长网页截图', icon: 'gallery-vertical', onFiles: async (fs) => { for (const f of fs) { try { items.push({ id: uid(), name: f.name, c: await toCanvas(f), url: URL.createObjectURL(f) }); } catch (e) { toast(e.message, 'err'); } } paint(); } });
  sortable(list, (ids) => { items = ids.map((id) => items.find((i) => i.id === id)); preview(); });
  const paint = () => { mount(list, items.map((it, i) => h('div.thumb', { dataset: { id: it.id }, draggable: true }, h('div.tools', h('button', { onclick: () => { items = items.filter((x) => x !== it); paint(); } }, icon('x'))), h('img', { src: it.url, draggable: false, style: 'aspect-ratio:1;object-fit:cover' }), h('div.cap', i + 1)))); pvBox.hidden = items.length < 2; go.disabled = items.length < 2; preview(); };
  function compose(scale = 1) {
    const v = o.dir === 'v'; const base = v ? Math.max(...items.map((i) => i.c.width)) : Math.max(...items.map((i) => i.c.height));
    const sized = items.map((i) => { const k = o.fit ? base / (v ? i.c.width : i.c.height) : 1; return { c: i.c, w: i.c.width * k, h: i.c.height * k }; });
    const total = sized.reduce((s, i) => s + (v ? i.h : i.w), 0) + o.gap * (items.length - 1); const W = v ? base : total, H = v ? total : base;
    const c = makeCanvas(W * scale, H * scale), g = c.getContext('2d'); g.fillStyle = o.bg; g.fillRect(0, 0, c.width, c.height); g.imageSmoothingQuality = 'high'; let p = 0;
    for (const s of sized) { const x = v ? (W - s.w) / 2 : p, y = v ? p : (H - s.h) / 2; g.drawImage(s.c, x * scale, y * scale, s.w * scale, s.h * scale); p += (v ? s.h : s.w) + o.gap; } return c;
  }
  function preview() { if (items.length < 2) return; const full = compose(1); const k = Math.min(1, 900 / Math.max(full.width, full.height)); const c = compose(k); pv.width = c.width; pv.height = c.height; pv.getContext('2d').drawImage(c, 0, 0); }
  const go = h('button.btn.primary.lg', { disabled: true, onclick: async () => { try { const c = compose(1); if (c.width * c.height > 2e8) throw new Error('拼接后的图片过大，请减少图片数量或缩小尺寸'); download(await encode(c, o.fmt, 0.92), `长图.${o.fmt}`); } catch (e) { toast(e.message, 'err'); } } }, icon('download'), '生成并下载');
  const upd = (k) => (v) => { o[k] = v; preview(); };
  mount(root, h('div.col', dz, list, h('div.panel', h('div.grid.g4', field('方向', seg([['v', '纵向'], ['h', '横向']], o.dir, upd('dir'))), field('间距', range(0, 80, 1, o.gap, upd('gap'), (v) => v + ' px')), field('背景色', h('input', { type: 'color', value: o.bg, oninput: (e) => upd('bg')(e.target.value) })), field('输出', seg([['jpg', 'JPG'], ['png', 'PNG']], o.fmt, (v) => { o.fmt = v; }))),
    h('label.check.mt-s', h('input', { type: 'checkbox', checked: o.fit, onchange: (e) => upd('fit')(e.target.checked) }), '自动统一宽度 / 高度')), pvBox, h('div.row', go), out));
}

/* ───────── 图片 Base64 ───────── */
function imgBase64(root) {
  const out = h('div'); const ta = h('textarea.textarea.mono', { placeholder: '在此粘贴 Base64 或 Data URI（data:image/png;base64,…），点击“还原为图片”', style: 'min-height:140px' });
  const dz = dropzone({ accept: 'image/*', title: '选择图片转为 Base64', icon: 'binary', compact: true, onFiles: async ([f]) => { const url = await readAs(f, 'dataURL'); const raw = url.split(',')[1];
    mount(out, h('div.col.mt', h('img', { src: url, style: 'max-width:240px;max-height:200px;border-radius:10px;background:#fff;box-shadow:var(--shadow)' }), h('div.row', h('span.chip', `${f.type} · ${fmtSize(f.size)} → Base64 ${fmtSize(raw.length)}`)),
      field('Data URI（可直接用于 <img src>）', h('textarea.textarea.mono', { readOnly: true, value: url, style: 'min-height:100px' })), h('div.row', h('button.btn.primary', { onclick: () => copyText(url) }, icon('copy'), '复制 Data URI'), h('button.btn', { onclick: () => copyText(raw) }, '仅复制 Base64'), h('button.btn', { onclick: () => copyText(`<img src="${url}" alt="">`) }, '复制 <img> 标签')))); } });
  const restore = () => { let v = ta.value.trim(); if (!v) return toast('请先粘贴 Base64', 'err'); if (!v.startsWith('data:')) v = 'data:image/png;base64,' + v.replace(/\s/g, ''); const im = new Image(); im.onload = async () => { const c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); const mime = /^data:(image\/[\w+.-]+)/.exec(v)?.[1] || 'image/png'; mount(out, h('div.col.mt', h('img', { src: v, style: 'max-width:100%;max-height:360px;border-radius:10px;background:repeating-conic-gradient(#ddd 0 25%,#fff 0 50%) 50%/16px 16px' }), h('div.row', h('span.chip', `${im.naturalWidth} × ${im.naturalHeight}`), h('button.btn.primary', { onclick: async () => download(await (await fetch(v)).blob(), `image.${mime.split('/')[1].replace('jpeg', 'jpg').replace(/\+.*/, '')}`) }, icon('download'), '下载图片')))); }; im.onerror = () => mount(out, banner('err', '不是有效的图片 Base64 数据')); im.src = v; };
  mount(root, h('div.col', dz, h('div.row', h('b', '或：Base64 → 图片')), ta, h('div.row', h('button.btn', { onclick: restore }, icon('image'), '还原为图片')), out));
}

/* ───────── 取色 / 颜色转换 ───────── */
const toHex = (r, g, b) => '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
function rgb2hsl(r, g, b) { r /= 255; g /= 255; b /= 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b); let hh = 0, s = 0; const l = (mx + mn) / 2; if (mx !== mn) { const d = mx - mn; s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn); hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hh *= 60; } return [Math.round(hh), Math.round(s * 100), Math.round(l * 100)]; }
function hsl2rgb(hh, s, l) { s /= 100; l /= 100; const k = (n) => (n + hh / 30) % 12, a = s * Math.min(l, 1 - l), f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); return [f(0) * 255, f(8) * 255, f(4) * 255]; }
function parseColor(s) { s = s.trim().toLowerCase(); let m; if ((m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/.exec(s))) { let x = m[1]; if (x.length === 3) x = [...x].map((c) => c + c).join(''); return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)]; } if ((m = /^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(s))) return [+m[1], +m[2], +m[3]]; if ((m = /^hsla?\(\s*(\d+)[ ,]+(\d+)%?[ ,]+(\d+)%?/.exec(s))) return hsl2rgb(+m[1], +m[2], +m[3]); return null; }
function colorTool(root) {
  let rgb = store.get('color_last', [91, 95, 245]); const hist = store.get('color_hist', []);
  const sw = h('div', { style: 'height:150px;border-radius:16px;box-shadow:inset 0 0 0 1px rgba(0,0,0,.1)' }); const vals = h('div.col.gap-s'); const pal = h('div.row'); const hv = h('div.row');
  const input = h('input.input.mono', { placeholder: '#5b5ff5 / rgb(91,95,245) / hsl(238,88%,64%)', onchange: () => { const c = parseColor(input.value); c ? set(c) : toast('无法识别的颜色格式', 'err'); } });
  const chip = (c) => h('button', { title: toHex(...c), onclick: () => set(c), style: `width:42px;height:42px;border-radius:12px;border:2px solid var(--surface);box-shadow:0 0 0 1px var(--border-2);background:${toHex(...c)};cursor:pointer` });
  function set(c, addHist = true) { rgb = c.map(Math.round); store.set('color_last', rgb); const hx = toHex(...rgb), [hh, s, l] = rgb2hsl(...rgb); sw.style.background = hx; input.value = hx; picker.value = hx;
    const row = (k, v) => h('div.row.nw', h('span.muted', { style: 'width:46px' }, k), h('code.grow', { style: 'font-size:14px' }, v), h('button.btn.sm.ghost.icon', { onclick: () => copyText(v) }, icon('copy')));
    mount(vals, row('HEX', hx.toUpperCase()), row('RGB', `rgb(${rgb.join(', ')})`), row('HSL', `hsl(${hh}, ${s}%, ${l}%)`), row('CSS', `${hx}`));
    mount(pal, [[0, -35], [0, -20], [0, -10], [0, 0], [0, 10], [0, 20], [0, 35]].map(([, d]) => chip(hsl2rgb(hh, s, clamp(l + d, 4, 96)))));
    const comp = (d) => chip(hsl2rgb((hh + d + 360) % 360, s, l)); mount(hv, h('span.muted.small', '互补 / 邻近 / 三角：'), comp(180), comp(30), comp(-30), comp(120), comp(240));
    if (addHist) { const i = hist.findIndex((x) => x.join() === rgb.join()); if (i >= 0) hist.splice(i, 1); hist.unshift(rgb); hist.length = Math.min(hist.length, 14); store.set('color_hist', hist); renderHist(); } }
  const histBox = h('div.row'); const renderHist = () => mount(histBox, hist.map(chip));
  const picker = h('input', { type: 'color', style: 'width:56px;height:46px', oninput: (e) => set(parseColor(e.target.value)) });
  const eye = window.EyeDropper && h('button.btn', { onclick: async () => { try { const r = await new EyeDropper().open(); set(parseColor(r.sRGBHex)); } catch {} } }, icon('pipette'), '屏幕吸管');
  /* 图片取色 */
  const cv = h('canvas', { style: 'max-width:100%;max-height:420px;cursor:crosshair;border-radius:10px' }); const imgBox = h('div', { hidden: true }, h('div.canvas-wrap', cv), h('p.hint.center.mt-s', '点击图片任意位置取色')); const dom = h('div.row');
  const dz = dropzone({ accept: 'image/*', title: '选择图片取色 / 提取主色调', icon: 'pipette', compact: true, onFiles: async ([f]) => { const c = await toCanvas(f, { maxSide: 1400 }); cv.width = c.width; cv.height = c.height; cv.getContext('2d').drawImage(c, 0, 0); imgBox.hidden = false; extract(c); } });
  cv.onclick = (e) => { const r = cv.getBoundingClientRect(); const x = Math.floor(((e.clientX - r.left) / r.width) * cv.width), y = Math.floor(((e.clientY - r.top) / r.height) * cv.height); const d = cv.getContext('2d').getImageData(x, y, 1, 1).data; set([d[0], d[1], d[2]]); };
  function extract(c) { const s = makeCanvas(60, 60 * c.height / c.width), g = s.getContext('2d'); g.drawImage(c, 0, 0, s.width, s.height); const d = g.getImageData(0, 0, s.width, s.height).data, bins = new Map(); for (let i = 0; i < d.length; i += 4) { const k = ((d[i] >> 5) << 6) | ((d[i + 1] >> 5) << 3) | (d[i + 2] >> 5); const b = bins.get(k) || [0, 0, 0, 0]; b[0] += d[i]; b[1] += d[i + 1]; b[2] += d[i + 2]; b[3]++; bins.set(k, b); }
    const top = [...bins.values()].sort((a, b) => b[3] - a[3]).slice(0, 8).map((b) => [b[0] / b[3], b[1] / b[3], b[2] / b[3]]); mount(dom, h('span.muted.small', '主色调：'), top.map(chip)); }
  mount(root, h('div.col', h('div.split', h('div.panel.col', sw, h('div.row.nw', input, picker, eye), vals), h('div.col', h('div.panel.col', h('b', '色板（明度变化）'), pal, h('b', { style: 'margin-top:6px' }, '配色'), hv), h('div.panel.col', h('b', '最近使用'), histBox))), h('div.panel.col', h('b', '从图片取色'), dz, imgBox, dom)));
  set(rgb, false); renderHist();
}
export const tools = { 'img-crop': imgCrop, 'img-stitch': imgStitch, 'img-base64': imgBase64, 'color-tool': colorTool };
