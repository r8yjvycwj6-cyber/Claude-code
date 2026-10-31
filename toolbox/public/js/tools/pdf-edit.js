import { h, $, mount, icon, dropzone, toast, download, fmtSize, baseName, field, seg, banner, spinner, progress, select, range, checkbox, store, modal, promptBox, uid, clamp, readAs } from '../ui.js';
import { PDFLib, openPdf, loadPdfLibDoc, renderPage, parseRanges, pdfBlob, pdfInfoBar, textToCanvas, canvasPngBytes, drawImageCentered, visibleSize } from '../lib/pdf.js';
import { decode, toCanvas } from '../lib/img.js';

/* 通用：单文件加载壳 + 首页预览 */
async function singlePdf(root, title, icn, build) {
  const area = h('div');
  const dz = dropzone({ accept: 'application/pdf,.pdf', title, icon: icn, onFiles: async ([f]) => {
    mount(area, h('div.row', spinner(), '读取中…'));
    try {
      const pdf = await openPdf(f); const lib = await loadPdfLibDoc(f);
      dz.hidden = true;
      const back = () => { dz.hidden = false; mount(area); };
      mount(area, build({ file: f, pdf, doc: lib.doc, bytes: lib.bytes, back }));
    } catch (e) { mount(area, banner('err', e.message)); }
  } });
  mount(root, dz, area);
}
const hexToRgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

/* ───────── 水印 ───────── */
function watermarkTool(root) {
  singlePdf(root, '选择要添加水印的 PDF', 'droplets', ({ file, pdf, doc, back }) => {
    const o = { text: '机密文件', size: 48, color: '#d92d20', opacity: 0.22, angle: 30, layout: 'tile', gap: 1.2, range: '' };
    const prev = h('canvas'); const out = h('div'); let base = null;
    const wm = () => textToCanvas(o.text || ' ', { size: o.size, color: o.color, bold: true });
    const placements = (vw, vh, w, hh) => {
      if (o.layout === 'center') return [{ cx: vw / 2, cy: vh / 2 }];
      const sx = w * (1 + o.gap * 0.6), sy = hh * (1 + o.gap * 1.2), a = (o.angle * Math.PI) / 180, R = Math.hypot(vw, vh) / 2 + Math.max(w, hh);
      const list = [];
      for (let v = -R, r = 0; v <= R; v += sy, r++) for (let u = -R + (r % 2 ? sx / 2 : 0); u <= R; u += sx) {
        const cx = vw / 2 + u * Math.cos(a) - v * Math.sin(a), cy = vh / 2 + u * Math.sin(a) + v * Math.cos(a);
        if (cx > -w && cx < vw + w && cy > -hh && cy < vh + hh) list.push({ cx, cy });
      }
      return list;
    };
    async function drawPreview() {
      if (!base) { const c = await renderPage(pdf, 1, { maxWidth: 520 }); base = c; }
      const page0 = doc.getPage(0); const { w: vw, h: vh } = visibleSize(page0);
      prev.width = base.width; prev.height = base.height; const g = prev.getContext('2d'); g.drawImage(base, 0, 0);
      const k = base.width / vw; const t = wm();
      for (const p of placements(vw, vh, t.w, t.h)) {
        g.save(); g.globalAlpha = o.opacity; g.translate(p.cx * k, (vh - p.cy) * k); g.rotate((-o.angle * Math.PI) / 180);
        g.drawImage(t.canvas, (-t.w / 2) * k, (-t.h / 2) * k, t.w * k, t.h * k); g.restore();
      }
    }
    const upd = (k) => (v) => { o[k] = v; drawPreview(); };
    const text = h('input.input', { value: o.text, oninput: () => upd('text')(text.value) });
    const go = h('button.btn.primary.lg', { onclick: async () => {
      go.disabled = true; mount(out, h('div.row', spinner(), '处理中…'));
      try {
        const { PDFDocument, degrees } = await PDFLib();
        const d = (await loadPdfLibDoc(file)).doc; const total = d.getPageCount();
        const idx = o.range.trim() ? parseRanges(o.range, total) : d.getPageIndices();
        const t = wm(); const img = await d.embedPng(await canvasPngBytes(t.canvas));
        for (const i of idx) { const pg = d.getPage(i); const { w, h: hh } = visibleSize(pg); for (const p of placements(w, hh, t.w, t.h)) drawImageCentered(pg, img, p.cx, p.cy, t.w, t.h, o.angle, { opacity: o.opacity, degrees }); }
        const bytes = await d.save(); download(pdfBlob(bytes), baseName(file.name) + '_水印.pdf');
        mount(out, banner('ok', `已为 ${idx.length} 页添加水印（${fmtSize(bytes.length)}）`));
      } catch (e) { mount(out, banner('err', e.message)); }
      go.disabled = false;
    } }, icon('droplets'), '添加水印并下载');
    drawPreview();
    return h('div.col', pdfInfoBar(file, pdf.numPages, back), h('div.split.wide-r',
      h('div.panel', h('div.col', field('水印文字', text, '支持中文，可换行请用多个水印'),
        h('div.grid.g2', field('字号', range(16, 120, 1, o.size, upd('size'), (v) => v + ' pt')), field('透明度', range(0.05, 0.8, 0.01, o.opacity, upd('opacity'), (v) => Math.round(v * 100) + '%'))),
        h('div.grid.g2', field('旋转角度', range(-90, 90, 1, o.angle, upd('angle'), (v) => v + '°')), field('颜色', h('input', { type: 'color', value: o.color, oninput: (e) => upd('color')(e.target.value) }))),
        field('排布', seg([['tile', '平铺'], ['center', '居中单个']], o.layout, (v) => { o.layout = v; drawPreview(); })),
        field('应用页码', h('input.input', { placeholder: `留空为全部页面（共 ${pdf.numPages} 页）`, oninput: (e) => { o.range = e.target.value; } })),
        h('div.row', go), out)),
      h('div.stick', h('div.canvas-wrap', prev), h('p.hint.center.mt-s', '效果预览（第 1 页）'))));
  });
}

