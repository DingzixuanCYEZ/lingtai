// 灵台试炼 · 规律破译（pattern）
// 图形属性按规则变化：数列 / 双属性 / 3×3 矩阵 / 干扰属性 / 规则关系（轮转、异或、叠加、个数加减）。
// 导入时不碰 DOM：normParams / generate / scoreItem / summarize / buildDisplay / explainItem / describe 都是纯函数。

import { makeRng, h, s, wait, choose, progressHead, flash, isMobile, AbortedError, median, round } from '../core/gamekit.js';

const ID = 'pattern';
const NAME = '规律破译';
export const TYPES = ['seq', 'dual', 'matrix', 'distract', 'relation'];
export const TYPE_NAME = { seq: '数列', dual: '双属性', matrix: '矩阵', distract: '干扰', relation: '规则关系' };
export const ATTRS = ['shape', 'color', 'count', 'size', 'rot', 'fill', 'pos', 'marks'];
export const META = {
  shape: { lo: 0, hi: 4, name: '形状' },   // 0 三角 1 方 2 五边 3 六边 4 圆
  color: { lo: 0, hi: 4, name: '颜色' },
  count: { lo: 1, hi: 6, name: '个数' },
  size: { lo: 0, hi: 2, name: '大小' },
  rot: { lo: 0, hi: 7, name: '朝向', cyc: 8 }, // ×45°
  fill: { lo: 0, hi: 2, name: '填充' },      // 0 实心 1 空心 2 套心
  pos: { lo: 0, hi: 2, name: '位置' },       // 0 偏上 1 居中 2 偏下
  marks: { lo: 0, hi: 15, name: '角点' },    // 四角小圆点的位掩码
};
export const SHAPE_NAME = ['三角', '方', '五边形', '六边形', '圆'];
export const COLOR_NAME = ['红', '蓝', '绿', '橙', '紫'];
export const COLOR_HEX = ['#d9483b', '#2f6fd6', '#2f9e44', '#e8890c', '#8a4fd1'];
const BASIC_M = ['const_row', 'const_col', 'prog'];
const REL_M = ['perm', 'arith', 'xor', 'or'];
const PROG_ATTRS = ['count', 'size', 'pos', 'shape', 'rot'];
const SEQ_ATTRS = ['shape', 'color', 'count', 'size', 'rot', 'fill', 'pos'];

const DEFAULTS = {
  types: ['seq'],
  rules: 1,
  distractAttrs: 0,
  options: 4,
  items: 10,
  timeLimitMs: 0,
  askRule: true,
  showFeedback: true,
};
export const CASUAL_MAX_ITEMS = 8;

function clampInt(v, lo, hi, d) {
  const x = Math.round(Number(v));
  if (!Number.isFinite(x)) return d;
  return Math.max(lo, Math.min(hi, x));
}
function toBool(v, d) {
  if (v === undefined || v === null) return d;
  if (typeof v === 'string') return v === 'true' || v === '1';
  return !!v;
}

export function normParams(params) {
  const q = { ...DEFAULTS, ...(params || {}) };
  const raw = Array.isArray(q.types) ? q.types : (typeof q.types === 'string' ? q.types.split(/[,+\s]+/) : []);
  let types = TYPES.filter((t) => raw.includes(t));
  if (!types.length) types = DEFAULTS.types.slice();
  return {
    types,
    rules: clampInt(q.rules, 1, 4, DEFAULTS.rules),
    distractAttrs: clampInt(q.distractAttrs, 0, 3, DEFAULTS.distractAttrs),
    options: clampInt(q.options, 4, 6, DEFAULTS.options),
    items: clampInt(q.items, 4, 30, DEFAULTS.items),
    timeLimitMs: clampInt(q.timeLimitMs, 0, 120000, DEFAULTS.timeLimitMs),
    askRule: toBool(q.askRule, DEFAULTS.askRule),
    showFeedback: toBool(q.showFeedback, DEFAULTS.showFeedback),
  };
}

// 休闲模式：不限时、题少、不问规则
export function effectiveParams(params, mode) {
  const p = normParams(params);
  if (mode !== 'casual') return p;
  return { ...p, timeLimitMs: 0, askRule: false, items: Math.min(p.items, CASUAL_MAX_ITEMS) };
}

