import { h, $, $$, mount, icon, toast, field, seg, select, range, tabs, copyText, store, clamp, banner, checkbox } from '../ui.js';

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : NaN; };
const fmt = (n, d = 2) => Number.isFinite(n) ? n.toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d }) : '-';
const input = (props) => h('input.input', { type: 'number', step: 'any', inputMode: 'decimal', ...props });
const stat = (k, v, cls = '') => h('div.stat' + cls, h('div.k', k), h('div.v', v));

/* ───────── 科学计算器 ───────── */
function calcEval(src, deg) {
  const toks = []; const re = /\s*(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+|[a-zA-Zπ]+|[+\-*/^%!()×÷,])/gy; let m; src = src.replace(/×/g, '*').replace(/÷/g, '/'); re.lastIndex = 0;
  let pos = 0; while (pos < src.trim().length + (src.length - src.trimStart().length) && (m = re.exec(src))) { toks.push(m[1]); pos = re.lastIndex; if (pos >= src.length) break; }
  if (toks.join('') !== src.replace(/\s/g, '')) throw new Error('表达式有误');
  let i = 0; const peek = () => toks[i], next = () => toks[i++];
  const FN = { sin: (x) => Math.sin(deg ? (x * Math.PI) / 180 : x), cos: (x) => Math.cos(deg ? (x * Math.PI) / 180 : x), tan: (x) => Math.tan(deg ? (x * Math.PI) / 180 : x), asin: (x) => (deg ? (Math.asin(x) * 180) / Math.PI : Math.asin(x)), acos: (x) => (deg ? (Math.acos(x) * 180) / Math.PI : Math.acos(x)), atan: (x) => (deg ? (Math.atan(x) * 180) / Math.PI : Math.atan(x)), ln: Math.log, log: Math.log10, sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp, floor: Math.floor, ceil: Math.ceil, round: Math.round };
  const fact = (n) => { if (n < 0 || !Number.isInteger(n) || n > 170) throw new Error('阶乘只支持 0–170 的整数'); let r = 1; for (let k = 2; k <= n; k++) r *= k; return r; };
  function expr() { let v = term(); while (peek() === '+' || peek() === '-') v = next() === '+' ? v + term() : v - term(); return v; }
  function term() { let v = unary(); while (peek() === '*' || peek() === '/') { const op = next(); const r = unary(); v = op === '*' ? v * r : v / r; } return v; }
  function unary() { if (peek() === '-') { next(); return -unary(); } if (peek() === '+') { next(); return unary(); } return pow(); }
  function pow() { let b = post(); if (peek() === '^') { next(); return Math.pow(b, unary()); } return b; }
  function post() { let v = atom(); for (;;) { if (peek() === '!') { next(); v = fact(v); } else if (peek() === '%') { next(); v = v / 100; } else break; } return v; }
  function atom() { const t = next(); if (t == null) throw new Error('表达式不完整'); if (/^[\d.]/.test(t)) return parseFloat(t); if (t === '(') { const v = expr(); if (next() !== ')') throw new Error('括号不匹配'); return v; } if (t === 'π' || t === 'pi') return Math.PI; if (t === 'e') return Math.E; if (FN[t]) { if (next() !== '(') throw new Error(`${t} 后需要括号`); const v = expr(); if (next() !== ')') throw new Error('括号不匹配'); return FN[t](v); } throw new Error(`无法识别：${t}`); }
  const v = expr(); if (i < toks.length) throw new Error('表达式有误'); return v;
}
function calculator(root) {
  let exp = '', deg = true; const hist = store.get('calc_hist', []);
  const disp = h('input.input.mono', { style: 'height:56px;font-size:22px;text-align:right', placeholder: '0', autocomplete: 'off', spellcheck: false });
  const res = h('div', { style: 'text-align:right;font:800 34px/1.2 var(--mono);min-height:44px;word-break:break-all' }, '0'); const histBox = h('div.col.gap-s');
  const fmtRes = (v) => { if (!Number.isFinite(v)) throw new Error('结果无穷大或无意义'); const s = +v.toPrecision(14); return String(s).includes('e') ? String(s) : s.toLocaleString('en-US', { maximumFractionDigits: 12 }).replace(/,/g, ''); };
  const live = () => { if (!disp.value.trim()) { res.textContent = '0'; return; } try { res.textContent = fmtRes(calcEval(disp.value, deg)); res.style.color = ''; } catch { res.style.color = 'var(--muted)'; } };
  const equals = () => { try { const r = fmtRes(calcEval(disp.value, deg)); hist.unshift({ e: disp.value, r }); hist.length = Math.min(hist.length, 30); store.set('calc_hist', hist); disp.value = r; res.textContent = r; paintHist(); } catch (e) { toast(e.message, 'err'); } };
  const paintHist = () => mount(histBox, hist.length ? hist.slice(0, 12).map((x) => h('button.btn.sm.ghost', { style: 'justify-content:space-between;width:100%', onclick: () => { disp.value = x.r; live(); } }, h('span.muted.mono', x.e), h('b.mono', '= ' + x.r))) : h('p.hint', '暂无历史记录'));
  const add = (t) => { const s = disp.selectionStart ?? disp.value.length; disp.setRangeText(t, s, disp.selectionEnd ?? s, 'end'); disp.focus(); live(); };
  const K = (label, fn, cls = '') => h('button' + (cls ? '.' + cls : ''), { onclick: fn }, label);
  const keys = [[K('C', () => { disp.value = ''; live(); }, 'fn'), K('(', () => add('('), 'fn'), K(')', () => add(')'), 'fn'), K('÷', () => add('÷'), 'op')], [K('7', () => add('7')), K('8', () => add('8')), K('9', () => add('9')), K('×', () => add('×'), 'op')], [K('4', () => add('4')), K('5', () => add('5')), K('6', () => add('6')), K('−', () => add('-'), 'op')], [K('1', () => add('1')), K('2', () => add('2')), K('3', () => add('3')), K('+', () => add('+'), 'op')], [K('0', () => add('0')), K('.', () => add('.')), K('⌫', () => { disp.value = disp.value.slice(0, -1); live(); }, 'fn'), K('=', equals, 'eq')]];
  const fns = ['sin', 'cos', 'tan', 'ln', 'log', '√', 'x²', '^', 'π', 'e', '!', '%'].map((f) => K(f, () => add({ '√': 'sqrt(', 'x²': '^2', sin: 'sin(', cos: 'cos(', tan: 'tan(', ln: 'ln(', log: 'log(' }[f] || f), 'fn'));
  disp.oninput = live; disp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); equals(); } };
  const degSeg = seg([['deg', '角度 DEG'], ['rad', '弧度 RAD']], 'deg', (v) => { deg = v === 'deg'; live(); });
  paintHist();
  mount(root, h('div.split', h('div.panel.col', degSeg, disp, res, h('div.keypad', { style: 'grid-template-columns:repeat(6,1fr)' }, fns), h('div.keypad', keys.flat())), h('div.panel.col', h('div.row', h('b', '历史记录'), h('div.sp'), h('button.btn.sm.ghost', { onclick: () => { hist.length = 0; store.set('calc_hist', []); paintHist(); } }, '清空')), histBox, h('p.hint', '支持键盘输入：+ − * / ^ ( ) 以及 sin cos tan ln log sqrt 等函数，回车计算。'))));
  disp.focus();
}

