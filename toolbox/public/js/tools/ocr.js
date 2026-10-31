import { h, mount, icon, dropzone, toast, download, fmtSize, field, seg, banner, spinner, progress, select, copyText, checkbox, baseName } from '../ui.js';
import { recognize, tidyText, disposeOcr } from '../lib/ocr.js';
import { toCanvas } from '../lib/img.js';

export default function ocrTool(root) {
  let files = [];
  const o = { lang: 'chi_sim+eng', tidy: true, enhance: false };
  const out = h('div'); const bar = progress(); const stat = h('span.muted.small'); const prog = h('div.col.gap-s', { hidden: true }, bar, stat);
  const list = h('div.col');
  const dz = dropzone({ accept: 'image/*', multiple: true, title: '点击选择图片，或拖拽 / 粘贴图片到此处', hint: '支持截图、照片、扫描件；中英文混排识别，全程在本机完成', icon: 'scan-text', onFiles: (f) => { files = files.concat(f); paint(); } });
  const go = h('button.btn.primary.lg', { onclick: run }, icon('scan-text'), '开始识别');
  const onPaste = (e) => { const imgs = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/')); if (imgs.length) { files = files.concat(imgs); paint(); toast('已粘贴图片', 'ok'); } };
  document.addEventListener('paste', onPaste);
  function paint() {
    mount(list, files.map((f, i) => h('div.file-item', h('img', { src: URL.createObjectURL(f), style: 'width:46px;height:46px;object-fit:cover;border-radius:8px' }), h('div.grow', h('div.fi-name.ellipsis', f.name || '粘贴的图片'), h('div.fi-meta', fmtSize(f.size))), h('button.btn.sm.ghost.icon', { onclick: () => { files.splice(i, 1); paint(); } }, icon('x')))));
    go.disabled = !files.length;
  }
  async function run() {
    go.disabled = true; prog.hidden = false; mount(out);
    const results = [];
    try {
      for (let i = 0; i < files.length; i++) {
        stat.textContent = `第 ${i + 1}/${files.length} 张：准备中…`;
        const c = await toCanvas(files[i], { maxSide: 3000, bg: '#fff' });
        if (o.enhance) { const g = c.getContext('2d'); g.globalCompositeOperation = 'source-over'; const d = g.getImageData(0, 0, c.width, c.height); const p = d.data; for (let k = 0; k < p.length; k += 4) { const y = 0.299 * p[k] + 0.587 * p[k + 1] + 0.114 * p[k + 2]; const v = Math.max(0, Math.min(255, (y - 128) * 1.5 + 128)); p[k] = p[k + 1] = p[k + 2] = v; } g.putImageData(d, 0, 0); }
        const r = await recognize(c, { lang: o.lang, onProgress: (p, m) => { bar.set((i + p) / files.length); stat.textContent = `第 ${i + 1}/${files.length} 张：${m}`; } });
        results.push({ name: files[i].name || '粘贴的图片', text: o.tidy ? tidyText(r.text) : r.text, conf: r.confidence });
      }
      const all = results.map((r) => (results.length > 1 ? `【${r.name}】\n` : '') + r.text).join('\n\n');
      const ta = h('textarea.textarea', { style: 'min-height:320px;font-size:15px', value: all });
      mount(out, h('div.col.mt', banner('ok', `识别完成，共 ${all.replace(/\s/g, '').length} 个字符，平均置信度 ${Math.round(results.reduce((s, r) => s + r.conf, 0) / results.length)}%`), ta,
        h('div.row', h('button.btn.primary', { onclick: () => copyText(ta.value) }, icon('copy'), '复制文字'), h('button.btn', { onclick: () => download(new Blob([ta.value], { type: 'text/plain;charset=utf-8' }), 'OCR识别结果.txt') }, icon('download'), '下载 .txt'))));
    } catch (e) { console.error(e); mount(out, banner('err', '识别失败：' + e.message)); }
    prog.hidden = true; go.disabled = false;
  }
  paint();
  mount(root, h('div.col', dz, list,
    h('div.panel', h('div.grid.g3', field('识别语言', select([['chi_sim+eng', '简体中文 + 英文'], ['eng', '仅英文'], ['chi_sim', '仅简体中文']], o.lang, (v) => { o.lang = v; })),
      field('选项', h('div.col.gap-s', checkbox('自动清理多余空格', o.tidy, (v) => { o.tidy = v; }), checkbox('增强对比度（图片偏灰时）', o.enhance, (v) => { o.enhance = v; }))))),
    h('div.row', go), prog, out));
  return () => { document.removeEventListener('paste', onPaste); disposeOcr(); };
}