export function describe(params, mode) {
  const p = effectiveParams(params, mode);
  const parts = [p.types.map((t) => TYPE_NAME[t]).join('、') + (p.types.length > 1 ? '混合' : '题')];
  parts.push(`矩阵题最多 ${p.rules} 条规则`);
  parts.push(p.distractAttrs ? `另有 ${p.distractAttrs} 个乱变的无关属性` : '没有无关属性');
  parts.push(`${p.options} 个选项`, `${p.items} 题`);
  parts.push(p.timeLimitMs ? `每题限时 ${round(p.timeLimitMs / 1000, 1)} 秒` : '不限时');
  if (p.askRule) parts.push('答完可写一句“我发现的规则”');
  return parts.join('，') + '。';
}

// ---------- 生成 ----------
const mod = (a, n) => ((a % n) + n) % n;
const domain = (attr) => { const m = META[attr]; const a = []; for (let v = m.lo; v <= m.hi; v++) a.push(v); return a; };
const distinct = (rng, attr, k) => rng.shuffle(domain(attr)).slice(0, k);
export const figKey = (f) => ATTRS.map((a) => f[a]).join(',');

function constValue(attr, rng) {
  if (attr === 'marks') return 0;
  if (attr === 'count') return rng.int(1, 2);
  if (attr === 'pos') return 1;
  return rng.pick(domain(attr));
}
function randValue(attr, rng) {
  if (attr === 'marks') return rng.int(1, 15);
  return rng.pick(domain(attr));
}

// 数列/双属性：L 个可见 + 第 L+1 个是答案。返回每个规则属性的 L+1 个值
function seqRule(attr, kind, L, rng) {
  if (kind === 'step') {
    if (attr === 'rot') {
      const d = rng.pick([1, 2, 3, -1, -2]);
      const b = rng.int(0, 7);
      return { rule: { attr, kind, d }, vals: Array.from({ length: L + 1 }, (_, i) => mod(b + d * i, 8)) };
    }
    const d = rng.pick([1, -1]);
    const b = d > 0 ? rng.int(1, 6 - L) : rng.int(1 + L, 6);
    return { rule: { attr, kind, d }, vals: Array.from({ length: L + 1 }, (_, i) => b + d * i) };
  }
  const per = kind === 'alt' ? 2 : 3;
  const v = distinct(rng, attr, per);
  return { rule: { attr, kind }, vals: Array.from({ length: L + 1 }, (_, i) => v[i % per]) };
}
function seqKinds(attr, L) {
  const k = ['alt', 'cycle3'];
  if (attr === 'rot' || (attr === 'count' && L + 1 <= 6)) k.push('step');
  return k;
}

function genSeq(type, nDis, rng) {
  const L = rng.int(4, 6);
  const nR = type === 'dual' ? 2 : 1;
  const ruleAttrs = rng.shuffle(SEQ_ATTRS).slice(0, nR);
  const rules = [], seqs = {};
  for (const a of ruleAttrs) {
    let kinds = seqKinds(a, L);
    if (rules.length && kinds.length > 1) kinds = kinds.filter((k) => k !== rules[0].kind); // 两条规则尽量不同类
    const { rule, vals } = seqRule(a, rng.pick(kinds), L, rng);
    rules.push(rule); seqs[a] = vals;
  }
  const rest = rng.shuffle(ATTRS.filter((a) => !ruleAttrs.includes(a)));
  const distract = rest.slice(0, nDis);
  const consts = {};
  for (const a of rest.slice(nDis)) consts[a] = constValue(a, rng);
  const figs = [];
  for (let i = 0; i <= L; i++) {
    const f = {};
    for (const a of ATTRS) f[a] = a in seqs ? seqs[a][i] : a in consts ? consts[a] : randValue(a, rng);
    figs.push(f);
  }
  return { type, layout: 'row', L, rules, distract, cells: figs.slice(0, L), answerFig: figs[L] };
}