/* ───────── 单位换算 ───────── */
const UNITS = {
  长度: { m: 1, base: '米', list: [['毫米', 0.001], ['厘米', 0.01], ['米', 1], ['千米', 1000], ['英寸', 0.0254], ['英尺', 0.3048], ['码', 0.9144], ['英里', 1609.344], ['海里', 1852], ['里', 500], ['丈', 10 / 3], ['尺', 1 / 3], ['寸', 1 / 30]] },
  重量: { list: [['毫克', 1e-6], ['克', 0.001], ['千克', 1], ['吨', 1000], ['盎司', 0.028349523], ['磅', 0.45359237], ['斤', 0.5], ['两', 0.05], ['克拉', 0.0002]] },
  面积: { list: [['平方厘米', 1e-4], ['平方米', 1], ['平方千米', 1e6], ['公顷', 1e4], ['亩', 10000 / 15], ['平方英尺', 0.09290304], ['平方英寸', 0.00064516], ['英亩', 4046.8564224]] },
  体积: { list: [['毫升', 0.001], ['升', 1], ['立方米', 1000], ['立方厘米', 0.001], ['美制加仑', 3.785411784], ['美制品脱', 0.473176473], ['美制杯', 0.2365882365], ['液体盎司(美)', 0.0295735296]] },
  速度: { list: [['米/秒', 1], ['千米/时', 1 / 3.6], ['英里/时', 0.44704], ['节', 0.514444], ['马赫', 340.29]] },
  时间: { list: [['毫秒', 0.001], ['秒', 1], ['分钟', 60], ['小时', 3600], ['天', 86400], ['周', 604800], ['月(30天)', 2592000], ['年(365天)', 31536000]] },
  数据: { list: [['比特 bit', 0.125], ['字节 B', 1], ['KB', 1024], ['MB', 1048576], ['GB', 1073741824], ['TB', 1099511627776], ['PB', 1125899906842624]] },
  温度: { temp: true, list: [['摄氏度 °C'], ['华氏度 °F'], ['开尔文 K']] },
};
function unitConvert(root) {
  let cat = '长度', from = 0, to = 2; const val = input({ value: 1, oninput: calc }); const fromSel = select([], 0, (v) => { from = +v; calc(); }), toSel = select([], 0, (v) => { to = +v; calc(); }); const out = h('div'), table = h('div');
  const toBase = (c, v, i) => (c.temp ? [v, ((v - 32) * 5) / 9, v - 273.15][i] : v * c.list[i][1]); const fromBase = (c, v, i) => (c.temp ? [v, (v * 9) / 5 + 32, v + 273.15][i] : v / c.list[i][1]);
  const DEF = { 长度: [2, 1], 重量: [2, 1], 面积: [1, 4], 体积: [1, 0], 速度: [1, 2], 时间: [3, 2], 数据: [4, 3], 温度: [0, 1] };
  function setCat(c) { cat = c; const u = UNITS[c].list; [from, to] = DEF[c]; [fromSel, toSel].forEach((s, k) => { mount(s, u.map((x, i) => h('option', { value: i }, x[0]))); s.value = k ? to : from; }); calc(); }
  function calc() { const c = UNITS[cat], v = num(val.value); if (!Number.isFinite(v)) { mount(out, h('div.stat.pri', h('div.k', '结果'), h('div.v', '-'))); mount(table); return; } const base = toBase(c, v, from), r = fromBase(c, base, to); const f = (x) => (Math.abs(x) >= 1e12 || (Math.abs(x) < 1e-6 && x !== 0) ? x.toExponential(6) : +x.toPrecision(10)).toString();
    mount(out, h('div.stat.pri', h('div.k', `${v} ${c.list[from][0]} =`), h('div.v', f(r) + ' ' + c.list[to][0]), h('button.btn.sm', { style: 'margin-top:8px', onclick: () => copyText(f(r)) }, icon('copy'), '复制')));
    mount(table, h('table.table', h('tbody', c.list.map((u, i) => h('tr', h('td', u[0]), h('td.num.mono', f(fromBase(c, base, i)))))))); }
  mount(root, h('div.col', h('div.panel.col', seg(Object.keys(UNITS).map((k) => [k, k]), cat, setCat), h('div.grid.g3', { style: 'align-items:end' }, field('数值', val), field('从', fromSel), field('换算为', h('div.row.nw', toSel, h('button.btn.icon', { title: '互换', onclick: () => { [from, to] = [to, from]; fromSel.value = from; toSel.value = to; calc(); } }, icon('arrow-left-right'))))), out), h('div.panel', table)));
  setCat(cat);
}

