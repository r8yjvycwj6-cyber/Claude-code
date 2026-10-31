import { h, $, mount, icon, dropzone, toast, download, fmtSize, field, select, banner, spinner, tabs, baseName, readAs, loadScript, esc, copyText, checkbox } from '../ui.js';

async function readSheet(file) {
  await loadScript('/vendor/xlsx/xlsx.full.min.js'); const X = window.XLSX; const ext = (file.name.split('.').pop() || '').toLowerCase();
  const buf = await readAs(file);
  if (ext === 'json') { const data = JSON.parse(new TextDecoder().decode(buf)); const arr = Array.isArray(data) ? data : [data]; const wb = X.utils.book_new(); X.utils.book_append_sheet(wb, X.utils.json_to_sheet(arr), 'Sheet1'); return wb; }
  if (ext === 'csv' || ext === 'txt' || ext === 'tsv') { let text; try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { text = new TextDecoder('gbk').decode(buf); } return X.read(text.replace(/^﻿/, ''), { type: 'string', raw: true }); }
  return X.read(buf, { type: 'array', cellDates: true });
}
export default function sheetConvert(root) {
  const area = h('div');
  const dz = dropzone({ accept: '.xlsx,.xls,.xlsm,.ods,.csv,.tsv,.json,.html,.txt', title: '选择 Excel / CSV / JSON 文件', hint: '支持 xlsx、xls、ods、csv（自动识别 UTF-8 / GBK 编码）、json、html 表格', icon: 'table', onFiles: ([f]) => load(f) });
  mount(root, dz, area);
  async function load(f) {
    mount(area, h('div.row', spinner(), '解析中…'));
    try {
      const wb = await readSheet(f); const X = window.XLSX; let active = wb.SheetNames[0]; const names = wb.SheetNames; let bom = true;
      const preview = h('div.scroll-y'); const info = h('span.muted.small');
      const paintPreview = () => {
        const ws = wb.Sheets[active]; const rows = X.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }); const shown = rows.slice(0, 300); const cols = Math.max(1, ...shown.map((r) => r.length));
        info.textContent = `共 ${rows.length} 行 × ${cols} 列` + (rows.length > 300 ? '（预览前 300 行）' : '');
        mount(preview, h('table.table', h('thead', h('tr', h('th', { style: 'width:44px' }, '#'), Array.from({ length: cols }, (_, i) => h('th', X.utils.encode_col(i))))), h('tbody', shown.map((r, i) => h('tr', h('td.muted', i + 1), Array.from({ length: cols }, (_, c) => h('td', { style: 'max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, r[c] ?? '')))))));
      };
      const sheetTabs = names.length > 1 ? tabs(names.map((n) => [n, n]), active, (v) => { active = v; paintPreview(); }) : null;
      const base = baseName(f.name); const ws = () => wb.Sheets[active];
      const out = (fmt) => { try {
        if (fmt === 'xlsx' || fmt === 'xls' || fmt === 'ods') return download(new Blob([X.write(wb, { bookType: fmt, type: 'array' })]), `${base}.${fmt}`);
        if (fmt === 'csv') return download(new Blob([(bom ? '﻿' : '') + X.utils.sheet_to_csv(ws())], { type: 'text/csv;charset=utf-8' }), `${base}_${active}.csv`);
        if (fmt === 'tsv') return download(new Blob([(bom ? '﻿' : '') + X.utils.sheet_to_csv(ws(), { FS: '\t' })], { type: 'text/tab-separated-values;charset=utf-8' }), `${base}_${active}.tsv`);
        if (fmt === 'json') return download(new Blob([JSON.stringify(X.utils.sheet_to_json(ws(), { defval: '' }), null, 2)], { type: 'application/json' }), `${base}_${active}.json`);
        if (fmt === 'html') return download(new Blob([`<!doctype html><meta charset="utf-8"><style>table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:4px 8px}</style>` + X.utils.sheet_to_html(ws())], { type: 'text/html' }), `${base}_${active}.html`);
        if (fmt === 'md') { const rows = X.utils.sheet_to_json(ws(), { header: 1, raw: false, defval: '' }); if (!rows.length) return; const w = Math.max(...rows.map((r) => r.length)); const line = (r) => '| ' + Array.from({ length: w }, (_, i) => String(r[i] ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |'; const md = [line(rows[0]), '| ' + Array(w).fill('---').join(' | ') + ' |', ...rows.slice(1).map(line)].join('\n'); return copyText(md, 'Markdown 表格已复制'); }
      } catch (e) { toast('导出失败：' + e.message, 'err'); } };
      paintPreview();
      mount(area, h('div.col', h('div.file-item', h('div.fi-ico', icon('table')), h('div.grow', h('div.fi-name.ellipsis', f.name), h('div.fi-meta', `${fmtSize(f.size)} · ${names.length} 个工作表`)), h('button.btn.sm.ghost', { onclick: () => mount(area) }, icon('x'), '更换')),
        h('div.panel', h('div.col', h('b', '转换为'), h('div.row', [['xlsx', 'Excel (.xlsx)'], ['xls', 'Excel 97 (.xls)'], ['ods', 'ODS'], ['csv', 'CSV'], ['tsv', 'TSV'], ['json', 'JSON'], ['html', 'HTML'], ['md', '复制为 Markdown']].map(([k, n]) => h('button.btn' + (k === 'xlsx' ? '.primary' : ''), { onclick: () => out(k) }, icon(k === 'md' ? 'copy' : 'download'), n))), checkbox('CSV / TSV 添加 UTF-8 BOM（Excel 打开中文不乱码，推荐）', true, (v) => { bom = v; }), names.length > 1 && h('p.hint', 'CSV / JSON / HTML / Markdown 仅导出当前选中的工作表；Excel / ODS 导出全部工作表。'))),
        sheetTabs, h('div.row', h('b', '预览'), info), preview));
    } catch (e) { console.error(e); mount(area, banner('err', '无法解析该文件：' + e.message)); }
  }
}