// 矩阵：返回 9 个值（行优先），下标 8 是答案
function matRule(attr, kind, rng) {
  const grid = (fn) => { const g = []; for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) g.push(fn(r, c)); return g; };
  if (kind === 'const_row' || kind === 'const_col') {
    const v = distinct(rng, attr, 3);
    return { rule: { attr, kind }, vals: grid((r, c) => v[kind === 'const_row' ? r : c]) };
  }
  if (kind === 'perm') {
    const v = distinct(rng, attr, 3);
    const sh = rng.pick([1, 2]);
    return { rule: { attr, kind }, vals: grid((r, c) => v[(c + sh * r) % 3]) };
  }
  if (kind === 'prog') {
    const m = META[attr];
    if (attr === 'rot') {
      const d = rng.pick([1, 2, -1, 3]), e = rng.pick([0, 1, 2, -1]), b = rng.int(0, 7);
      return { rule: { attr, kind, d, e }, vals: grid((r, c) => mod(b + d * c + e * r, 8)) };
    }
    const hi = attr === 'shape' ? 3 : m.hi; // 形状只在多边形（边数 3–6）上递进
    for (let t = 0; t < 60; t++) {
      const d = rng.pick([1, -1]), e = rng.pick([0, 1, -1]), b = rng.int(m.lo, hi);
      const vals = grid((r, c) => b + d * c + e * r);
      if (vals.every((v) => v >= m.lo && v <= hi)) return { rule: { attr, kind, d, e }, vals };
    }
    return null;
  }
  if (kind === 'arith') { // 个数：第三列 = 前两列相加或相减
    const op = rng.pick(['+', '-']);
    for (let t = 0; t < 60; t++) {
      const rows = [0, 1, 2].map(() => {
        if (op === '+') { const a = rng.int(1, 5); const b = rng.int(1, 6 - a); return [a, b, a + b]; }
        const a = rng.int(2, 6); const b = rng.int(1, a - 1); return [a, b, a - b];
      });
      if (rows[0].join() === rows[1].join() && rows[1].join() === rows[2].join()) continue;
      return { rule: { attr, kind, op }, vals: rows.flat() };
    }
    return null;
  }
  if (kind === 'xor' || kind === 'or') { // 角点：第三列 = 前两列异或 / 叠加
    for (let t = 0; t < 200; t++) {
      const rows = [0, 1, 2].map(() => { const a = rng.int(1, 15); const b = rng.int(1, 15); return [a, b, kind === 'xor' ? a ^ b : a | b]; });
      if (rows.some(([a, b]) => a === b)) continue;
      if (!rows.slice(0, 2).some(([a, b]) => (a & b) !== 0)) continue;      // 前两行至少一行有重合，才分得清异或和叠加
      if (!rows.slice(0, 2).some(([a, b]) => (a | b) !== a && (a | b) !== b)) continue;
      if (rows[2][2] === 0) continue;
      return { rule: { attr, kind }, vals: rows.flat() };
    }
    return null;
  }
  return null;
}

function genMatrix(type, nRules, nDis, rng) {
  const rules = [], vals = {};
  const used = new Set();
  const add = (attr, kind) => {
    const g = matRule(attr, kind, rng);
    if (!g) return false;
    rules.push(g.rule); vals[attr] = g.vals; used.add(attr);
    return true;
  };
  if (type === 'relation') {
    const rels = rng.shuffle(REL_M);
    const nRel = nRules >= 3 && rng.chance(0.5) ? 2 : 1;
    for (const k of rels) {
      if (rules.length >= nRel) break;
      if (k === 'arith') { if (!used.has('count')) add('count', k); }
      else if (k === 'xor' || k === 'or') { if (!used.has('marks')) add('marks', k); }
      else add(rng.pick(SEQ_ATTRS.filter((a) => !used.has(a))), k);
    }
  }
  let guard = 0;
  while (rules.length < nRules && guard++ < 40) {
    const kind = rng.pick(BASIC_M);
    const pool = (kind === 'prog' ? PROG_ATTRS : SEQ_ATTRS).filter((a) => !used.has(a));
    if (pool.length) add(rng.pick(pool), kind);
  }
  if (rules.length < nRules) return null;
  const rest = rng.shuffle(ATTRS.filter((a) => !used.has(a)));
  const distract = rest.slice(0, nDis);
  const consts = {};
  for (const a of rest.slice(nDis)) consts[a] = constValue(a, rng);
  const figs = [];
  for (let i = 0; i < 9; i++) {
    const f = {};
    for (const a of ATTRS) f[a] = a in vals ? vals[a][i] : a in consts ? consts[a] : randValue(a, rng);
    figs.push(f);
  }
  return { type, layout: 'grid', L: 8, rules, distract, cells: figs.slice(0, 8), answerFig: figs[8] };
}

