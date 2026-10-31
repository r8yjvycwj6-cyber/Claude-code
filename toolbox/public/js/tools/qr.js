import { h, mount, icon, dropzone, toast, download, field, seg, banner, spinner, select, range, copyText, tabs, loadScript, debounce, store } from '../ui.js';
import { toCanvas } from '../lib/img.js';

function qrGen(root) {
  const o = { type: 'text', text: 'https://example.com', fg: '000000', bg: 'ffffff', ec: 'M', size: 512, margin: 2, ssid: '', pass: '', enc: 'WPA', name: '', tel: '', mail: '', org: '' };
  const img = h('img', { style: 'width:100%;max-width:340px;border-radius:12px;background:#fff;box-shadow:var(--shadow);aspect-ratio:1', alt: '二维码' });
  const form = h('div.col'); const err = h('div');
  const content = () => {
    switch (o.type) {
      case 'wifi': return `WIFI:T:${o.enc};S:${o.ssid.replace(/([\;,:"])/g, '\\$1')};P:${o.pass.replace(/([\;,:"])/g, '\\$1')};;`;
      case 'tel': return 'tel:' + o.tel;
      case 'mail': return 'mailto:' + o.mail;
      case 'vcard': return `BEGIN:VCARD\nVERSION:3.0\nFN:${o.name}\nORG:${o.org}\nTEL:${o.tel}\nEMAIL:${o.mail}\nEND:VCARD`;
      default: return o.text;
    }
  };
  const url = (fmt = 'png', size = o.size) => `/api/qr?text=${encodeURIComponent(content())}&fg=${o.fg}&bg=${o.bg}&ec=${o.ec}&size=${size}&margin=${o.margin}&format=${fmt}`;
  const refresh = debounce(async () => {
    if (!content().trim()) { mount(err, banner('info', '请输入要编码的内容')); img.style.opacity = .3; return; }
    const r = await fetch(url()); if (!r.ok) { mount(err, banner('err', (await r.json()).error)); return; }
    mount(err); img.style.opacity = 1; const old = img.src; img.src = URL.createObjectURL(await r.blob()); if (old.startsWith('blob:')) URL.revokeObjectURL(old);
  }, 200);
  const inp = (k, ph, type = 'text') => h('input.input', { type, placeholder: ph, value: o[k], oninput: (e) => { o[k] = e.target.value; refresh(); } });
  const paintForm = () => mount(form,
    o.type === 'text' && field('内容（文本 / 链接）', h('textarea.textarea', { value: o.text, style: 'min-height:90px', oninput: (e) => { o.text = e.target.value; refresh(); } })),
    o.type === 'wifi' && h('div.col', field('WiFi 名称 (SSID)', inp('ssid', '我的WiFi')), field('密码', inp('pass', '')), field('加密方式', select([['WPA', 'WPA/WPA2'], ['WEP', 'WEP'], ['nopass', '无密码']], o.enc, (v) => { o.enc = v; refresh(); }))),
    o.type === 'tel' && field('电话号码', inp('tel', '13800000000')),
    o.type === 'mail' && field('邮箱地址', inp('mail', 'name@example.com')),
    o.type === 'vcard' && h('div.col', field('姓名', inp('name', '张三')), field('公司', inp('org', '')), field('电话', inp('tel', '')), field('邮箱', inp('mail', ''))));
  paintForm(); refresh();
  mount(root, h('div.split.wide-r',
    h('div.panel', h('div.col',
      seg([['text', '文本 / 链接'], ['wifi', 'WiFi'], ['tel', '电话'], ['mail', '邮箱'], ['vcard', '名片']], o.type, (v) => { o.type = v; paintForm(); refresh(); }), form,
      h('div.grid.g2', field('前景色', h('input', { type: 'color', value: '#' + o.fg, oninput: (e) => { o.fg = e.target.value.slice(1); refresh(); } })), field('背景色', h('input', { type: 'color', value: '#' + o.bg, oninput: (e) => { o.bg = e.target.value.slice(1); refresh(); } }))),
      h('div.grid.g2', field('纠错等级', select([['L', 'L · 7%'], ['M', 'M · 15%'], ['Q', 'Q · 25%'], ['H', 'H · 30%']], o.ec, (v) => { o.ec = v; refresh(); })), field('边距', range(0, 8, 1, o.margin, (v) => { o.margin = v; refresh(); }))))),
    h('div.stick.panel.center', h('div.col', { style: 'align-items:center' }, img, err,
      h('div.row', { style: 'justify-content:center' }, h('button.btn.primary', { onclick: async () => download(await (await fetch(url('png', 1024))).blob(), '二维码.png') }, icon('download'), 'PNG'), h('button.btn', { onclick: async () => download(await (await fetch(url('svg'))).blob(), '二维码.svg') }, icon('download'), 'SVG'))))));
}

