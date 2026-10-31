import { h, mount, icon, dropzone, toast, download, fmtSize, baseName, field, seg, banner, spinner, sortable, progress, select, range, checkbox, canvasToBlob, resultList } from '../ui.js';
import { PDFLib, openPdf, renderPage, parseRanges, JSZip, pdfBlob, pdfInfoBar, canvasJpgBytes, canvasPngBytes } from '../lib/pdf.js';
import { decode, sizeOf, makeCanvas, encode } from '../lib/img.js';

/* ───────── PDF 转图片 ───────── */
function pdfToImage(root) {
  const area = h('div');
  const dz = dropzone({ accept: 'application/pdf,.pdf', title: '选择要转换的 PDF', icon: 'file-image', onFiles: ([f]) => load(f) });
  mount(root, dz, area);
  async function load(f) {
    mount(area, h('div.row', spinner(), '读取中…'));
    let pdf; try { pdf = await openPdf(f); } catch (e) { return mount(area, banner('err', e.message)); }
    dz.hidden = true;
    let fmt = 'png', dpi = 150, quality = 0.9;
    const rangeIn = h('input.input', { placeholder: `全部页面（1-${pdf.numPages}）`, value: '' });
    const out = h('div'); const bar = progress(); bar.hidden = true;
    const qBox = h('div', { hidden: true }, field('JPG 质量', range(0.5, 1, 0.01, quality, (v) => { quality = v; }, (v) => Math.round(v * 100) + '%')));
    const fmtSeg = seg([['png', 'PNG（无损）'], ['jpg', 'JPG（体积小）']], fmt, (v) => { fmt = v; qBox.hidden = v !== 'jpg'; });
    const go = h('button.btn.primary.lg', { onclick: async () => {
      go.disabled = true; bar.hidden = false; bar.set(0); mount(out);
      try {
        const idx = rangeIn.value.trim() ? parseRanges(rangeIn.value, pdf.numPages) : Array.from({ length: pdf.numPages }, (_, i) => i);
        const base = baseName(f.name); const files = [];
        for (let k = 0; k < idx.length; k++) {
          const c = await renderPage(pdf, idx[k] + 1, { scale: dpi / 72 });
          const blob = await canvasToBlob(c, fmt === 'png' ? 'image/png' : 'image/jpeg', quality);
          files.push({ name: `${base}_第${String(idx[k] + 1).padStart(3, '0')}页.${fmt}`, blob }); bar.set((k + 1) / idx.length);
        }
        const list = h('div.thumb-grid', { style: '--min:150px' }, files.map((x) => h('div.thumb', h('img', { src: URL.createObjectURL(x.blob) }), h('div.cap', fmtSize(x.blob.size)), h('div.row', { style: 'justify-content:center;margin-top:6px' }, h('button.btn.sm', { onclick: () => download(x.blob, x.name) }, icon('download'), '下载')))));
        const zipBtn = h('button.btn.primary', { onclick: async () => { const Z = await JSZip(); const z = new Z(); files.forEach((x) => z.file(x.name, x.blob)); download(await z.generateAsync({ type: 'blob' }), base + '_图片.zip'); } }, icon('folder-down'), `打包下载全部（${files.length} 张）`);
        mount(out, h('div.col', h('div.row', zipBtn, h('span.muted.small', `共 ${files.length} 张，${fmtSize(files.reduce((s, x) => s + x.blob.size, 0))}`)), list));
        if (files.length === 1) download(files[0].blob, files[0].name);
      } catch (e) { mount(out, banner('err', e.message)); }
      go.disabled = false; bar.hidden = true;
    } }, icon('image-down'), '开始转换');
    mount(area, h('div.col', pdfInfoBar(f, pdf.numPages, () => { dz.hidden = false; mount(area); }),
      h('div.panel', h('div.grid.g3', field('输出格式', fmtSeg), field('清晰度', select([[72, '72 DPI（屏幕预览）'], [150, '150 DPI（标准）'], [220, '220 DPI（高清）'], [300, '300 DPI（打印）']], dpi, (v) => { dpi = +v; })), field('页码范围', rangeIn, '留空为全部')), qBox, h('div.row.mt', go)), bar, out));
  }
}

