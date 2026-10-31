import { h, $, mount, icon, dropzone, toast, download, fmtSize, field, seg, banner, spinner, progress, range, modal, copyText, clamp, uid, baseName, sortable, canvasToBlob, debounce } from '../ui.js';
import { toCanvas, makeCanvas } from '../lib/img.js';
import { detectQuad, warpQuad, applyFilter, rotateCanvas } from '../lib/scan.js';
import { PDFLib, JSZip, pdfBlob, canvasJpgBytes } from '../lib/pdf.js';
import { recognize, tidyText } from '../lib/ocr.js';

const FILTERS = [['magic', '增强'], ['bw', '黑白'], ['gray', '灰度'], ['original', '原图']];
const PAGE = { a4: [595.28, 841.89], letter: [612, 792] };

export default function scanner(root) {
  const pages = [];          // {id, name, src, quad, rot, filter, brightness, contrast, thr, warped, result}
  let curId = null, mode = 'crop', camStream = null;
  const strip = h('div.thumb-grid', { style: '--min:92px' });
  const stage = h('div'); const side = h('div.col'); const exportBar = h('div');
  const empty = h('div.col');
  const cur = () => pages.find((p) => p.id === curId);

  /* ───── 添加页面 ───── */
  async function addFiles(files) {
    const busy = h('div.row', spinner(), `正在处理 ${files.length} 张图片…`); empty.append(busy);
    for (const f of files) {
      try {
        const src = await toCanvas(f, { maxSide: 3200, bg: '#fff' });
        const q = detectQuad(src);
        const m = Math.min(src.width, src.height) * 0.04;
        pages.push({ id: uid(), name: f.name || '拍照', src, quad: q || [[m, m], [src.width - m, m], [src.width - m, src.height - m], [m, src.height - m]], detected: !!q, rot: 0, filter: 'magic', brightness: 0, contrast: 0, thr: 0.82 });
      } catch (e) { toast(e.message, 'err'); }
    }
    busy.remove();
    if (pages.length) { curId = pages[pages.length - 1].id; mode = 'crop'; const p = cur(); if (p.detected) toast('已自动识别文档边缘，可拖动圆点微调', 'ok'); else toast('未能自动识别边缘，请拖动四个角点框选文档'); }
    renderAll();
  }
  const dz = dropzone({ accept: 'image/*', multiple: true, title: '选择文档照片 / 截图', hint: '可一次选择多张，自动识别边缘并矫正；手机上可直接拍照', icon: 'scan-line', onFiles: addFiles });
  const camInput = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, onchange: () => { if (camInput.files.length) addFiles([...camInput.files]); camInput.value = ''; } });
  const addBar = () => h('div.row', h('button.btn.primary', { onclick: () => camInput.click() }, icon('camera'), '拍照'), h('button.btn', { onclick: openCamera }, icon('video'), '摄像头'), camInput);

  async function openCamera() {
    if (!navigator.mediaDevices?.getUserMedia) return toast('当前环境不支持摄像头（需 https 或 localhost），请使用“拍照 / 选择图片”', 'err', 4500);
    try { camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 } } }); } catch (e) { return toast('无法打开摄像头：' + e.message, 'err', 4000); }
    const v = h('video', { playsInline: true, muted: true, autoplay: true, style: 'width:100%;border-radius:14px;background:#000;max-height:60vh' }); v.srcObject = camStream;
    const stop = () => { camStream?.getTracks().forEach((t) => t.stop()); camStream = null; };
    const m = modal(h('div.col', h('h2', '摄像头拍摄'), v, h('div.row', { style: 'justify-content:center' }, h('button.btn.primary.lg', { onclick: async () => {
      const c = makeCanvas(v.videoWidth, v.videoHeight); c.getContext('2d').drawImage(v, 0, 0);
      const blob = await canvasToBlob(c, 'image/jpeg', 0.95); addFiles([new File([blob], `拍摄_${pages.length + 1}.jpg`, { type: 'image/jpeg' })]); toast('已拍摄，可继续拍下一张或关闭');
    } }, icon('camera'), '拍照'), h('button.btn', { onclick: () => m.close() }, '完成'))), { wide: true, onClose: stop });
  }

  /* ───── 渲染 ───── */
  function renderAll() { render0(); renderStrip(); renderStage(); renderExport(); }
  function renderStrip() {
    mount(strip, pages.map((p, i) => h('div.thumb' + (p.id === curId ? '.sel' : ''), { dataset: { id: p.id }, draggable: true, style: 'padding:5px;cursor:pointer', onclick: () => { curId = p.id; mode = p.result ? 'enhance' : 'crop'; renderAll(); } },
      h('div.tools', h('button', { title: '删除', onclick: (e) => { e.stopPropagation(); pages.splice(i, 1); if (curId === p.id) curId = pages[Math.max(0, i - 1)]?.id; renderAll(); } }, icon('x'))),
      thumbOf(p), h('div.cap', `第 ${i + 1} 页`))));
  }
  function thumbOf(p) {
    const c = p.result || p.src; const t = makeCanvas(120, Math.round((120 * c.height) / c.width)); t.getContext('2d').drawImage(c, 0, 0, t.width, t.height); t.style.cssText = 'aspect-ratio:auto'; return t;
  }
  sortable(strip, (ids) => { const m = new Map(pages.map((p) => [p.id, p])); pages.splice(0, pages.length, ...ids.map((id) => m.get(id))); renderStrip(); renderExport(); });

  function renderStage() {
    const p = cur();
    if (!p) { mount(stage, h('div.col', dz, addBar(), h('div.muted.small', '全部处理均在浏览器本地完成，照片不会上传。'))); mount(side); return; }
    mode === 'crop' ? cropView(p) : enhanceView(p);
  }

  /* ───── 裁剪视图 ───── */
  function cropView(p) {
    const box = h('div', { style: 'position:relative;display:inline-block;max-width:100%;touch-action:none;user-select:none;line-height:0' });
    const cv = h('canvas', { style: 'max-width:100%;max-height:68vh;display:block' });
    const maxW = 900, k0 = Math.min(1, maxW / Math.max(p.src.width, p.src.height)); cv.width = Math.round(p.src.width * k0); cv.height = Math.round(p.src.height * k0); cv.getContext('2d').drawImage(p.src, 0, 0, cv.width, cv.height);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `0 0 ${p.src.width} ${p.src.height}`); svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
    const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polygon'); poly.setAttribute('fill', 'rgba(91,95,245,.18)'); poly.setAttribute('stroke', '#5b5ff5'); poly.setAttribute('stroke-width', Math.max(2, p.src.width / 300)); poly.setAttribute('vector-effect', 'non-scaling-stroke'); poly.style.strokeWidth = '2.5'; svg.append(poly);
    box.append(cv, svg);
    const handles = p.quad.map((_, i) => { const hd = h('div', { style: 'position:absolute;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;background:#fff;border:4px solid var(--primary);box-shadow:0 2px 8px rgba(0,0,0,.35);cursor:grab;touch-action:none;z-index:3' }); box.append(hd);
      hd.onpointerdown = (e) => { e.preventDefault(); hd.setPointerCapture(e.pointerId); hd.style.cursor = 'grabbing';
        hd.onpointermove = (ev) => { const r = cv.getBoundingClientRect(); p.quad[i] = [clamp(((ev.clientX - r.left) / r.width) * p.src.width, 0, p.src.width), clamp(((ev.clientY - r.top) / r.height) * p.src.height, 0, p.src.height)]; sync(); };
        hd.onpointerup = () => { hd.onpointermove = null; hd.style.cursor = 'grab'; }; };
      return hd; });
    function sync() { poly.setAttribute('points', p.quad.map((q) => q.join(',')).join(' ')); handles.forEach((hd, i) => { hd.style.left = (p.quad[i][0] / p.src.width) * 100 + '%'; hd.style.top = (p.quad[i][1] / p.src.height) * 100 + '%'; }); }
    sync();
    mount(stage, h('div.col', h('div.canvas-wrap', { style: 'background:var(--surface-3)' }, box), h('div.row', { style: 'justify-content:center' },
      h('button.btn', { onclick: () => { const q = detectQuad(p.src); if (q) { p.quad = q; sync(); toast('已重新识别', 'ok'); } else toast('未能识别边缘，请手动框选'); } }, icon('wand-sparkles'), '自动识别'),
      h('button.btn', { onclick: () => { const m = 0; p.quad = [[m, m], [p.src.width, m], [p.src.width, p.src.height], [m, p.src.height]]; sync(); } }, icon('maximize'), '全图'),
      h('button.btn.primary', { onclick: apply }, icon('check'), '确认裁剪'))));
    mount(side, h('div.panel', h('div.col', h('h3', '裁剪矫正'), h('p.muted.small', '拖动四个圆点贴合文档边缘，确认后会自动拉直成矩形并消除透视变形。'),
      h('button.btn.sm', { onclick: () => { p.rot = (p.rot + 90) % 360; const c = rotateCanvas(p.src, 90); p.src = c; p.quad = detectQuad(c) || [[0, 0], [c.width, 0], [c.width, c.height], [0, c.height]]; p.rot = 0; renderStage(); } }, icon('rotate-cw'), '旋转原图 90°'),
      p.result && h('button.btn.sm', { onclick: () => { mode = 'enhance'; renderStage(); } }, '返回增强视图'))));
    async function apply() {
      const t = h('div.row', spinner(), '处理中…'); stage.prepend(t); await new Promise((r) => setTimeout(r, 30));
      p.warped = warpQuad(p.src, p.quad); mode = 'enhance'; process(p); renderAll();
    }
  }

  /* ───── 增强视图 ───── */
  function process(p) { const f = applyFilter(p.warped, p); p.result = rotateCanvas(f, p.rot); }
  function enhanceView(p) {
    if (!p.warped) { mode = 'crop'; return cropView(p); }
    if (!p.result) process(p);
    const view = h('canvas', { style: 'max-width:100%;max-height:70vh' });
    const draw = () => { view.width = p.result.width; view.height = p.result.height; view.getContext('2d').drawImage(p.result, 0, 0); };
    const redo = debounce(() => { process(p); draw(); renderStrip(); }, 60);
    const thrBox = h('div', { hidden: p.filter !== 'bw' }, field('黑白阈值', range(0.55, 0.95, 0.01, p.thr, (v) => { p.thr = v; redo(); }, (v) => v.toFixed(2))));
    draw();
    mount(stage, h('div.col', h('div.canvas-wrap', view), h('div.row', { style: 'justify-content:center' },
      h('button.btn', { onclick: () => { mode = 'crop'; renderStage(); } }, icon('crop'), '重新裁剪'),
      h('button.btn', { onclick: () => { p.rot = (p.rot + 270) % 360; process(p); draw(); renderStrip(); } }, icon('rotate-ccw'), '左转'),
      h('button.btn', { onclick: () => { p.rot = (p.rot + 90) % 360; process(p); draw(); renderStrip(); } }, icon('rotate-cw'), '右转'),
      h('button.btn', { onclick: ocr }, icon('scan-text'), '识别文字'))));
    mount(side, h('div.panel', h('div.col', h('h3', '增强'),
      seg(FILTERS, p.filter, (v) => { p.filter = v; thrBox.hidden = v !== 'bw'; redo(); }), thrBox,
      field('亮度', range(-50, 50, 1, p.brightness, (v) => { p.brightness = v; redo(); }, (v) => (v > 0 ? '+' : '') + v)),
      field('对比度', range(-50, 80, 1, p.contrast, (v) => { p.contrast = v; redo(); }, (v) => (v > 0 ? '+' : '') + v)),
      h('div.row', h('button.btn.sm', { onclick: () => { p.brightness = 0; p.contrast = 0; p.thr = 0.82; enhanceView(p); redo(); } }, '重置'),
        h('button.btn.sm', { onclick: () => { pages.forEach((q) => { if (q.warped && q !== p) { q.filter = p.filter; q.brightness = p.brightness; q.contrast = p.contrast; q.thr = p.thr; process(q); } }); renderStrip(); toast('已应用到所有页面', 'ok'); } }, '应用到全部页')))));
  }
  async function ocr() {
    const p = cur(); const bar = progress(); const stat = h('span.muted.small', '准备中…');
    const body = h('div.col', h('h2', '文字识别'), bar, stat); const m = modal(body, { wide: true });
    try {
      const r = await recognize(p.result, { lang: 'chi_sim+eng', onProgress: (v, t) => { bar.set(v); stat.textContent = t; } });
      const ta = h('textarea.textarea', { style: 'min-height:300px;font-size:15px', value: tidyText(r.text) });
      mount(body, h('h2', '识别结果'), ta, h('div.row', h('button.btn.primary', { onclick: () => copyText(ta.value) }, icon('copy'), '复制'), h('button.btn', { onclick: () => download(new Blob([ta.value], { type: 'text/plain;charset=utf-8' }), '扫描文字.txt') }, icon('download'), '下载 .txt'), h('span.muted.small', `置信度 ${Math.round(r.confidence)}%`)));
    } catch (e) { mount(body, h('h2', '识别失败'), banner('err', e.message)); }
  }

  /* ───── 导出 ───── */
  function renderExport() {
    const ready = pages.filter((p) => p.warped);
    if (!pages.length) return mount(exportBar);
    const unproc = pages.length - ready.length;
    let size = 'a4'; const sizeSel = seg([['a4', 'A4'], ['letter', 'Letter'], ['fit', '原图尺寸']], size, (v) => { size = v; });
    const getResult = (p) => p.result || (p.warped ? (process(p), p.result) : null);
    mount(exportBar, h('div.panel', h('div.row', h('b', `导出（${ready.length}/${pages.length} 页已处理）`), h('div.sp'), sizeSel,
      h('button.btn.primary', { disabled: !ready.length, onclick: async (e) => {
        const b = e.currentTarget; b.disabled = true;
        try {
          const { PDFDocument } = await PDFLib(); const doc = await PDFDocument.create();
          for (const p of ready) {
            const c = getResult(p); const img = await doc.embedJpg(await canvasJpgBytes(c, 0.88));
            let pw, ph; if (size === 'fit') { pw = c.width * 0.5; ph = c.height * 0.5; } else { [pw, ph] = PAGE[size]; if (c.width > c.height) [pw, ph] = [ph, pw]; }
            const k = Math.min(pw / c.width, ph / c.height); const w = c.width * k, hh = c.height * k;
            doc.addPage([pw, ph]).drawImage(img, { x: (pw - w) / 2, y: (ph - hh) / 2, width: w, height: hh });
          }
          const bytes = await doc.save(); download(pdfBlob(bytes), `扫描件_${new Date().toISOString().slice(0, 10)}.pdf`); toast(`已导出 PDF（${fmtSize(bytes.length)}）`, 'ok');
        } catch (er) { toast(er.message, 'err'); }
        b.disabled = false;
      } }, icon('file-down'), '导出 PDF'),
      h('button.btn', { disabled: !ready.length, onclick: async () => {
        if (ready.length === 1) return download(await canvasToBlob(getResult(ready[0]), 'image/jpeg', 0.92), '扫描件.jpg');
        const Z = await JSZip(); const z = new Z(); for (let i = 0; i < ready.length; i++) z.file(`扫描件_${String(i + 1).padStart(2, '0')}.jpg`, await canvasToBlob(getResult(ready[i]), 'image/jpeg', 0.92));
        download(await z.generateAsync({ type: 'blob' }), '扫描件.zip');
      } }, icon('image-down'), ready.length > 1 ? '导出图片 (ZIP)' : '导出 JPG')),
      unproc > 0 && h('p.hint.mt-s', `还有 ${unproc} 页未确认裁剪，点击对应缩略图完成后才会被导出。`)));
  }

  const main = h('div.col');
  const render0 = () => {
    mount(main, pages.length ? h('div.col', h('div.row', { style: 'justify-content:space-between' }, h('div.row', addBar(), h('button.btn.ghost', { onclick: () => { pages.length = 0; curId = null; renderAll(); } }, icon('trash-2'), '清空')), h('span.muted.small', '拖动缩略图可调整页面顺序')), strip, h('div.split.wide-r', stage, side), exportBar)
      : h('div.col', stage));
  };
  renderAll();
  mount(root, main);
  return () => { camStream?.getTracks().forEach((t) => t.stop()); };
}
