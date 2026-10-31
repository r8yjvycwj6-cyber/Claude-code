import { h, $, mount, icon, toast, download, store, debounce, loadScript, copyText } from '../ui.js';
import { cleanHtml, printHtml, exportDocx, standaloneHtml, PAPER_CSS } from '../lib/doc.js';

const SAMPLE = `# Markdown 编辑器

在左侧输入，右侧**实时预览**。支持常见语法：

## 功能
- [x] 标题、列表、引用、代码块
- [x] 表格、任务列表、链接、图片
- [x] 导出 **HTML / Word / PDF**

> 灵感随时记录，内容自动保存在浏览器。

| 工具 | 说明 |
| ---- | ---- |
| PPT | 在线制作 |
| PDF | 合并拆分 |

\`\`\`js
console.log('Hello, 工具箱!');
\`\`\`

访问 [在线工具箱](/) 查看更多。
`;
export default async function mdEditor(root) {
  await loadScript('/vendor/marked/marked.umd.js');
  const marked = window.marked; marked.setOptions({ gfm: true, breaks: true });
  const ta = h('textarea.textarea.mono', { spellcheck: false, style: 'height:calc(100vh - 290px);min-height:480px;resize:none;font-size:14px;line-height:1.7', value: store.get('md_draft', SAMPLE) });
  const view = h('div.md-view', { style: 'height:calc(100vh - 290px);min-height:480px;overflow:auto;background:#fff;color:#111;border-radius:12px;border:1px solid var(--border);padding:24px 30px;font:16px/1.75 "Microsoft YaHei","PingFang SC",sans-serif' });
  const style = h('style', PAPER_CSS.replace(/(^|\})\s*(?=[a-z])/g, '$1 .md-view ').replace(/\.md-view body\{[^}]*\}/, ''));
  const stat = h('span.muted.small');
  const save = debounce(() => store.set('md_draft', ta.value), 400);
  const render = () => { view.innerHTML = cleanHtml(marked.parse(ta.value)); stat.textContent = `${ta.value.replace(/\s/g, '').length} 字`; save(); };
  ta.oninput = render;
  let syncing = false; const link = (a, b) => a.addEventListener('scroll', () => { if (syncing) return; syncing = true; b.scrollTop = (a.scrollTop / (a.scrollHeight - a.clientHeight || 1)) * (b.scrollHeight - b.clientHeight); requestAnimationFrame(() => (syncing = false)); }); link(ta, view); link(view, ta);
  const wrapSel = (l, r = l, ph = '文字') => { const s = ta.selectionStart, e = ta.selectionEnd, t = ta.value.slice(s, e) || ph; ta.setRangeText(l + t + r, s, e, 'select'); ta.focus(); ta.setSelectionRange(s + l.length, s + l.length + t.length); render(); };
  const linePrefix = (p) => { const s = ta.selectionStart; const ls = ta.value.lastIndexOf('\n', s - 1) + 1; ta.setRangeText(p, ls, ls, 'end'); ta.focus(); render(); };
  const tbtn = (ic, tip, fn) => h('button.btn.sm.ghost.icon', { title: tip, onclick: fn }, icon(ic));
  const tb = h('div.row', { style: 'gap:2px' }, tbtn('bold', '加粗', () => wrapSel('**')), tbtn('italic', '斜体', () => wrapSel('*')), tbtn('strikethrough', '删除线', () => wrapSel('~~')), tbtn('heading-2', '标题', () => linePrefix('## ')), tbtn('quote', '引用', () => linePrefix('> ')), tbtn('list', '列表', () => linePrefix('- ')), tbtn('list-todo', '任务', () => linePrefix('- [ ] ')), tbtn('code', '行内代码', () => wrapSel('`')), tbtn('square-code', '代码块', () => wrapSel('\n```\n', '\n```\n', '代码')), tbtn('link', '链接', () => wrapSel('[', '](https://)', '链接文字')), tbtn('image', '图片', () => wrapSel('![', '](https://)', '图片说明')), tbtn('table', '表格', () => wrapSel('\n| 列1 | 列2 |\n| --- | --- |\n| ', ' |  |\n', '内容')), tbtn('minus', '分隔线', () => wrapSel('\n---\n', '', '')));
  const fileIn = h('input', { type: 'file', accept: '.md,.markdown,.txt', hidden: true, onchange: async () => { const f = fileIn.files[0]; fileIn.value = ''; if (f) { ta.value = await f.text(); render(); } } });
  const run = async (b, fn) => { b.disabled = true; try { await fn(); } catch (e) { toast(e.message, 'err'); } b.disabled = false; };
  const html = () => view.innerHTML;
  mount(root, h('div.col', { style: 'gap:12px' }, style, h('div.row', tb, h('div.sp'), stat, h('button.btn.sm', { onclick: () => fileIn.click() }, icon('folder-open'), '打开 .md'), fileIn,
    h('button.btn.sm', { onclick: () => download(new Blob([ta.value], { type: 'text/markdown;charset=utf-8' }), '文档.md') }, icon('download'), '.md'),
    h('button.btn.sm', { onclick: () => download(new Blob([standaloneHtml(html(), '文档')], { type: 'text/html' }), '文档.html') }, icon('code'), 'HTML'),
    h('button.btn.sm', { onclick: () => printHtml(html(), '文档') }, icon('printer'), 'PDF / 打印'),
    h('button.btn.sm.primary', { onclick: (e) => run(e.currentTarget, () => exportDocx(html(), '文档')) }, icon('file-down'), '导出 Word')),
    h('div.grid.g2', { style: 'gap:12px' }, ta, view)));
  render();
}
