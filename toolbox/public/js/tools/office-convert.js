import { h, mount, icon, dropzone, toast, download, fmtSize, field, select, banner, spinner, progress, upload, extOf, baseName } from '../ui.js';

const DOC = ['doc', 'docx', 'odt', 'rtf', 'txt', 'html', 'htm', 'wps', 'md'];
const SHEET = ['xls', 'xlsx', 'ods', 'csv', 'et'];
const SLIDE = ['ppt', 'pptx', 'odp', 'dps'];
const TARGETS = {
  doc: [['pdf', 'PDF'], ['docx', 'Word (.docx)'], ['doc', 'Word 97-2003 (.doc)'], ['odt', 'OpenDocument (.odt)'], ['rtf', 'RTF'], ['txt', '纯文本 (.txt)'], ['html', 'HTML']],
  sheet: [['pdf', 'PDF'], ['xlsx', 'Excel (.xlsx)'], ['xls', 'Excel 97-2003 (.xls)'], ['ods', 'OpenDocument (.ods)'], ['csv', 'CSV'], ['html', 'HTML']],
  slide: [['pdf', 'PDF'], ['pptx', 'PowerPoint (.pptx)'], ['ppt', 'PowerPoint 97-2003 (.ppt)'], ['odp', 'OpenDocument (.odp)'], ['png', '首张幻灯片图片 (.png)']],
  pdf: [['docx', 'Word (.docx)'], ['odt', 'OpenDocument (.odt)'], ['pptx', 'PowerPoint (.pptx)'], ['txt', '纯文本 (.txt)']],
};
const kindOf = (ext) => (DOC.includes(ext) ? 'doc' : SHEET.includes(ext) ? 'sheet' : SLIDE.includes(ext) ? 'slide' : ext === 'pdf' ? 'pdf' : null);

function makeTool(cfg) {
  return (root, ctx) => {
    let file = null;
    const area = h('div');
    const dz = dropzone({ accept: cfg.accept, title: cfg.title, hint: cfg.hint || `文件将上传到服务器，用 LibreOffice 转换，最大 ${ctx.health.maxUploadMB}MB，处理完成后自动删除`, icon: cfg.icon, onFiles: ([f]) => pick(f) });
    mount(root, dz, area);
    function pick(f) {
      const kind = kindOf(extOf(f.name));
      if (!kind) return toast('不支持的文件类型：.' + extOf(f.name), 'err');
      file = f; dz.hidden = true; let target = cfg.target || TARGETS[kind][0][0];
      const out = h('div');
      const go = h('button.btn.primary.lg', { onclick: run }, icon('refresh-cw'), cfg.label || '开始转换');
      mount(area, h('div.col',
        h('div.file-item', h('div.fi-ico', icon(cfg.icon)), h('div.grow', h('div.fi-name.ellipsis', f.name), h('div.fi-meta', fmtSize(f.size))), h('button.btn.sm.ghost', { onclick: () => { dz.hidden = false; mount(area); } }, icon('x'), '更换')),
        h('div.panel', h('div.col', cfg.target ? h('div.row', h('span.lbl', '转换为'), h('span.chip.pri', cfg.targetLabel)) : field('转换为', select(TARGETS[kind], target, (v) => { target = v; })),
          cfg.note && banner('info', cfg.note))), h('div.row', go), out));
      async function run() {
        if (!ctx.requireLogin('Office 文档转换在服务器上处理，请先登录（仅需邮箱 + 密码）')) return;
        go.disabled = true; const bar = progress(); const stat = h('span.muted.small', '正在上传…');
        mount(out, h('div.panel.col', h('div.row', spinner(), stat), bar));
        const fd = new FormData(); fd.append('target', target); fd.append('file', file);
        try {
          const r = await upload('/api/office/convert', fd, { expect: 'blob', onProgress: (p) => { bar.set(p); if (p >= 1) { stat.textContent = '服务器转换中，请稍候（大文件可能需要一两分钟）…'; bar.classList.add('indet'); } else stat.textContent = `正在上传 ${Math.round(p * 100)}%`; } });
          const name = r.name || `${baseName(file.name)}.${target}`;
          mount(out, h('div.panel.col', h('div.row', icon('circle-check'), h('b', '转换完成')), h('div.row', h('span.chip', fmtSize(file.size)), icon('arrow-right'), h('span.chip.ok', fmtSize(r.blob.size))),
            h('div.row', h('button.btn.primary', { onclick: () => download(r.blob, name) }, icon('download'), `下载 ${name}`))));
          download(r.blob, name);
        } catch (e) { mount(out, banner('err', e.message)); if (e.code === 'LOGIN_REQUIRED') ctx.requireLogin(); }
        go.disabled = false;
      }
    }
  };
}
const ALL = [...DOC, ...SHEET, ...SLIDE, 'pdf'].map((e) => '.' + e).join(',');
export const tools = {
  'office-convert': makeTool({ accept: ALL, title: '选择 Word / Excel / PPT / WPS 文件', icon: 'file-cog' }),
  'pdf-to-word': makeTool({ accept: '.pdf,application/pdf', title: '选择要转换的 PDF', icon: 'file-type', target: 'docx', targetLabel: 'Word (.docx)', label: '转换为 Word',
    note: '适合以文字为主的 PDF。复杂排版、表格或扫描件（图片型 PDF）的还原效果有限；扫描件请先使用「图片文字识别」。' }),
  'word-to-pdf': makeTool({ accept: '.doc,.docx,.wps,.odt,.rtf,.txt', title: '选择 Word / WPS 文档', icon: 'file-output', target: 'pdf', targetLabel: 'PDF', label: '转换为 PDF' }),
  'ppt-to-pdf': makeTool({ accept: '.ppt,.pptx,.odp,.dps', title: '选择 PPT 演示文稿', icon: 'presentation', target: 'pdf', targetLabel: 'PDF', label: '转换为 PDF' }),
  'excel-to-pdf': makeTool({ accept: '.xls,.xlsx,.ods,.csv,.et', title: '选择 Excel 表格', icon: 'sheet', target: 'pdf', targetLabel: 'PDF', label: '转换为 PDF' }),
};
