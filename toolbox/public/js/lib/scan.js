// 文档扫描算法：边缘检测、透视矫正、阴影消除 / 黑白增强（纯 Canvas，无外部依赖）
import { makeCanvas } from './img.js';

/* ───────── 自动检测文档四角 ───────── */
// 返回顺序：左上、右上、右下、左下（原图像素坐标）；检测失败返回 null
export function detectQuad(src) {
  const W = 320, k = Math.min(1, W / Math.max(src.width, src.height));
  const w = Math.max(8, Math.round(src.width * k)), h = Math.max(8, Math.round(src.height * k));
  const c = makeCanvas(w, h); const g = c.getContext('2d'); g.drawImage(src, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  let gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  gray = boxBlur(gray, w, h, 2);

  // Otsu 阈值
  const hist = new Array(256).fill(0); for (const v of gray) hist[v | 0]++;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = w * h - wB; if (!wF) break; sB += t * hist[t]; const mB = sB / wB, mF = (sum - sB) / wF; const v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; thr = t; } }

  const tryMask = (bright) => {
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = (bright ? gray[i] > thr : gray[i] <= thr) ? 1 : 0;
    // 找最大连通域（4 邻域 BFS）
    const label = new Int32Array(w * h); let bestLabel = 0, bestSize = 0, cur = 0; const stack = new Int32Array(w * h);
    for (let s = 0; s < w * h; s++) {
      if (!mask[s] || label[s]) continue;
      cur++; let sp = 0, size = 0; stack[sp++] = s; label[s] = cur;
      while (sp) { const p = stack[--sp]; size++; const x = p % w, y = (p / w) | 0;
        if (x > 0 && mask[p - 1] && !label[p - 1]) { label[p - 1] = cur; stack[sp++] = p - 1; }
        if (x < w - 1 && mask[p + 1] && !label[p + 1]) { label[p + 1] = cur; stack[sp++] = p + 1; }
        if (y > 0 && mask[p - w] && !label[p - w]) { label[p - w] = cur; stack[sp++] = p - w; }
        if (y < h - 1 && mask[p + w] && !label[p + w]) { label[p + w] = cur; stack[sp++] = p + w; } }
      if (size > bestSize) { bestSize = size; bestLabel = cur; }
    }
    if (bestSize < w * h * 0.15 || bestSize > w * h * 0.97) return null;
    // 极值点法求四角
    let tl = { v: 1e9 }, br = { v: -1e9 }, tr = { v: -1e9 }, bl = { v: 1e9 };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (label[y * w + x] !== bestLabel) continue;
      const s = x + y, d = x - y;
      if (s < tl.v) tl = { x, y, v: s }; if (s > br.v) br = { x, y, v: s }; if (d > tr.v) tr = { x, y, v: d }; if (d < bl.v) bl = { x, y, v: d };
    }
    const q = [[tl.x, tl.y], [tr.x, tr.y], [br.x, br.y], [bl.x, bl.y]];
    if (q.some((p) => p[0] == null)) return null;
    return { q, size: bestSize };
  };
  // 优先假设“纸比背景亮”；其次反过来
  const res = tryMask(true) || tryMask(false);
  if (!res) return null;
  const q = res.q.map(([x, y]) => [x / k, y / k]);
  // 面积 / 凸性简单校验
  const area = Math.abs(polyArea(q));
  if (area < src.width * src.height * 0.12) return null;
  return q;
}
function polyArea(q) { let a = 0; for (let i = 0; i < 4; i++) { const [x1, y1] = q[i], [x2, y2] = q[(i + 1) % 4]; a += x1 * y2 - x2 * y1; } return a / 2; }
function boxBlur(data, w, h, r) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) { let acc = 0, cnt = 0; for (let x = -r; x <= r; x++) if (x >= 0 && x < w) { acc += data[y * w + x]; cnt++; }
    for (let x = 0; x < w; x++) { tmp[y * w + x] = acc / cnt; const a = x - r, b = x + r + 1; if (a >= 0) { acc -= data[y * w + a]; cnt--; } if (b < w) { acc += data[y * w + b]; cnt++; } } }
  for (let x = 0; x < w; x++) { let acc = 0, cnt = 0; for (let y = -r; y <= r; y++) if (y >= 0 && y < h) { acc += tmp[y * w + x]; cnt++; }
    for (let y = 0; y < h; y++) { out[y * w + x] = acc / cnt; const a = y - r, b = y + r + 1; if (a >= 0) { acc -= tmp[a * w + x]; cnt--; } if (b < h) { acc += tmp[b * w + x]; cnt++; } } }
  return out;
}

