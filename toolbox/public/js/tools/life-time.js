import { h, $, mount, icon, toast, field, seg, select, tabs, copyText, store, banner, fmtTime, checkbox } from '../ui.js';

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return y ? new Date(y, m - 1, d) : null; };
const stat = (k, v, cls = '') => h('div.stat' + cls, h('div.k', k), h('div.v', v));
const dateIn = (v, on) => h('input.input', { type: 'date', value: v, oninput: (e) => on(e.target.value) });

/* ───────── 日期计算 ───────── */
function dateCalc(root) {
  let tab = 'diff'; const today = ymd(new Date()); const s = { a: today, b: ymd(new Date(Date.now() + 100 * 864e5)), base: today, n: 30, dir: 1, unit: 'd', birth: '1995-06-15' }; const area = h('div');
  const SIGNS = [['摩羯座', 1, 19], ['水瓶座', 2, 18], ['双鱼座', 3, 20], ['白羊座', 4, 19], ['金牛座', 5, 20], ['双子座', 6, 21], ['巨蟹座', 7, 22], ['狮子座', 8, 22], ['处女座', 9, 22], ['天秤座', 10, 23], ['天蝎座', 11, 22], ['射手座', 12, 21], ['摩羯座', 13, 31]];
  const ZODIAC = ['猴', '鸡', '狗', '猪', '鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊'];
  function paint() {
    if (tab === 'diff') {
      const out = h('div'); const upd = () => { const a = parseD(s.a), b = parseD(s.b); if (!a || !b) return mount(out); const days = Math.round((b - a) / 864e5); let [x, y] = a <= b ? [a, b] : [b, a]; let yy = y.getFullYear() - x.getFullYear(), mm = y.getMonth() - x.getMonth(), dd = y.getDate() - x.getDate(); if (dd < 0) { mm--; dd += new Date(y.getFullYear(), y.getMonth(), 0).getDate(); } if (mm < 0) { yy--; mm += 12; }
        mount(out, h('div.grid.g4', stat('相差天数', Math.abs(days) + ' 天', '.pri'), stat('约合', `${yy} 年 ${mm} 月 ${dd} 天`), stat('周数', (Math.abs(days) / 7).toFixed(1) + ' 周'), stat('工作日（约）', countWork(x, y) + ' 天')), days < 0 && h('p.hint', '结束日期早于开始日期，已按绝对值计算。')); };
      mount(area, h('div.panel.col', h('div.grid.g2', field('开始日期', dateIn(s.a, (v) => { s.a = v; upd(); })), field('结束日期', dateIn(s.b, (v) => { s.b = v; upd(); }))), h('div.row', h('button.btn.sm', { onclick: () => { s.a = today; paint(); } }, '开始=今天'), h('button.btn.sm', { onclick: () => { s.b = today; paint(); } }, '结束=今天')), out)); upd();
    } else if (tab === 'add') {
      const out = h('div'); const upd = () => { const b = parseD(s.base); if (!b || !Number.isFinite(s.n)) return mount(out); const r = new Date(b); if (s.unit === 'd') r.setDate(r.getDate() + s.dir * s.n); else if (s.unit === 'w') r.setDate(r.getDate() + s.dir * s.n * 7); else if (s.unit === 'm') r.setMonth(r.getMonth() + s.dir * s.n); else r.setFullYear(r.getFullYear() + s.dir * s.n);
        mount(out, h('div.grid.g2', stat('结果日期', ymd(r), '.pri'), stat('星期', '星期' + WEEK[r.getDay()]))); };
      mount(area, h('div.panel.col', h('div.grid.g4', { style: 'align-items:end' }, field('起始日期', dateIn(s.base, (v) => { s.base = v; upd(); })), field('方向', seg([[1, '之后'], [-1, '之前']], s.dir, (v) => { s.dir = +v; upd(); })), field('数量', h('input.input', { type: 'number', value: s.n, oninput: (e) => { s.n = +e.target.value; upd(); } })), field('单位', select([['d', '天'], ['w', '周'], ['m', '月'], ['y', '年']], s.unit, (v) => { s.unit = v; upd(); }))), out)); upd();
    } else {
      const out = h('div'); const upd = () => { const b = parseD(s.birth); if (!b) return mount(out); const n = new Date(); let age = n.getFullYear() - b.getFullYear(); const had = n.getMonth() > b.getMonth() || (n.getMonth() === b.getMonth() && n.getDate() >= b.getDate()); if (!had) age--; const next = new Date(n.getFullYear(), b.getMonth(), b.getDate()); if (next < new Date(n.getFullYear(), n.getMonth(), n.getDate())) next.setFullYear(n.getFullYear() + 1); const toNext = Math.round((next - new Date(n.getFullYear(), n.getMonth(), n.getDate())) / 864e5);
        const sign = SIGNS.find((z) => b.getMonth() + 1 < z[1] || (b.getMonth() + 1 === z[1] && b.getDate() <= z[2]))[0]; const lived = Math.round((n - b) / 864e5);
        mount(out, h('div.grid.g4', stat('周岁', age + ' 岁', '.pri'), stat('已出生', lived.toLocaleString() + ' 天'), stat('距下次生日', toNext === 0 ? '就是今天 🎂' : toNext + ' 天'), stat('星座 / 生肖', `${sign} · ${ZODIAC[b.getFullYear() % 12]}`)), h('p.hint', `出生于星期${WEEK[b.getDay()]}。`)); };
      mount(area, h('div.panel.col', field('出生日期', dateIn(s.birth, (v) => { s.birth = v; upd(); })), out)); upd();
    }
  }
  const countWork = (a, b) => { let c = 0; for (const d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) if (d.getDay() % 6) c++; return c; };
  mount(root, h('div.col', tabs([['diff', '日期间隔'], ['add', '日期加减'], ['age', '年龄 / 生日']], tab, (v) => { tab = v; paint(); }), area)); paint();
}

