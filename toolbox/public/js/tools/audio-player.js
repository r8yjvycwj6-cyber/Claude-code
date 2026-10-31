import { h, $, $$, mount, icon, toast, fmtTime, uid, sortable, clamp, baseName, extOf } from '../ui.js';
import { readTags, parseLrc, hueOf } from '../lib/audio-meta.js';

const AUDIO_EXT = /\.(mp3|wav|flac|aac|m4a|ogg|opus|wma|aiff?|ape|mp4|webm)$/i;
const EQ_FREQ = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000];
const EQ_LABEL = ['60', '170', '310', '600', '1K', '3K', '6K', '12K', '14K', '16K'];
const EQ_PRESETS = { flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], pop: [-1, 2, 4, 5, 3, 0, -1, -1, -2, -2], rock: [5, 4, 2, -1, -2, 1, 3, 4, 5, 5], vocal: [-3, -2, 0, 3, 5, 5, 3, 1, 0, -1], bass: [8, 6, 4, 1, 0, 0, 0, 0, 0, 0], classic: [4, 3, 2, 1, 0, 0, -1, -2, -2, -3] };
const EQ_NAME = { flat: '平衡', pop: '流行', rock: '摇滚', vocal: '人声', bass: '重低音', classic: '古典' };
const MODES = [['list', 'repeat', '列表循环'], ['one', 'repeat-1', '单曲循环'], ['shuffle', 'shuffle', '随机播放'], ['seq', 'arrow-right-to-line', '顺序播放']];
const VIS = [['bars', '频谱'], ['wave', '波形'], ['ring', '环形']];

