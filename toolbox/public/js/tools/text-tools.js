import { h, $, mount, icon, toast, field, seg, select, tabs, copyText, download, loadScript, checkbox, esc, banner, spinner, debounce } from '../ui.js';

const stat = (k, v, cls = '') => h('div.stat' + cls, h('div.k', k), h('div.v', v));
const area = (props = {}) => h('textarea.textarea', { style: 'min-height:220px;font-size:15px', ...props });
const outBar = (get, name = '结果.txt') => h('div.row', h('button.btn.primary', { onclick: () => copyText(get()) }, icon('copy'), '复制结果'), h('button.btn', { onclick: () => download(new Blob([get()], { type: 'text/plain;charset=utf-8' }), name) }, icon('download'), '下载'));

/* ───────── 字数统计 ───────── */
function wordCount(root) {
  const ta = area({ placeholder: '在此粘贴或输入文字…', style: 'min-height:300px;font-size:15px' }); const grid = h('div.grid.g4');
  const calc = () => { const t = ta.value; const cn = (t.match(/[一-鿿㐀-䶿]/g) || []).length; const en = (t.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length; const num = (t.match(/\d+(?:\.\d+)?/g) || []).length; const punct = (t.match(/[，。！？；：、“”‘’（）【】《》…—,.!?;:'"()\[\]{}\-]/g) || []).length;
    const lines = t ? t.split('\n').length : 0, paras = t.split(/\n\s*\n|\n/).filter((s) => s.trim()).length, sent = (t.match(/[^。！？.!?\n]+[。！？.!?]*/g) || []).filter((s) => s.trim()).length; const read = (cn + en) / 300;
    mount(grid, stat('总字数（汉字+单词）', cn + en, '.pri'), stat('汉字', cn), stat('英文单词', en), stat('数字', num), stat('字符（含空格）', [...t].length), stat('字符（不含空格）', [...t.replace(/\s/g, '')].length), stat('标点', punct), stat('行数', lines), stat('段落', paras), stat('句子', sent), stat('阅读时间', read < 1 ? '< 1 分钟' : `约 ${Math.ceil(read)} 分钟`), stat('朗读时间', (cn + en) / 200 < 1 ? '< 1 分钟' : `约 ${Math.ceil((cn + en) / 200)} 分钟`)); };
  ta.addEventListener('input', calc); mount(root, h('div.col', grid, ta, h('div.row', h('button.btn.sm', { onclick: () => { ta.value = ''; calc(); } }, '清空'), h('button.btn.sm', { onclick: async () => { try { ta.value = await navigator.clipboard.readText(); calc(); } catch { toast('无法读取剪贴板，请手动粘贴', 'err'); } } }, icon('clipboard-paste'), '粘贴')))); calc();
}

/* ───────── 大小写 / 命名转换 ───────── */
function caseConvert(root) {
  const words = (s) => s.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[\s_\-./]+/).filter(Boolean);
  const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  const MODES = [['UPPER', '全部大写', (s) => s.toUpperCase()], ['lower', '全部小写', (s) => s.toLowerCase()], ['Title', '每个单词首字母大写', (s) => s.toLowerCase().replace(/(^|[\s\-_(])([a-z])/g, (m, a, b) => a + b.toUpperCase())], ['Sentence', '句首大写', (s) => s.toLowerCase().replace(/(^\s*|[.!?]\s+)([a-z])/g, (m, a, b) => a + b.toUpperCase())], ['camelCase', '小驼峰', (s) => words(s).map((w, i) => (i ? cap(w) : w.toLowerCase())).join('')], ['PascalCase', '大驼峰', (s) => words(s).map(cap).join('')], ['snake_case', '下划线', (s) => words(s).map((w) => w.toLowerCase()).join('_')], ['CONSTANT_CASE', '常量', (s) => words(s).map((w) => w.toUpperCase()).join('_')], ['kebab-case', '短横线', (s) => words(s).map((w) => w.toLowerCase()).join('-')], ['aLtErNaTe', '交替大小写', (s) => [...s].map((c, i) => (i % 2 ? c.toLowerCase() : c.toUpperCase())).join('')], ['反转', '反转文字', (s) => [...s].reverse().join('')]];
  const src = area({ placeholder: '输入文本，如：hello world / user_name / getUserInfo', value: 'hello world from toolbox' }); const list = h('div.col.gap-s');
  const run = () => mount(list, MODES.map(([k, d, fn]) => { let r = ''; try { r = fn(src.value); } catch {} return h('div.row.nw', { style: 'padding:8px 12px;background:var(--surface-2);border:1px solid var(--border);border-radius:12px' }, h('div', { style: 'width:150px;flex:none' }, h('b', { style: 'font-size:13px' }, k), h('div.hint', d)), h('code.grow', { style: 'word-break:break-all;font-size:13px;white-space:pre-wrap' }, r), h('button.btn.sm.ghost.icon', { onclick: () => copyText(r) }, icon('copy'))); }));
  src.addEventListener('input', run); mount(root, h('div.col', src, list)); src.style.minHeight = '90px'; run();
}

/* ───────── 文本对比 ───────── */
function textDiff(root) {
  let mode = 'lines'; const a = area({ placeholder: '原文本', style: 'min-height:200px;font-size:14px', value: '第一行相同\n这一行将被修改\n这一行会被删除\n最后一行' }), b = area({ placeholder: '新文本', style: 'min-height:200px;font-size:14px', value: '第一行相同\n这一行已经被修改了\n最后一行\n这是新增的一行' }); const out = h('div'); const sum = h('div.row');
  const run = async () => { await loadScript('/vendor/diff/diff.min.js'); const D = window.Diff; const nl = (x) => (x && !x.endsWith('\n') ? x + '\n' : x); const parts = mode === 'lines' ? D.diffLines(nl(a.value), nl(b.value)) : mode === 'words' ? D.diffWordsWithSpace(a.value, b.value) : D.diffChars(a.value, b.value); let add = 0, del = 0;
    parts.forEach((p) => { if (p.added) add += mode === 'lines' ? p.count : p.value.length; if (p.removed) del += mode === 'lines' ? p.count : p.value.length; });
    mount(sum, h('span.chip.ok', `+ ${add} 新增`), h('span.chip', { style: 'background:var(--danger-soft);color:var(--danger)' }, `− ${del} 删除`), !add && !del && h('span.chip.pri', '两段文本完全一致'));
    if (mode === 'lines') mount(out, h('div.out-box', { style: 'padding:0;max-height:520px;font-size:13px' }, parts.flatMap((p) => p.value.replace(/\n$/, '').split('\n').map((ln) => h('div', { style: `padding:2px 12px;white-space:pre-wrap;word-break:break-all;${p.added ? 'background:rgba(23,166,115,.16)' : p.removed ? 'background:rgba(229,72,77,.16);text-decoration:line-through;opacity:.85' : ''}` }, h('span.muted', { style: 'display:inline-block;width:18px' }, p.added ? '+' : p.removed ? '−' : ' '), ln)))));
    else mount(out, h('div.out-box', { style: 'font-family:var(--font);font-size:15px;line-height:1.9' }, parts.map((p) => h('span', { style: p.added ? 'background:rgba(23,166,115,.25);border-radius:3px' : p.removed ? 'background:rgba(229,72,77,.22);text-decoration:line-through;border-radius:3px' : '' }, p.value)))); };
  [a, b].forEach((x) => x.addEventListener('input', debounce(run, 200)));
  mount(root, h('div.col', h('div.grid.g2', field('原文本', a), field('新文本', b)), h('div.row', seg([['lines', '按行'], ['words', '按词'], ['chars', '按字符']], mode, (v) => { mode = v; run(); }), h('button.btn.sm', { onclick: () => { [a.value, b.value] = [b.value, a.value]; run(); } }, icon('arrow-left-right'), '交换'), h('div.sp'), sum), out)); run();
}

/* ───────── 文本整理 ───────── */
function textTidy(root) {
  const o = { trim: true, empty: true, dedupe: false, sort: 'none', num: false, rev: false, find: '', rep: '', re: false, prefix: '', suffix: '' }; const src = area({ placeholder: '粘贴需要整理的文本（每行一项）', style: 'min-height:280px;font-size:14px' }), out = area({ readOnly: true, style: 'min-height:280px;font-size:14px;background:var(--surface-2)' }); const info = h('span.muted.small');
  const run = () => { let lines = src.value.split('\n'); const n0 = lines.length; if (o.trim) lines = lines.map((l) => l.trim()); if (o.empty) lines = lines.filter((l) => l.length); if (o.find) { try { const re = o.re ? new RegExp(o.find, 'g') : new RegExp(o.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'); lines = lines.map((l) => l.replace(re, o.rep)); } catch { info.textContent = '正则表达式有误'; return; } }
    if (o.dedupe) lines = [...new Set(lines)]; if (o.sort !== 'none') { const coll = new Intl.Collator('zh-CN', { numeric: true }); lines.sort((x, y) => coll.compare(x, y)); if (o.sort === 'desc') lines.reverse(); } if (o.rev) lines.reverse(); if (o.prefix || o.suffix) lines = lines.map((l) => o.prefix + l + o.suffix); if (o.num) lines = lines.map((l, i) => `${i + 1}. ${l}`);
    out.value = lines.join('\n'); info.textContent = `${n0} 行 → ${lines.length} 行`; };
  src.addEventListener('input', run);
  const ck = (l, k) => checkbox(l, o[k], (v) => { o[k] = v; run(); }); const tx = (ph, k) => h('input.input.sm', { placeholder: ph, oninput: (e) => { o[k] = e.target.value; run(); } });
  mount(root, h('div.col', h('div.panel.col', h('div.row', ck('去除首尾空格', 'trim'), ck('删除空行', 'empty'), ck('去重（保持顺序）', 'dedupe'), ck('倒序', 'rev'), ck('添加行号', 'num'), field(null, select([['none', '不排序'], ['asc', '升序 A→Z / 小→大'], ['desc', '降序']], o.sort, (v) => { o.sort = v; run(); }))), h('div.grid.g4', tx('查找', 'find'), tx('替换为', 'rep'), tx('每行前缀', 'prefix'), tx('每行后缀', 'suffix')), ck('查找使用正则表达式', 're')),
    h('div.grid.g2', src, out), h('div.row', outBar(() => out.value), h('div.sp'), info))); run();
}

/* ───────── 简繁转换 ───────── */
function zhConvert(root) {
  let dir = 'cn:twp'; const src = area({ placeholder: '输入或粘贴需要转换的文字', value: '软件开发工程师正在优化数据库的网络连接性能。' }); const out = area({ readOnly: true, style: 'min-height:220px;font-size:15px;background:var(--surface-2)' }); const st = h('span.muted.small');
  const DIRS = [['cn:twp', '简体 → 繁体（台湾，含用语）'], ['cn:tw', '简体 → 繁体（台湾）'], ['cn:hk', '简体 → 繁体（香港）'], ['tw:cn', '繁体（台湾）→ 简体'], ['hk:cn', '繁体（香港）→ 简体'], ['t:cn', '繁体（通用）→ 简体']];
  const cache = {}; const run = async () => { try { if (!window.OpenCC) { st.textContent = '加载词库中…'; await loadScript('/vendor/opencc/full.js'); } const [from, to] = dir.split(':'); const key = dir; cache[key] ||= window.OpenCC.Converter({ from, to }); out.value = cache[key](src.value); st.textContent = ''; } catch (e) { st.textContent = '转换失败：' + e.message; } };
  src.addEventListener('input', debounce(run, 150)); mount(root, h('div.col', h('div.row', field('转换方向', select(DIRS, dir, (v) => { dir = v; run(); })), st), h('div.grid.g2', src, out), outBar(() => out.value, '转换结果.txt'))); run();
}

/* ───────── 汉字转拼音 ───────── */
function pinyin(root) {
  let mode = 'tone', sep = ' ', multi = false; const src = area({ placeholder: '输入汉字', value: '在线工具箱，办公生活一站搞定', style: 'min-height:120px;font-size:16px' }); const out = h('div.out-box', { style: 'min-height:80px;font-size:16px;font-family:var(--font)' }); const ruby = h('div', { style: 'line-height:2.6;font-size:22px' }); let plain = '';
  const run = async () => { if (!window.pinyinPro) await loadScript('/vendor/pinyin-pro/index.js'); const P = window.pinyinPro; const t = src.value; const opt = (extra) => ({ toneType: mode === 'tone' ? 'symbol' : mode === 'num' ? 'num' : 'none', ...extra });
    if (mode === 'first') plain = P.pinyin(t, { pattern: 'first', toneType: 'none', type: 'array', v: true }).join(sep === ' ' ? '' : sep); else plain = P.pinyin(t, { ...opt(), type: 'array', v: true, multiple: false }).join(sep);
    mount(out, plain); const arr = P.pinyin(t, { toneType: 'symbol', type: 'all' }); mount(ruby, arr.map((x) => (x.isZh ? h('ruby', { style: 'margin:0 3px' }, x.origin, h('rt', { style: 'font-size:12px;color:var(--primary)' }, x.pinyin)) : x.origin))); };
  src.addEventListener('input', debounce(run, 150));
  mount(root, h('div.col', src, h('div.row', seg([['tone', '带声调 nǐ'], ['num', '数字声调 ni3'], ['none', '无声调 ni'], ['first', '首字母 n']], mode, (v) => { mode = v; run(); }), field(null, select([[' ', '空格分隔'], ['', '无分隔'], ['-', '连字符 -'], ['_', '下划线 _']], sep, (v) => { sep = v; run(); }))), h('div.panel', ruby), out, h('div.row', h('button.btn.primary', { onclick: () => copyText(plain) }, icon('copy'), '复制拼音')))); run();
}
export const tools = { 'word-count': wordCount, 'case-convert': caseConvert, 'text-diff': textDiff, 'text-tidy': textTidy, 'zh-convert': zhConvert, pinyin };