/* ───────── 倒计时 / 秒表 ───────── */
function countdown(root) {
  let tab = 'event', raf = 0; const area = h('div'); let events = store.get('cd_events', [{ name: '元旦', t: `${new Date().getFullYear() + 1}-01-01T00:00` }]);
  let stop = () => cancelAnimationFrame(raf); const beep = () => { try { const c = new AudioContext(); [0, 0.25, 0.5].forEach((d) => { const o = c.createOscillator(), g = c.createGain(); o.frequency.value = 880; o.connect(g); g.connect(c.destination); g.gain.setValueAtTime(0.2, c.currentTime + d); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + d + 0.2); o.start(c.currentTime + d); o.stop(c.currentTime + d + 0.22); }); } catch {} };
  function parts(ms) { const s = Math.max(0, Math.floor(ms / 1000)); return [Math.floor(s / 86400), Math.floor((s % 86400) / 3600), Math.floor((s % 3600) / 60), s % 60]; }
  const big = (arr) => h('div.row', { style: 'justify-content:center;gap:14px' }, arr.map(([v, l]) => h('div.stat', { style: 'min-width:92px;text-align:center' }, h('div.v', { style: 'font-size:38px' }, pad(v)), h('div.k', l))));
  function paint() {
    stop();
    if (tab === 'event') {
      const list = h('div.col'); const name = h('input.input', { placeholder: '事件名称，如：生日、考试' }), when = h('input.input', { type: 'datetime-local' });
      const tick = () => { mount(list, events.length ? events.map((e, i) => { const ms = new Date(e.t) - Date.now(); const [d, hh, m, s] = parts(Math.abs(ms)); return h('div.panel.row', h('div.grow', h('b', e.name), h('div.muted.small', e.t.replace('T', ' '))), h('div.mono', { style: 'font-size:22px;font-weight:800;color:' + (ms < 0 ? 'var(--muted)' : 'var(--primary)') }, (ms < 0 ? '已过 ' : '') + `${d} 天 ${pad(hh)}:${pad(m)}:${pad(s)}`), h('button.btn.sm.ghost.icon', { onclick: () => { events.splice(i, 1); store.set('cd_events', events); tick(); } }, icon('trash-2'))); }) : h('div.empty', '还没有倒计时事件')); raf = setTimeout(tick, 500); };
      mount(area, h('div.col', h('div.panel.col', h('div.grid.g3', { style: 'align-items:end' }, field('名称', name), field('目标时间', when), h('button.btn.primary', { onclick: () => { if (!name.value.trim() || !when.value) return toast('请填写名称和时间', 'err'); events.push({ name: name.value.trim(), t: when.value }); events.sort((a, b) => new Date(a.t) - new Date(b.t)); store.set('cd_events', events); name.value = ''; tick(); } }, icon('plus'), '添加'))), list)); tick(); stop = () => clearTimeout(raf);
    } else if (tab === 'timer') {
      let total = 300, end = 0, running = false, left = total * 1000; const disp = h('div'); const mi = h('input.input', { type: 'number', value: 5, min: 0 }), si = h('input.input', { type: 'number', value: 0, min: 0, max: 59 });
      const draw = () => mount(disp, big([[Math.floor(left / 3600000), '时'], [Math.floor((left % 3600000) / 60000), '分'], [Math.floor((left % 60000) / 1000), '秒']]));
      const btn = h('button.btn.primary.lg', { onclick: () => { if (running) { running = false; clearTimeout(raf); btn.replaceChildren(icon('play'), '继续'); return; } if (left <= 0 || (!end && !running)) { total = (+mi.value || 0) * 60 + (+si.value || 0); if (!total) return toast('请设置时长', 'err'); left = total * 1000; } running = true; end = Date.now() + left; btn.replaceChildren(icon('pause'), '暂停'); const t = () => { left = end - Date.now(); if (left <= 0) { left = 0; running = false; draw(); btn.replaceChildren(icon('play'), '开始'); beep(); toast('⏰ 时间到！', 'ok', 6000); document.title = '⏰ 时间到'; return; } draw(); raf = setTimeout(t, 100); }; t(); } }, icon('play'), '开始');
      mount(area, h('div.panel.col', { style: 'align-items:center' }, h('div.grid.g2', { style: 'width:100%;max-width:340px' }, field('分钟', mi), field('秒', si)), h('div.row', [1, 3, 5, 10, 15, 25, 45].map((m) => h('button.btn.sm', { onclick: () => { mi.value = m; si.value = 0; running = false; clearTimeout(raf); end = 0; left = m * 60000; btn.replaceChildren(icon('play'), '开始'); draw(); } }, m + ' 分钟'))), disp, h('div.row', btn, h('button.btn.lg', { onclick: () => { running = false; clearTimeout(raf); end = 0; left = ((+mi.value || 0) * 60 + (+si.value || 0)) * 1000; btn.replaceChildren(icon('play'), '开始'); draw(); } }, icon('rotate-ccw'), '重置')))); left = 5 * 60000; draw(); stop = () => clearTimeout(raf);
    } else {
      let t0 = 0, acc = 0, running = false, laps = []; const disp = h('div.mono', { style: 'font-size:64px;font-weight:800;text-align:center;font-variant-numeric:tabular-nums' }, '00:00.00'); const lapBox = h('div.col.gap-s');
      const now = () => acc + (running ? performance.now() - t0 : 0); const draw = () => { const ms = now(); disp.textContent = `${pad(Math.floor(ms / 60000))}:${pad(Math.floor((ms % 60000) / 1000))}.${pad(Math.floor((ms % 1000) / 10))}`; if (running) raf = requestAnimationFrame(draw); };
      const paintLaps = () => mount(lapBox, laps.slice().reverse().map((l, i) => h('div.row', { style: 'justify-content:space-between;padding:6px 12px;background:var(--surface-2);border-radius:10px' }, h('span.muted', `#${laps.length - i}`), h('span.mono', fmtTime(l.split / 1000, true)), h('b.mono', fmtTime(l.total / 1000, true)))));
      const main = h('button.btn.primary.lg', { onclick: () => { if (running) { acc += performance.now() - t0; running = false; main.replaceChildren(icon('play'), '继续'); } else { t0 = performance.now(); running = true; main.replaceChildren(icon('pause'), '暂停'); draw(); } } }, icon('play'), '开始');
      mount(area, h('div.panel.col', disp, h('div.row', { style: 'justify-content:center' }, main, h('button.btn.lg', { onclick: () => { if (!running && !acc) return; const tot = now(); laps.push({ total: tot, split: tot - (laps.at(-1)?.total || 0) }); paintLaps(); } }, icon('flag'), '计次'), h('button.btn.lg', { onclick: () => { running = false; acc = 0; laps = []; cancelAnimationFrame(raf); main.replaceChildren(icon('play'), '开始'); draw(); paintLaps(); } }, icon('rotate-ccw'), '复位')), lapBox)); stop = () => cancelAnimationFrame(raf);
    }
  }
  mount(root, h('div.col', tabs([['event', '事件倒计时'], ['timer', '计时器'], ['watch', '秒表']], tab, (v) => { stop(); tab = v; paint(); }), area)); paint();
  return () => stop();
}

