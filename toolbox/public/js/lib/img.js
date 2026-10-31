// 图片公共能力：解码（含 EXIF 方向）、缩放、导出、Canvas 辅助
import { canvasToBlob } from '../ui.js';

export async function decode(file) {
  try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); }
  catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image(); img.src = url; await img.decode();
      return img;
    } catch { throw new Error(`无法读取图片“${file.name}”，格式可能不受支持`); }
    finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
  }
}
export const sizeOf = (im) => ({ w: im.naturalWidth || im.width, h: im.naturalHeight || im.height });
export function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }
export async function toCanvas(file, { maxSide, bg } = {}) {
  const im = await decode(file); const { w, h } = sizeOf(im);
  const k = maxSide ? Math.min(1, maxSide / Math.max(w, h)) : 1;
  const c = makeCanvas(w * k, h * k); const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); }
  g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, c.width, c.height);
  im.close?.();
  return c;
}
/** 逐步缩小以获得更好的缩放质量 */
export function resizeCanvas(src, w, h) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  let cur = src;
  while (cur.width / 2 > w && cur.height / 2 > h) {
    const c = makeCanvas(cur.width / 2, cur.height / 2); const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, c.width, c.height); cur = c;
  }
  const out = makeCanvas(w, h); const g = out.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(cur, 0, 0, w, h);
  return out;
}
export const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', gif: 'image/gif' };
export async function encode(canvas, fmt, quality = 0.9) {
  const mime = MIME[fmt] || fmt;
  if (mime === 'image/jpeg') { // JPG 不支持透明：垫白底
    const c = makeCanvas(canvas.width, canvas.height); const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(canvas, 0, 0); canvas = c;
  }
  if (mime === 'image/bmp') return encodeBmp(canvas);
  const blob = await canvasToBlob(canvas, mime, quality);
  if (!blob || blob.type !== mime) throw new Error(`当前浏览器不支持导出 ${fmt.toUpperCase()} 格式`);
  return blob;
}
function encodeBmp(canvas) {
  const { width: w, height: h } = canvas; const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const rowSize = Math.ceil((w * 3) / 4) * 4, size = 54 + rowSize * h;
  const buf = new ArrayBuffer(size), v = new DataView(buf);
  v.setUint16(0, 0x4d42, true); v.setUint32(2, size, true); v.setUint32(10, 54, true); v.setUint32(14, 40, true);
  v.setInt32(18, w, true); v.setInt32(22, h, true); v.setUint16(26, 1, true); v.setUint16(28, 24, true); v.setUint32(34, rowSize * h, true);
  let o = 54;
  for (let y = h - 1; y >= 0; y--) { let p = o; for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const a = d[i + 3] / 255; v.setUint8(p++, d[i + 2] * a + 255 * (1 - a)); v.setUint8(p++, d[i + 1] * a + 255 * (1 - a)); v.setUint8(p++, d[i] * a + 255 * (1 - a)); } o += rowSize; }
  return new Blob([buf], { type: 'image/bmp' });
}
export const extFor = (fmt) => ({ jpeg: 'jpg', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/bmp': 'bmp' }[fmt] || fmt);