/* ───────── 页码 ───────── */
function pagenumTool(root) {
  singlePdf(root, '选择要添加页码的 PDF', 'list-ordered', ({ file, pdf, doc, back }) => {
    const o = { pos: 'bc', fmt: '{n}', start: 1, size: 11, color: '#333333', margin: 28, range: '' };
    const prev = h('canvas'); const out = h('div'); let base = null;
    const FMT = [['{n}', '1'], ['- {n} -', '- 1 -'], ['第 {n} 页', '第 1 页'], ['{n} / {total}', '1 / 10'], ['第 {n} / {total} 页', '第 1 / 10 页'], ['Page {n} of {total}', 'Page 1 of 10']];
    const label = (n, total) => o.fmt.replace('{n}', n).replace('{total}', total);
    const place = (vw, vh, w, hh) => {
      const m = o.margin, [v, hz] = [o.pos[0], o.pos[1]];
      return { cx: hz === 'l' ? m + w / 2 : hz === 'r' ? vw - m - w / 2 : vw / 2, cy: v === 't' ? vh - m - hh / 2 : m + hh / 2 };
    };
    async function drawPreview() {
      if (!base) base = await renderPage(pdf, 1, { maxWidth: 520 });
      const { w: vw, h: vh } = visibleSize(doc.getPage(0)); prev.width = base.width; prev.height = base.height;
      const g = prev.getContext('2d'); g.drawImage(base, 0, 0); const k = base.width / vw;
      const t = textToCanvas(label(+o.start, +o.start + pdf.numPages - 1), { size: o.size, color: o.color }); const p = place(vw, vh, t.w, t.h);
      g.drawImage(t.canvas, (p.cx - t.w / 2) * k, (vh - p.cy - t.h / 2) * k, t.w * k, t.h * k);
    }
    const upd = (k) => (v) => { o[k] = v; drawPreview(); };
    const POS = [['tl', '左上'], ['tc', '上中'], ['tr', '右上'], ['bl', '左下'], ['bc', '下中'], ['br', '右下']];
    const go = h('button.btn.primary.lg', { onclick: async () => {
      go.disabled = true; mount(out, h('div.row', spinner(), '处理中…'));
      try {
        const { degrees } = await PDFLib(); const d = (await loadPdfLibDoc(file)).doc; const total = d.getPageCount();
        const idx = o.range.trim() ? parseRanges(o.range, total) : d.getPageIndices(); const last = +o.start + idx.length - 1; const cache = new Map();
        for (let k = 0; k < idx.length; k++) {
          const pg = d.getPage(idx[k]); const txt = label(+o.start + k, last);
          const t = textToCanvas(txt, { size: o.size, color: o.color });
          if (!cache.has(txt)) cache.set(txt, await d.embedPng(await canvasPngBytes(t.canvas)));
          const { w, h: hh } = visibleSize(pg); const p = place(w, hh, t.w, t.h);
          drawImageCentered(pg, cache.get(txt), p.cx, p.cy, t.w, t.h, 0, { degrees });
        }
        const bytes = await d.save(); download(pdfBlob(bytes), baseName(file.name) + '_页码.pdf');
        mount(out, banner('ok', `已为 ${idx.length} 页添加页码（${fmtSize(bytes.length)}）`));
      } catch (e) { mount(out, banner('err', e.message)); }
      go.disabled = false;
    } }, icon('list-ordered'), '添加页码并下载');
    drawPreview();
    return h('div.col', pdfInfoBar(file, pdf.numPages, back), h('div.split.wide-r',
      h('div.panel', h('div.col',
        field('位置', seg(POS, o.pos, upd('pos'))), field('格式', select(FMT, o.fmt, upd('fmt'))),
        h('div.grid.g3', field('起始页码', h('input.input', { type: 'number', value: o.start, min: 0, oninput: (e) => upd('start')(+e.target.value || 0) })), field('字号', range(8, 28, 1, o.size, upd('size'), (v) => v + ' pt')), field('颜色', h('input', { type: 'color', value: o.color, oninput: (e) => upd('color')(e.target.value) }))),
        field('边距', range(10, 80, 1, o.margin, upd('margin'), (v) => v + ' pt')),
        field('应用页码', h('input.input', { placeholder: `留空为全部页面（共 ${pdf.numPages} 页）`, oninput: (e) => { o.range = e.target.value; } }), '页码按所选页面顺序依次递增，例如跳过封面可填 2-'),
        h('div.row', go), out)),
      h('div.stick', h('div.canvas-wrap', prev), h('p.hint.center.mt-s', '效果预览（第 1 页）'))));
  });
}