/* ───────── 房贷计算 ───────── */
function loanCalc(root) {
  const o = { mode: 'single', method: 'pi', amt: 100, years: 30, rate: 3.5, amt2: 50, rate2: 2.85 }; const out = h('div');
  const schedule = (P, years, rate, method) => { const n = years * 12, r = rate / 100 / 12, rows = []; let bal = P; const pmt = r ? (P * r * Math.pow(1 + r, n)) / (Math.pow(1 + r, n) - 1) : P / n;
    for (let k = 1; k <= n; k++) { const interest = bal * r; const principal = method === 'pi' ? pmt - interest : P / n; const pay = principal + interest; bal = Math.max(0, bal - principal); rows.push({ k, pay, principal, interest, bal }); } return rows; };
  function calc() {
    const parts = [[o.amt * 1e4, o.rate]]; if (o.mode === 'combo') parts.push([o.amt2 * 1e4, o.rate2]);
    if (parts.some(([a, r]) => !(a > 0) || !(r >= 0)) || !(o.years > 0)) return mount(out, banner('info', '请填写有效的贷款金额、年限与利率'));
    const sch = parts.map(([a, r]) => schedule(a, o.years, r, o.method)); const n = sch[0].length; const rows = Array.from({ length: n }, (_, i) => sch.reduce((s, x) => ({ k: i + 1, pay: s.pay + x[i].pay, principal: s.principal + x[i].principal, interest: s.interest + x[i].interest, bal: s.bal + x[i].bal }), { pay: 0, principal: 0, interest: 0, bal: 0 }));
    const total = rows.reduce((s, r) => s + r.pay, 0), interest = rows.reduce((s, r) => s + r.interest, 0), P = parts.reduce((s, p) => s + p[0], 0), pct = (interest / total) * 100;
    mount(out, h('div.col', h('div.grid.g4', o.method === 'pi' ? stat('每月还款', '¥' + fmt(rows[0].pay), '.pri') : stat('首月还款', '¥' + fmt(rows[0].pay), '.pri'), o.method === 'pp' ? stat('末月还款', '¥' + fmt(rows[n - 1].pay)) : stat('还款期数', n + ' 期'), stat('支付利息', '¥' + fmt(interest)), stat('还款总额', '¥' + fmt(total))),
      h('div.panel.row', { style: 'gap:24px' }, h('div', { style: `width:120px;height:120px;border-radius:50%;background:conic-gradient(var(--primary) 0 ${100 - pct}%, #f59e0b ${100 - pct}% 100%);display:grid;place-items:center;flex:none` }, h('div', { style: 'width:78px;height:78px;border-radius:50%;background:var(--surface)' })), h('div.col.gap-s', h('div.row', h('span', { style: 'width:12px;height:12px;border-radius:3px;background:var(--primary)' }), `本金 ¥${fmt(P)}（${(100 - pct).toFixed(1)}%）`), h('div.row', h('span', { style: 'width:12px;height:12px;border-radius:3px;background:#f59e0b' }), `利息 ¥${fmt(interest)}（${pct.toFixed(1)}%）`))),
      h('div.panel', h('div.row', h('b', '还款明细'), h('span.muted.small', '（前 360 期可滚动查看）')), h('div.scroll-y.mt-s', h('table.table', h('thead', h('tr', ['期数', '月供', '本金', '利息', '剩余本金'].map((t, i) => h('th' + (i ? '.num' : ''), t)))), h('tbody', rows.slice(0, 360).map((r) => h('tr', h('td', r.k), ['pay', 'principal', 'interest', 'bal'].map((c) => h('td.num', fmt(r[c])))))))))));
  }
  const n = (k, extra = {}) => input({ value: o[k], min: 0, oninput: (e) => { o[k] = num(e.target.value); calc(); }, ...extra });
  const combo = h('div.grid.g2', { hidden: true }, field('公积金贷款（万元）', n('amt2')), field('公积金利率（%/年）', n('rate2', { step: '0.01' })));
  mount(root, h('div.col', h('div.panel.col', h('div.row', seg([['single', '单一贷款'], ['combo', '组合贷款（商贷 + 公积金）']], o.mode, (v) => { o.mode = v; combo.hidden = v !== 'combo'; calc(); }), seg([['pi', '等额本息'], ['pp', '等额本金']], o.method, (v) => { o.method = v; calc(); })),
    h('div.grid.g3', field(o.mode === 'combo' ? '商业贷款（万元）' : '贷款金额（万元）', n('amt')), field('贷款年限', select([5, 10, 15, 20, 25, 30].map((y) => [y, y + ' 年']), o.years, (v) => { o.years = +v; calc(); })), field('年利率（%）', n('rate', { step: '0.01' }), '当前 LPR 请以银行为准')), combo, h('p.hint', '等额本息：每月还款额固定；等额本金：每月本金固定，月供逐月递减，总利息更少。结果仅供参考，以银行实际合同为准。')), out));
  calc();
}

