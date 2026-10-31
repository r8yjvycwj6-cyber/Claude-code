'use strict';
// 音视频转换任务：上传 -> 排队 -> ffmpeg -> 下载。全部用 spawn 数组传参，不经过 shell。
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');
const multer = require('multer');
const bins = require('./bins');

const MAX_PARALLEL = Number(process.env.MEDIA_PARALLEL || 2);
const MAX_PER_USER = 3;
const TTL_MS = 60 * 60 * 1000;

const VIDEO_FORMATS = {
  mp4:  { ext: 'mp4',  v: ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'], a: ['-c:a', 'aac'], extra: ['-movflags', '+faststart'] },
  mkv:  { ext: 'mkv',  v: ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'], a: ['-c:a', 'aac'] },
  mov:  { ext: 'mov',  v: ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'], a: ['-c:a', 'aac'] },
  webm: { ext: 'webm', v: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '5'], a: ['-c:a', 'libopus'] },
  avi:  { ext: 'avi',  v: ['-c:v', 'mpeg4', '-vtag', 'xvid'], a: ['-c:a', 'libmp3lame'], qv: true },
  flv:  { ext: 'flv',  v: ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'], a: ['-c:a', 'aac'] },
  wmv:  { ext: 'wmv',  v: ['-c:v', 'wmv2'], a: ['-c:a', 'wmav2'], qv: true },
  ts:   { ext: 'ts',   v: ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p'], a: ['-c:a', 'aac'] },
  '3gp':{ ext: '3gp',  v: ['-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-profile:v', 'baseline'], a: ['-c:a', 'aac', '-ar', '44100', '-ac', '2'] },
  mpg:  { ext: 'mpg',  v: ['-c:v', 'mpeg2video'], a: ['-c:a', 'mp2'], qv: true },
};
const AUDIO_FORMATS = {
  mp3:  { ext: 'mp3',  args: ['-c:a', 'libmp3lame'], lossy: true },
  aac:  { ext: 'aac',  args: ['-c:a', 'aac', '-f', 'adts'], lossy: true },
  m4a:  { ext: 'm4a',  args: ['-c:a', 'aac'], lossy: true },
  ogg:  { ext: 'ogg',  args: ['-c:a', 'libvorbis'], lossy: true },
  opus: { ext: 'opus', args: ['-c:a', 'libopus'], lossy: true },
  wma:  { ext: 'wma',  args: ['-c:a', 'wmav2'], lossy: true },
  wav:  { ext: 'wav',  args: ['-c:a', 'pcm_s16le'] },
  flac: { ext: 'flac', args: ['-c:a', 'flac'] },
  aiff: { ext: 'aiff', args: ['-c:a', 'pcm_s16be'] },
};
const CRF = { high: 20, medium: 25, low: 30 };           // x264
const CRF_VP9 = { high: 28, medium: 33, low: 38 };
const QV = { high: 3, medium: 6, low: 10 };              // mpeg4/wmv2 的 qscale
const HEIGHTS = new Set(['480', '720', '1080', '1440', '2160', '360', '240']);

const jobs = new Map();
const queue = [];
let running = 0;

const jobDirRoot = (dataDir) => path.join(dataDir, 'tmp');
const num = (v, min, max, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def; };
const safeBase = (name) => (path.parse(String(name || 'file')).name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').slice(0, 80) || 'file');

function probe(file) {
  return new Promise((resolve) => {
    if (!bins.ffprobe) return resolve(null);
    execFile(bins.ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeout: 30000, maxBuffer: 8e6 }, (err, out) => {
      if (err) return resolve(null);
      try { resolve(JSON.parse(out)); } catch { resolve(null); }
    });
  });
}

function buildArgs(op, p, info, input, output) {
  const hasVideo = info.streams.some((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const hasAudio = info.streams.some((s) => s.codec_type === 'audio');
  const args = ['-y', '-hide_banner', '-nostdin', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats'];
  let ss = p.start > 0 ? p.start : 0;
  let to = p.end > 0 ? p.end : 0;
  const cut = op === 'trim' || op === 'gif';
  if (cut && ss) args.push('-ss', String(ss));
  args.push('-i', input);
  if (cut && to) args.push('-t', String(Math.max(0.1, to - ss)));
  else if (op === 'gif' && Number(info.format && info.format.duration) - ss > 20) args.push('-t', '15'); // GIF 默认最多 15 秒
  const q = ['high', 'medium', 'low'].includes(p.quality) ? p.quality : 'medium';

  const audioOnlyOut = (fmtKey) => {
    const f = AUDIO_FORMATS[fmtKey];
    args.push('-vn', ...f.args);
    if (f.lossy) args.push('-b:a', num(p.audioBitrate, 32, 320, 192) + 'k');
    if (p.sampleRate) args.push('-ar', String(num(p.sampleRate, 8000, 96000, 44100)));
    if (p.channels) args.push('-ac', String(num(p.channels, 1, 2, 2)));
    if (p.volume && Number(p.volume) !== 1) args.push('-filter:a', `volume=${num(p.volume, 0.1, 4, 1)}`);
    args.push(output);
    return AUDIO_FORMATS[fmtKey].ext;
  };

  if (op === 'audio' || (op === 'trim' && (!hasVideo || p.format in AUDIO_FORMATS))) {
    if (!hasAudio) throw new Error('该文件中没有音频轨道');
    const fmt = p.format in AUDIO_FORMATS ? p.format : 'mp3';
    return { args, ext: audioOnlyOut(fmt) };
  }
  if (!hasVideo) throw new Error('该文件中没有视频轨道');

  if (op === 'gif') {
    const fps = num(p.fps, 1, 30, 12);
    const w = num(p.width, 80, 1280, 480);
    const filter = `fps=${fps},scale='min(${w},iw)':-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`;
    args.push('-an', '-filter_complex', filter, '-loop', '0', output);
    return { args, ext: 'gif' };
  }

  const f = p.format in VIDEO_FORMATS ? p.format : 'mp4';
  const spec = VIDEO_FORMATS[f];
  const vf = [];
  let vcodec = spec.v.slice();
  if (op === 'compress' && p.codec === 'h265' && ['mp4', 'mkv', 'mov'].includes(f)) {
    vcodec = ['-c:v', 'libx265', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1'];
  }
  args.push(...vcodec);
  const isX265 = vcodec.includes('libx265');
  if (spec.qv) args.push('-q:v', String(QV[q]));
  else if (f === 'webm') args.push('-crf', String(CRF_VP9[q]));
  else if (isX265) args.push('-crf', String(CRF[q] + 5));
  else args.push('-crf', String(op === 'compress' ? CRF[q] + 4 : CRF[q]));
  if (p.height && HEIGHTS.has(String(p.height))) vf.push(`scale=-2:'min(${p.height},ih)'`);
  else vf.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  if (p.fps) vf.push(`fps=${num(p.fps, 1, 120, 30)}`);
  args.push('-vf', vf.join(','));
  if (p.mute === true || p.mute === 'true' || !hasAudio) args.push('-an');
  else {
    args.push(...spec.a, '-b:a', (op === 'compress' ? '96' : String(num(p.audioBitrate, 64, 320, 160))) + 'k');
  }
  if (spec.extra) args.push(...spec.extra);
  args.push(output);
  return { args, ext: spec.ext };
}

function pump() {
  while (running < MAX_PARALLEL && queue.length) {
    const job = queue.shift();
    if (job.status !== 'queued') continue;
    running++;
    run(job).finally(() => { running--; pump(); });
  }
}

async function run(job) {
  job.status = 'running';
  const { args } = job;
  const child = spawn(bins.ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  job.child = child;
  let buf = '', errBuf = '';
  child.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
      if (m && job.duration) job.progress = Math.min(0.99, Number(m[1]) / 1e6 / job.duration);
      if (line === 'speed=N/A') continue;
      const sp = /^speed=([\d.]+)x/.exec(line);
      if (sp) job.speed = Number(sp[1]);
    }
  });
  child.stderr.on('data', (d) => { errBuf = (errBuf + d).slice(-2000); });
  await new Promise((resolve) => {
    child.on('error', (e) => { job.status = 'error'; job.error = '无法启动 ffmpeg：' + e.message; resolve(); });
    child.on('close', (code) => {
      if (job.status === 'canceled') return resolve();
      if (code === 0 && fs.existsSync(job.outFile)) {
        job.status = 'done'; job.progress = 1; job.size = fs.statSync(job.outFile).size;
      } else { job.status = 'error'; job.error = (errBuf.trim().split('\n').slice(-3).join(' ') || `ffmpeg 退出码 ${code}`).slice(0, 400); }
      fs.rm(job.inFile, { force: true }, () => {});
      resolve();
    });
  });
  job.child = null;
}

function cleanup(dataDir) {
  const root = jobDirRoot(dataDir);
  const t = Date.now();
  for (const [id, job] of jobs) {
    if (t - job.created > TTL_MS && job.status !== 'running') {
      fs.rm(job.dir, { recursive: true, force: true }, () => {});
      jobs.delete(id);
    }
  }
}

function setup(app, { dataDir, requireAuth, maxUploadMB }) {
  const root = jobDirRoot(dataDir);
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  setInterval(() => cleanup(dataDir), 5 * 60e3).unref();

  const upload = multer({
    storage: multer.diskStorage({
      destination(req, _file, cb) {
        req.jobId = crypto.randomBytes(12).toString('hex');
        const dir = path.join(root, req.jobId);
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
      },
      filename(_req, file, cb) {
        const ext = (path.extname(file.originalname).slice(1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin').slice(0, 6);
        cb(null, 'in.' + ext);
      },
    }),
    limits: { fileSize: maxUploadMB * 1024 * 1024, files: 1 },
  });

  const owner = (req) => (req.user ? req.user.id : 'anon:' + req.ip);
  const find = (req, res) => {
    const job = jobs.get(String(req.params.id));
    if (!job || job.owner !== owner(req)) { res.status(404).json({ error: '任务不存在或已过期' }); return null; }
    return job;
  };

  app.post('/api/media/convert', requireAuth, (req, res, next) => {
    if (!bins.ffmpeg) return res.status(503).json({ error: '服务器未安装 ffmpeg，无法转换。请安装 ffmpeg 或执行 npm i ffmpeg-static' });
    const mine = [...jobs.values()].filter((j) => j.owner === owner(req) && ['queued', 'running'].includes(j.status)).length;
    if (mine >= MAX_PER_USER) return res.status(429).json({ error: `同时最多处理 ${MAX_PER_USER} 个任务，请等待完成后再提交` });
    upload.single('file')(req, res, (err) => {
      if (err) {
        if (req.jobId) fs.rm(path.join(root, req.jobId), { recursive: true, force: true }, () => {});
        return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `文件超过 ${maxUploadMB}MB 上限` : '上传失败：' + err.message });
      }
      next();
    });
  }, async (req, res) => {
    const dir = path.join(root, req.jobId || 'x');
    const fail = (code, msg) => { fs.rm(dir, { recursive: true, force: true }, () => {}); return res.status(code).json({ error: msg }); };
    if (!req.file) return fail(400, '请选择要处理的文件');
    const op = ['convert', 'compress', 'gif', 'audio', 'trim'].includes(req.body.op) ? req.body.op : 'convert';
    const info = await probe(req.file.path);
    if (!info || !info.streams || !info.streams.length) return fail(400, '无法识别该文件，可能不是有效的音视频文件');
    const p = {
      format: String(req.body.format || ''), quality: req.body.quality, height: req.body.height, fps: req.body.fps,
      audioBitrate: req.body.audioBitrate, sampleRate: req.body.sampleRate, channels: req.body.channels,
      volume: req.body.volume, mute: req.body.mute, codec: req.body.codec, width: req.body.width,
      start: num(req.body.start, 0, 1e6, 0), end: num(req.body.end, 0, 1e6, 0),
    };
    let built;
    const outTmp = path.join(dir, 'out');
    try {
      built = buildArgs(op, p, info, req.file.path, outTmp + '.__ext__');
    } catch (e) { return fail(400, e.message); }
    const outFile = outTmp + '.' + built.ext;
    built.args[built.args.length - 1] = outFile;
    let duration = Number(info.format && info.format.duration) || 0;
    if (op === 'trim' || op === 'gif') {
      duration = (p.end || duration) - p.start;
      if (op === 'gif' && !p.end && duration > 20) duration = 15;
    }
    const job = {
      id: req.jobId, owner: owner(req), status: 'queued', progress: 0, created: Date.now(), dir,
      inFile: req.file.path, outFile, args: built.args, duration: Math.max(duration, 0.1),
      outName: `${safeBase(req.file.originalname)}${op === 'compress' ? '_compressed' : ''}.${built.ext}`,
      inSize: req.file.size, inName: req.file.originalname,
      info: { duration, streams: info.streams.map((s) => ({ type: s.codec_type, codec: s.codec_name, w: s.width, h: s.height })) },
    };
    jobs.set(job.id, job);
    queue.push(job);
    pump();
    res.json({ id: job.id, info: job.info });
  });

  const view = (j) => ({ id: j.id, status: j.status, progress: j.progress, error: j.error, size: j.size, name: j.outName, inSize: j.inSize, speed: j.speed, queuePos: j.status === 'queued' ? queue.indexOf(j) + 1 : 0 });
  app.get('/api/media/jobs/:id', (req, res) => { const j = find(req, res); if (j) res.json(view(j)); });
  app.get('/api/media/jobs/:id/download', (req, res) => {
    const j = find(req, res);
    if (!j) return;
    if (j.status !== 'done') return res.status(409).json({ error: '任务尚未完成' });
    res.download(j.outFile, j.outName);
  });
  app.delete('/api/media/jobs/:id', (req, res) => {
    const j = find(req, res);
    if (!j) return;
    if (j.child) { j.status = 'canceled'; j.child.kill('SIGKILL'); }
    j.status = 'canceled';
    fs.rm(j.dir, { recursive: true, force: true }, () => {});
    jobs.delete(j.id);
    res.json({ ok: true });
  });
}
module.exports = { setup };