/* ───────── 图片转 PDF ───────── */
const PAGE_SIZES = { a4: [595.28, 841.89], letter: [612, 792], a3: [841.89, 1190.55], a5: [419.53, 595.28] };
function imageToPdf(root) {
  let items = []; // {id, file, bmp, w, h, url}
  const list = h('div.thumb-grid', { style: '--min:120px' });
  const out = h('div');
  const o = { size: 'a4', orient: 'auto', margin: 20, fit: 'contain', quality: 0.9 };
  sortable(list, (ids) => { items = ids.map((id) => items.find((i) => i.id === id)); });
  const dz = dropzone({ accept: 'image/*', multiple: true, title: '点击选择图片，或拖拽多张图片到此处', hint: '支持 JPG / PNG / WebP / BMP / GIF，可拖动调整顺序', icon: 'images', onFiles: add, compact: false });
  const go = h('button.btn.primary.lg', { onclick: run }, icon('file-output'), '生成 PDF');
  async function add(files) {
    for (const file of files) {
      try { const bmp = await decode(file); const { w, h: hh } = sizeOf(bmp); items.push({ id: Math.random().toString(36).slice(2), file, bmp, w, h: hh, url: URL.createObjectURL(file) }); }
      catch (e) { toast(e.message, 'err'); }
    }
    paint();
  }
  function paint() {
    mount(list, items.map((it, i) => h('div.thumb', { dataset: { id: it.id }, draggable: true },
      h('div.tools', h('button', { title: '移除', onclick: () => { items = items.filter((x) => x !== it); paint(); } }, icon('x'))),
      h('img', { src: it.url, style: 'aspect-ratio:3/4;object-fit:cover', draggable: false }), h('div.cap', `${i + 1} · ${it.file.name.slice(0, 14)}`))));
    go.disabled = !items.length;
  }
  async function run() {
    go.disabled = true; mount(out, h('div.row', spinner(), '正在生成…'));
    try {
      const { PDFDocument } = await PDFLib();
      const doc = await PDFDocument.create();
      for (const it of items) {
        const c = makeCanvas(it.w, it.h); const g = c.getContext('2d');
        const isPng = it.file.type === 'image/png';
        if (!isPng) { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
        g.drawImage(it.bmp, 0, 0);
        const img = isPng ? await doc.embedPng(await canvasPngBytes(c)) : await doc.embedJpg(await canvasJpgBytes(c, o.quality));
        let pw, ph;
        if (o.size === 'fit') { pw = it.w * 0.75; ph = it.h * 0.75; }
        else { [pw, ph] = PAGE_SIZES[o.size]; const land = o.orient === 'landscape' || (o.orient === 'auto' && it.w > it.h); if (land !== pw > ph) [pw, ph] = [ph, pw]; }
        const m = o.size === 'fit' ? 0 : o.margin;
        const page = doc.addPage([pw, ph]);
        const aw = pw - m * 2, ah = ph - m * 2;
        let dw, dh;
        if (o.size === 'fit') { dw = pw; dh = ph; }
        else if (o.fit === 'cover') { const k = Math.max(aw / it.w, ah / it.h); dw = it.w * k; dh = it.h * k; }
        else { const k = Math.min(aw / it.w, ah / it.h); dw = it.w * k; dh = it.h * k; }
        page.drawImage(img, { x: (pw - dw) / 2, y: (ph - dh) / 2, width: dw, height: dh });
      }
      const bytes = await doc.save();
      download(pdfBlob(bytes), (items.length === 1 ? baseName(items[0].file.name) : '图片合集') + '.pdf');
      mount(out, banner('ok', `已生成 ${items.length} 页 PDF（${fmtSize(bytes.length)}）`));
    } catch (e) { mount(out, banner('err', e.message)); }
    go.disabled = false;
  }
  const settings = h('div.panel', h('div.grid.g4',
    field('页面大小', select([['a4', 'A4'], ['a3', 'A3'], ['a5', 'A5'], ['letter', 'Letter'], ['fit', '与图片等大']], o.size, (v) => { o.size = v; })),
    field('方向', select([['auto', '自动'], ['portrait', '纵向'], ['landscape', '横向']], o.orient, (v) => { o.orient = v; })),
    field('页边距', select([[0, '无边距'], [20, '小'], [40, '中'], [72, '大']], o.margin, (v) => { o.margin = +v; })),
    field('图片填充', select([['contain', '完整显示'], ['cover', '铺满页面']], o.fit, (v) => { o.fit = v; }))));
  paint();
  mount(root, h('div.col', dz, items.length === 0 && null, list, settings, h('div.row', go), out));
}

/* ───────── PDF 压缩 ───────── */
function pdfCompress(root) {
  const area = h('div');
  const dz = dropzone({ accept: 'application/pdf,.pdf', title: '选择要压缩的 PDF', icon: 'file-archive', onFiles: ([f]) => load(f) });
  mount(root, dz, area);
  const LEVELS = { light: { dpi: 150, q: 0.78, name: '轻度' }, mid: { dpi: 110, q: 0.62, name: '推荐' }, heavy: { dpi: 80, q: 0.5, name: '强力' } };
  async function load(f) {
    mount(area, h('div.row', spinner(), '读取中…'));
    let pdf; try { pdf = await openPdf(f); } catch (e) { return mount(area, banner('err', e.message)); }
    dz.hidden = true; let level = 'mid';
    const out = h('div'); const bar = progress(); bar.hidden = true;
    const go = h('button.btn.primary.lg', { onclick: async () => {
      go.disabled = true; bar.hidden = false; bar.set(0); mount(out);
      try {
        const { PDFDocument } = await PDFLib(); const L = LEVELS[level];
        const doc = await PDFDocument.create();
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i); const vp1 = page.getViewport({ scale: 1 });
          const c = await renderPage(pdf, i, { scale: L.dpi / 72 });
          const img = await doc.embedJpg(await canvasJpgBytes(c, L.q));
          const p = doc.addPage([vp1.width, vp1.height]); p.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
          bar.set(i / pdf.numPages);
        }
        const bytes = await doc.save();
        const saved = 1 - bytes.length / f.size;
        if (saved <= 0) mount(out, banner('warn', `压缩后（${fmtSize(bytes.length)}）反而比原文件（${fmtSize(f.size)}）更大，说明该 PDF 已经很精简，建议保留原文件。`), h('div.row.mt-s', h('button.btn', { onclick: () => download(pdfBlob(bytes), baseName(f.name) + '_压缩.pdf') }, '仍然下载')));
        else { mount(out, banner('ok', `${fmtSize(f.size)} → ${fmtSize(bytes.length)}，减小 ${Math.round(saved * 100)}%`), h('div.row.mt-s', h('button.btn.primary', { onclick: () => download(pdfBlob(bytes), baseName(f.name) + '_压缩.pdf') }, icon('download'), '下载压缩后的 PDF'))); download(pdfBlob(bytes), baseName(f.name) + '_压缩.pdf'); }
      } catch (e) { mount(out, banner('err', e.message)); }
      go.disabled = false; bar.hidden = true;
    } }, icon('file-archive'), '开始压缩');
    mount(area, h('div.col', pdfInfoBar(f, pdf.numPages, () => { dz.hidden = false; mount(area); }), h('div.panel', h('div.col',
      field('压缩强度', seg(Object.entries(LEVELS).map(([k, v]) => [k, `${v.name}（${v.dpi}DPI）`]), level, (v) => { level = v; })),
      banner('info', '原理：把每一页重新渲染为压缩图片再生成 PDF，体积会明显减小，但', h('b', '文字将不再可选中复制'), '。适合扫描件、图片型 PDF。'),
      h('div.row', go))), bar, out));
  }
}

export const tools = { 'pdf-to-image': pdfToImage, 'image-to-pdf': imageToPdf, 'pdf-compress': pdfCompress };
