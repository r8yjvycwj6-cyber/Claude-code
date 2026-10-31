import { h, $, mount, icon, toast, download, fmtTime, fmtSize, banner, select, field, checkbox, seg, spinner } from '../ui.js';

function pickMime(list) { return list.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || ''; }
const extOfMime = (m) => (/mp4/.test(m) ? 'mp4' : /ogg/.test(m) ? 'ogg' : 'webm');

/** AudioBuffer → 16-bit PCM WAV */
function encodeWav(buf) {
  const ch = buf.numberOfChannels, len = buf.length, rate = buf.sampleRate, out = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => [...s].forEach((c, i) => out.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); out.setUint32(4, 36 + len * ch * 2, true); w(8, 'WAVEfmt '); out.setUint32(16, 16, true); out.setUint16(20, 1, true); out.setUint16(22, ch, true); out.setUint32(24, rate, true); out.setUint32(28, rate * ch * 2, true); out.setUint16(32, ch * 2, true); out.setUint16(34, 16, true); w(36, 'data'); out.setUint32(40, len * ch * 2, true);
  const data = Array.from({ length: ch }, (_, c) => buf.getChannelData(c)); let o = 44;
  for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { const s = Math.max(-1, Math.min(1, data[c][i])); out.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
  return new Blob([out], { type: 'audio/wav' });
}

function recorder(root) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return mount(root, banner('warn', '当前浏览器或访问方式不支持录音。请使用 Chrome / Edge / Firefox，并通过 https 或 localhost 访问。'));
  let stream, mr, chunks = [], t0 = 0, acc = 0, timer, raf, ctx, analyser, state = 'idle', blob = null, devices = [];
  const mime = pickMime(['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus', 'audio/webm']);
  const time = h('div', { style: 'font:800 54px/1 var(--mono);letter-spacing:-.02em;font-variant-numeric:tabular-nums' }, '00:00.0');
  const cv = h('canvas', { style: 'width:100%;height:110px;border-radius:14px;background:var(--surface-2)' });
  const stateChip = h('span.chip', '待机');
  const dev = h('select.select'); const result = h('div'); const err = h('div');
  const mainBtn = h('button.btn.primary.lg', { onclick: start }, icon('mic'), '开始录音');
  const pauseBtn = h('button.btn.lg', { onclick: pause, hidden: true }, icon('pause'), '暂停');
  const stopBtn = h('button.btn.lg.danger', { onclick: stop, hidden: true }, icon('square'), '停止');
  async function loadDevices() { try { devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput'); mount(dev, devices.map((d, i) => h('option', { value: d.deviceId }, d.label || `麦克风 ${i + 1}`))); } catch {} }
  loadDevices();
  async function start() {
    mount(err); mount(result);
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: dev.value ? { exact: dev.value } : undefined, echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { return mount(err, banner('err', e.name === 'NotAllowedError' ? '麦克风权限被拒绝，请在浏览器地址栏允许使用麦克风' : '无法访问麦克风：' + e.message)); }
    loadDevices();
    ctx = new AudioContext(); analyser = ctx.createAnalyser(); analyser.fftSize = 1024; ctx.createMediaStreamSource(stream).connect(analyser);
    chunks = []; mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined); mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mr.onstop = () => { blob = new Blob(chunks, { type: mr.mimeType || mime }); showResult(); };
    mr.start(250); t0 = performance.now(); acc = 0; state = 'rec'; paint(); tick(); drawWave();
  }
  const elapsed = () => (state === 'rec' ? acc + (performance.now() - t0) : acc) / 1000;
  const tick = () => { time.textContent = fmtTime(elapsed(), false).padStart(5, '0').replace(/^(\d):/, '0$1:') + '.' + Math.floor((elapsed() % 1) * 10); timer = requestAnimationFrame(tick); };
  function pause() { if (state === 'rec') { mr.pause(); acc += performance.now() - t0; state = 'pause'; } else { mr.resume(); t0 = performance.now(); state = 'rec'; } paint(); }
  function stop() { if (state === 'rec') acc += performance.now() - t0; state = 'idle'; mr.stop(); stream.getTracks().forEach((t) => t.stop()); cancelAnimationFrame(timer); cancelAnimationFrame(raf); ctx.close(); paint(); }
  function paint() {
    mainBtn.hidden = state !== 'idle'; pauseBtn.hidden = state === 'idle'; stopBtn.hidden = state === 'idle';
    pauseBtn.replaceChildren(icon(state === 'pause' ? 'play' : 'pause'), state === 'pause' ? '继续' : '暂停');
    stateChip.className = 'chip ' + (state === 'rec' ? 'warn' : ''); stateChip.textContent = { idle: '待机', rec: '● 录音中', pause: '已暂停' }[state];
  }
  function drawWave() {
    const g = cv.getContext('2d'), dpr = devicePixelRatio || 1; cv.width = cv.clientWidth * dpr; cv.height = cv.clientHeight * dpr; g.scale(dpr, dpr);
    const W = cv.clientWidth, H = cv.clientHeight, data = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(data);
    g.clearRect(0, 0, W, H); const grad = g.createLinearGradient(0, 0, W, 0); grad.addColorStop(0, '#6366f1'); grad.addColorStop(1, '#ec4899'); g.strokeStyle = grad; g.lineWidth = 2.5; g.beginPath();
    for (let i = 0; i < data.length; i += 2) { const x = (i / data.length) * W, y = H / 2 + ((data[i] - 128) / 128) * H * 0.48; i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); raf = requestAnimationFrame(drawWave);
  }
  function showResult() {
    const url = URL.createObjectURL(blob); const ext = extOfMime(blob.type);
    mount(result, h('div.panel.col', h('b', '录音完成'), h('audio', { src: url, controls: true, style: 'width:100%' }), h('div.row', h('span.chip', fmtSize(blob.size)), h('span.chip', fmtTime(acc / 1000)),
      h('button.btn.primary', { onclick: () => download(blob, `录音_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`) }, icon('download'), `下载 .${ext}`),
      h('button.btn', { onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { const ac = new AudioContext(); const buf = await ac.decodeAudioData(await blob.arrayBuffer()); download(encodeWav(buf), '录音.wav'); ac.close(); } catch { toast('转换失败', 'err'); } b.disabled = false; } }, icon('file-audio'), '转为 WAV'))));
  }
  paint();
  mount(root, h('div.panel.col', { style: 'align-items:center;text-align:center;gap:18px' }, stateChip, time, h('div', { style: 'width:100%' }, cv), h('div.row', { style: 'justify-content:center' }, mainBtn, pauseBtn, stopBtn),
    h('div', { style: 'width:100%;max-width:380px' }, field('麦克风', dev))), err, result);
  return () => { cancelAnimationFrame(timer); cancelAnimationFrame(raf); try { if (mr && mr.state !== 'inactive') mr.stop(); } catch {} stream?.getTracks().forEach((t) => t.stop()); ctx?.close().catch(() => {}); };
}

