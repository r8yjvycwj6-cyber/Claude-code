import { h, $, mount, icon, dropzone, toast, download, fmtSize, fmtTime, field, seg, select, banner, spinner, progress, api, upload, range, checkbox, sleep, baseName, extOf } from '../ui.js';

const VIDEO_FMT = [['mp4', 'MP4（H.264，兼容性最好）'], ['mkv', 'MKV'], ['mov', 'MOV'], ['webm', 'WebM（VP9）'], ['avi', 'AVI'], ['flv', 'FLV'], ['wmv', 'WMV'], ['ts', 'TS'], ['3gp', '3GP'], ['mpg', 'MPG']];
const AUDIO_FMT = [['mp3', 'MP3'], ['aac', 'AAC'], ['m4a', 'M4A'], ['wav', 'WAV（无损）'], ['flac', 'FLAC（无损）'], ['ogg', 'OGG'], ['opus', 'Opus'], ['wma', 'WMA'], ['aiff', 'AIFF']];
const QUALITY = [['high', '高质量'], ['medium', '均衡'], ['low', '小体积']];
const HEIGHT = [['', '保持原始'], ['2160', '4K (2160p)'], ['1440', '2K (1440p)'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['360', '360p']];
const parseTime = (s) => { s = String(s).trim(); if (!s) return 0; const p = s.split(':').map(Number); if (p.some(isNaN)) return NaN; return p.reduce((a, v) => a * 60 + v, 0); };

/** cfg: {op, accept, title, hint, icon, options(state)->Node, extra?(file)->Node, params(state)->object, validate?, label} */
function serverTool(cfg) {
  return (root, ctx) => {
    let file = null, job = null, abort = null; const state = {};
    const area = h('div'); const dz = dropzone({ accept: cfg.accept, title: cfg.title, hint: cfg.hint || '支持 ' + ctx.health.maxUploadMB + 'MB 以内的文件，文件会上传到服务器处理，1 小时后自动删除', icon: cfg.icon, onFiles: ([f]) => pick(f) });
    mount(root, dz, area);
    const cleanupFns = [];
    function pick(f) {
      file = f; dz.hidden = true; const out = h('div'); const optBox = cfg.options(state, f, cleanupFns);
      const go = h('button.btn.primary.lg', { onclick: () => start(go, out) }, icon('play'), cfg.label || '开始转换');
      mount(area, h('div.col',
        h('div.file-item', h('div.fi-ico', icon(cfg.icon)), h('div.grow', h('div.fi-name.ellipsis', f.name), h('div.fi-meta', fmtSize(f.size))), h('button.btn.sm.ghost', { onclick: reset }, icon('x'), '更换')),
        cfg.preview && cfg.preview(f, state, cleanupFns), h('div.panel', optBox), h('div.row', go), out));
    }
    function reset() { abort?.abort(); cleanupFns.splice(0).forEach((fn) => fn()); file = null; dz.hidden = false; mount(area); }
    async function start(btn, out) {
      if (!ctx.requireLogin('音视频转换在服务器上处理，请先登录（仅需邮箱 + 密码）')) return;
      let params; try { params = cfg.params(state); } catch (e) { return toast(e.message, 'err'); }
      const fd = new FormData(); fd.append('op', cfg.op); for (const [k, v] of Object.entries(params)) if (v !== '' && v != null) fd.append(k, v); fd.append('file', file);
      btn.disabled = true; abort = new AbortController();
      const bar = progress(); const stat = h('span.muted.small', '正在上传…'); const cancel = h('button.btn.sm.danger', { onclick: () => { abort.abort(); if (job) api('/api/media/jobs/' + job, { method: 'DELETE' }).catch(() => {}); mount(out); btn.disabled = false; job = null; } }, '取消');
      mount(out, h('div.panel.col', h('div.row', spinner(), stat, h('div.sp'), cancel), bar));
      try {
        const r = await upload('/api/media/convert', fd, { signal: abort.signal, onProgress: (p) => { bar.set(p * 0.3); stat.textContent = `正在上传 ${Math.round(p * 100)}%`; } });
        job = r.id; bar.set(0); stat.textContent = '排队中…';
        for (;;) {
          await sleep(600); if (abort.signal.aborted) return;
          const s = await api('/api/media/jobs/' + job, { signal: abort.signal });
          if (s.status === 'queued') stat.textContent = `排队中（前面还有 ${Math.max(0, s.queuePos - 1)} 个任务）…`;
          else if (s.status === 'running') { bar.set(s.progress); stat.textContent = `转换中 ${Math.round(s.progress * 100)}%` + (s.speed ? `  ·  ${s.speed.toFixed(1)}x 速度` : ''); }
          else if (s.status === 'error') throw new Error(s.error || '转换失败');
          else if (s.status === 'done') {
            const url = `/api/media/jobs/${job}/download`;
            const ratio = s.size / s.inSize;
            mount(out, h('div.panel.col', h('div.row', icon('circle-check', ''), h('b', '转换完成')), h('div.row', h('span.chip', `原文件 ${fmtSize(s.inSize)}`), icon('arrow-right'), h('span.chip.ok', `${fmtSize(s.size)}`), cfg.op === 'compress' && h('span.chip.pri', ratio < 1 ? `减小 ${Math.round((1 - ratio) * 100)}%` : '体积未减小')),
              h('div.row', h('a.btn.primary', { href: url, download: s.name }, icon('download'), `下载 ${s.name}`), h('button.btn', { onclick: reset }, '处理另一个文件'))));
            btn.disabled = false; job = null; return;
          }
        }
      } catch (e) { if (e.name === 'AbortError') return; mount(out, banner('err', e.message)); btn.disabled = false; if (e.code === 'LOGIN_REQUIRED') ctx.requireLogin(); }
    }
    return () => { abort?.abort(); cleanupFns.splice(0).forEach((fn) => fn()); };
  };
}
const opt = (...kids) => h('div.col', ...kids);
const g = (...kids) => h('div.grid.g2', ...kids);

const videoConvert = serverTool({
  op: 'convert', accept: 'video/*,.mkv,.flv,.wmv,.ts,.rmvb,.avi,.3gp,.mpg,.mov,.m4v,.webm,.mp4', title: '选择要转换的视频', icon: 'film',
  options: (s) => { Object.assign(s, { format: 'mp4', quality: 'medium', height: '', fps: '', mute: false });
    return opt(g(field('输出格式', select(VIDEO_FMT, s.format, (v) => { s.format = v; })), field('画质', seg(QUALITY, s.quality, (v) => { s.quality = v; }))),
      g(field('分辨率', select(HEIGHT, s.height, (v) => { s.height = v; }), '只缩小不放大'), field('帧率', select([['', '保持原始'], ['60', '60 fps'], ['30', '30 fps'], ['24', '24 fps'], ['15', '15 fps']], s.fps, (v) => { s.fps = v; }))), checkbox('移除声音', false, (v) => { s.mute = v; })); },
  params: (s) => ({ format: s.format, quality: s.quality, height: s.height, fps: s.fps, mute: s.mute }),
});
const videoCompress = serverTool({
  op: 'compress', accept: 'video/*,.mkv,.flv,.wmv,.ts,.avi,.mov,.m4v,.webm,.mp4', title: '选择要压缩的视频', icon: 'minimize-2', label: '开始压缩',
  options: (s) => { Object.assign(s, { quality: 'medium', height: '1080', codec: 'h264', format: 'mp4' });
    return opt(g(field('压缩强度', seg([['high', '轻度（画质优先）'], ['medium', '标准'], ['low', '强力（体积优先）']], s.quality, (v) => { s.quality = v; })), field('编码', seg([['h264', 'H.264（通用）'], ['h265', 'H.265（更小，部分设备不兼容）']], s.codec, (v) => { s.codec = v; }))),
      field('最大分辨率', select(HEIGHT.slice(1).concat([['', '保持原始']]), s.height, (v) => { s.height = v; }), '超过该分辨率的视频会被等比缩小')); },
  params: (s) => ({ ...s }),
});
const videoGif = serverTool({
  op: 'gif', accept: 'video/*,.mkv,.avi,.mov,.webm,.mp4,.m4v', title: '选择视频生成 GIF', icon: 'image-play', label: '生成 GIF',
  hint: '默认截取前 15 秒；可设置起止时间',
  options: (s) => { Object.assign(s, { start: '0', end: '', width: '480', fps: '12' });
    return opt(g(field('开始时间', h('input.input', { value: s.start, placeholder: '0 或 0:05', oninput: (e) => { s.start = e.target.value; } }), '秒 或 分:秒'), field('结束时间', h('input.input', { value: s.end, placeholder: '留空 = 前 15 秒', oninput: (e) => { s.end = e.target.value; } }))),
      g(field('宽度', select([['320', '320 px'], ['480', '480 px'], ['640', '640 px'], ['800', '800 px']], s.width, (v) => { s.width = v; })), field('帧率', select([['8', '8 fps'], ['12', '12 fps'], ['15', '15 fps'], ['20', '20 fps']], s.fps, (v) => { s.fps = v; })))); },
  params: (s) => { const a = parseTime(s.start), b = parseTime(s.end); if (isNaN(a) || isNaN(b)) throw new Error('时间格式不正确'); if (b && b <= a) throw new Error('结束时间必须大于开始时间'); return { start: a, end: b, width: s.width, fps: s.fps }; },
});
const videoAudio = serverTool({
  op: 'audio', accept: 'video/*,audio/*,.mkv,.flv,.avi,.mov,.webm,.mp4,.m4v', title: '选择视频提取音频', icon: 'audio-lines', label: '提取音频',
  options: (s) => { Object.assign(s, { format: 'mp3', audioBitrate: '192' });
    return g(field('输出格式', select(AUDIO_FMT, s.format, (v) => { s.format = v; })), field('音质（有损格式）', select([['128', '128 kbps'], ['192', '192 kbps'], ['256', '256 kbps'], ['320', '320 kbps']], s.audioBitrate, (v) => { s.audioBitrate = v; }))); },
  params: (s) => ({ ...s }),
});
const audioConvert = serverTool({
  op: 'audio', accept: 'audio/*,.mp3,.wav,.flac,.aac,.m4a,.ogg,.opus,.wma,.aiff,.amr,.ape', title: '选择要转换的音频', icon: 'file-audio',
  options: (s) => { Object.assign(s, { format: 'mp3', audioBitrate: '192', sampleRate: '', channels: '', volume: 1 });
    return opt(g(field('输出格式', select(AUDIO_FMT, s.format, (v) => { s.format = v; })), field('音质（有损格式）', select([['64', '64 kbps'], ['128', '128 kbps'], ['192', '192 kbps'], ['256', '256 kbps'], ['320', '320 kbps']], s.audioBitrate, (v) => { s.audioBitrate = v; }))),
      g(field('采样率', select([['', '保持原始'], ['22050', '22.05 kHz'], ['44100', '44.1 kHz'], ['48000', '48 kHz']], s.sampleRate, (v) => { s.sampleRate = v; })), field('声道', select([['', '保持原始'], ['1', '单声道'], ['2', '立体声']], s.channels, (v) => { s.channels = v; }))),
      field('音量', range(0.2, 3, 0.05, 1, (v) => { s.volume = v; }, (v) => Math.round(v * 100) + '%'))); },
  params: (s) => ({ ...s }),
});
const mediaTrim = serverTool({
  op: 'trim', accept: 'video/*,audio/*,.mkv,.flv,.avi,.mov,.webm,.mp4,.mp3,.wav,.flac,.m4a,.aac,.ogg', title: '选择要剪切的音频 / 视频', icon: 'scissors', label: '剪切并导出',
  preview: (f, s, cleanup) => {
    const isVideo = f.type.startsWith('video/') || /\.(mkv|flv|avi|mov|webm|mp4|m4v|ts)$/i.test(f.name);
    const url = URL.createObjectURL(f); cleanup.push(() => URL.revokeObjectURL(url));
    const el = h(isVideo ? 'video' : 'audio', { src: url, controls: true, preload: 'metadata', style: 'width:100%;max-height:340px;border-radius:12px;background:#000' }); s._media = el; return el;
  },
  options: (s) => { Object.assign(s, { start: '0', end: '', format: 'keep' });
    const si = h('input.input', { value: s.start, oninput: (e) => { s.start = e.target.value; } }), ei = h('input.input', { value: s.end, placeholder: '留空 = 到结尾', oninput: (e) => { s.end = e.target.value; } });
    const setCur = (inp, key) => () => { const t = s._media?.currentTime || 0; inp.value = fmtTime(t, true).replace(/^(\d+):(\d\d)\.(\d+)$/, (_, m, sec, ms) => `${+m * 60 + +sec}.${ms}`); s[key] = inp.value; };
    return opt(g(field('开始时间', h('div.row.nw', si, h('button.btn.sm', { onclick: setCur(si, 'start'), title: '取播放器当前位置' }, '取当前'))), field('结束时间', h('div.row.nw', ei, h('button.btn.sm', { onclick: setCur(ei, 'end') }, '取当前')))),
      field('输出', select([['keep', '视频保持为 MP4 / 音频保持为 MP3'], ['mp3', '仅导出音频 (MP3)'], ['wav', '仅导出音频 (WAV)']], s.format, (v) => { s.format = v; })), h('p.hint', '时间可写成 90、1:30 或 01:02:03。导出时会重新编码以保证起止点精确。')); },
  params: (s) => { const a = parseTime(s.start), b = parseTime(s.end); if (isNaN(a) || isNaN(b)) throw new Error('时间格式不正确'); if (b && b <= a) throw new Error('结束时间必须大于开始时间'); return { start: a, end: b, format: s.format === 'keep' ? 'mp4' : s.format, quality: 'high' }; },
});

export const tools = { 'video-convert': videoConvert, 'video-compress': videoCompress, 'video-gif': videoGif, 'video-audio': videoAudio, 'audio-convert': audioConvert, 'media-trim': mediaTrim };