/* ───────── 个税计算 ───────── */
const TAX = [[36000, 0.03, 0], [144000, 0.1, 2520], [300000, 0.2, 16920], [420000, 0.25, 31920], [660000, 0.3, 52920], [960000, 0.35, 85920], [Infinity, 0.45, 181920]];
const BONUS = [[3000, 0.03, 0], [12000, 0.1, 210], [25000, 0.2, 1410], [35000, 0.25, 2660], [55000, 0.3, 4410], [80000, 0.35, 7160], [Infinity, 0.45, 15160]];
const taxOf = (x, t) => { if (x <= 0) return 0; const r = t.find((z) => x <= z[0]); return x * r[1] - r[2]; };
function taxCalc(root) {
  const o = { salary: 15000, si: 1800, special: 1000, bonus: 0, thr: 5000 }; const out = h('div');
  const n = (k, extra = {}) => input({ value: o[k], min: 0, oninput: (e) => { o[k] = num(e.target.value) || 0; calc(); }, ...extra });
  function calc() { let cum = 0, cumTax = 0; const rows = []; for (let m = 1; m <= 12; m++) { cum += o.salary - o.si - o.special - o.thr; const t = Math.max(0, taxOf(cum, TAX) - cumTax); cumTax += t; rows.push({ m, tax: t, net: o.salary - o.si - t }); }
    const salaryTax = rows.reduce((s, r) => s + r.tax, 0), net = rows.reduce((s, r) => s + r.net, 0);
    const bonusTax = o.bonus > 0 ? (() => { const avg = o.bonus / 12; const r = BONUS.find((z) => avg <= z[0]); return o.bonus * r[1] - r[2]; })() : 0;
    mount(out, h('div.col', h('div.grid.g4', stat('全年个税（工资）', '¥' + fmt(salaryTax), '.pri'), stat('全年税后工资', '¥' + fmt(net)), o.bonus > 0 ? stat('年终奖个税', '¥' + fmt(bonusTax)) : stat('平均月到手', '¥' + fmt(net / 12)), o.bonus > 0 ? stat('年终奖到手', '¥' + fmt(o.bonus - bonusTax)) : stat('综合税负', (o.salary ? (salaryTax / (o.salary * 12)) * 100 : 0).toFixed(2) + '%')),
      h('div.panel', h('b', '每月明细（累计预扣法）'), h('div.scroll-y.mt-s', h('table.table', h('thead', h('tr', ['月份', '税前', '五险一金', '个税', '税后到手'].map((t, i) => h('th' + (i ? '.num' : ''), t)))), h('tbody', rows.map((r) => h('tr', h('td', r.m + ' 月'), h('td.num', fmt(o.salary)), h('td.num', fmt(o.si)), h('td.num', fmt(r.tax)), h('td.num', h('b', fmt(r.net))))))))))); }
  mount(root, h('div.col', h('div.panel.col', h('div.grid.g4', field('税前月薪（元）', n('salary')), field('五险一金个人部分（月）', n('si')), field('专项附加扣除（月）', n('special'), '子女教育、房贷利息、租房、赡养老人等'), field('起征点（月）', n('thr'))), field('年终奖（元，单独计税，可选）', n('bonus', { placeholder: '0' })), h('p.hint', '按现行综合所得税率表（3%–45%）与累计预扣预缴法估算，年终奖按“单独计税”。结果仅供参考，请以单位实际代扣为准。')), out));
  calc();
}

