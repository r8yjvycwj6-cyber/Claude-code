import { h, $, mount, icon, dropzone, toast, download, fmtSize, field, seg, select, range, banner, spinner, progress, baseName, extOf, checkbox, resultList } from '../ui.js';
import { decode, sizeOf, toCanvas, resizeCanvas, encode, extFor, makeCanvas, MIME } from '../lib/img.js';
import { JSZip } from '../lib/pdf.js';

/** 批量图片处理框架：cfg.options(state)→Node，cfg.run(canvas, file, state)→{canvas, fmt, q, suffix} */
function batchTool(cfg) {
  return (root) => {
    let files = []; const state = {}; const out = h('div'); const list = h('div.file-list'); const bar = progress(); bar.hidden = true;
    const dz = dropzone({ accept: 'image/*', multiple: true, title: '点击选择图片，或拖拽 / 粘贴到此处', hint: '支持 JPG / PNG / WebP / BMP / GIF，可批量处理，全程在浏览器本地完成', icon: 'image-up', onFiles: (f) => { files = files.concat(f); paint(); } });
    const go = h('button.btn.primary.lg', { onclick: run }, icon(cfg.icon || 'play'), cfg.label);
    const onPaste = (e) => { const f = [...(e.clipboardData?.files || [])].filter((x) => x.type.startsWith('image/')); if (f.length) { files = files.concat(f); paint(); } };
    document.addEventListener('paste', onPaste);
    function paint() {
      mount(list, files.map((f, i) => h('div.file-item', h('img', { src: URL.createObjectURL(f), style: 'width:46px;height:46px;object-fit:cover;border-radius:8px;background:#fff' }), h('div.grow', h('div.fi-name.ellipsis', f.name || '粘贴的图片'), h('div.fi-meta', fmtSize(f.size))), h('button.btn.sm.ghost.icon', { onclick: () => { files.splice(i, 1); paint(); } }, icon('x')))));
      go.disabled = !files.length; optBox.hidden = !files.length; cfg.onFiles?.(files, state);
    }
    const optBox = h('div.panel', { hidden: true }, cfg.options(state, () => files));
    async function run() {
      go.disabled = true; bar.hidden = false; bar.set(0); mount(out); const results = [];
      try {
        for (let i = 0; i < files.length; i++) {
          const f = files[i]; const c = await toCanvas(f); const r = await cfg.run(c, f, state);
          const fmt = r.fmt === 'keep' ? (extOf(f.name) === 'jpeg' ? 'jpg' : MIME[extOf(f.name)] ? extOf(f.name) : 'png') : r.fmt;
          let blob = await encode(r.canvas, fmt, r.q ?? 0.9);
          if (cfg.keepSmaller && blob.size >= f.size && (!r.fmt || r.fmt === 'keep' || MIME[extFor(r.fmt)] === f.type) && r.canvas.width === c.width) blob = f.slice(0, f.size, f.type);
          results.push({ name: `${baseName(f.name || 'image')}${r.suffix || ''}.${extFor(fmt)}`, blob, before: f.size }); bar.set((i + 1) / files.length);
        }
        const total = results.reduce((s, r) => s + r.blob.size, 0), before = results.reduce((s, r) => s + r.before, 0);
        const zipBtn = results.length > 1 && h('button.btn.primary', { onclick: async () => { const Z = await JSZip(); const z = new Z(); const seen = new Set(); results.forEach((r) => { let n = r.name; for (let k = 2; seen.has(n); k++) n = r.name.replace(/(\.[^.]+)$/, `_${k}$1`); seen.add(n); z.file(n, r.blob); }); download(await z.generateAsync({ type: 'blob' }), '处理结果.zip'); } }, icon('folder-down'), '打包下载 ZIP');
        mount(out, h('div.col.mt', banner('ok', `处理完成：${results.length} 张，${fmtSize(before)} → ${fmtSize(total)}` + (cfg.showSaved ? `（${total <= before ? '节省' : '增加'} ${Math.abs(Math.round((1 - total / before) * 100))}%）` : '')), zipBtn && h('div.row', zipBtn), resultList(results)));
      } catch (e) { console.error(e); mount(out, banner('err', e.message)); }
      go.disabled = false; bar.hidden = true;
    }
    paint();
    mount(root, h('div.col', dz, list, optBox, h('div.row', go), bar, out));
    return () => document.removeEventListener('paste', onPaste);
  };
}