function screenRecorder(root) {
  if (!navigator.mediaDevices?.getDisplayMedia || !window.MediaRecorder) return mount(root, banner('warn', '当前浏览器不支持屏幕录制（手机浏览器通常不支持）。请在电脑上使用 Chrome / Edge / Firefox，并通过 https 或 localhost 访问。'));
  const o = { mic: false, sys: true, bitrate: 4 };
  let mr, chunks = [], streams = [], t0, timer, ctx, blob;
  const mime = pickMime(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4']);
  const timeEl = h('span.chip.warn', '● 00:00'); timeEl.hidden = true; const result = h('div'); const err = h('div');
  const go = h('button.btn.primary.lg', { onclick: start }, icon('circle-dot'), '开始录制'); const stopBtn = h('button.btn.lg.danger', { onclick: () => mr?.stop(), hidden: true }, icon('square'), '停止录制');
  async function start() {
    mount(err); mount(result);
    let display;
    try { display = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: o.sys }); } catch (e) { return e.name === 'NotAllowedError' ? toast('已取消选择录制内容') : mount(err, banner('err', '无法录制屏幕：' + e.message)); }
    streams = [display]; let tracks = [...display.getVideoTracks()];
    try {
      const mic = o.mic ? await navigator.mediaDevices.getUserMedia({ audio: true }) : null; if (mic) streams.push(mic);
      const sources = [display, mic].filter((s) => s && s.getAudioTracks().length);
      if (sources.length) { ctx = new AudioContext(); const dest = ctx.createMediaStreamDestination(); sources.forEach((s) => ctx.createMediaStreamSource(new MediaStream(s.getAudioTracks())).connect(dest)); tracks.push(...dest.stream.getAudioTracks()); }
      else if (o.sys || o.mic) toast('未获取到声音（共享时需勾选“分享音频”）');
    } catch (e) { toast('麦克风不可用：' + e.message, 'err'); }
    chunks = []; mr = new MediaRecorder(new MediaStream(tracks), { mimeType: mime || undefined, videoBitsPerSecond: o.bitrate * 1e6 });
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    mr.onstop = () => { clearInterval(timer); streams.forEach((s) => s.getTracks().forEach((t) => t.stop())); ctx?.close().catch(() => {}); blob = new Blob(chunks, { type: mr.mimeType }); timeEl.hidden = true; stopBtn.hidden = true; go.hidden = false; show(); };
    display.getVideoTracks()[0].addEventListener('ended', () => mr.state !== 'inactive' && mr.stop());
    mr.start(500); t0 = Date.now(); timeEl.hidden = false; stopBtn.hidden = false; go.hidden = true;
    timer = setInterval(() => { timeEl.textContent = '● ' + fmtTime((Date.now() - t0) / 1000); }, 500);
  }
  function show() {
    const url = URL.createObjectURL(blob), ext = extOfMime(blob.type);
    mount(result, h('div.panel.col', h('b', '录制完成'), h('video', { src: url, controls: true, style: 'width:100%;max-height:460px;border-radius:12px;background:#000' }), h('div.row', h('span.chip', fmtSize(blob.size)), h('span.chip', fmtTime((Date.now() - t0) / 1000)),
      h('button.btn.primary', { onclick: () => download(blob, `屏幕录制_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`) }, icon('download'), `下载 .${ext}`), ext === 'webm' && h('a.btn', { href: '/tool/video-convert', 'data-link': true }, icon('film'), '转为 MP4'))));
  }
  mount(root, h('div.col', h('div.panel.col', h('div.grid.g3', field('系统 / 标签页声音', h('div', checkbox('一并录制', o.sys, (v) => { o.sys = v; }))), field('麦克风', h('div', checkbox('录制麦克风旁白', o.mic, (v) => { o.mic = v; }))), field('画质', select([[2, '标清 2 Mbps'], [4, '高清 4 Mbps'], [8, '超清 8 Mbps']], o.bitrate, (v) => { o.bitrate = +v; }))),
    banner('info', '点击开始后浏览器会让你选择要共享的屏幕、窗口或标签页。录制内容仅保存在本机。'), h('div.row', go, stopBtn, timeEl)), err, result));
  return () => { clearInterval(timer); try { if (mr && mr.state !== 'inactive') mr.stop(); } catch {} streams.forEach((s) => s.getTracks().forEach((t) => t.stop())); };
}
export const tools = { recorder, 'screen-recorder': screenRecorder };