/* ───────── BMI ───────── */
function bmiCalc(root) {
  const o = { h: 170, w: 65, age: 30, sex: 'm', act: 1.375 }; const out = h('div');
  const n = (k) => input({ value: o[k], oninput: (e) => { o[k] = num(e.target.value); calc(); } });
  function calc() { if (!(o.h > 50 && o.w > 10 && o.age > 0)) return mount(out); const m = o.h / 100, bmi = o.w / (m * m); const [lab, col] = bmi < 18.5 ? ['偏瘦', '#3b82f6'] : bmi < 24 ? ['正常', '#10b981'] : bmi < 28 ? ['超重', '#f59e0b'] : ['肥胖', '#ef4444'];
    const bmr = 10 * o.w + 6.25 * o.h - 5 * o.age + (o.sex === 'm' ? 5 : -161), pos = clamp(((bmi - 14) / (36 - 14)) * 100, 0, 100);
    mount(out, h('div.col', h('div.grid.g3', h('div.stat.pri', h('div.k', 'BMI'), h('div.v', bmi.toFixed(1) + ' · ' + lab)), stat('健康体重范围', `${(18.5 * m * m).toFixed(1)} – ${(23.9 * m * m).toFixed(1)} kg`), stat('基础代谢 BMR', Math.round(bmr) + ' kcal/天')),
      h('div.panel.col', h('div', { style: 'position:relative;height:14px;border-radius:9px;background:linear-gradient(90deg,#3b82f6 0 20.5%,#10b981 20.5% 45%,#f59e0b 45% 63.6%,#ef4444 63.6%)' }, h('div', { style: `position:absolute;left:${pos}%;top:-6px;width:6px;height:26px;border-radius:3px;background:var(--text);transform:translateX(-3px)` })), h('div.row', { style: 'justify-content:space-between;font-size:12px;color:var(--muted)' }, h('span', '<18.5 偏瘦'), h('span', '18.5–23.9 正常'), h('span', '24–27.9 超重'), h('span', '≥28 肥胖'))),
      h('div.grid.g3', stat('每日所需热量 TDEE', Math.round(bmr * o.act) + ' kcal'), stat('减重参考（-500）', Math.round(bmr * o.act - 500) + ' kcal'), stat('增重参考（+300）', Math.round(bmr * o.act + 300) + ' kcal')))); }
  mount(root, h('div.col', h('div.panel.col', h('div.grid.g4', field('身高（cm）', n('h')), field('体重（kg）', n('w')), field('年龄', n('age')), field('性别', seg([['m', '男'], ['f', '女']], o.sex, (v) => { o.sex = v; calc(); }))), field('日常活动量', select([[1.2, '久坐（几乎不运动）'], [1.375, '轻度（每周运动 1–3 次）'], [1.55, '中度（每周运动 3–5 次）'], [1.725, '高度（每周运动 6–7 次）']], o.act, (v) => { o.act = +v; calc(); })), h('p.hint', 'BMI 分级采用中国成人标准；BMR 使用 Mifflin-St Jeor 公式。仅供参考，不能替代医生建议。')), out)); calc();
}