export default function audioPlayer(root) {
  const audio = new Audio(); audio.preload = 'metadata'; audio.crossOrigin = 'anonymous';
  let list = [], idx = -1, mode = 0, vis = 0, ctxA, analyser, eqNodes = [], srcNode, rafId = 0, lrc = [], lrcIdx = -1, eqOn = false, sleepTimer = null;
  const gradOf = (name) => { const hu = hueOf(name); return `linear-gradient(135deg, hsl(${hu} 80% 60%), hsl(${(hu + 50) % 360} 75% 45%))`; };

  /* ───── DOM ───── */
  const vinyl = h('div.vinyl', h('div.cover', icon('music-4')));
  const titleEl = h('div.ap-title', '未选择曲目'); const subEl = h('div.ap-sub', '添加本地音乐文件开始播放');
  const lrcIn = h('div.ap-lyrics-in'); const lrcBox = h('div.ap-lyrics', lrcIn);
  const canvas = h('canvas.ap-vis'); const g2 = canvas.getContext('2d');
  const seek = h('input', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': '播放进度' });
  const cur = h('span', '0:00'), dur = h('span', '0:00');
  const playBtn = h('button.ap-btn.play', { onclick: toggle, 'aria-label': '播放/暂停' }, icon('play'));
  const modeBtn = h('button.ap-btn.sm', { onclick: () => { mode = (mode + 1) % MODES.length; paintMode(); toast(MODES[mode][2]); } });
  const vol = h('input', { type: 'range', min: 0, max: 100, value: 80, 'aria-label': '音量' }); audio.volume = 0.8;
  const volBtn = h('button.ap-btn.sm', { onclick: () => { audio.muted = !audio.muted; paintVol(); } });
  const speedBtn = h('button.ap-chip', { onclick: () => { const s = [0.5, 0.75, 1, 1.25, 1.5, 2]; audio.playbackRate = s[(s.indexOf(audio.playbackRate) + 1) % s.length]; speedBtn.textContent = audio.playbackRate + 'x'; } }, '1x');
  const visBtn = h('button.ap-chip', { onclick: () => { vis = (vis + 1) % VIS.length; visBtn.textContent = VIS[vis][1]; } }, VIS[0][1]);
  const eqBtn = h('button.ap-chip', { onclick: () => { eqOn = !eqOn; eqPanel.hidden = !eqOn; eqBtn.style.background = eqOn ? 'rgba(255,255,255,.32)' : ''; } }, '均衡器');
  const sleepBtn = h('button.ap-chip', { onclick: setSleep }, '定时');
  const lrcInput = h('input', { type: 'file', accept: '.lrc,.txt', hidden: true, onchange: async () => { const f = lrcInput.files[0]; lrcInput.value = ''; if (f && list[idx]) { list[idx].lrc = parseLrc(await f.text()); loadLrc(); toast('已加载歌词', 'ok'); } } });
  const eqPanel = h('div.ap-eq', { hidden: true });
  const eqRanges = EQ_FREQ.map((f, i) => { const r = h('input', { type: 'range', min: -12, max: 12, step: 1, value: 0, 'aria-label': EQ_LABEL[i] + 'Hz', oninput: () => { if (eqNodes[i]) eqNodes[i].gain.value = +r.value; } }); return r; });
  eqPanel.append(...EQ_FREQ.map((f, i) => h('div.band', eqRanges[i], h('span', EQ_LABEL[i]))));
  const presetRow = h('div.row', { style: 'margin-top:10px', hidden: true }, Object.entries(EQ_NAME).map(([k, n]) => h('button.ap-chip', { onclick: () => { EQ_PRESETS[k].forEach((v, i) => { eqRanges[i].value = v; if (eqNodes[i]) eqNodes[i].gain.value = v; }); } }, n)));
  new MutationObserver(() => { presetRow.hidden = eqPanel.hidden; }).observe(eqPanel, { attributes: true, attributeFilter: ['hidden'] });

  const main = h('div.ap-main',
    h('div.ap-top', vinyl, h('div.ap-info', titleEl, subEl, lrcBox)),
    canvas,
    h('div.ap-seek', cur, seek, dur),
    h('div.ap-ctrl',
      h('div.row.nw', { style: 'gap:8px' }, modeBtn, h('button.ap-btn.sm', { onclick: () => skip(-5), title: '后退 5 秒' }, icon('rewind'))),
      h('div.row.nw', { style: 'gap:14px' }, h('button.ap-btn', { onclick: () => step(-1), 'aria-label': '上一首' }, icon('skip-back')), playBtn, h('button.ap-btn', { onclick: () => step(1), 'aria-label': '下一首' }, icon('skip-forward'))),
      h('div.row.nw', { style: 'gap:8px' }, h('button.ap-btn.sm', { onclick: () => skip(5), title: '前进 5 秒' }, icon('fast-forward')), h('div.ap-vol', volBtn, vol))),
    h('div.row', { style: 'margin-top:14px;gap:8px' }, speedBtn, visBtn, eqBtn, sleepBtn, h('button.ap-chip', { onclick: () => list[idx] ? lrcInput.click() : toast('请先选择曲目') }, '加载歌词 .lrc'), lrcInput),
    presetRow, eqPanel);

  /* ───── 播放列表 ───── */
  const plList = h('div.pl-list'); const plCount = h('span.muted.small');
  const fileIn = h('input', { type: 'file', accept: 'audio/*,.mp3,.flac,.wav,.m4a,.aac,.ogg,.opus,.wma,.lrc', multiple: true, hidden: true, onchange: () => { addFiles([...fileIn.files]); fileIn.value = ''; } });
  const dirIn = h('input', { type: 'file', webkitdirectory: true, hidden: true, onchange: () => { addFiles([...dirIn.files]); dirIn.value = ''; } });
  const filter = h('input.input.sm', { placeholder: '搜索播放列表…', oninput: paintList });
  const pl = h('div.panel.pl', h('div.row', { style: 'margin-bottom:10px' }, h('b', '播放列表'), plCount, h('div.sp'),
    h('button.btn.sm.primary', { onclick: () => fileIn.click() }, icon('plus'), '添加音乐'), h('button.btn.sm.icon', { title: '添加文件夹', onclick: () => dirIn.click() }, icon('folder-plus')), h('button.btn.sm.icon.ghost', { title: '清空', onclick: () => { list.forEach(release); list = []; idx = -1; audio.pause(); audio.removeAttribute('src'); loadTrackUi(null); paintList(); } }, icon('trash-2')), fileIn, dirIn),
    filter, h('div', { style: 'height:10px' }), plList);
  sortable(plList, (ids) => { const curId = list[idx]?.id; list = ids.map((id) => list.find((t) => t.id === id)); idx = list.findIndex((t) => t.id === curId); paintList(); });

  function release(t) { URL.revokeObjectURL(t.url); if (t.cover) URL.revokeObjectURL(t.cover); }
  async function addFiles(files) {
    const lrcs = new Map(files.filter((f) => /\.(lrc)$/i.test(f.name)).map((f) => [baseName(f.name).toLowerCase(), f]));
    const songs = files.filter((f) => AUDIO_EXT.test(f.name) || f.type.startsWith('audio/'));
    if (!songs.length) return toast(lrcs.size ? '歌词文件需要与音乐一同选择，或点击“加载歌词”' : '没有找到音频文件', 'err');
    const startLen = list.length;
    for (const f of songs) {
      const t = { id: uid(), file: f, url: URL.createObjectURL(f), name: baseName(f.name), title: baseName(f.name), artist: '', album: '', duration: 0 };
      const m = /^(.+?)\s+-\s+(.+)$/.exec(t.name); if (m) { t.artist = m[1]; t.title = m[2]; }
      list.push(t);
      const lf = lrcs.get(t.name.toLowerCase()); if (lf) lf.text().then((x) => { t.lrc = parseLrc(x); if (list[idx] === t) loadLrc(); });
      readTags(f).then((tags) => { if (tags.title) t.title = tags.title; if (tags.artist) t.artist = tags.artist; if (tags.album) t.album = tags.album; if (tags.cover) t.cover = tags.cover; if (tags.lrc && !t.lrc) t.lrc = parseLrc(tags.lrc); paintList(); if (list[idx] === t) loadTrackUi(t); });
      const probe = new Audio(); probe.preload = 'metadata'; probe.src = t.url; probe.onloadedmetadata = () => { t.duration = probe.duration; paintList(); probe.removeAttribute('src'); };
    }
    paintList();
    if (idx < 0) play(startLen);
  }
  function paintList() {
    const q = filter.value.trim().toLowerCase();
    plCount.textContent = list.length ? `${list.length} 首` : '';
    mount(plList, list.length ? list.map((t, i) => ({ t, i })).filter(({ t }) => !q || (t.title + t.artist + t.name).toLowerCase().includes(q)).map(({ t, i }) =>
      h('div.pl-item' + (i === idx ? '.on' : ''), { dataset: { id: t.id }, draggable: true, onclick: () => play(i) },
        i === idx && !audio.paused ? h('span.no', h('span.eq-bars', h('i'), h('i'), h('i'))) : h('span.no', i + 1),
        h('div.cv', { style: `--grad:${t.cover ? `url(${t.cover})` : gradOf(t.name)}` }, !t.cover && icon('music')),
        h('div.grow', h('div.ellipsis', { style: 'font-weight:600;font-size:14px' }, t.title), h('div.ellipsis.muted', { style: 'font-size:12px' }, [t.artist, t.album].filter(Boolean).join(' · ') || '未知艺术家')),
        h('span.muted.small', t.duration ? fmtTime(t.duration) : ''),
        h('button.btn.sm.ghost.icon.x', { title: '移除', onclick: (e) => { e.stopPropagation(); remove(i); } }, icon('x'))))
      : h('div.empty', icon('music-4'), h('p', { style: 'margin-top:8px' }, '还没有音乐'), h('p.small', '点击“添加音乐”或把文件拖到页面上')));
  }
  function remove(i) { release(list[i]); list.splice(i, 1); if (i === idx) { idx = -1; audio.pause(); audio.removeAttribute('src'); if (list.length) play(Math.min(i, list.length - 1)); else loadTrackUi(null); } else if (i < idx) idx--; paintList(); }

  /* ───── 播放控制 ───── */
  function initAudioGraph() {
    if (ctxA) return;
    ctxA = new (window.AudioContext || window.webkitAudioContext)();
    srcNode = ctxA.createMediaElementSource(audio);
    analyser = ctxA.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.82;
    eqNodes = EQ_FREQ.map((f, i) => { const n = ctxA.createBiquadFilter(); n.type = i === 0 ? 'lowshelf' : i === EQ_FREQ.length - 1 ? 'highshelf' : 'peaking'; n.frequency.value = f; n.Q.value = 1.1; n.gain.value = +eqRanges[i].value; return n; });
    let node = srcNode; for (const n of eqNodes) { node.connect(n); node = n; } node.connect(analyser); analyser.connect(ctxA.destination);
  }
  async function play(i) {
    if (i < 0 || i >= list.length) return;
    initAudioGraph(); idx = i; const t = list[i]; audio.src = t.url; loadTrackUi(t); paintList();
    try { await ctxA.resume(); await audio.play(); } catch (e) { if (e.name !== 'AbortError') toast('无法播放该文件：' + (t.title || ''), 'err'); }
  }
  function toggle() { if (!list.length) return fileIn.click(); if (idx < 0) return play(0); initAudioGraph(); ctxA.resume(); audio.paused ? audio.play() : audio.pause(); }
  function step(d, auto = false) {
    if (!list.length) return;
    if (mode === 2 && list.length > 1) { let n; do n = Math.floor(Math.random() * list.length); while (n === idx); return play(n); }
    let n = idx + d;
    if (n >= list.length) { if (auto && MODES[mode][0] === 'seq') { audio.pause(); return; } n = 0; }
    if (n < 0) n = list.length - 1;
    play(n);
  }
  const skip = (s) => { if (audio.duration) audio.currentTime = clamp(audio.currentTime + s, 0, audio.duration); };
  function loadTrackUi(t) {
    titleEl.textContent = t ? t.title : '未选择曲目'; subEl.textContent = t ? [t.artist || '未知艺术家', t.album].filter(Boolean).join(' · ') : '添加本地音乐文件开始播放';
    const cv = $('.cover', vinyl); const bg = t ? (t.cover ? `url(${t.cover})` : gradOf(t.name)) : '';
    cv.style.setProperty('--grad', bg || 'linear-gradient(135deg,#6366f1,#d946ef)'); cv.style.background = bg || ''; cv.replaceChildren(...(t && t.cover ? [] : [icon('music-4')]));
    main.style.setProperty('--ap-bg', bg || 'none'); document.title = t ? `${t.title} - 音频播放器` : '音频播放器 - 在线工具箱';
    loadLrc();
    if ('mediaSession' in navigator && t) navigator.mediaSession.metadata = new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: t.cover ? [{ src: t.cover }] : [] });
  }
  function loadLrc() {
    lrc = list[idx]?.lrc || []; lrcIdx = -1;
    mount(lrcIn, lrc.length ? lrc.map((l) => h('p', l.text || '♪')) : [h('p'), h('p', '暂无歌词'), h('p.on', { style: 'font-size:14px;font-weight:400;color:rgba(255,255,255,.45)' }, '可加载同名 .lrc 文件或带歌词的 MP3')]);
    lrcIn.style.transform = 'translateY(30px)';
  }
  function syncLrc() {
    if (!lrc.length) return; const t = audio.currentTime + 0.15; let i = -1; for (let k = 0; k < lrc.length; k++) { if (lrc[k].t <= t) i = k; else break; }
    if (i !== lrcIdx) { lrcIdx = i; $$('p', lrcIn).forEach((p, k) => p.classList.toggle('on', k === i)); lrcIn.style.transform = `translateY(${30 - Math.max(0, i) * 30}px)`; }
  }
  const paintMode = () => { modeBtn.replaceChildren(icon(MODES[mode][1])); modeBtn.title = MODES[mode][2]; };
  const paintVol = () => { volBtn.replaceChildren(icon(audio.muted || audio.volume === 0 ? 'volume-x' : audio.volume < 0.5 ? 'volume-1' : 'volume-2')); vol.style.setProperty('--p', (audio.muted ? 0 : audio.volume * 100) + '%'); };
  function setSleep() {
    const opts = [0, 15, 30, 45, 60]; const cur = sleepTimer ? sleepTimer.min : 0; const next = opts[(opts.indexOf(cur) + 1) % opts.length];
    clearTimeout(sleepTimer?.id); sleepTimer = null; sleepBtn.textContent = '定时';
    if (next) { sleepTimer = { min: next, id: setTimeout(() => { audio.pause(); sleepBtn.textContent = '定时'; sleepTimer = null; toast('定时结束，已暂停播放'); }, next * 60000) }; sleepBtn.textContent = `${next} 分钟后停止`; }
  }

  /* ───── 事件 ───── */
  let seeking = false;
  seek.oninput = () => { seeking = true; if (audio.duration) cur.textContent = fmtTime((seek.value / 1000) * audio.duration); seek.style.setProperty('--p', seek.value / 10 + '%'); };
  seek.onchange = () => { if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration; seeking = false; };
  vol.oninput = () => { audio.volume = vol.value / 100; audio.muted = false; paintVol(); };
  audio.ontimeupdate = () => { if (!seeking && audio.duration) { seek.value = (audio.currentTime / audio.duration) * 1000; seek.style.setProperty('--p', seek.value / 10 + '%'); cur.textContent = fmtTime(audio.currentTime); } syncLrc(); };
  audio.onloadedmetadata = () => { dur.textContent = fmtTime(audio.duration); if (list[idx]) { list[idx].duration = audio.duration; } };
  audio.onplay = () => { playBtn.replaceChildren(icon('pause')); vinyl.classList.add('on'); paintList(); startVis(); };
  audio.onpause = () => { playBtn.replaceChildren(icon('play')); vinyl.classList.remove('on'); paintList(); };
  audio.onended = () => { if (MODES[mode][0] === 'one') { audio.currentTime = 0; audio.play(); } else step(1, true); };
  audio.onerror = () => { if (audio.src) { toast('该文件无法解码，已跳到下一首', 'err'); if (list.length > 1) setTimeout(() => step(1), 600); } };
  if ('mediaSession' in navigator) { const ms = navigator.mediaSession; ms.setActionHandler('play', toggle); ms.setActionHandler('pause', toggle); ms.setActionHandler('previoustrack', () => step(-1)); ms.setActionHandler('nexttrack', () => step(1)); }
  const onKey = (e) => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName) && document.activeElement.type !== 'range') return; if ($('.overlay')) return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); } else if (e.key === 'ArrowRight') skip(5); else if (e.key === 'ArrowLeft') skip(-5);
    else if (e.key === 'ArrowUp') { e.preventDefault(); audio.volume = clamp(audio.volume + 0.05, 0, 1); vol.value = audio.volume * 100; paintVol(); } else if (e.key === 'ArrowDown') { e.preventDefault(); audio.volume = clamp(audio.volume - 0.05, 0, 1); vol.value = audio.volume * 100; paintVol(); }
  };
  document.addEventListener('keydown', onKey);
  const outer = h('div.ap', main, pl);
  const onDrag = (e) => e.preventDefault(); const onDrop = (e) => { if (e.dataTransfer?.files?.length) { e.preventDefault(); addFiles([...e.dataTransfer.files]); } };
  outer.addEventListener('dragover', onDrag); outer.addEventListener('drop', onDrop);

  /* ───── 可视化 ───── */
  function startVis() { cancelAnimationFrame(rafId); const loop = () => { draw(); if (!audio.paused || fade > 0.01) rafId = requestAnimationFrame(loop); }; loop(); }
  let fade = 0;
  function draw() {
    const dpr = devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight; if (!W) return;
    if (canvas.width !== W * dpr) { canvas.width = W * dpr; canvas.height = H * dpr; }
    g2.setTransform(dpr, 0, 0, dpr, 0, 0); g2.clearRect(0, 0, W, H);
    fade = audio.paused ? fade * 0.9 : 1; if (!analyser) return;
    const g = g2.createLinearGradient(0, H, 0, 0); g.addColorStop(0, '#6ee7f9'); g.addColorStop(0.55, '#a78bfa'); g.addColorStop(1, '#f472b6');
    g2.fillStyle = g; g2.strokeStyle = g; g2.globalAlpha = Math.min(1, fade + 0.05);
    if (VIS[vis][0] === 'bars') {
      const n = 56, data = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(data); const bw = W / n;
      for (let i = 0; i < n; i++) { const a = Math.floor(Math.pow(i / n, 1.8) * data.length * 0.55), b = Math.max(a + 1, Math.floor(Math.pow((i + 1) / n, 1.8) * data.length * 0.55)); let s = 0; for (let k = a; k < b; k++) s += data[k]; const v = (s / (b - a) / 255) ** 1.2 * H * 0.95 * (audio.paused ? fade : 1), w = bw * 0.62; g2.beginPath(); g2.roundRect(i * bw + (bw - w) / 2, H - Math.max(3, v), w, Math.max(3, v), w / 2); g2.fill(); }
    } else if (VIS[vis][0] === 'wave') {
      const data = new Uint8Array(analyser.fftSize); analyser.getByteTimeDomainData(data); g2.lineWidth = 3; g2.lineJoin = 'round'; g2.beginPath();
      for (let i = 0; i < data.length; i += 4) { const x = (i / data.length) * W, y = H / 2 + ((data[i] - 128) / 128) * H * 0.45 * (audio.paused ? fade : 1); i ? g2.lineTo(x, y) : g2.moveTo(x, y); } g2.stroke();
    } else {
      const n = 90, data = new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(data); const cx = W / 2, cy = H / 2, r0 = Math.min(W, H) * 0.22; g2.lineWidth = 3; g2.lineCap = 'round';
      for (let i = 0; i < n; i++) { const v = (data[Math.floor(Math.pow(i / n, 1.6) * data.length * 0.5)] / 255) * Math.min(W, H) * 0.3 * (audio.paused ? fade : 1), a = (i / n) * Math.PI * 2 - Math.PI / 2; g2.beginPath(); g2.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0); g2.lineTo(cx + Math.cos(a) * (r0 + 3 + v), cy + Math.sin(a) * (r0 + 3 + v)); g2.stroke(); }
    }
    g2.globalAlpha = 1;
  }

  paintMode(); paintVol(); paintList(); loadLrc();
  mount(root, outer);
  return () => { cancelAnimationFrame(rafId); audio.pause(); audio.removeAttribute('src'); audio.load(); document.removeEventListener('keydown', onKey); clearTimeout(sleepTimer?.id); list.forEach(release); ctxA?.close().catch(() => {}); if ('mediaSession' in navigator) { ['play', 'pause', 'previoustrack', 'nexttrack'].forEach((a) => navigator.mediaSession.setActionHandler(a, null)); } };
}
