// 文档类工具公共函数：HTML 清理、打印为 PDF、导出 Word
import { h, api, download, toast } from '../ui.js';

const BAD_TAGS = 'script,style,iframe,object,embed,link,meta,base,form,button,textarea,select,svg,math';
/** 去掉脚本 / 事件属性 / javascript: 链接，保留常见排版标签与行内样式 */
export function cleanHtml(html) {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  doc.body.querySelectorAll(BAD_TAGS).forEach((n) => n.remove());
  doc.body.querySelectorAll('input').forEach((n) => { if (n.type === 'checkbox') n.setAttribute('disabled', ''); else n.remove(); });
  doc.body.querySelectorAll('*').forEach((n) => {
    for (const a of [...n.attributes]) {
      const name = a.name.toLowerCase(), v = a.value.trim().toLowerCase();
      if (name.startsWith('on') || ((name === 'href' || name === 'src' || name === 'xlink:href') && /^(javascript|vbscript|data:text\/html)/.test(v.replace(/\s/g, '')))) n.removeAttribute(a.name);
      else if (name === 'style' && /expression|javascript:|url\s*\(\s*['"]?\s*(?!data:image)/i.test(a.value)) n.removeAttribute('style');
    }
    if (n.tagName === 'A') { n.setAttribute('rel', 'noopener noreferrer'); n.setAttribute('target', '_blank'); }
  });
  return doc.body.innerHTML;
}
export const PAPER_CSS = `
  body{margin:0;font:16px/1.75 "Microsoft YaHei","PingFang SC","Noto Sans CJK SC",sans-serif;color:#111}
  h1{font-size:2em;margin:.67em 0}h2{font-size:1.5em;margin:.75em 0}h3{font-size:1.17em;margin:.8em 0}
  p{margin:.6em 0}img{max-width:100%}blockquote{margin:1em 0;padding:.2em 1em;border-left:4px solid #c7c9d9;color:#555;background:#f6f7fb}
  pre{background:#f4f5f9;padding:12px 14px;border-radius:6px;overflow:auto;white-space:pre-wrap}code{font-family:Consolas,Menlo,monospace;background:#f1f2f7;padding:.1em .35em;border-radius:4px}pre code{background:none;padding:0}
  table{border-collapse:collapse;width:100%}td,th{border:1px solid #aab;padding:6px 10px}th{background:#f1f2f7}hr{border:0;border-top:1px solid #ccd;margin:1.5em 0}
  ul,ol{padding-left:2em}a{color:#4f46e5}`;

/** 通过隐藏 iframe 调起浏览器打印（可选“另存为 PDF”），文字保持矢量 */
export function printHtml(html, title = '文档', pageCss = '') {
  const full = `<!doctype html><html><head><meta charset="utf-8"><title>${title.replace(/[<>&]/g, '')}</title><style>${PAPER_CSS}@page{size:A4;margin:18mm}${pageCss}</style></head><body>${cleanHtml(html)}</body></html>`;
  const url = URL.createObjectURL(new Blob([full], { type: 'text/html' }));
  const f = h('iframe', { src: url, style: 'position:fixed;right:0;bottom:0;width:0;height:0;border:0' });
  f.onload = () => { setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch { toast('无法调起打印，请使用 Ctrl+P', 'err'); } setTimeout(() => { f.remove(); URL.revokeObjectURL(url); }, 60000); }, 300); };
  document.body.append(f);
}
export async function exportDocx(html, title) {
  const r = await fetch('/api/office/html-to-docx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html, title }) });
  if (!r.ok) { let m = '导出失败'; try { m = (await r.json()).error; } catch {} throw new Error(m); }
  download(await r.blob(), (title || '文档') + '.docx');
}
export function standaloneHtml(html, title) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title.replace(/[<>&]/g, '')}</title><style>${PAPER_CSS}body{max-width:820px;margin:40px auto;padding:0 20px}</style></head><body>${cleanHtml(html)}</body></html>`;
}