/* ───────── 签名 / 批注 ───────── */
function signTool(root) {
  singlePdf(root, '选择要签名 / 批注的 PDF', 'signature', ({ file, pdf, doc, back }) => {
    let cur = 1, k = 1, sel = null; const items = {}; // page -> [item]
    const stage = h('div', { style: 'position:relative;margin:0 auto;box-shadow:var(--shadow);background:#fff;touch-action:none;user-select:none' });
    const canvas = h('canvas', { style: 'display:block;width:100%' }); const layer = h('div', { style: 'position:absolute;inset:0;overflow:hidden' });
    stage.append(canvas, layer);
    const holder = h('div.canvas-wrap', { style: 'padding:14px;display:block' }, stage);
    const pageLab = h('span.bold', ''); const props = h('div.col'); const out = h('div');
    const list = () => (items[cur] ||= []);
    let vw = 1, vh = 1;

    async function showPage(n) {
      cur = n; sel = null; pageLab.textContent = `第 ${n} / ${pdf.numPages} 页`;
      const pg = doc.getPage(n - 1); ({ w: vw, h: vh } = visibleSize(pg));
      const dispW = Math.min(holder.clientWidth - 28 || 700, 820); stage.style.width = dispW + 'px'; k = dispW / vw;
      const c = await renderPage(pdf, n, { maxWidth: dispW * Math.min(2, devicePixelRatio || 1) });
      canvas.width = c.width; canvas.height = c.height; canvas.getContext('2d').drawImage(c, 0, 0);
      stage.style.height = vh * k + 'px'; paintItems(); paintProps();
    }
    function paintItems() {
      mount(layer, list().map((it) => {
        const el = h('div', { style: `position:absolute;left:${it.x * k}px;top:${it.y * k}px;width:${it.w * k}px;height:${it.h * k}px;cursor:move;outline:${it === sel ? '2px solid var(--primary)' : '1px dashed transparent'};` }, h('img', { src: it.canvas.toDataURL(), style: 'width:100%;height:100%;pointer-events:none;display:block', draggable: false }));
        el.onpointerdown = (e) => {
          if (e.target.dataset.rz) return;
          sel = it; paintProps(); [...layer.children].forEach((c) => (c.style.outline = '1px dashed transparent')); el.style.outline = '2px solid var(--primary)';
          const sx = e.clientX, sy = e.clientY, ox = it.x, oy = it.y; el.setPointerCapture(e.pointerId);
          el.onpointermove = (ev) => { it.x = clamp(ox + (ev.clientX - sx) / k, -it.w * .8, vw - it.w * .2); it.y = clamp(oy + (ev.clientY - sy) / k, -it.h * .8, vh - it.h * .2); el.style.left = it.x * k + 'px'; el.style.top = it.y * k + 'px'; };
          el.onpointerup = () => { el.onpointermove = null; };
        };
        if (it === sel) {
          const rz = h('div', { dataset: { rz: 1 }, style: 'position:absolute;right:-7px;bottom:-7px;width:14px;height:14px;border-radius:50%;background:var(--primary);border:2px solid #fff;cursor:nwse-resize' });
          rz.onpointerdown = (e) => {
            e.stopPropagation(); rz.setPointerCapture(e.pointerId); const sx = e.clientX, ow = it.w, oh = it.h, osz = it.size;
            rz.onpointermove = (ev) => { const f = clamp((ow + (ev.clientX - sx) / k) / ow, 0.15, 6); it.w = ow * f; it.h = oh * f; if (it.kind === 'text') it.size = Math.max(6, Math.round(osz * f)); el.style.width = it.w * k + 'px'; el.style.height = it.h * k + 'px'; };
            rz.onpointerup = () => { rz.onpointermove = null; if (it.kind === 'text') { rerenderText(it); paintItems(); paintProps(); } };
          };
          el.append(rz);
        }
        if (it.kind === 'text') el.ondblclick = async () => { const v = await promptBox('编辑文字', it.text); if (v != null && v.trim()) { it.text = v; rerenderText(it); paintItems(); } };
        return el;
      }));
    }
    function rerenderText(it) { const t = textToCanvas(it.text, { size: it.size, color: it.color }); it.canvas = t.canvas; it.w = t.w; it.h = t.h; }
    function add(it) { it.id = uid(); list().push(it); sel = it; paintItems(); paintProps(); }
    function addText(text = '在此输入文字') {
      const it = { kind: 'text', text, size: 20, color: '#111111' }; rerenderText(it); it.x = (vw - it.w) / 2; it.y = vh / 3; add(it);
    }
    function addCanvas(c, kind, widthPt) {
      const w = widthPt || Math.min(vw * 0.35, 180), hh = (c.height / c.width) * w;
      add({ kind, canvas: c, w, h: hh, x: (vw - w) / 2, y: vh / 2 - hh / 2 });
    }
    function paintProps() {
      const it = sel;
      mount(props, it ? h('div.col.gap-s', h('div.lbl', '当前对象：' + (it.kind === 'text' ? '文字' : it.kind === 'sig' ? '签名' : '图片')),
        it.kind === 'text' && h('div.col', field('字号', range(8, 96, 1, it.size, (v) => { const r = v / it.size; it.size = v; rerenderText(it); paintItems(); }, (v) => v + ' pt')),
          field('颜色', h('input', { type: 'color', value: it.color, oninput: (e) => { it.color = e.target.value; rerenderText(it); paintItems(); } })), h('p.hint', '双击对象可修改文字内容')),
        h('button.btn.sm.danger', { onclick: () => { items[cur] = list().filter((x) => x !== it); sel = null; paintItems(); paintProps(); } }, icon('trash-2'), '删除')) : h('p.hint', '点击页面上的对象进行选择；拖动移动，拖拽右下角圆点缩放。'));
    }
    function sigPad() {
      const W = 640, H = 260; const c = h('canvas', { width: W * 2, height: H * 2, style: `width:100%;aspect-ratio:${W}/${H};background:repeating-linear-gradient(transparent,transparent 59px,var(--border) 60px);border:1px solid var(--border-2);border-radius:12px;touch-action:none;cursor:crosshair` });
      const g = c.getContext('2d'); g.lineCap = 'round'; g.lineJoin = 'round'; let color = '#111', width = 5, drawing = false, last, empty = true;
      const pos = (e) => { const r = c.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * c.width, ((e.clientY - r.top) / r.height) * c.height]; };
      c.onpointerdown = (e) => { drawing = true; last = pos(e); c.setPointerCapture(e.pointerId); g.fillStyle = color; g.beginPath(); g.arc(last[0], last[1], width, 0, 7); g.fill(); empty = false; };
      c.onpointermove = (e) => { if (!drawing) return; const p = pos(e); g.strokeStyle = color; g.lineWidth = width * 2; g.beginPath(); g.moveTo(...last); g.lineTo(...p); g.stroke(); last = p; };
      c.onpointerup = () => { drawing = false; };
      const saved = store.get('signature');
      const m = modal(h('div.col', h('h2', '手写签名'), c,
        h('div.row', h('input', { type: 'color', value: '#111111', oninput: (e) => { color = e.target.value; }, title: '笔迹颜色' }), field(null, range(2, 12, 1, width, (v) => { width = v; }, (v) => '粗细 ' + v)),
          h('button.btn.sm', { onclick: () => { g.clearRect(0, 0, c.width, c.height); empty = true; } }, icon('eraser'), '清除'), saved && h('button.btn.sm', { onclick: () => { const im = new Image(); im.onload = () => { g.drawImage(im, 0, 0); empty = false; }; im.src = saved; } }, icon('history'), '载入上次签名'), h('div.sp'),
          h('button.btn.primary', { onclick: () => {
            if (empty) return toast('请先在上方书写签名', 'err');
            const d = g.getImageData(0, 0, c.width, c.height).data; let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
            for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) if (d[(y * c.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
            const pad = 8, cw = x1 - x0 + pad * 2, ch = y1 - y0 + pad * 2; const o = document.createElement('canvas'); o.width = cw; o.height = ch;
            o.getContext('2d').drawImage(c, x0 - pad, y0 - pad, cw, ch, 0, 0, cw, ch); store.set('signature', o.toDataURL()); addCanvas(o, 'sig'); m.close();
          } }, '使用签名'))), { wide: true });
    }
    const img = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => { const f = img.files[0]; img.value = ''; if (f) { try { addCanvas(await toCanvas(f, { maxSide: 1600 }), 'img', Math.min(vw * 0.4, 220)); } catch (e) { toast(e.message, 'err'); } } } });
    const go = h('button.btn.primary.lg.block', { onclick: async () => {
      go.disabled = true; mount(out, h('div.row', spinner(), '正在写入…'));
      try {
        const { degrees } = await PDFLib(); const d = (await loadPdfLibDoc(file)).doc; let n = 0;
        for (const [pn, arr] of Object.entries(items)) for (const it of arr) {
          const pg = d.getPage(+pn - 1); const e = await d.embedPng(await canvasPngBytes(it.canvas)); const { h: vhh } = visibleSize(pg);
          drawImageCentered(pg, e, it.x + it.w / 2, vhh - (it.y + it.h / 2), it.w, it.h, 0, { degrees }); n++;
        }
        if (!n) throw new Error('还没有添加任何内容');
        const bytes = await d.save(); download(pdfBlob(bytes), baseName(file.name) + '_已签名.pdf'); mount(out, banner('ok', `已写入 ${n} 个对象（${fmtSize(bytes.length)}）`));
      } catch (e) { mount(out, banner('err', e.message)); }
      go.disabled = false;
    } }, icon('download'), '保存并下载 PDF');
    const nav = h('div.row', { style: 'justify-content:center' }, h('button.btn.sm', { onclick: () => cur > 1 && showPage(cur - 1) }, icon('chevron-left'), '上一页'), pageLab, h('button.btn.sm', { onclick: () => cur < pdf.numPages && showPage(cur + 1) }, '下一页', icon('chevron-right')));
    const keyh = (e) => { if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) { items[cur] = list().filter((x) => x !== sel); sel = null; paintItems(); paintProps(); } };
    document.addEventListener('keydown', keyh);
    new MutationObserver((_, ob) => { if (!document.body.contains(holder)) { document.removeEventListener('keydown', keyh); ob.disconnect(); } }).observe(document.body, { childList: true, subtree: true });
    setTimeout(() => showPage(1), 0);
    return h('div.col', pdfInfoBar(file, pdf.numPages, back), h('div.split.wide-r', h('div.col', nav, holder),
      h('div.stick.col', h('div.panel', h('div.col', h('div.lbl', '添加内容'),
        h('button.btn.block', { onclick: () => addText() }, icon('type'), '添加文字'), h('button.btn.block', { onclick: sigPad }, icon('signature'), '手写签名'), h('button.btn.block', { onclick: () => img.click() }, icon('image-plus'), '插入图片 / 印章'), img)),
        h('div.panel', props), go, out)));
  });
}

export const tools = { 'pdf-watermark': watermarkTool, 'pdf-pagenum': pagenumTool, 'pdf-sign': signTool };