// 干扰项：每个只在 1–2 个“非干扰”属性上和答案不同；彼此不同
function makeOptions(item, nOpt, rng) {
  const ans = item.answerFig;
  const mutable = ATTRS.filter((a) => !item.distract.includes(a));
  const ruleAttrs = item.rules.map((r) => r.attr);
  const seen = new Set([figKey(ans)]);
  const opts = [];
  const altValue = (a) => {
    const vis = [...new Set(item.cells.map((c) => c[a]))].filter((v) => v !== ans[a]);
    if (vis.length && rng.chance(0.65)) return rng.pick(vis);
    if (a === 'marks') return ans.marks ^ (1 << rng.int(0, 3));
    if (a === 'count' && rng.chance(0.5)) { const v = ans.count + rng.pick([1, -1]); if (v >= 1 && v <= 6) return v; }
    return rng.pick(domain(a).filter((v) => v !== ans[a]));
  };
  for (let t = 0; t < 400 && opts.length < nOpt - 1; t++) {
    const k = rng.chance(0.6) ? 1 : 2;
    const first = rng.chance(0.75) ? rng.pick(ruleAttrs) : rng.pick(mutable);
    const attrs = [first];
    if (k === 2) attrs.push(rng.pick(mutable.filter((a) => a !== first)));
    const f = { ...ans };
    for (const a of attrs) f[a] = altValue(a);
    const key = figKey(f);
    if (seen.has(key)) continue;
    seen.add(key); opts.push(f);
  }
  if (opts.length < nOpt - 1) return null;
  const answer = rng.int(0, nOpt - 1);
  opts.splice(answer, 0, ans);
  return { options: opts, answer };
}

function genItem(type, p, rng) {
  const nDis = type === 'distract' ? Math.max(1, p.distractAttrs) : p.distractAttrs;
  for (let t = 0; t < 30; t++) {
    const it = type === 'seq' || type === 'dual' ? genSeq(type, nDis, rng) : genMatrix(type, p.rules, nDis, rng);
    if (!it) continue;
    const o = makeOptions(it, p.options, rng);
    if (!o) continue;
    return { ...it, ...o };
  }
  throw new Error('pattern: 生成失败');
}

// 纯函数：生成一组题目
export function generate(params, rng, mode) {
  const p = effectiveParams(params, mode);
  const n = p.items;
  const mix = rng.shuffle(p.types);
  const order = rng.shuffle(Array.from({ length: n }, (_, i) => mix[i % mix.length]));
  const items = order.map((type) => genItem(type, p, rng));
  return { items, n, params: p };
}

// ---------- 说明 / 计分 ----------
const nm = (a) => META[a].name;
const signed = (x, unit = '') => `${x > 0 ? '+' : '−'}${Math.abs(x)}${unit}`;
export function explainRule(r) {
  const a = nm(r.attr);
  switch (r.kind) {
    case 'step': return r.attr === 'rot' ? `朝向每次转 ${signed(r.d * 45, '°')}` : `个数每次 ${signed(r.d)}`;
    case 'alt': return `${a}两种交替`;
    case 'cycle3': return `${a}三种轮流`;
    case 'const_row': return `同一行${a}相同`;
    case 'const_col': return `同一列${a}相同`;
    case 'prog': {
      const what = r.attr === 'rot' ? `朝向从左到右每格转 ${signed(r.d * 45, '°')}` : r.attr === 'shape' ? `边数从左到右每格 ${signed(r.d)}` : `${a}从左到右每格 ${signed(r.d)} 档`;
      if (!r.e) return what;
      return what + `，往下一行再 ${r.attr === 'rot' ? signed(r.e * 45, '°') : signed(r.e)}`;
    }
    case 'perm': return `每行每列${a}三种各出现一次（轮转）`;
    case 'arith': return `第三列个数 = 前两列${r.op === '+' ? '相加' : '相减'}`;
    case 'xor': return '第三列角点 = 前两列叠起来、去掉重合的（异或）';
    case 'or': return '第三列角点 = 前两列叠起来（叠加）';
    default: return '';
  }
}
export function explainItem(it) {
  const t = it.rules.map(explainRule).join('；');
  return it.distract.length ? `${t}。${it.distract.map(nm).join('、')}乱变，无关` : t;
}
export const ruleTag = (it) => it.rules.map((r) => `${r.attr}:${r.kind}`).join('+');

// 用户写的规则不限长度（多半是语音输入的长段话）
const tidy = (str) => String(str || '').replace(/s+/g, ' ').trim();