/* ───────── 透视变换 ───────── */
function solveHomography(dst, src) { // dst(x,y) -> src(x',y')，返回 8 个系数
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], [u, v] = src[i];
    A.push([x, y, 1, 0, 0, 0, -x * u, -y * u]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -x * v, -y * v]); b.push(v);
  }
  const n = 8;
  for (let i = 0; i < n; i++) {
    let m = i; for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[m][i])) m = r;
    [A[i], A[m]] = [A[m], A[i]]; [b[i], b[m]] = [b[m], b[i]];
    for (let r = i + 1; r < n; r++) { const f = A[r][i] / A[i][i]; for (let c = i; c < n; c++) A[r][c] -= f * A[i][c]; b[r] -= f * b[i]; }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) { let s = b[i]; for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c]; x[i] = s / A[i][i]; }
  return x;
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** 将 quad 区域拉直成矩形，maxSide 限制输出最长边 */
export function warpQuad(src, quad, maxSide = 2200) {
  const [tl, tr, br, bl] = quad;
  let W = Math.max(dist(tl, tr), dist(bl, br)), H = Math.max(dist(tl, bl), dist(tr, br));
  const k = Math.min(1, maxSide / Math.max(W, H)); W = Math.max(2, Math.round(W * k)); H = Math.max(2, Math.round(H * k));
  const hm = solveHomography([[0, 0], [W, 0], [W, H], [0, H]], quad);
  const sctx = src.getContext('2d'); const sw = src.width, sh = src.height; const sd = sctx.getImageData(0, 0, sw, sh).data;
  const out = new ImageData(W, H); const od = out.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const px = x + 0.5, py = y + 0.5; const d = hm[6] * px + hm[7] * py + 1;
      const u = (hm[0] * px + hm[1] * py + hm[2]) / d - 0.5, v = (hm[3] * px + hm[4] * py + hm[5]) / d - 0.5;
      const x0 = Math.floor(u), y0 = Math.floor(v), fx = u - x0, fy = v - y0; const o = (y * W + x) * 4;
      if (x0 < 0 || y0 < 0 || x0 >= sw - 1 || y0 >= sh - 1) { // 边缘夹取
        const cx = Math.min(sw - 1, Math.max(0, Math.round(u))), cy = Math.min(sh - 1, Math.max(0, Math.round(v))), i = (cy * sw + cx) * 4;
        od[o] = sd[i]; od[o + 1] = sd[i + 1]; od[o + 2] = sd[i + 2]; od[o + 3] = 255; continue;
      }
      const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
      od[o] = sd[i00] * w00 + sd[i10] * w10 + sd[i01] * w01 + sd[i11] * w11;
      od[o + 1] = sd[i00 + 1] * w00 + sd[i10 + 1] * w10 + sd[i01 + 1] * w01 + sd[i11 + 1] * w11;
      od[o + 2] = sd[i00 + 2] * w00 + sd[i10 + 2] * w10 + sd[i01 + 2] * w01 + sd[i11 + 2] * w11;
      od[o + 3] = 255;
    }
  }
  const c = makeCanvas(W, H); c.getContext('2d').putImageData(out, 0, 0); return c;
}