/* ───────── 百分比 / 折扣 ───────── */
function percentCalc(root) {
  const area = h('div.col'); let tab = 'of'; const vals = { a: 200, b: 15 };
  const defs = { of: ['X 的 Y% 是多少', 'X', 'Y%', (a, b) => `${fmt((a * b) / 100, 4).replace(/\.?0+$/, '')}`], is: ['X 是 Y 的百分之几', 'X', 'Y', (a, b) => (b ? `${fmt((a / b) * 100, 4).replace(/\.?0+$/, '')}%` : '-')], chg: ['从 X 变化到 Y 的涨跌幅', 'X（原值）', 'Y（新值）', (a, b) => (a ? `${b >= a ? '+' : ''}${fmt(((b - a) / a) * 100, 4).replace(/\.?0+$/, '')}%` : '-')], disc: ['折扣价：原价 X，打 Y 折', '原价', '折扣（如 7.5 折）', (a, b) => `${fmt((a * b) / 10)} 元（省 ${fmt(a - (a * b) / 10)}）`], up: ['X 增加 Y%', 'X', 'Y%', (a, b) => fmt(a * (1 + b / 100), 4).replace(/\.?0+$/, '')], down: ['X 减少 Y%', 'X', 'Y%', (a, b) => fmt(a * (1 - b / 100), 4).replace(/\.?0+$/, '')] };
  function paint() { const [name, la, lb, fn] = defs[tab]; const out = h('div.stat.pri', h('div.k', '结果'), h('div.v', '')); const upd = () => { out.querySelector('.v').textContent = Number.isFinite(vals.a) && Number.isFinite(vals.b) ? fn(vals.a, vals.b) : '-'; };
    mount(area, h('div.panel.col', h('h3', name), h('div.grid.g2', field(la, input({ value: vals.a, oninput: (e) => { vals.a = num(e.target.value); upd(); } })), field(lb, input({ value: vals.b, oninput: (e) => { vals.b = num(e.target.value); upd(); } }))), out)); upd(); }
  mount(root, h('div.col', seg([['of', 'X 的 Y%'], ['is', 'X 占 Y'], ['chg', '涨跌幅'], ['disc', '折扣价'], ['up', '增加 Y%'], ['down', '减少 Y%']], tab, (v) => { tab = v; paint(); }), area)); paint();
}