// 纯函数：一题的记录。resp=-1 表示超时
export function scoreItem(it, i, resp, rtMs, ruleText) {
  const timeout = resp < 0;
  return {
    i, type: it.type, rules: ruleTag(it), nRules: it.rules.length, nDistract: it.distract.length,
    nOptions: it.options.length, answer: it.answer, resp, correct: !timeout && resp === it.answer,
    rtMs: timeout ? null : rtMs, timeout,
    ruleText: tidy(ruleText) || null,
    truth: explainItem(it),
  };
}

const frac = (xs) => `${xs.filter((r) => r.correct).length}/${xs.length}`;
export function summarize(recs, gen) {
  const p = gen.params;
  const n = recs.length;
  const nc = recs.filter((r) => r.correct).length;
  const rts = recs.filter((r) => r.correct && r.rtMs != null).map((r) => r.rtMs);
  const byType = TYPES.filter((t) => recs.some((r) => r.type === t)).map((t) => `${t} ${frac(recs.filter((r) => r.type === t))}`).join(', ');
  const kinds = [...new Set(recs.flatMap((r) => r.rules.split('+').map((x) => x.split(':')[1])))];
  const byRule = kinds.map((k) => `${k} ${frac(recs.filter((r) => r.rules.split('+').some((x) => x.endsWith(':' + k))))}`).join(', ');
  const stated = recs.filter((r) => r.ruleText);
  const notes = stated.map((r) => `#${r.i + 1}${r.type}${r.correct ? '✓' : '✗'} 说「${r.ruleText}」实为「${r.truth}」`).join(' | ');
  const hard = recs.filter((r) => r.nRules >= 3);
  return {
    types: p.types.join('+'),
    n_trials: n,
    n_correct: nc,
    acc: n ? round(nc / n, 3) : null,
    rt_median_ms: rts.length ? Math.round(median(rts)) : null,
    timeouts: recs.filter((r) => r.timeout).length,
    acc_by_type: byType || null,
    acc_by_rule: byRule || null,
    acc_3plus_rules: hard.length ? round(hard.filter((r) => r.correct).length / hard.length, 3) : null,
    rules_param: p.rules,
    distract_attrs: p.distractAttrs,
    options: p.options,
    rule_stated_n: stated.length,
    rule_stated_correct_n: stated.filter((r) => r.correct).length,
    rule_notes: notes || null,
  };
}

export function buildDisplay(sm, gen) {
  const d = [['正确率', sm.n_trials ? `${sm.n_correct}/${sm.n_trials}（${Math.round((sm.acc || 0) * 100)}%）` : '—']];
  d.push(['答对的中位用时', sm.rt_median_ms == null ? '—' : `${round(sm.rt_median_ms / 1000, 1)} 秒`]);
  if (sm.acc_by_type && gen.params.types.length > 1) {
    d.push(['各题型', sm.acc_by_type.replace(/[a-z]+/g, (t) => TYPE_NAME[t] || t).replace(/, /g, '　')]);
  }
  if (sm.timeouts) d.push(['超时', `${sm.timeouts} 题`]);
  if (gen.params.askRule && d.length < 5) d.push(['写了规则', `${sm.rule_stated_n} 题`]);
  return d;
}

// ---------- 画图 ----------
const LAYOUT = {
  1: [[0, 0]], 2: [[-14, 0], [14, 0]], 3: [[0, -12], [-13, 10], [13, 10]], 4: [[-12, -12], [12, -12], [-12, 12], [12, 12]],
  5: [[-14, -14], [14, -14], [0, 0], [-14, 14], [14, 14]], 6: [[-16, -11], [0, -11], [16, -11], [-16, 11], [0, 11], [16, 11]],
};
const RAD = { 1: [13, 19, 25], 2: [8, 12, 15], 3: [7, 10.5, 13.5], 4: [7, 10.5, 13.5], 5: [5.5, 8, 10.5], 6: [5.5, 8, 10.5] };
const POS_DY = [-12, 0, 12];
const CORNERS = [[9, 9], [91, 9], [91, 91], [9, 91]];
const SIDES = [3, 4, 5, 6, 0];

