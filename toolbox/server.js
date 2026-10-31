'use strict';
const express = require('express');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { createAuth } = require('./lib/auth');
const bins = require('./lib/bins');
const { CATEGORIES, TOOLS } = require('./lib/tools');

const PORT = Number(process.env.PORT || 2600);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 500);
// 需要服务端算力的工具（音视频 / Office 转换）是否必须登录，设为 0 可关闭
const REQUIRE_LOGIN = process.env.REQUIRE_LOGIN !== '0';

fs.mkdirSync(DATA_DIR, { recursive: true });
const app = express();
app.disable('x-powered-by');
if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : process.env.TRUST_PROXY);

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'", "script-src 'self' 'wasm-unsafe-eval' blob:", "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "media-src 'self' blob: data:",
    "connect-src 'self' blob: data:", "font-src 'self' data:", "frame-src 'self' blob:",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'",
  ].join('; '));
  next();
});

// 基础 CSRF 防护：跨站来源的写请求一律拒绝（Cookie 另外带 SameSite=Lax）
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    try { if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: '非法来源' }); }
    catch { return res.status(403).json({ error: '非法来源' }); }
  }
  next();
});

app.use(express.json({ limit: '25mb' }));
const toolIds = new Set(TOOLS.map((t) => t.id));
const auth = createAuth(DATA_DIR, { isToolId: (id) => toolIds.has(id) });
app.use(auth.attach);
auth.routes(app);

const requireAuth = REQUIRE_LOGIN ? auth.requireUser : (_req, _res, next) => next();
require('./lib/media').setup(app, { dataDir: DATA_DIR, requireAuth, maxUploadMB: MAX_UPLOAD_MB });
require('./lib/office').setup(app, { dataDir: DATA_DIR, requireAuth, maxUploadMB: MAX_UPLOAD_MB });

app.get('/api/tools', (_req, res) => res.json({ categories: CATEGORIES, tools: TOOLS }));
app.get('/api/health', (_req, res) => res.json({
  ok: true, requireLogin: REQUIRE_LOGIN, maxUploadMB: MAX_UPLOAD_MB,
  capabilities: { media: !!bins.ffmpeg, office: !!bins.soffice },
}));

// 二维码生成（服务端渲染，前端直接当图片用）
app.get('/api/qr', async (req, res) => {
  const text = String(req.query.text || '');
  if (!text || text.length > 2000) return res.status(400).json({ error: '内容为空或过长（最多 2000 字符）' });
  const hex = (v, d) => (/^[0-9a-fA-F]{6}$/.test(String(v)) ? '#' + v : d);
  const opts = {
    errorCorrectionLevel: ['L', 'M', 'Q', 'H'].includes(req.query.ec) ? req.query.ec : 'M',
    margin: Math.min(10, Math.max(0, Number(req.query.margin ?? 2))),
    width: Math.min(2000, Math.max(100, Number(req.query.size || 512))),
    color: { dark: hex(req.query.fg, '#000000'), light: hex(req.query.bg, '#ffffff') },
  };
  try {
    if (req.query.format === 'svg') {
      res.type('image/svg+xml').send(await QRCode.toString(text, { ...opts, type: 'svg' }));
    } else {
      res.type('image/png').send(await QRCode.toBuffer(text, opts));
    }
  } catch (e) { res.status(400).json({ error: '内容过长，无法生成二维码' }); }
});

// 第三方前端库：直接从 node_modules 提供，不依赖任何外部 CDN（国内网络同样可用）
const NM = path.join(__dirname, 'node_modules');
const vendor = {
  'pdf-lib': 'pdf-lib/dist', pdfjs: 'pdfjs-dist/build', 'pdfjs-cmaps': 'pdfjs-dist/cmaps', 'pdfjs-fonts': 'pdfjs-dist/standard_fonts', 'pdfjs-wasm': 'pdfjs-dist/wasm',
  tesseract: 'tesseract.js/dist', 'tesseract-core': 'tesseract.js-core', pptxgenjs: 'pptxgenjs/dist', jsqr: 'jsqr/dist',
  marked: 'marked/lib', opencc: 'opencc-js/dist/umd', 'pinyin-pro': 'pinyin-pro/dist', xlsx: 'xlsx/dist', jszip: 'jszip/dist', diff: 'diff/dist',
};
for (const [name, dir] of Object.entries(vendor)) {
  app.use('/vendor/' + name, express.static(path.join(NM, dir), { maxAge: '7d', index: false, dotfiles: 'ignore' }));
}
app.get('/vendor/mammoth/mammoth.browser.min.js', (_req, res) => res.sendFile(path.join(NM, 'mammoth/mammoth.browser.min.js'), { maxAge: '7d' }));
const tessDirs = ['eng', 'chi_sim'].map((l) => path.join(NM, '@tesseract.js-data', l, '4.0.0_best_int'));
app.get('/vendor/tessdata/:file', (req, res) => {
  const f = path.basename(req.params.file);
  for (const d of tessDirs) {
    const p = path.join(d, f);
    if (fs.existsSync(p)) { res.setHeader('Cache-Control', 'public, max-age=604800'); return res.sendFile(p, { headers: { 'Content-Type': 'application/gzip' } }); }
  }
  res.status(404).end();
});
app.use('/icons', express.static(path.join(NM, 'lucide-static/icons'), { maxAge: '30d', index: false }));

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], setHeaders(res, p) {
  if (/\.(js|css|html)$/.test(p)) res.setHeader('Cache-Control', 'no-cache');
} }));

app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));
// SPA 回退
app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  if (err.type === 'entity.too.large') return res.status(413).json({ error: '内容过大' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: '请求格式错误' });
  res.status(500).json({ error: '服务器内部错误' });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`\n  工具箱已启动  http://localhost:${PORT}`);
  console.log(`  ffmpeg      : ${bins.ffmpeg ? '✔ ' + bins.ffmpeg : '✘ 未找到（音视频转换不可用）'}`);
  console.log(`  LibreOffice : ${bins.soffice ? '✔ ' + bins.soffice : '✘ 未找到（Office 文档转换不可用）'}`);
  console.log(`  服务端工具登录：${REQUIRE_LOGIN ? '需要' : '不需要'}   数据目录：${DATA_DIR}\n`);
});
const shutdown = () => { auth.flush(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 1500).unref(); };
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
