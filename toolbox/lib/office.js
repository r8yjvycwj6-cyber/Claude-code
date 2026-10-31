'use strict';
// 借助 LibreOffice 做 Office 文档互转，以及把编辑器 HTML 导出为 .docx
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const crypto = require('crypto');
const { spawn } = require('child_process');
const multer = require('multer');
const bins = require('./bins');

const TARGETS = {
  pdf:  { filter: 'pdf', ext: 'pdf' },
  docx: { filter: 'docx', ext: 'docx' },
  doc:  { filter: 'doc', ext: 'doc' },
  odt:  { filter: 'odt', ext: 'odt' },
  rtf:  { filter: 'rtf', ext: 'rtf' },
  txt:  { filter: 'txt:Text', ext: 'txt' },
  html: { filter: 'html', ext: 'html' },
  xlsx: { filter: 'xlsx', ext: 'xlsx' },
  xls:  { filter: 'xls', ext: 'xls' },
  csv:  { filter: 'csv', ext: 'csv' },
  ods:  { filter: 'ods', ext: 'ods' },
  pptx: { filter: 'pptx', ext: 'pptx' },
  ppt:  { filter: 'ppt', ext: 'ppt' },
  odp:  { filter: 'odp', ext: 'odp' },
  png:  { filter: 'png', ext: 'png' },
};
const IN_EXT = new Set(['doc', 'docx', 'odt', 'rtf', 'txt', 'html', 'htm', 'xls', 'xlsx', 'ods', 'csv', 'ppt', 'pptx', 'odp', 'pdf', 'wps', 'et', 'dps', 'md']);
const PDF_IMPORT = { docx: 'writer_pdf_import', doc: 'writer_pdf_import', odt: 'writer_pdf_import', rtf: 'writer_pdf_import', txt: 'writer_pdf_import', html: 'writer_pdf_import', pptx: 'impress_pdf_import', ppt: 'impress_pdf_import', odp: 'impress_pdf_import' };

let active = 0;
const waiters = [];
const MAX = Number(process.env.OFFICE_PARALLEL || 2);
const acquire = () => new Promise((r) => { if (active < MAX) { active++; r(); } else waiters.push(r); });
const release = () => { const n = waiters.shift(); if (n) n(); else active--; };

function convert(inFile, outDir, target, inExt) {
  const t = TARGETS[target];
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lo-'));
  const args = ['--headless', '--norestore', '--nolockcheck', '--nodefault', '--nologo', `-env:UserInstallation=${pathToFileURL(profile).href}`];
  if (inExt === 'pdf' && PDF_IMPORT[target]) args.push(`--infilter=${PDF_IMPORT[target]}`);
  else if (inExt === 'pdf') args.push('--infilter=writer_pdf_import');
  args.push('--convert-to', t.filter, '--outdir', outDir, inFile);
  return new Promise((resolve, reject) => {
    const child = spawn(bins.soffice, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-1000); });
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('转换超时（3 分钟），文件可能过大或过于复杂')); }, 180000);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', () => {
      clearTimeout(timer);
      fs.rm(profile, { recursive: true, force: true }, () => {});
      const out = path.join(outDir, path.parse(inFile).name + '.' + t.ext);
      if (fs.existsSync(out)) resolve(out); else reject(new Error('转换失败：' + (err.trim() || '该文件格式不受支持或文件已损坏')));
    });
  });
}

function sanitizeHtml(html) {
  // 服务端不允许抓取外部图片（防 SSRF），只保留 data: 图片；移除脚本与事件属性
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/<img\b[^>]*>/gi, (tag) => (/\ssrc\s*=\s*["']data:image\/(png|jpe?g|gif|webp);base64,/i.test(tag) ? tag : ''))
    .replace(/<(iframe|object|embed|link|meta|base)\b[^>]*>/gi, '');
}

function setup(app, { dataDir, requireAuth, maxUploadMB }) {
  const root = path.join(dataDir, 'office');
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination(req, _f, cb) { req.jobDir = path.join(root, crypto.randomBytes(10).toString('hex')); fs.mkdirSync(req.jobDir, { recursive: true }); cb(null, req.jobDir); },
      filename(_req, file, cb) { cb(null, 'in.' + (path.extname(file.originalname).slice(1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin')); },
    }),
    limits: { fileSize: Math.min(maxUploadMB, 200) * 1024 * 1024, files: 1 },
  });

  app.post('/api/office/convert', requireAuth, (req, res, next) => {
    if (!bins.soffice) return res.status(503).json({ error: '服务器未安装 LibreOffice，无法进行 Office 文档转换。请安装后重启服务（https://www.libreoffice.org）' });
    upload.single('file')(req, res, (err) => {
      if (err) { if (req.jobDir) fs.rm(req.jobDir, { recursive: true, force: true }, () => {}); return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? '文件过大' : '上传失败' }); }
      next();
    });
  }, async (req, res) => {
    const dir = req.jobDir;
    const done = () => fs.rm(dir, { recursive: true, force: true }, () => {});
    try {
      if (!req.file) throw Object.assign(new Error('请选择文件'), { status: 400 });
      const inExt = path.extname(req.file.path).slice(1);
      const target = String(req.body.target || 'pdf');
      if (!TARGETS[target]) throw Object.assign(new Error('不支持的目标格式'), { status: 400 });
      if (!IN_EXT.has(inExt)) throw Object.assign(new Error('不支持的文件类型：.' + inExt), { status: 400 });
      await acquire();
      let out;
      try { out = await convert(req.file.path, dir, target, inExt); } finally { release(); }
      const base = path.parse(req.file.originalname).name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_') || 'document';
      res.download(out, `${base}.${TARGETS[target].ext}`, () => done());
    } catch (e) { done(); res.status(e.status || 500).json({ error: e.message }); }
  });

  app.post('/api/office/html-to-docx', async (req, res) => {
    try {
      const html = sanitizeHtml(req.body?.html || '');
      if (!html.trim()) return res.status(400).json({ error: '文档内容为空' });
      const HTMLtoDOCX = require('html-to-docx');
      const full = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
      const buf = await HTMLtoDOCX(full, null, {
        table: { row: { cantSplit: true } }, footer: false, pageNumber: false,
        font: 'Microsoft YaHei', fontSize: 22, lang: 'zh-CN',
      });
      const name = String(req.body?.title || '文档').replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 60) || '文档';
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(name)}.docx`);
      res.send(Buffer.from(buf));
    } catch (e) { console.error('[docx]', e); res.status(500).json({ error: '导出 Word 失败：' + e.message }); }
  });
}
module.exports = { setup };
