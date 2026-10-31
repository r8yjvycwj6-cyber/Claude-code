import { h, $, mount, icon, dropzone, toast, download, fmtSize, baseName, field, seg, banner, spinner, sortable, readAs, fmtTime, copyText, progress, checkbox, select } from '../ui.js';
import { PDFLib, openPdf, loadPdfLibDoc, renderPage, parseRanges, compressRanges, thumbGrid, pdfBlob, JSZip, pdfInfoBar } from '../lib/pdf.js';

/* ───────── 合并 ───────── */
function mergeTool(root) {
  let items = []; // {id, file, pages, doc}
  const list = h('div.file-list');
  const out = h('div');
  const btn = h('button.btn.primary.lg', { onclick: run }, icon('merge'), '合并 PDF');
  const dz = dropzone({ accept: 'application/pdf,.pdf', multiple: true, title: '点击选择 PDF，或拖拽多个文件到此处', hint: '支持一次添加多个文件，可拖动调整顺序', icon: 'file-plus-2', onFiles: add });
  const summary = h('div.muted.small');
  sortable(list, (ids) => { items = ids.map((id) => items.find((i) => i.id === id)); });

  async function add(files) {
    for (const file of files) {
      const id = Math.random().toString(36).slice(2);
      const it = { id, file, pages: '…' };
      items.push(it);
      try {
        const { doc } = await loadPdfLibDoc(file);
        it.pages = doc.getPageCount();
      } catch (e) { toast(e.message, 'err', 4000); items = items.filter((x) => x !== it); }
      paint();
    }
  }
  function paint() {
    mount(list, items.map((it, i) => h('div.file-item', { dataset: { id: it.id }, draggable: true },
      icon('grip-vertical', 'handle'), h('div.fi-ico', icon('file-text')),
      h('div.grow', h('div.fi-name.ellipsis', it.file.name), h('div.fi-meta', `${it.pages} 页 · ${fmtSize(it.file.size)}`)),
      h('button.btn.sm.ghost.icon', { title: '上移', disabled: i === 0, onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; paint(); } }, icon('arrow-up')),
      h('button.btn.sm.ghost.icon', { title: '下移', disabled: i === items.length - 1, onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; paint(); } }, icon('arrow-down')),
      h('button.btn.sm.ghost.icon', { title: '移除', onclick: () => { items = items.filter((x) => x !== it); paint(); } }, icon('x')))));
    const total = items.reduce((s, i) => s + (+i.pages || 0), 0);
    summary.textContent = items.length ? `${items.length} 个文件，共 ${total} 页` : '';
    btn.disabled = items.length < 2;
  }
  async function run() {
    btn.disabled = true; mount(out, h('div.row', spinner(), '正在合并…'));
    try {
      const { PDFDocument } = await PDFLib();
      const merged = await PDFDocument.create();
      for (const it of items) {
        const { doc } = await loadPdfLibDoc(it.file);
        const pages = await merged.copyPages(doc, doc.getPageIndices());
        pages.forEach((p) => merged.addPage(p));
      }
      const bytes = await merged.save();
      mount(out, banner('ok', `合并完成：${merged.getPageCount()} 页，${fmtSize(bytes.length)}`), h('div.row.mt-s', h('button.btn.primary', { onclick: () => download(pdfBlob(bytes), '合并结果.pdf') }, icon('download'), '下载合并后的 PDF')));
      download(pdfBlob(bytes), '合并结果.pdf');
    } catch (e) { mount(out, banner('err', e.message)); }
    btn.disabled = false; paint();
  }
  paint();
  mount(root, h('div.col', dz, list, h('div.row', btn, summary), out));
}