/* ───────── 番茄钟 ───────── */
function pomodoro(root) {
  const cfg = store.get('pomo_cfg', { work: 25, short: 5, long: 15 }); let phase = 'work', left = cfg.work * 60, running = false, timer = 0, end = 0; const today = ymd(new Date()); let stats = store.get('pomo_stats', {}); if (!stats[today]) stats[today] = 0;
  const PH = { work: ['专注', '#ef4444'], short: ['短休息', '#10b981'], long: ['长休息', '#3b82f6'] };
  const ring = h('div', { style: 'width:260px;height:260px;border-radius:50%;display:grid;place-items:center;margin:0 auto;transition:background .3s' }); const timeEl = h('div.mono', { style: 'font-size:60px;font-weight:800;font-variant-numeric:tabular-nums' }); const lab = h('div.muted'); const cnt = h('div.stat');
  const inner = h('div', { style: 'width:218px;height:218px;border-radius:50%;background:var(--surface);display:grid;place-items:center;align-content:center' }, timeEl, lab); ring.append(inner);
  const beep = () => { try { const c = new AudioContext(); [0, 0.3, 0.6].forEach((d) => { const o = c.createOscillator(), g = c.createGain(); o.type = 'sine'; o.frequency.value = 660; o.connect(g); g.connect(c.destination); g.gain.setValueAtTime(0.25, c.currentTime + d); g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + d + 0.25); o.start(c.currentTime + d); o.stop(c.currentTime + d + 0.3); }); } catch {} };
  const total = () => cfg[phase] * 60;
  function draw() { const p = 1 - left / total(); const col = PH[phase][1]; ring.style.background = `conic-gradient(${col} ${p * 360}deg, var(--surface-3) 0)`; timeEl.textContent = `${pad(Math.floor(left / 60))}:${pad(left % 60)}`; lab.textContent = PH[phase][0]; timeEl.style.color = col; cnt.replaceChildren(h('div.k', '今日完成专注'), h('div.v', `${stats[today]} 个 🍅`)); document.title = running ? `${timeEl.textContent} ${PH[phase][0]} - 番茄钟` : '番茄钟 - 在线工具箱'; }
  function tick() { left = Math.max(0, Math.round((end - Date.now()) / 1000)); draw(); if (left <= 0) { running = false; beep(); if (phase === 'work') { stats[today]++; store.set('pomo_stats', stats); toast('🍅 专注完成，休息一下', 'ok', 5000); phase = stats[today] % 4 === 0 ? 'long' : 'short'; } else { toast('休息结束，开始新一轮专注', 'ok', 5000); phase = 'work'; } left = total(); startBtn.replaceChildren(icon('play'), '开始'); draw(); return; } timer = setTimeout(tick, 250); }
  const startBtn = h('button.btn.primary.lg', { onclick: () => { if (running) { running = false; clearTimeout(timer); startBtn.replaceChildren(icon('play'), '继续'); draw(); } else { running = true; end = Date.now() + left * 1000; startBtn.replaceChildren(icon('pause'), '暂停'); tick(); } } }, icon('play'), '开始');
  const setPhase = (p) => { phase = p; running = false; clearTimeout(timer); left = total(); startBtn.replaceChildren(icon('play'), '开始'); draw(); };
  const num = (k) => h('input.input', { type: 'number', min: 1, max: 120, value: cfg[k], onchange: (e) => { cfg[k] = Math.max(1, +e.target.value || cfg[k]); store.set('pomo_cfg', cfg); if (!running && phase === k) { left = total(); draw(); } } });
  mount(root, h('div.split', h('div.panel.col', { style: 'align-items:center;text-align:center' }, seg([['work', '专注'], ['short', '短休息'], ['long', '长休息']], phase, setPhase), ring, h('div.row', { style: 'justify-content:center' }, startBtn, h('button.btn.lg', { onclick: () => setPhase(phase) }, icon('rotate-ccw'), '重置'))),
    h('div.col', cnt, h('div.panel.col', h('b', '时长设置（分钟）'), h('div.grid.g3', field('专注', num('work')), field('短休息', num('short')), field('长休息', num('long'))), h('p.hint', '每完成 4 个番茄自动进入长休息。倒计时结束会有提示音，标题栏同步显示剩余时间。')))));
  draw(); return () => { clearTimeout(timer); document.title = '在线工具箱'; };
}