function polyPts(n, R, k = 1) {
  const a0 = n === 4 ? -135 : -90;
  const pts = [];
  for (let i = 0; i < n; i++) { const a = ((a0 + (360 / n) * i) * Math.PI) / 180; pts.push(`${round(R * k * Math.cos(a), 2)},${round(R * k * Math.sin(a), 2)}`); }
  return pts.join(' ');
}
function shapeEl(sh, R, k, attrs) {
  const n = SIDES[sh];
  return n ? s('polygon', { points: polyPts(n, R, k), ...attrs }) : s('circle', { cx: 0, cy: 0, r: R * k, ...attrs });
}
export function figSvg(f) {
  const col = COLOR_HEX[f.color];
  const R = RAD[f.count][f.size];
  const sw = Math.max(1.6, round(R * 0.16, 2));
  const kids = [];
  for (const [x, y] of LAYOUT[f.count]) {
    const g = [];
    if (f.fill === 0) g.push(shapeEl(f.shape, R, 1, { fill: col, stroke: col, 'stroke-width': sw, 'stroke-linejoin': 'round' }));
    else {
      g.push(shapeEl(f.shape, R, 1, { fill: 'none', stroke: col, 'stroke-width': sw, 'stroke-linejoin': 'round' }));
      if (f.fill === 2) g.push(shapeEl(f.shape, R, 0.5, { fill: col }));
    }
    g.push(s('line', { x1: 0, y1: round(-R * (f.fill === 2 ? 0.5 : 0.12), 2), x2: 0, y2: round(-R * 0.92, 2), 'stroke-width': sw, 'stroke-linecap': 'round', style: `stroke:${f.fill === 0 ? 'var(--card)' : col}` }));
    kids.push(s('g', { transform: `translate(${50 + x},${50 + y + POS_DY[f.pos]}) rotate(${f.rot * 45})` }, g));
  }
  CORNERS.forEach(([x, y], b) => { if (f.marks & (1 << b)) kids.push(s('circle', { cx: x, cy: y, r: 4.5, style: 'fill:var(--fg)' })); });
  return s('svg', { viewBox: '0 0 100 100', 'aria-hidden': 'true' }, kids);
}

const CSS = `
.pt-wrap{position:relative;display:flex;flex-direction:column;gap:10px;width:100%;max-width:720px;margin:0 auto;padding-bottom:8px;box-sizing:border-box;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.pt-prompt{text-align:center;font-size:15px;color:var(--fg);margin:0}
.pt-board{align-self:center;display:grid;gap:6px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:8px;box-sizing:border-box}
.pt-grid{grid-template-columns:repeat(3,minmax(0,1fr));width:min(88vw,40vh,360px)}
.pt-row{grid-template-columns:repeat(var(--pt-n),minmax(0,1fr));width:min(100%,calc(var(--pt-n) * 104px))}
.pt-cell{aspect-ratio:1/1;border:1px solid var(--line);border-radius:8px;background:var(--bg);display:flex;align-items:center;justify-content:center;min-width:0;overflow:hidden}
.pt-cell svg,.pt-opt svg{width:100%;height:100%;display:block}
.pt-qm{font-size:clamp(22px,7vw,34px);font-weight:800;color:var(--muted)}
.pt-cell.pt-miss{border-style:dashed;border-color:var(--accent)}
.pt-opts{align-self:center;display:grid;gap:8px;grid-template-columns:repeat(var(--pt-oc),minmax(0,1fr));width:min(100%,calc(var(--pt-oc) * 118px))}
.pt-wrap .pt-opt{position:relative;aspect-ratio:1/1;min-height:44px;padding:4px;margin:0;color:var(--fg);touch-action:manipulation;min-width:0;transition:transform 60ms}
.pt-wrap .pt-opt:active{transform:scale(.96)}
.p-nopress .pt-wrap .pt-opt:active{transform:none}
.pt-key{position:absolute;left:6px;top:3px;font-size:11px;color:var(--muted);line-height:1}
.p-nokeys .pt-key{display:none}
.pt-wrap .pt-opt.pt-right{border-color:var(--ok);box-shadow:0 0 0 2px color-mix(in srgb,var(--ok) 35%,transparent)}
.pt-wrap .pt-opt.pt-wrong{border-color:var(--bad);box-shadow:0 0 0 2px color-mix(in srgb,var(--bad) 30%,transparent)}
.pt-done .pt-opt{cursor:default}
.pt-explain{font-size:14px;line-height:1.5;text-align:center;color:var(--fg);margin:0}
.pt-explain:empty{display:none}
.pt-explain b.ok{color:var(--ok)}
.pt-explain b.bad{color:var(--bad)}
.pt-ask,.pt-next{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:center}
.pt-ask[hidden],.pt-next[hidden]{display:none}
.pt-input{flex:1 1 100%;min-width:0;min-height:44px;box-sizing:border-box;font:inherit;font-size:16px;line-height:1.5;resize:vertical;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--fg)}
.pt-ask .g-btn,.pt-next .g-btn{flex:0 0 auto}
.pt-next .g-btn{min-width:160px}
.pt-hint{text-align:center;margin:0}
@media (max-width:600px){.pt-row{grid-template-columns:repeat(var(--pt-m),minmax(0,1fr));width:min(100%,calc(var(--pt-m) * 96px))}.pt-opts{grid-template-columns:repeat(var(--pt-om),minmax(0,1fr));width:100%}}
`;
function injectStyle() {
  if (document.getElementById(`style-${ID}`)) return;
  const st = document.createElement('style');
  st.id = `style-${ID}`;
  st.textContent = CSS;
  document.head.append(st);
}