/* ───────── 拆分 / 提取 ───────── */
function splitTool(root) {
  let file, pdf, total = 0, mode = 'range';
  const selected = new Set();
  const area = h('div');
  const dz = dropzone({ accept: 'application/pdf,.pdf', title: '选择要拆分的 PDF', icon: 'file-up', onFiles: ([f]) => load(f) });
  mount(root, dz, area);

  async function load(f) {
    mount(area, h('div.loading-page', spinner(), '读取中…'));
    try { pdf = await openPdf(f); } catch (e) { return mount(area, banner('err', e.message)); }
    file = f; total = pdf.numPages; selected.clear();
    dz.hidden = true;
    const rangeInput = h('input.input', { placeholder: `例如 1-3,5,8-${total}`, oninput: () => { try { const idx = parseRanges(rangeInput.value, total); selected.clear(); idx.forEach((i) => selected.add(i)); syncThumbs(); } catch { /* 输入中 */ } } });
    const out = h('div'); const modeBox = h('div');
    const nInput = h('input.input', { type: 'number', min: 1, max: total, value: 1 });
    const { el: grid, cells } = thumbGrid(pdf, { width: 130, cellFn: (cell, n) => { cell.style.cursor = 'pointer'; cell.onclick = () => { selected.has(n - 1) ? selected.delete(n - 1) : selected.add(n - 1); rangeInput.value = compressRanges([...selected]); syncThumbs(); }; } });
    function syncThumbs() { cells.forEach((c, i) => c.classList.toggle('sel', selected.has(i))); count.textContent = `已选 ${selected.size} / ${total} 页`; }
    const count = h('span.chip.pri');
    const modeSeg = seg([['range', '提取页面'], ['each', '每页拆分'], ['every', '按页数拆分']], mode, (v) => { mode = v; paintMode(); });
    function paintMode() {
      mount(modeBox, mode === 'range' ? h('div.col', field('页码范围', rangeInput, '也可以直接在下方点击缩略图选择'), h('div.row', h('button.btn.sm', { onclick: () => { selected.clear(); for (let i = 0; i < total; i++) selected.add(i); rangeInput.value = `1-${total}`; syncThumbs(); } }, '全选'),
        h('button.btn.sm', { onclick: () => { for (let i = 0; i < total; i++) selected.has(i) ? selected.delete(i) : selected.add(i); rangeInput.value = compressRanges([...selected]); syncThumbs(); } }, '反选'),
        h('button.btn.sm', { onclick: () => { selected.clear(); rangeInput.value = ''; syncThumbs(); } }, '清空'), count))
        : mode === 'each' ? h('p.muted', `将 ${total} 页拆成 ${total} 个单页 PDF，并打包为 ZIP 下载。`)
        : h('div.col', field('每个文件包含的页数', nInput), h('p.muted.small', '最后一个文件可能不足该页数。')));
      grid.style.display = mode === 'range' ? '' : 'none';
    }
    const go = h('button.btn.primary.lg', { onclick: async () => {
      go.disabled = true; mount(out, h('div.row', spinner(), '处理中…'));
      try {
        const { PDFDocument } = await PDFLib();
        const src = (await loadPdfLibDoc(file)).doc;
        const make = async (idx) => { const d = await PDFDocument.create(); (await d.copyPages(src, idx)).forEach((p) => d.addPage(p)); return d.save(); };
        const base = baseName(file.name);
        if (mode === 'range') {
          const idx = parseRanges(rangeInput.value, total);
          if (!idx.length) throw new Error('请先选择要提取的页面');
          const bytes = await make(idx); download(pdfBlob(bytes), `${base}_提取${idx.length}页.pdf`);
          mount(out, banner('ok', `已提取 ${idx.length} 页（${fmtSize(bytes.length)}）`));
        } else {
          const step = mode === 'each' ? 1 : Math.max(1, Math.min(total, Math.floor(+nInput.value) || 1));
          const Z = await JSZip(); const zip = new Z();
          let parts = 0;
          for (let s = 0; s < total; s += step) {
            const idx = Array.from({ length: Math.min(step, total - s) }, (_, k) => s + k);
            zip.file(`${base}_${String(s / step + 1).padStart(3, '0')}.pdf`, await make(idx)); parts++;
          }
          const blob = await zip.generateAsync({ type: 'blob' });
          download(blob, `${base}_拆分.zip`);
          mount(out, banner('ok', `已拆分为 ${parts} 个文件（ZIP ${fmtSize(blob.size)}）`));
        }
      } catch (e) { mount(out, banner('err', e.message)); }
      go.disabled = false;
    } }, icon('scissors'), '开始处理');
    mount(area, h('div.col', pdfInfoBar(f, total, () => { dz.hidden = false; mount(area); grid.destroy?.(); }), h('div.panel', h('div.col', modeSeg, modeBox, h('div.row', go), out)), grid));
    paintMode(); syncThumbs();
  }
}