/* ───────── 图像增强 ───────── */
/** 估计每个像素处的“纸张背景亮度”：缩小 → 膨胀(取局部最大) → 模糊 → 放大。返回 [r,g,b] 三个 Float32Array(w*h) 或灰度 */
function estimateBackground(c, gray) {
  const k = 1 / 10, sw = Math.max(4, Math.round(c.width * k)), sh = Math.max(4, Math.round(c.height * k));
  const s = makeCanvas(sw, sh); const g = s.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(c, 0, 0, sw, sh);
  const d = g.getImageData(0, 0, sw, sh).data; const chans = gray ? 1 : 3; const planes = [];
  for (let ch = 0; ch < chans; ch++) {
    let p = new Float32Array(sw * sh);
    for (let i = 0; i < sw * sh; i++) p[i] = gray ? 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2] : d[i * 4 + ch];
    p = dilate(dilate(p, sw, sh), sw, sh); p = boxBlur(p, sw, sh, 2);
    planes.push(p);
  }
  // 放大回原尺寸（用 canvas 双线性插值）
  const outPlanes = [];
  const bgSmall = makeCanvas(sw, sh); const bg = bgSmall.getContext('2d'); const im = bg.createImageData(sw, sh);
  for (let i = 0; i < sw * sh; i++) { im.data[i * 4] = planes[0][i]; im.data[i * 4 + 1] = planes[gray ? 0 : 1][i]; im.data[i * 4 + 2] = planes[gray ? 0 : 2][i]; im.data[i * 4 + 3] = 255; }
  bg.putImageData(im, 0, 0);
  const big = makeCanvas(c.width, c.height); const bgc = big.getContext('2d'); bgc.imageSmoothingEnabled = true; bgc.imageSmoothingQuality = 'high'; bgc.drawImage(bgSmall, 0, 0, c.width, c.height);
  return bgc.getImageData(0, 0, c.width, c.height).data;
}
function dilate(p, w, h) {
  const o = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let m = 0; for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= h) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= w) continue; const v = p[yy * w + xx]; if (v > m) m = v; } } o[y * w + x] = m; }
  return o;
}

/** filter: original | magic | bw | gray ；brightness -100..100，contrast -100..100，thr 0.5..0.95 */
export function applyFilter(src, { filter = 'magic', brightness = 0, contrast = 0, thr = 0.82 } = {}) {
  const out = makeCanvas(src.width, src.height); const g = out.getContext('2d'); g.drawImage(src, 0, 0);
  const id = g.getImageData(0, 0, out.width, out.height); const d = id.data; const n = out.width * out.height;
  const cf = 1 + contrast / 100, bo = brightness * 1.6;
  const adj = (v) => Math.max(0, Math.min(255, (v - 128) * cf + 128 + bo));
  if (filter === 'magic') {
    const bg = estimateBackground(src, false);
    for (let i = 0; i < n; i++) { const o = i * 4;
      for (let ch = 0; ch < 3; ch++) { const r = d[o + ch] / Math.max(30, bg[o + ch]); let v = Math.min(1, r * 1.04); v = Math.pow(v, 1.35); d[o + ch] = adj(v * 255); } }
  } else if (filter === 'bw') {
    const bg = estimateBackground(src, true);
    const lo = thr - 0.1, hi = thr + 0.03;
    for (let i = 0; i < n; i++) { const o = i * 4; const gy = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]; const r = gy / Math.max(30, bg[o]);
      let t = (r - lo) / (hi - lo); t = t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t); const v = adj(t * 255); d[o] = d[o + 1] = d[o + 2] = v; }
  } else if (filter === 'gray') {
    const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) { const o = i * 4; const gy = (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) | 0; d[o] = d[o + 1] = d[o + 2] = gy; hist[gy]++; }
    let acc = 0, lo = 0, hi = 255; for (let i = 0; i < 256; i++) { acc += hist[i]; if (acc > n * 0.01) { lo = i; break; } } acc = 0; for (let i = 255; i >= 0; i--) { acc += hist[i]; if (acc > n * 0.01) { hi = i; break; } }
    const sc = 255 / Math.max(1, hi - lo);
    for (let i = 0; i < n; i++) { const o = i * 4; const v = adj((d[o] - lo) * sc); d[o] = d[o + 1] = d[o + 2] = v; }
  } else if (brightness || contrast) {
    for (let i = 0; i < n; i++) { const o = i * 4; d[o] = adj(d[o]); d[o + 1] = adj(d[o + 1]); d[o + 2] = adj(d[o + 2]); }
  }
  g.putImageData(id, 0, 0);
  return out;
}
export function rotateCanvas(c, deg) {
  deg = ((deg % 360) + 360) % 360; if (!deg) return c;
  const swap = deg % 180 !== 0; const o = makeCanvas(swap ? c.height : c.width, swap ? c.width : c.height); const g = o.getContext('2d');
  g.translate(o.width / 2, o.height / 2); g.rotate((deg * Math.PI) / 180); g.drawImage(c, -c.width / 2, -c.height / 2); return o;
}
