// PDF 公共能力：pdf-lib（读写）、pdf.js（渲染 / 文本）、页码范围、缩略图、旋转页坐标换算
import { h, loadScript, readAs, icon } from '../ui.js';

export async function PDFLib() {
  if (!window.PDFLib) await loadScript('/vendor/pdf-lib/pdf-lib.min.js');
  return window.PDFLib;
}
let pdfjsP;
export function pdfjs() {
  if (!pdfjsP) pdfjsP = import('/vendor/pdfjs/pdf.min.mjs').then((m) => { m.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs'; return m; });
  return pdfjsP;
}
export async function JSZip() {
  if (!window.JSZip) await loadScript('/vendor/jszip/jszip.min.js');
  return window.JSZip;
}

/** 用 pdf.js 打开（data 会被拷贝，原 bytes 仍可用于 pdf-lib） */
export async function openPdf(src, password) {
  const lib = await pdfjs();
  const bytes = src instanceof Uint8Array ? src : new Uint8Array(src instanceof ArrayBuffer ? src : await readAs(src));
  const task = lib.getDocument({ data: bytes.slice(), cMapUrl: '/vendor/pdfjs-cmaps/', cMapPacked: true, standardFontDataUrl: '/vendor/pdfjs-fonts/', wasmUrl: '/vendor/pdfjs-wasm/', isEvalSupported: false, password });
  try { return await task.promise; }
  catch (e) {
    if (e?.name === 'PasswordException') throw new Error('该 PDF 已加密，暂不支持处理加密文件');
    throw new Error('无法读取该 PDF，文件可能已损坏');
  }
}
export async function loadPdfLibDoc(file, opts = {}) {
  const { PDFDocument } = await PDFLib();
  const bytes = new Uint8Array(await readAs(file));
  try { return { doc: await PDFDocument.load(bytes, opts), bytes }; }
  catch (e) {
    if (/encrypt/i.test(e.message)) throw new Error(`“${file.name}”已加密，暂不支持处理加密文件`);
    throw new Error(`“${file.name}”无法读取，文件可能已损坏`);
  }
}

/** 渲染某页到 canvas。scale 为相对 72dpi 的倍数 */
export async function renderPage(pdf, pageNo, { scale = 1, maxWidth } = {}) {
  const page = await pdf.getPage(pageNo);
  let vp = page.getViewport({ scale });
  if (maxWidth) vp = page.getViewport({ scale: maxWidth / page.getViewport({ scale: 1 }).width });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  page.cleanup();
  return canvas;
}

/** "1-3,5,8-" → [0,1,2,4,7,...]（0 起始索引，去重保序） */
export function parseRanges(str, total) {
  const out = [];
  const seen = new Set();
  for (const part of String(str).replace(/，|、|；|;/g, ',').split(',')) {
    const s = part.trim(); if (!s) continue;
    const m = /^(\d*)\s*[-~–—]\s*(\d*)$/.exec(s);
    let a, b;
    if (m) { a = m[1] ? +m[1] : 1; b = m[2] ? +m[2] : total; }
    else if (/^\d+$/.test(s)) a = b = +s;
    else throw new Error(`无法识别的页码：“${s}”`);
    if (a < 1 || b > total || a > b) throw new Error(`页码范围“${s}”超出 1–${total}`);
    for (let i = a; i <= b; i++) if (!seen.has(i)) { seen.add(i); out.push(i - 1); }
  }
  return out;
}
export function compressRanges(idx) {
  const a = [...idx].sort((x, y) => x - y); const parts = [];
  for (let i = 0; i < a.length;) { let j = i; while (a[j + 1] === a[j] + 1) j++; parts.push(i === j ? `${a[i] + 1}` : `${a[i] + 1}-${a[j] + 1}`); i = j + 1; }
  return parts.join(',');
}

/** 懒加载缩略图网格。返回 { el, cells } ；cell 为 .thumb 元素，带 dataset.page(1 起) */
export function thumbGrid(pdf, { width = 150, cellFn } = {}) {
  const el = h('div.thumb-grid', { style: `--min:${width}px` });
  const cells = [];
  const io = new IntersectionObserver((entries) => {
    for (const en of entries) if (en.isIntersecting) {
      io.unobserve(en.target);
      const box = en.target; const n = +box.dataset.page;
      renderPage(pdf, n, { maxWidth: width * 1.6 }).then((c) => { box.querySelector('.ph')?.replaceWith(c); box.canvas = c; box.dispatchEvent(new CustomEvent('thumb', { detail: c })); }).catch(() => {});
    }
  }, { rootMargin: '300px' });
  for (let n = 1; n <= pdf.numPages; n++) {
    const cell = h('div.thumb', { dataset: { page: n, id: n } }, h('div.ph', { style: 'aspect-ratio:3/4;background:var(--surface-3);border-radius:6px' }), h('div.cap', `第 ${n} 页`));
    cellFn?.(cell, n);
    el.append(cell); cells.push(cell); io.observe(cell);
  }
  el.destroy = () => io.disconnect();
  return { el, cells };
}

/** 可见页坐标 (vx,vy 以可见页左下为原点) → 未旋转 mediabox 坐标，并换算旋转角（PDF 逆时针为正）*/
export function toPageSpace(page, vx, vy, theta = 0) {
  const { width: w, height: hgt } = page.getSize();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  if (r === 90) return { x: w - vy, y: vx, rot: theta + 90, vw: hgt, vh: w };
  if (r === 180) return { x: w - vx, y: hgt - vy, rot: theta + 180, vw: w, vh: hgt };
  if (r === 270) return { x: vy, y: hgt - vx, rot: theta + 270, vw: hgt, vh: w };
  return { x: vx, y: vy, rot: theta, vw: w, vh: hgt };
}
export function visibleSize(page) {
  const { width: w, height: hgt } = page.getSize();
  const r = ((page.getRotation().angle % 360) + 360) % 360;
  return r === 90 || r === 270 ? { w: hgt, h: w } : { w, h: hgt };
}
/** 在中心点 (cx,cy)(可见坐标) 绘制 w×h 的图片并旋转 theta 度 */
export function drawImageCentered(page, img, cx, cy, w, hgt, theta, { opacity = 1, degrees } = {}) {
  const p = toPageSpace(page, cx, cy, theta);
  const a = (p.rot * Math.PI) / 180;
  const x = p.x - (w / 2) * Math.cos(a) + (hgt / 2) * Math.sin(a);
  const y = p.y - (w / 2) * Math.sin(a) - (hgt / 2) * Math.cos(a);
  page.drawImage(img, { x, y, width: w, height: hgt, rotate: degrees(p.rot), opacity });
}

/** 把文字画成透明背景 PNG（支持中文等任意字体），返回 {canvas, w, h}（w/h 为 CSS 像素） */
export function textToCanvas(text, { size = 32, color = '#000', font = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif', bold = false, scale = 3, padding = 4 } = {}) {
  const lines = String(text).split('\n');
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  const f = `${bold ? '700 ' : ''}${size}px ${font}`;
  ctx.font = f;
  const w = Math.ceil(Math.max(...lines.map((l) => ctx.measureText(l).width))) + padding * 2;
  const lh = Math.ceil(size * 1.3);
  const hh = lh * lines.length + padding * 2;
  c.width = w * scale; c.height = hh * scale;
  const g = c.getContext('2d');
  g.scale(scale, scale); g.font = f; g.fillStyle = color; g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, padding, padding + lh * i + lh / 2));
  return { canvas: c, w, h: hh };
}
export const canvasPngBytes = async (canvas) => new Uint8Array(await (await new Promise((r) => canvas.toBlob(r, 'image/png'))).arrayBuffer());
export const canvasJpgBytes = async (canvas, q = 0.85) => new Uint8Array(await (await new Promise((r) => canvas.toBlob(r, 'image/jpeg', q))).arrayBuffer());
export const pdfBlob = (bytes) => new Blob([bytes], { type: 'application/pdf' });

/** 公共：单个 PDF 选择后的“文件信息条” */
export function pdfInfoBar(file, pages, onClear) {
  return h('div.file-item', h('div.fi-ico', icon('file-text')), h('div.grow', h('div.fi-name.ellipsis', file.name), h('div.fi-meta', `${pages} 页`)),
    onClear && h('button.btn.sm.ghost', { onclick: onClear }, icon('x'), '更换'));
}
