import { h, $, $$, mount, icon, toast, download, field, select, modal, promptBox, store, debounce, loadScript, readAs, banner, spinner, baseName, dropzone } from '../ui.js';
import { cleanHtml, printHtml, exportDocx, standaloneHtml, PAPER_CSS } from '../lib/doc.js';

const FONTS = [['Microsoft YaHei', '微软雅黑'], ['SimSun', '宋体'], ['SimHei', '黑体'], ['KaiTi', '楷体'], ['FangSong', '仿宋'], ['Arial', 'Arial'], ['Times New Roman', 'Times New Roman'], ['Georgia', 'Georgia'], ['Courier New', 'Courier New']];
const SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40, 48];
const SAMPLE = '<h1>在线文档标题</h1><p>在这里开始写作。支持<b>加粗</b>、<i>斜体</i>、<u>下划线</u>、列表、表格、图片等，写完可导出为 <b>Word (.docx)</b>、PDF 或 HTML。</p><ul><li>内容自动保存在浏览器中</li><li>可以打开已有的 .docx 文件继续编辑</li></ul><p><br></p>';

export default function wordEditor(root, ctx) {
  const draft = store.get('word_draft', null);
  const title = h('input.input', { value: draft?.title || '未命名文档', style: 'font-weight:700;max-width:320px', 'aria-label': '文档标题' });
  const paper = h('div', { contentEditable: 'true', spellcheck: false, style: 'width:794px;max-width:100%;min-height:1050px;background:#fff;color:#111;margin:0 auto;padding:72px 80px;box-shadow:var(--shadow-lg);outline:none;border-radius:4px;font:16px/1.75 "Microsoft YaHei","PingFang SC",sans-serif;box-sizing:border-box' });
  paper.innerHTML = draft?.html ? cleanHtml(draft.html) : SAMPLE;
  const style = h('style', PAPER_CSS.replace(/(^|\})\s*(?=[a-z])/g, '$1 .word-paper ').replace(/body\{[^}]*\}/, '')); paper.classList.add('word-paper');
  const stat = h('span.muted.small');
  const cmd = (c, v = null) => { paper.focus(); document.execCommand('styleWithCSS', false, true); document.execCommand(c, false, v); sync(); };
  const save = debounce(() => store.set('word_draft', { title: title.value, html: paper.innerHTML }), 500);
  function sync() { const t = paper.innerText.replace(/\s/g, ''); stat.textContent = `${t.length} 字`; save(); }
  paper.addEventListener('input', sync); title.addEventListener('input', save);
  paper.addEventListener('paste', (e) => { const html = e.clipboardData.getData('text/html'); if (html) { e.preventDefault(); document.execCommand('insertHTML', false, cleanHtml(html)); } });
  let range = null; document.addEventListener('selectionchange', () => { const s = getSelection(); if (s.rangeCount && paper.contains(s.anchorNode)) range = s.getRangeAt(0).cloneRange(); });
  const restore = () => { paper.focus(); if (range) { const s = getSelection(); s.removeAllRanges(); s.addRange(range); } };
  const btn = (ic, tip, fn) => h('button.btn.sm.ghost.icon', { title: tip, onmousedown: (e) => e.preventDefault(), onclick: fn }, icon(ic));
  const sel = (opts, def, fn, w) => { const s = select(opts, def, (v) => { restore(); fn(v); }); s.style.cssText = `width:${w}px;height:32px;font-size:13px;border-radius:8px`; return s; };
  const sep = () => h('span', { style: 'width:1px;height:20px;background:var(--border-2);margin:0 4px' });
  const color = (tip, ic, c, fn) => h('label.btn.sm.ghost.icon', { title: tip, style: 'position:relative;cursor:pointer' }, icon(ic), h('span', { style: `position:absolute;left:8px;right:8px;bottom:4px;height:3px;border-radius:2px;background:${c}` }), h('input', { type: 'color', value: c, style: 'position:absolute;inset:0;opacity:0;cursor:pointer', onmousedown: () => { }, oninput: (e) => { restore(); fn(e.target.value); e.target.previousSibling.style.background = e.target.value; } }));
  function setSize(px) { restore(); document.execCommand('styleWithCSS', false, false); document.execCommand('fontSize', false, '7'); $$('font[size="7"]', paper).forEach((f) => { const s = h('span', { style: `font-size:${px}px` }); s.innerHTML = f.innerHTML; f.replaceWith(s); }); sync(); }
  async function insertTable() {
    const v = await promptBox('插入表格（行 × 列）', '3x3', '例如 4x3'); if (!v) return; const m = /^(\d{1,2})\s*[x×*]\s*(\d{1,2})$/i.exec(v.trim()); if (!m) return toast('格式应为 行x列，如 3x3', 'err');
    const cell = (t) => `<${t} style="border:1px solid #999;padding:6px 10px">${t === 'th' ? '标题' : '&nbsp;'}</${t}>`;
    let html = '<table border="1" style="border-collapse:collapse;width:100%"><tbody>'; for (let r = 0; r < +m[1]; r++) { html += '<tr>' + Array.from({ length: +m[2] }, () => cell(r ? 'td' : 'th')).join('') + '</tr>'; } html += '</tbody></table><p><br></p>';
    restore(); document.execCommand('insertHTML', false, html); sync();
  }
  const imgIn = h('input', { type: 'file', accept: 'image/*', hidden: true, onchange: async () => { const f = imgIn.files[0]; imgIn.value = ''; if (!f) return; const { toCanvas } = await import('../lib/img.js'); const c = await toCanvas(f, { maxSide: 1400 }); restore(); document.execCommand('insertHTML', false, `<img src="${f.type === 'image/png' ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.9)}" style="max-width:100%">`); sync(); } });
  async function link() { const url = await promptBox('插入链接', 'https://'); if (url && /^(https?:|mailto:)/i.test(url)) { restore(); document.execCommand('createLink', false, url); sync(); } else if (url) toast('仅支持 http(s) 或 mailto 链接', 'err'); }
  const docxIn = h('input', { type: 'file', accept: '.docx', hidden: true, onchange: async () => {
    const f = docxIn.files[0]; docxIn.value = ''; if (!f) return;
    try { await loadScript('/vendor/mammoth/mammoth.browser.min.js'); const r = await window.mammoth.convertToHtml({ arrayBuffer: await readAs(f) }, { convertImage: window.mammoth.images.imgElement(async (img) => ({ src: `data:${img.contentType};base64,${await img.read('base64')}` })) }); paper.innerHTML = cleanHtml(r.value) || '<p><br></p>'; title.value = baseName(f.name); sync(); toast('已导入（仅保留文字、表格、图片等主要排版）', 'ok', 3500); }
    catch (e) { toast('无法读取该 .docx：' + e.message, 'err'); }
  } });
  const run = async (b, fn) => { b.disabled = true; try { await fn(); } catch (e) { toast(e.message, 'err'); } b.disabled = false; };
  const tb = h('div.row', { style: 'gap:2px;padding:8px 10px;background:var(--surface);border:1px solid var(--border);border-radius:14px;position:sticky;top:calc(var(--header-h) + 8px);z-index:20;box-shadow:var(--shadow-sm)' },
    btn('undo-2', '撤销', () => cmd('undo')), btn('redo-2', '重做', () => cmd('redo')), sep(),
    sel([['p', '正文'], ['h1', '标题 1'], ['h2', '标题 2'], ['h3', '标题 3'], ['blockquote', '引用'], ['pre', '代码块']], 'p', (v) => cmd('formatBlock', v), 96),
    sel(FONTS, 'Microsoft YaHei', (v) => cmd('fontName', v), 120), sel(SIZES.map((s) => [s, s + ' px']), 16, (v) => setSize(+v), 80), sep(),
    btn('bold', '加粗 (Ctrl+B)', () => cmd('bold')), btn('italic', '斜体 (Ctrl+I)', () => cmd('italic')), btn('underline', '下划线 (Ctrl+U)', () => cmd('underline')), btn('strikethrough', '删除线', () => cmd('strikeThrough')),
    color('字体颜色', 'baseline', '#e11d48', (c) => cmd('foreColor', c)), color('高亮', 'highlighter', '#fde047', (c) => cmd('hiliteColor', c)), sep(),
    btn('align-left', '左对齐', () => cmd('justifyLeft')), btn('align-center', '居中', () => cmd('justifyCenter')), btn('align-right', '右对齐', () => cmd('justifyRight')), btn('align-justify', '两端对齐', () => cmd('justifyFull')), sep(),
    btn('list', '无序列表', () => cmd('insertUnorderedList')), btn('list-ordered', '有序列表', () => cmd('insertOrderedList')), btn('indent-increase', '增加缩进', () => cmd('indent')), btn('indent-decrease', '减少缩进', () => cmd('outdent')), sep(),
    btn('table', '插入表格', insertTable), btn('image', '插入图片', () => imgIn.click()), btn('link', '插入链接', link), btn('minus', '分隔线', () => cmd('insertHorizontalRule')), btn('remove-formatting', '清除格式', () => cmd('removeFormat')), imgIn);
  const exportBtn = h('button.btn.sm.primary', { onclick: (e) => run(e.currentTarget, () => exportDocx(paper.innerHTML, title.value || '文档')) }, icon('file-down'), '导出 Word');
  const bar = h('div.row', title, h('div.sp'), stat,
    h('button.btn.sm', { onclick: () => docxIn.click() }, icon('folder-open'), '打开 .docx'), docxIn,
    h('button.btn.sm', { onclick: () => printHtml(paper.innerHTML, title.value) }, icon('printer'), '导出 PDF / 打印'),
    h('button.btn.sm', { onclick: () => download(new Blob([standaloneHtml(paper.innerHTML, title.value)], { type: 'text/html' }), (title.value || '文档') + '.html') }, icon('code'), 'HTML'),
    h('button.btn.sm', { onclick: () => download(new Blob([paper.innerText], { type: 'text/plain;charset=utf-8' }), (title.value || '文档') + '.txt') }, 'TXT'), exportBtn);
  sync();
  mount(root, h('div.col', { style: 'gap:12px' }, style, bar, tb, h('div', { style: 'background:var(--surface-3);border:1px solid var(--border);border-radius:18px;padding:24px 14px;overflow:auto' }, paper)));
}