const imgCompress = batchTool({
  label: '开始压缩', icon: 'file-down', keepSmaller: true, showSaved: true,
  options: (s) => { Object.assign(s, { fmt: 'keep', q: 0.75, maxW: 0 });
    return h('div.col', h('div.grid.g3', field('输出格式', select([['keep', '保持原格式'], ['jpg', 'JPG（体积小）'], ['webp', 'WebP（更小）']], s.fmt, (v) => { s.fmt = v; })), field('质量', range(0.3, 1, 0.01, s.q, (v) => { s.q = v; }, (v) => Math.round(v * 100) + '%')), field('最大宽度', select([[0, '不限制'], [3840, '3840 px'], [2560, '2560 px'], [1920, '1920 px'], [1280, '1280 px'], [800, '800 px']], s.maxW, (v) => { s.maxW = +v; }))), h('p.hint', 'PNG 为无损格式，质量滑块对其无效；想大幅缩小请选择 JPG / WebP 或限制宽度。'));
  },
  run: (c, f, s) => ({ canvas: s.maxW && c.width > s.maxW ? resizeCanvas(c, s.maxW, (c.height * s.maxW) / c.width) : c, fmt: s.fmt, q: s.q, suffix: '_compressed' }),
});
const imgConvert = batchTool({
  label: '开始转换', icon: 'refresh-cw',
  options: (s) => { Object.assign(s, { fmt: 'png', q: 0.92 });
    return h('div.grid.g2', field('目标格式', seg([['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WebP'], ['bmp', 'BMP']], s.fmt, (v) => { s.fmt = v; })), field('质量（JPG / WebP）', range(0.5, 1, 0.01, s.q, (v) => { s.q = v; }, (v) => Math.round(v * 100) + '%')));
  },
  run: (c, f, s) => ({ canvas: c, fmt: s.fmt, q: s.q, suffix: '' }),
});
const imgResize = batchTool({
  label: '开始调整', icon: 'scaling',
  onFiles: async (files, s) => { s.first = files[0] ? sizeOf(await decode(files[0])) : null; s.hint?.(); },
  options: (s) => { Object.assign(s, { mode: 'px', w: 1280, h: 0, pct: 50, fmt: 'keep', lock: true });
    const hint = h('p.hint'); s.hint = () => { hint.textContent = s.first ? `第一张原始尺寸：${s.first.w} × ${s.first.h}` : ''; };
    const wI = h('input.input', { type: 'number', min: 1, value: s.w, oninput: (e) => { s.w = +e.target.value; } }), hI = h('input.input', { type: 'number', min: 0, value: s.h || '', placeholder: '自动', oninput: (e) => { s.h = +e.target.value || 0; } });
    const px = h('div.grid.g2', field('宽度 (px)', wI), field('高度 (px)', hI, '留空则按比例'));
    const pc = h('div', { hidden: true }, field('缩放比例', range(5, 300, 1, s.pct, (v) => { s.pct = v; }, (v) => v + '%')));
    return h('div.col', seg([['px', '指定像素'], ['pct', '按百分比']], s.mode, (v) => { s.mode = v; px.hidden = v !== 'px'; pc.hidden = v !== 'pct'; }), px, pc, field('输出格式', select([['keep', '保持原格式'], ['png', 'PNG'], ['jpg', 'JPG'], ['webp', 'WebP']], s.fmt, (v) => { s.fmt = v; })), hint);
  },
  run: (c, f, s) => { let w, hh; if (s.mode === 'pct') { w = c.width * s.pct / 100; hh = c.height * s.pct / 100; } else { w = s.w || c.width; hh = s.h || (c.height * w) / c.width; } return { canvas: resizeCanvas(c, w, hh), fmt: s.fmt, q: 0.92, suffix: `_${Math.round(w)}x${Math.round(hh)}` }; },
});
const imgWatermark = batchTool({
  label: '添加水印并生成', icon: 'stamp',
  onFiles: (files, s) => s.preview?.(files),
  options: (s, getFiles) => { Object.assign(s, { text: '仅供参考', size: 5, color: '#ffffff', opacity: 0.5, angle: -30, layout: 'tile', pos: 'br', fmt: 'keep' });
    const pv = h('canvas', { style: 'max-width:100%;max-height:360px;border-radius:10px;background:#000' });
    s.preview = async (files) => { if (!files[0]) return; const c = await toCanvas(files[0], { maxSide: 720 }); pv.width = c.width; pv.height = c.height; pv.getContext('2d').drawImage(draw(c, s), 0, 0); };
    const upd = (k) => (v) => { s[k] = v; s.preview(getFiles()); };
    return h('div.split.wide-r', h('div.col', field('水印文字', h('input.input', { value: s.text, oninput: (e) => upd('text')(e.target.value) })),
      h('div.grid.g2', field('字号（占图片宽度 %）', range(1, 15, 0.5, s.size, upd('size'), (v) => v + '%')), field('透明度', range(0.05, 1, 0.01, s.opacity, upd('opacity'), (v) => Math.round(v * 100) + '%'))),
      h('div.grid.g2', field('颜色', h('input', { type: 'color', value: s.color, oninput: (e) => upd('color')(e.target.value) })), field('旋转角度', range(-90, 90, 1, s.angle, upd('angle'), (v) => v + '°'))),
      field('排布', seg([['tile', '平铺'], ['br', '右下角'], ['center', '居中'], ['bl', '左下角']], s.layout, upd('layout'))), field('输出格式', select([['keep', '保持原格式'], ['png', 'PNG'], ['jpg', 'JPG']], s.fmt, (v) => { s.fmt = v; }))),
      h('div.center', pv));
  },
  run: (c, f, s) => ({ canvas: draw(c, s), fmt: s.fmt, q: 0.92, suffix: '_watermark' }),
});
function draw(src, s) {
  const c = makeCanvas(src.width, src.height); const g = c.getContext('2d'); g.drawImage(src, 0, 0);
  const fs = Math.max(10, (c.width * s.size) / 100); g.font = `700 ${fs}px "Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif`; g.fillStyle = s.color; g.globalAlpha = s.opacity; g.textBaseline = 'middle'; g.textAlign = 'center';
  g.shadowColor = 'rgba(0,0,0,.35)'; g.shadowBlur = fs * 0.08;
  const tw = g.measureText(s.text || ' ').width;
  if (s.layout === 'tile') { const a = (s.angle * Math.PI) / 180, sx = tw * 1.6, sy = fs * 3.2, R = Math.hypot(c.width, c.height); g.save(); g.translate(c.width / 2, c.height / 2); g.rotate(a); for (let y = -R, r = 0; y < R; y += sy, r++) for (let x = -R + (r % 2 ? sx / 2 : 0); x < R; x += sx) g.fillText(s.text, x, y); g.restore(); }
  else { const m = fs * 0.8 + tw / 2; const [x, y] = s.layout === 'center' ? [c.width / 2, c.height / 2] : s.layout === 'bl' ? [m, c.height - fs] : [c.width - m, c.height - fs]; g.save(); g.translate(x, y); g.rotate((s.angle * Math.PI) / 180); g.fillText(s.text, 0, 0); g.restore(); }
  return c;
}
export const tools = { 'img-compress': imgCompress, 'img-convert': imgConvert, 'img-resize': imgResize, 'img-watermark': imgWatermark };
