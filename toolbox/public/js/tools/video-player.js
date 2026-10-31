import { h, $, mount, icon, dropzone, toast, download, fmtSize, seg, canvasToBlob, baseName, readAs, banner } from '../ui.js';

const srt2vtt = (t) => 'WEBVTT\n\n' + t.replace(/\r/g, '').replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2');

export default function videoPlayer(root) {
  let url = null, subUrl = null;
  const area = h('div'); const dz = dropzone({ accept: 'video/*,audio/*,.mkv,.mp4,.webm,.mov,.m4v,.ogv', title: '选择本地视频文件', hint: '直接在浏览器中播放，不会上传。支持浏览器可解码的格式（MP4/WebM/MOV 等），其它格式请先用「视频格式转换」', icon: 'circle-play', onFiles: ([f]) => load(f) });
  mount(root, dz, area);
  function load(f) {
    if (url) URL.revokeObjectURL(url); url = URL.createObjectURL(f);
    const v = h('video', { src: url, controls: true, autoplay: true, playsInline: true, style: 'width:100%;max-height:72vh;background:#000;border-radius:16px;display:block' });
    v.onerror = () => mount(msg, banner('err', '浏览器无法解码该文件。可先用「视频格式转换」转成 MP4 (H.264) 再播放。'));
    const msg = h('div'); const info = h('span.muted.small');
    v.onloadedmetadata = () => { info.textContent = `${v.videoWidth}×${v.videoHeight} · ${Math.round(v.duration)} 秒 · ${fmtSize(f.size)}`; };
    const speed = seg([['0.5', '0.5x'], ['0.75', '0.75x'], ['1', '1x'], ['1.25', '1.25x'], ['1.5', '1.5x'], ['2', '2x'], ['3', '3x']], '1', (s) => { v.playbackRate = +s; });
    const subIn = h('input', { type: 'file', accept: '.srt,.vtt', hidden: true, onchange: async () => { const sf = subIn.files[0]; subIn.value = ''; if (!sf) return; let t = await sf.text(); if (!/^WEBVTT/.test(t)) t = srt2vtt(t); if (subUrl) URL.revokeObjectURL(subUrl); subUrl = URL.createObjectURL(new Blob([t], { type: 'text/vtt' })); $$all(v, 'track').forEach((x) => x.remove()); v.append(h('track', { kind: 'subtitles', src: subUrl, default: true, label: '字幕', srclang: 'zh' })); setTimeout(() => { if (v.textTracks[0]) v.textTracks[0].mode = 'showing'; }, 100); toast('字幕已加载', 'ok'); } });
    const $$all = (el, s) => [...el.querySelectorAll(s)];
    let flip = false;
    mount(area, h('div.col.mt', v, msg, h('div.panel', h('div.col',
      h('div.row', h('b', f.name), info, h('div.sp'), h('button.btn.sm.ghost', { onclick: () => { v.pause(); mount(area); dz.hidden = false; } }, icon('x'), '换一个')),
      h('div.row', h('span.lbl', '倍速'), speed),
      h('div.row', h('button.btn.sm', { onclick: async () => { const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight; c.getContext('2d').drawImage(v, 0, 0); download(await canvasToBlob(c, 'image/png'), `${baseName(f.name)}_${Math.floor(v.currentTime)}s.png`); } }, icon('camera'), '截图当前画面'),
        h('button.btn.sm', { onclick: () => v.requestPictureInPicture?.().catch(() => toast('当前浏览器不支持画中画', 'err')) }, icon('picture-in-picture-2'), '画中画'),
        h('button.btn.sm', { onclick: () => { flip = !flip; v.style.transform = flip ? 'scaleX(-1)' : ''; } }, icon('flip-horizontal-2'), '镜像'),
        h('button.btn.sm', { onclick: () => { v.loop = !v.loop; toast(v.loop ? '已开启循环' : '已关闭循环'); } }, icon('repeat'), '循环'),
        h('button.btn.sm', { onclick: () => subIn.click() }, icon('captions'), '加载字幕 (.srt/.vtt)'), subIn),
      h('p.hint', '快捷键：空格 播放/暂停，← → 快退/快进 5 秒，F 全屏（需先点击播放器）')))));
    dz.hidden = true;
  }
  return () => { if (url) URL.revokeObjectURL(url); if (subUrl) URL.revokeObjectURL(subUrl); };
}