function qrScan(root) {
  let stream = null, raf = 0;
  const out = h('div'); const video = h('video', { playsInline: true, muted: true, style: 'width:100%;max-height:420px;border-radius:14px;background:#000' }); const cam = h('div', { hidden: true }, video);
  const camBtn = h('button.btn', { onclick: toggleCam }, icon('camera'), '打开摄像头扫描');
  const dz = dropzone({ accept: 'image/*', title: '选择含二维码的图片', hint: '也可以直接粘贴截图（Ctrl+V）', icon: 'scan-qr-code', onFiles: ([f]) => fromFile(f) });
  const onPaste = (e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/')); if (f) fromFile(f); };
  document.addEventListener('paste', onPaste);
  const show = (text) => {
    const isUrl = /^https?:\/\//i.test(text);
    mount(out, h('div.panel.mt', h('div.col', h('div.row', icon('circle-check'), h('b', '识别成功')), h('pre.out', text), h('div.row', h('button.btn.primary', { onclick: () => copyText(text) }, icon('copy'), '复制'), isUrl && h('a.btn', { href: text, target: '_blank', rel: 'noopener noreferrer' }, icon('external-link'), '打开链接')))));
  };
  async function decodeCanvas(c) {
    await loadScript('/vendor/jsqr/jsQR.js');
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height);
    return window.jsQR(d.data, d.width, d.height, { inversionAttempts: 'attemptBoth' });
  }
  async function fromFile(f) {
    try {
      let c = await toCanvas(f, { maxSide: 2000, bg: '#fff' }); let r = await decodeCanvas(c);
      if (!r) { c = await toCanvas(f, { maxSide: 900, bg: '#fff' }); r = await decodeCanvas(c); }
      r ? show(r.data) : mount(out, banner('warn', '没有识别到二维码，请确认图片清晰且二维码完整'));
    } catch (e) { mount(out, banner('err', e.message)); }
  }
  function stop() { cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); stream = null; cam.hidden = true; camBtn.lastChild.textContent = '打开摄像头扫描'; }
  async function toggleCam() {
    if (stream) return stop();
    if (!navigator.mediaDevices?.getUserMedia) return toast('当前环境不支持摄像头（需要 https 或 localhost 访问）', 'err', 4000);
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream; await video.play(); cam.hidden = false; camBtn.lastChild.textContent = '关闭摄像头';
      const c = document.createElement('canvas'); const g = c.getContext('2d', { willReadFrequently: true });
      const tick = async () => {
        if (!stream) return;
        if (video.videoWidth) { const k = Math.min(1, 800 / video.videoWidth); c.width = video.videoWidth * k; c.height = video.videoHeight * k; g.drawImage(video, 0, 0, c.width, c.height); const r = await decodeCanvas(c); if (r) { show(r.data); stop(); return; } }
        raf = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) { toast('无法打开摄像头：' + e.message, 'err', 4000); stream = null; }
  }
  mount(root, h('div.col', dz, h('div.row', camBtn, h('span.muted.small', '摄像头仅在本机使用，画面不会上传')), cam, out));
  return () => { stop(); document.removeEventListener('paste', onPaste); };
}
export const tools = { 'qr-gen': qrGen, 'qr-scan': qrScan };