/* ───────── 世界时钟 ───────── */
const CITIES = [['北京', 'Asia/Shanghai'], ['香港', 'Asia/Hong_Kong'], ['台北', 'Asia/Taipei'], ['东京', 'Asia/Tokyo'], ['首尔', 'Asia/Seoul'], ['新加坡', 'Asia/Singapore'], ['曼谷', 'Asia/Bangkok'], ['迪拜', 'Asia/Dubai'], ['孟买', 'Asia/Kolkata'], ['莫斯科', 'Europe/Moscow'], ['伊斯坦布尔', 'Europe/Istanbul'], ['巴黎', 'Europe/Paris'], ['柏林', 'Europe/Berlin'], ['伦敦', 'Europe/London'], ['开罗', 'Africa/Cairo'], ['约翰内斯堡', 'Africa/Johannesburg'], ['纽约', 'America/New_York'], ['芝加哥', 'America/Chicago'], ['丹佛', 'America/Denver'], ['洛杉矶', 'America/Los_Angeles'], ['温哥华', 'America/Vancouver'], ['墨西哥城', 'America/Mexico_City'], ['圣保罗', 'America/Sao_Paulo'], ['悉尼', 'Australia/Sydney'], ['奥克兰', 'Pacific/Auckland'], ['檀香山', 'Pacific/Honolulu']];
function worldClock(root) {
  let sel = store.get('wc_sel', ['Asia/Shanghai', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney']); let timer; const grid = h('div.cards'); const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const offset = (tz, d) => { const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(d); const g = (t) => +f.find((x) => x.type === t).value; return (Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - d.setMilliseconds(0)) / 6e4; };
  function tick() { const d = new Date(); const lo = offset(localTz, new Date()); mount(grid, sel.map((tz) => { const c = CITIES.find((x) => x[1] === tz); const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: tz, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(d); const date = new Intl.DateTimeFormat('zh-CN', { timeZone: tz, month: 'long', day: 'numeric', weekday: 'short' }).format(d); const hr = +parts.slice(0, 2); const diff = (offset(tz, new Date()) - lo) / 60;
    return h('div.card', { style: '--h:210;flex-direction:column;gap:6px' }, h('div.row', { style: 'justify-content:space-between' }, h('b', c ? c[0] : tz), h('span', hr >= 6 && hr < 18 ? '☀️' : '🌙')), h('div.mono', { style: 'font-size:34px;font-weight:800' }, parts), h('div.row', { style: 'justify-content:space-between' }, h('span.muted.small', date), h('span.chip' + (diff ? '' : '.pri'), diff === 0 ? '本地时间' : `${diff > 0 ? '+' : ''}${diff} 小时`)), h('button.btn.sm.ghost', { style: 'position:absolute;right:6px;bottom:6px;width:28px;padding:0', onclick: () => { sel = sel.filter((x) => x !== tz); store.set('wc_sel', sel); tick(); } }, icon('x'))); })); timer = setTimeout(tick, 1000); }
  const add = select([['', '＋ 添加城市…'], ...CITIES.filter((c) => true).map((c) => [c[1], c[0]])], '', (v) => { if (v && !sel.includes(v)) { sel.push(v); store.set('wc_sel', sel); tick(); } add.value = ''; });
  mount(root, h('div.col', h('div.row', h('span.muted', `本地时区：${localTz}`), h('div.sp'), h('div', { style: 'width:200px' }, add)), grid)); tick(); return () => clearTimeout(timer);
}
export const tools = { 'date-calc': dateCalc, countdown, pomodoro, 'world-clock': worldClock };