/* ───────── 金额大写 ───────── */
function rmbUpper(root) {
  const D = '零壹贰叁肆伍陆柒捌玖', U = ['', '拾', '佰', '仟'], B = ['', '万', '亿', '兆'];
  function conv(s) {
    s = String(s).replace(/[,，\s¥￥元]/g, ''); if (!/^-?\d+(\.\d+)?$/.test(s)) throw new Error('请输入有效数字'); const neg = s[0] === '-'; if (neg) s = s.slice(1); let [ip, fp = ''] = s.split('.'); ip = ip.replace(/^0+(?=\d)/, ''); if (ip.length > 16) throw new Error('数字过大（最多 16 位整数）');
    fp = (fp + '00').slice(0, 2); const jiao = +fp[0], fen = +fp[1]; let out = '';
    if (+ip) { const groups = []; for (let i = ip.length; i > 0; i -= 4) groups.unshift(ip.slice(Math.max(0, i - 4), i));
      groups.forEach((g, gi) => { const bi = groups.length - 1 - gi; let part = '', zero = false; const pad = g.padStart(4, '0'); for (let i = 0; i < 4; i++) { const d = +pad[i]; if (d) { if (zero) part += '零'; part += D[d] + U[3 - i]; zero = false; } else if (part) zero = true; }
        if (part) { out += (out && +g < 1000 && !out.endsWith('零') ? '零' : '') + part + B[bi]; } else if (out && bi > 0 && !out.endsWith('零')) { /* 整组为零 */ } });
      out = out.replace(/零+/g, '零').replace(/零(万|亿|兆)/g, '$1').replace(/亿万/g, '亿') + '元'; } 
    if (!jiao && !fen) out = (out || '零元') + '整'; else { if (!+ip) out = ''; if (jiao) out += D[jiao] + '角'; else if (+ip) out += '零'; if (fen) out += D[fen] + '分'; else out += jiao ? '整' : ''; }
    if (!+ip && !jiao && !fen) out = '零元整'; return (neg ? '负' : '') + out;
  }
  const o = h('div.stat.pri', h('div.k', '大写金额'), h('div.v', { style: 'font-size:26px;word-break:break-all' }, '壹万贰仟叁佰肆拾伍元陆角柒分'));
  const refresh = () => { try { o.querySelector('.v').textContent = conv(i.value); } catch (e) { o.querySelector('.v').textContent = e.message; } };
  const i = input({ value: '12345.67', type: 'text', style: 'font-size:20px;height:52px', oninput: refresh });
  mount(root, h('div.panel.col', field('小写金额（元）', i), o, h('div.row', h('button.btn.primary', { onclick: () => copyText(o.querySelector('.v').textContent) }, icon('copy'), '复制大写'), ...[100, 1000, 10050.5, 100000000, 1000.01].map((v) => h('button.btn.sm.ghost', { onclick: () => { i.value = v; refresh(); } }, v))), h('p.hint', '最多支持 16 位整数与 2 位小数，自动处理“零”的连读与“整”字。'))); refresh();
}
export const tools = { calculator, 'unit-convert': unitConvert, 'loan-calc': loanCalc, 'tax-calc': taxCalc, 'bmi-calc': bmiCalc, 'percent-calc': percentCalc, 'rmb-upper': rmbUpper };