export default {
  id: ID,
  name: NAME,
  line: 'pattern',
  casual: true,
  blurb: '看图形怎么变：形状、颜色、个数、朝向……找出规律，补上“？”。',
  aiDescription:
    '规律破译，练规律归纳。每题看一组图形（属性：形状、颜色、个数、大小、朝向、填充、位置、角点），从选项里挑出“？”处的图形；干扰项只错一两个属性，答案唯一。' +
    'types 题型：seq 一行数列、一个属性按规则变；dual 两个属性各有规则；matrix 为3×3矩阵，行列规则；distract 矩阵且至少1个属性乱变无关；relation 含轮转、角点异或/叠加、个数加减。' +
    'rules 为矩阵题规则条数；distractAttrs 为每题乱变的无关属性数；options 选项数，越多越难；timeLimitMs 每题限时，0不限；askRule 题后可选填“我发现的规则”。休闲模式不限时、最多8题、不问规则。' +
    '段位参考：童生 seq；秀才 dual；举人 matrix；贡士 distract；进士 relation；探花 rules≥3 且有干扰；榜眼最难档稳定做对且规则说清。' +
    'summary：acc_by_type、acc_by_rule 为各题型、各规则种类对几题；acc_3plus_rules 为三条以上规则题正确率；rule_notes 列出用户写的规则与真实规则，请据此判断是真懂还是蒙对，说对规则的组更有分量。',
  defaults: { ...DEFAULTS, types: DEFAULTS.types.slice() },
  paramSpec: {
    types: { type: 'set', options: TYPES.slice(), desc: '题型，多选随机混合：seq 数列单属性 / dual 双属性 / matrix 3×3 矩阵 / distract 带无关属性的矩阵 / relation 轮转·异或·叠加·个数加减' },
    rules: { type: 'int', min: 1, max: 4, desc: '矩阵类题（matrix/distract/relation）每题同时起作用的规则条数' },
    distractAttrs: { type: 'int', min: 0, max: 3, desc: '每题乱变、与答案无关的属性个数（distract 题至少 1）' },
    options: { type: 'int', min: 4, max: 6, desc: '选项个数' },
    items: { type: 'int', min: 4, max: 30, desc: '本组题数（休闲模式最多 8）' },
    timeLimitMs: { type: 'int', min: 0, max: 120000, desc: '每题限时（毫秒），0=不限时；休闲模式忽略' },
    askRule: { type: 'bool', desc: '答完每题可选填一句“我发现的规则”（可跳过）；休闲模式关闭' },
    showFeedback: { type: 'bool', desc: '答完显示对错并揭示真实规律' },
  },
  describe,

  async run(root, ctx) {
    const signal = ctx.signal;
    injectStyle();
    const casual = ctx.mode === 'casual';
    const gen = generate(ctx.params, makeRng(ctx.seed), ctx.mode);
    const p = gen.params;
    const total = gen.n;
    const desk = !isMobile();

    root.innerHTML = '';
    const head = progressHead(NAME);
    head.set(0, total, `0/${total}`);
    const prompt = h('p', { class: 'pt-prompt' });
    const board = h('div', { class: 'pt-board' });
    const opts = h('div', { class: 'pt-opts' });
    const explain = h('p', { class: 'pt-explain' });
    const input = h('textarea', { class: 'pt-input', rows: 3, placeholder: '我发现的规则（可不填，可以用语音输入；回车提交）', enterkeyhint: 'done' });
    const submitBtn = h('button', { class: 'g-btn primary', type: 'button' }, '提交');
    const skipBtn = h('button', { class: 'g-btn', type: 'button' }, '跳过');
    const ask = h('div', { class: 'pt-ask', hidden: true }, input, submitBtn, skipBtn);
    const nextBtn = h('button', { class: 'g-btn primary', type: 'button' }, '下一题');
    const next = h('div', { class: 'pt-next', hidden: true }, nextBtn);
    const hint = h('p', { class: 'g-note pt-hint' },
      '选出“？”处应有的图形' + (desk ? `（数字键 1–${p.options}）` : '') + (p.timeLimitMs ? `，每题限时 ${round(p.timeLimitMs / 1000, 1)} 秒` : ''));
    const wrap = h('div', { class: 'pt-wrap' }, head.el, prompt, board, opts, explain, ask, next, hint);
    root.append(wrap);
    opts.style.setProperty('--pt-oc', String(p.options));
    opts.style.setProperty('--pt-om', String(p.options === 4 ? 4 : 3));

    const renderItem = (it) => {
      board.innerHTML = '';
      const grid = it.layout === 'grid';
      board.className = 'pt-board ' + (grid ? 'pt-grid' : 'pt-row');
      if (!grid) { board.style.setProperty('--pt-n', String(it.L + 1)); board.style.setProperty('--pt-m', String(Math.ceil((it.L + 1) / 2))); }
      for (const c of it.cells) board.append(h('div', { class: 'pt-cell' }, figSvg(c)));
      board.append(h('div', { class: 'pt-cell pt-miss' }, h('span', { class: 'pt-qm' }, '？')));
      prompt.textContent = grid ? '每行、每列都有规律，补上右下角' : '照这个规律，下一个是？';
      opts.innerHTML = '';
      opts.classList.remove('pt-done');
      return it.options.map((f, k) => {
        const b = h('button', { class: 'g-card pt-opt', type: 'button', 'aria-label': `选项 ${k + 1}` }, figSvg(f), h('span', { class: 'pt-key' }, String(k + 1)));
        opts.append(b);
        return b;
      });
    };

    const recs = [];
    try {
      for (let i = 0; i < total; i++) {
        const it = gen.items[i];
        explain.textContent = '';
        const btns = renderItem(it);
        const keys = btns.map((_, k) => String(k + 1));
        const res = await choose(btns, { signal, keys, timeoutMs: casual ? 0 : p.timeLimitMs });
        opts.classList.add('pt-done');
        if (res.index >= 0) btns[res.index].classList.add('g-card', 'sel');

        let ruleText = '';
        if (p.askRule && !casual) {
          input.value = '';
          ask.hidden = false;
          if (desk) input.focus();
          const r = await choose([submitBtn, skipBtn], { signal, keys: ['enter', 'escape'] });
          ruleText = r.index === 0 ? input.value : '';
          input.blur();
          ask.hidden = true;
        }

        const rec = scoreItem(it, i, res.index, res.rtMs, ruleText);
        recs.push(rec);
        head.set(i + 1, total, `${i + 1}/${total}`);

        if (p.showFeedback) {
          btns[it.answer].classList.add('pt-right');
          if (res.index >= 0 && !rec.correct) btns[res.index].classList.add('pt-wrong');
          explain.innerHTML = '';
          explain.append(h('b', { class: rec.correct ? 'ok' : 'bad' }, rec.correct ? '对。' : rec.timeout ? '超时。' : '不对。'), '规律：' + explainItem(it));
          flash(wrap, rec.correct, rec.correct ? '✓' : rec.timeout ? '超时' : '✗', signal, 500).catch(() => {});
          nextBtn.textContent = i < total - 1 ? '下一题' : '看结果';
          next.hidden = false;
          await choose([nextBtn], { signal, keys: ['enter', ' ', 'arrowright'] });
          next.hidden = true;
        } else {
          await wait(300, signal);
        }
      }
    } catch (e) {
      if (!(e instanceof AbortedError) && !signal?.aborted) throw e;
    }
    ask.hidden = true; next.hidden = true;

    const summary = summarize(recs, gen);
    return {
      aborted: recs.length < total,
      trials: recs,
      summary,
      display: buildDisplay(summary, gen),
      accuracy: recs.length ? summary.acc : null,
    };
  },
};