/* ───────── 页面管理（排序/旋转/删除） ───────── */
function applyRot(cell, st) {
  const c = cell.querySelector('canvas');
  if (!c) return;
  const r = c.height / c.width, s = st.rot % 180 ? Math.min(r, 1 / r) : 1;
  c.style.transition = 'transform .2s';
  c.style.transform = `rotate(${st.rot}deg) scale(${s})`;
}
function organizeTool(root) {
  let file, pdf, pages = []; // {n, rot, el}
  const area = h('div');
  const dz = dropzone({ accept: 'application/pdf,.pdf', title: '选择要整理的 PDF', icon: 'layout-grid', onFiles: ([f]) => load(f) });
  mount(root, dz, area);
  async function load(f) {
    mount(area, h('div.loading-page', spinner(), '读取中…'));
    try { pdf = await openPdf(f); } catch (e) { return mount(area, banner('err', e.message)); }
    file = f; dz.hidden = true;
    pages = Array.from({ length: pdf.numPages }, (_, i) => ({ n: i + 1, rot: 0 }));
    const { el: grid } = thumbGrid(pdf, { width: 150, cellFn: (cell, n) => {
      const st = pages[n - 1];
      cell.draggable = true; cell.dataset.id = String(n);
      const apply = () => applyRot(cell, st);
      cell.addEventListener('thumb', apply);
      const tools = h('div.tools',
        h('button', { title: '向左旋转', onclick: (e) => { e.stopPropagation(); st.rot = (st.rot + 270) % 360; apply(); } }, icon('rotate-ccw')),
        h('button', { title: '向右旋转', onclick: (e) => { e.stopPropagation(); st.rot = (st.rot + 90) % 360; apply(); } }, icon('rotate-cw')),
        h('button', { title: '删除此页', onclick: (e) => { e.stopPropagation(); st.del = !st.del; cell.style.opacity = st.del ? .3 : 1; cell.querySelector('.cap').textContent = st.del ? '将被删除' : `第 ${n} 页`; refreshCount(); } }, icon('trash-2')));
      cell.prepend(tools);
    } });
    grid.style.setProperty('--min', '150px');
    sortable(grid, () => {});
    const info = h('span.chip.pri');
    const refreshCount = () => { info.textContent = `保留 ${pages.filter((p) => !p.del).length} / ${pages.length} 页`; };
    const rotAll = (d) => { pages.forEach((p) => { p.rot = (p.rot + d + 360) % 360; }); [...grid.children].forEach((c) => applyRot(c, pages[+c.dataset.id - 1])); };
    const out = h('div');
    const go = h('button.btn.primary.lg', { onclick: async () => {
      go.disabled = true; mount(out, h('div.row', spinner(), '正在生成…'));
      try {
        const { PDFDocument, degrees } = await PDFLib();
        const src = (await loadPdfLibDoc(file)).doc;
        const order = [...grid.children].map((c) => pages[+c.dataset.id - 1]).filter((p) => !p.del);
        if (!order.length) throw new Error('至少保留一页');
        const d = await PDFDocument.create();
        const copied = await d.copyPages(src, order.map((p) => p.n - 1));
        copied.forEach((pg, i) => { if (order[i].rot) pg.setRotation(degrees((pg.getRotation().angle + order[i].rot) % 360)); d.addPage(pg); });
        const bytes = await d.save(); download(pdfBlob(bytes), `${baseName(file.name)}_整理后.pdf`);
        mount(out, banner('ok', `已生成 ${order.length} 页的新 PDF（${fmtSize(bytes.length)}）`));
      } catch (e) { mount(out, banner('err', e.message)); }
      go.disabled = false;
    } }, icon('download'), '导出 PDF');
    mount(area, h('div.col', pdfInfoBar(f, pages.length, () => { dz.hidden = false; mount(area); grid.destroy?.(); }),
      h('div.row', h('span.muted.small', '拖动缩略图调整顺序；悬停显示旋转 / 删除按钮'), h('div.sp'), info, h('button.btn.sm', { onclick: () => rotAll(90) }, icon('rotate-cw'), '全部右转'), h('button.btn.sm', { onclick: () => rotAll(-90) }, icon('rotate-ccw'), '全部左转'), go),
      out, grid));
    refreshCount();
  }
}

/* ───────── 提取文字 ───────── */
function textTool(root) {
  const area = h('div');
  const dz = dropzone({ accept: 'application/pdf,.pdf', title: '选择 PDF 提取文字', icon: 'text-select', onFiles: ([f]) => load(f) });
  mount(root, dz, area);
  async function load(f) {
    mount(area, h('div.row', spinner(), '正在提取…'));
    try {
      const pdf = await openPdf(f); const parts = []; let chars = 0;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i); const tc = await page.getTextContent();
        let lines = [], cur = [], lastY = null;
        for (const it of tc.items) {
          if (!('str' in it)) continue;
          const y = it.transform[5];
          if (lastY !== null && Math.abs(y - lastY) > 3) { lines.push(cur.join('')); cur = []; }
          cur.push(it.str); lastY = y; if (it.hasEOL) { lines.push(cur.join('')); cur = []; lastY = null; }
        }
        if (cur.length) lines.push(cur.join(''));
        const t = lines.join('\n').trim(); chars += t.length;
        parts.push(t);
      }
      const withSep = parts.map((t, i) => `———— 第 ${i + 1} 页 ————\n${t}`).join('\n\n');
      const ta = h('textarea.textarea', { style: 'min-height:380px', value: withSep });
      mount(area, h('div.col.mt',
        pdfInfoBar(f, pdf.numPages), chars < 20 && banner('warn', '几乎没有提取到文字，这可能是扫描件 / 图片型 PDF。请使用「图片文字识别」工具，先用「PDF 转图片」导出页面后识别。'),
        ta, h('div.row', h('button.btn.primary', { onclick: () => copyText(ta.value) }, icon('copy'), '复制全部'), h('button.btn', { onclick: () => download(new Blob([ta.value], { type: 'text/plain;charset=utf-8' }), baseName(f.name) + '.txt') }, icon('download'), '下载 .txt'), h('span.muted.small', `${chars} 个字符`))));
    } catch (e) { mount(area, banner('err', e.message)); }
  }
}

export const tools = { 'pdf-merge': mergeTool, 'pdf-split': splitTool, 'pdf-organize': organizeTool, 'pdf-text': textTool };
