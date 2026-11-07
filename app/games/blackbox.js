// 灵台试炼 · 黑箱实验室（blackbox）
// 假设检验：每个黑箱藏一条规则，用户输入数字看输出（次数有限），再做程序挑选的测验题（能区分真规则和常见错误猜想）。
// 导入时不碰 DOM：normParams / generate / evalSeq / scoreBox / summarize / buildDisplay / describe 都是纯函数，可在 node 里自测。

import { makeRng, h, wait, progressHead, flash, isMobile, AbortedError, round } from '../core/gamekit.js';

const ID = 'blackbox';
const NAME = '黑箱实验室';
export const LEVEL_NAMES = ['格物', '致知', '诚意', '正心', '修身', '齐家', '治国'];
const LEVEL_DESC = [
  '简单的一次函数，多试几次就能猜出来',
  '规则在 0、负数或很大的数上才露出真面目',
  '小数字上看着像一种规则，其实是另一种（奇偶、余数、数位）',
  '规则更绕；两个输入时两数会互相影响',
  '规则本身不难，但有个别例外',
  '几条子规则串起来或分段',
  '黑箱有记忆：输出和之前的输入有关',
];
export const MAX_ABS = 9999;            // 输入范围 -9999..9999
export const BIG = 50;                  // |x| ≥ 50 算“极端值”
export const CASUAL_EXTRA_PROBES = 5;

const DEFAULTS = { level: 1, boxes: 3, probes: 10, inputs: 1, tests: 4, showFeedback: true };

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
  return {
    level: clampInt(q.level, 1, 7, DEFAULTS.level),
    boxes: clampInt(q.boxes, 1, 6, DEFAULTS.boxes),
    probes: clampInt(q.probes, 3, 20, DEFAULTS.probes),
    inputs: clampInt(q.inputs, 1, 2, DEFAULTS.inputs),
    tests: clampInt(q.tests, 3, 5, DEFAULTS.tests),
    showFeedback: toBool(q.showFeedback, true),
  };
}

// ---------- 小工具 ----------
const sgn = (x) => (x < 0 ? -1 : 1);
export const digitSum = (x) => String(Math.abs(x)).split('').reduce((a, c) => a + Number(c), 0);
export const reverseNum = (x) => sgn(x) * Number(String(Math.abs(x)).split('').reverse().join(''));
export const mod = (x, m) => ((x % m) + m) % m;
const Z = (v) => (Object.is(v, -0) ? 0 : v);

// 一次式文字：L(2,3)='2x+3'，L(-1,0)='-x'
export function L(a, b, v = 'x') {
  if (a === 0) return String(b);
  let s = a === 1 ? v : a === -1 ? `-${v}` : `${a}${v}`;
  if (b > 0) s += `+${b}`; else if (b < 0) s += `-${-b}`;
  return s;
}
function L2(a, b, c) {
  let s = L(a, 0, 'x');
  if (b !== 0) s += b === 1 ? '+y' : b === -1 ? '-y' : b > 0 ? `+${b}y` : `-${-b}y`;
  if (c > 0) s += `+${c}`; else if (c < 0) s += `-${-c}`;
  return s;
}

// 规则对象：{fam, name, arity, init(), step(state, x, y) => [out, newState], stateful?, exc?}
const R = (fam, name, f, arity = 1) => ({ fam, name, arity, init: () => null, step: (st, x, y) => [Z(f(x, y)), st] });
const S = (fam, name, init, step, arity = 1) => ({
  fam, name, arity, init, stateful: true,
  step: (st, x, y) => { const [o, ns] = step(st, x, y); return [Z(o), ns]; },
});

// seq 每项是 [x] / [x,y]，或 'R'（清零）。返回输出数组（清零处为 null）
export function evalSeq(rule, seq) {
  let st = rule.init();
  const out = [];
  for (const it of seq) {
    if (it === 'R') { st = rule.init(); out.push(null); continue; }
    const [o, ns] = rule.step(st, it[0], it[1]);
    out.push(o); st = ns;
  }
  return out;
}
const at = (rule, x, y) => rule.step(rule.init(), x, y)[0];

// ---------- 规则族 ----------
const ONE = {
  1: [
    (r) => { const a = r.pick([1, 2, 3, -1, 2, 3, 5]); let b = r.int(-6, 6); if (a === 1 && b === 0) b = 4; return R('linear', `输出 = ${L(a, b)}`, (x) => a * x + b); },
  ],
  2: [
    (r) => { const k = r.pick([1, 2, 3]); const b = r.int(-3, 3); return R('abs', `输出 = ${k === 1 ? '' : k}|x|${b > 0 ? '+' + b : b < 0 ? '-' + -b : ''}`, (x) => k * Math.abs(x) + b); },
    (r) => { const b = r.int(-3, 3); return R('square', `输出 = x×x${b > 0 ? '+' + b : b < 0 ? '-' + -b : ''}`, (x) => x * x + b); },
    (r) => { const a = r.pick([1, 2]); const b = r.int(0, 3); const c = r.pick([0, 0, -1, 1]); return R('sign', `x≥0 时 ${L(a, b)}；x<0 时输出 ${c}`, (x) => (x < 0 ? c : a * x + b)); },
    (r) => { const a = r.pick([1, 2]); const C = r.pick([20, 30, 50]); return R('cap', `输出 = ${L(a, 0)}，但最大不超过 ${C}`, (x) => Math.min(a * x, C)); },
  ],
  3: [
    (r) => r.pick([
      () => R('parity', '偶数时 x÷2，奇数时 x+1', (x) => (mod(x, 2) === 0 ? x / 2 : x + 1)),
      () => { const a = r.int(1, 4); return R('parity', `偶数时 x+${a}，奇数时 x-${a}`, (x) => (mod(x, 2) === 0 ? x + a : x - a)); },
      () => R('parity', '偶数时 2x，奇数时原样输出 x', (x) => (mod(x, 2) === 0 ? 2 * x : x)),
    ])(),
    (r) => { const m = r.pick([3, 4, 5, 7, 10]); return R('mod', `输出 = x 除以 ${m} 的余数（0 到 ${m - 1}，负数也一样）`, (x) => mod(x, m)); },
    () => R('digitsum', '输出 = x 各位数字之和（不管正负号）', (x) => digitSum(x)),
    () => R('reverse', '输出 = 把 x 的数字倒过来写（保留负号，120→21）', (x) => reverseNum(x)),
  ],
  4: [
    (r) => { const a = r.pick([2, 3]); const b = r.int(1, 4); const m = r.pick([5, 7, 10]); return R('modlin', `输出 = (${L(a, b)}) 除以 ${m} 的余数`, (x) => mod(a * x + b, m)); },
    (r) => { const k = r.pick([2, 3]); const b = r.int(-2, 3); return R('digitlin', `输出 = ${k}×(各位数字之和)${b > 0 ? '+' + b : b < 0 ? '-' + -b : ''}`, (x) => k * digitSum(x) + b); },
    () => R('mult3', 'x 是 3 的倍数时 x÷3，否则 x+1', (x) => (mod(x, 3) === 0 ? x / 3 : x + 1)),
  ],
};
const TWO = {
  1: [
    (r) => { const a = r.pick([1, 2, 3, -1]); const b = r.pick([1, 2, -1, 3]); const c = r.int(-3, 3); return R('lin2', `输出 = ${L2(a, b, c)}`, (x, y) => a * x + b * y + c, 2); },
  ],
  2: [
    (r) => { const c = r.int(0, 2); return R('max2', `输出 = x 和 y 中较大的${c ? '再+' + c : ''}`, (x, y) => Math.max(x, y) + c, 2); },
    () => R('min2', '输出 = x 和 y 中较小的', (x, y) => Math.min(x, y), 2),
    (r) => { const c = r.int(-2, 2); return R('mul2', `输出 = x×y${c > 0 ? '+' + c : c < 0 ? '-' + -c : ''}`, (x, y) => x * y + c, 2); },
    () => R('absdiff', '输出 = |x-y|', (x, y) => Math.abs(x - y), 2),
  ],
  3: [
    (r) => { const m = r.pick([5, 10]); return R('modsum', `输出 = (x+y) 除以 ${m} 的余数`, (x, y) => mod(x + y, m), 2); },
    () => R('parity2', 'x 为偶数时 x+y，否则 x-y', (x, y) => (mod(x, 2) === 0 ? x + y : x - y), 2),
    () => R('digits2', '输出 = x 的各位数字和 + y 的各位数字和', (x, y) => digitSum(x) + digitSum(y), 2),
  ],
  4: [
    (r) => r.pick([
      () => R('mulplus', '输出 = x×y + x', (x, y) => x * y + x, 2),
      () => R('mulplus', '输出 = x×y - y', (x, y) => x * y - y, 2),
      () => R('mulplus', '输出 = (x+1)×(y-1)', (x, y) => (x + 1) * (y - 1), 2),
      () => R('mulplus', '输出 = x×x - y', (x, y) => x * x - y, 2),
    ])(),
    (r) => r.pick([
      () => R('cond2', 'y>0 时输出 x，否则输出 -x', (x, y) => (y > 0 ? x : -x), 2),
      () => R('cond2', 'x>y 时输出 x-y，否则输出 x+y', (x, y) => (x > y ? x - y : x + y), 2),
      () => R('cond2', 'y 为偶数时 x+y，否则 x×y', (x, y) => (mod(y, 2) === 0 ? x + y : x * y), 2),
      () => R('cond2', 'x≥y 时输出 x，否则输出 2y', (x, y) => (x >= y ? x : 2 * y), 2),
    ])(),
  ],
};

// 齐家：子规则串联 / 分段
const STEP1 = [
  (r) => { const a = r.pick([2, 3]); return { t: `${a}x`, f: (x) => a * x, lin: true }; },
  (r) => { const b = r.pick([1, 2, 3, 5]); return { t: `x+${b}`, f: (x) => x + b, lin: true }; },
  () => ({ t: 'x×x', f: (x) => x * x }),
  () => ({ t: '|x|', f: (x) => Math.abs(x) }),
];
const STEP2 = [
  (r) => { const m = r.pick([5, 7, 10]); return { t: `除以 ${m} 的余数`, f: (v) => mod(v, m) }; },
  () => ({ t: '各位数字之和', f: (v) => digitSum(v) }),
  () => ({ t: '数字倒过来写', f: (v) => reverseNum(v) }),
  (r) => { const b = r.pick([1, 3, -2]); return { t: `${b > 0 ? '+' : ''}${b}`, f: (v) => v + b, lin: true }; },
  (r) => { const a = r.pick([2, -1]); return { t: `×${a}`, f: (v) => a * v, lin: true }; },
];
function chainOne(r) {
  if (r.chance(0.3)) {
    const A = [r.pick([0, -1, 1]), r.int(0, 3)], B = [r.pick([1, 2]), r.int(0, 3)], C = [r.pick([-1, 1, 3]), r.int(-5, 5)];
    return R('piece3', `x<0 时 ${L(A[0], A[1])}；0≤x<10 时 ${L(B[0], B[1])}；x≥10 时 ${L(C[0], C[1])}`,
      (x) => (x < 0 ? A[0] * x + A[1] : x < 10 ? B[0] * x + B[1] : C[0] * x + C[1]));
  }
  let a, b;
  do { a = r.pick(STEP1)(r); b = r.pick(STEP2)(r); } while (a.lin && b.lin);
  return R('chain', `先算 ${a.t}，再${b.lin ? '' : '取'}${b.t}`, (x) => b.f(a.f(x)));
}
function chainTwo(r) {
  const c = r.pick([
    { t: 'x+y', f: (x, y) => x + y }, { t: 'x×y', f: (x, y) => x * y },
    { t: 'x-y', f: (x, y) => x - y }, { t: 'x、y 中较大的', f: (x, y) => Math.max(x, y) },
  ]);
  const b = r.pick(STEP2.slice(0, 3))(r);
  return R('chain2', `先算 ${c.t}，再取${b.t}`, (x, y) => b.f(c.f(x, y)), 2);
}

// 治国：有记忆
const STATE_ONE = [
  () => S('prevsum', '输出 = 本次输入 + 上一次输入（清零后上一次算 0）', () => 0, (p, x) => [x + p, x]),
  () => S('prevdiff', '输出 = 本次输入 - 上一次输入（清零后上一次算 0）', () => 0, (p, x) => [x - p, x]),
  (r) => r.chance(0.5)
    ? S('counter', '输出 = x + n（n=清零后第几次输入）', () => 0, (n, x) => [x + n + 1, n + 1])
    : S('counter', '输出 = x × n（n=清零后第几次输入）', () => 0, (n, x) => [x * (n + 1), n + 1]),
  () => S('running', '输出 = 清零以来所有输入之和', () => 0, (s, x) => [s + x, s + x]),
  (r) => { const a = r.int(1, 5); return S('toggle', `第 1、3、5… 次输出 x+${a}，第 2、4、6… 次输出 x-${a}（清零重新数）`, () => 0, (n, x) => [n % 2 === 0 ? x + a : x - a, n + 1]); },
  () => S('maxsofar', '输出 = 清零以来输入过的最大数', () => null, (m, x) => { const v = m === null ? x : Math.max(m, x); return [v, v]; }),
  () => S('prevout', '输出 = 本次输入 - 上一次的输出（清零后算 0）', () => 0, (p, x) => [x - p, x - p]),
];
const STATE_TWO = [
  () => S('counter2', '输出 = x×n + y（n=清零后第几次输入）', () => 0, (n, x, y) => [x * (n + 1) + y, n + 1], 2),
  () => S('prev2', '输出 = x + y + 上一次的 x（清零后算 0）', () => 0, (p, x, y) => [x + y + p, x], 2),
  () => S('running2', '输出 = 清零以来所有 x 之和 - y', () => 0, (s, x, y) => [s + x - y, s + x], 2),
];

// 例外（修身）：只套在无记忆规则上
const EXC_ONE = [
  { t: 'x 是 7 的倍数（非 0）时输出 0', trig: (x) => x !== 0 && x % 7 === 0, f: () => 0 },
  { t: 'x 的个位是 5 时原样输出 x', trig: (x) => Math.abs(x) % 10 === 5, f: (x) => x },
  { t: 'x=0 时输出 99', trig: (x) => x === 0, f: () => 99 },
  { t: 'x 大于 100 时输出 100', trig: (x) => x > 100, f: () => 100 },
];
const EXC_TWO = [
  { t: 'x 与 y 相等时输出 0', trig: (x, y) => x === y, f: () => 0 },
  { t: 'x=0 时输出 99', trig: (x) => x === 0, f: () => 99 },
  { t: 'y 是 7 的倍数（非 0）时输出 7', trig: (x, y) => y !== 0 && y % 7 === 0, f: () => 7 },
];

// ---------- 测验候选 ----------
const POOL1 = [0, -1, -2, -3, -4, -5, -6, -7, -9, -10, -11, -12, -14, -15, -20, -25, -50, -99, -100, -123,
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 24, 25, 28, 30, 35, 42, 49,
  50, 51, 55, 63, 70, 77, 99, 100, 101, 105, 120, 123, 150, 250, 999, 1000];
const V2 = [-5, -3, -2, -1, 0, 1, 2, 3, 4, 5, 7, 10, 12, 14, 20, 50, 100];
const POOL2 = V2.flatMap((x) => V2.map((y) => [x, y]));
const candidates = (arity) => (arity === 1 ? POOL1.map((x) => [x]) : POOL2);
const mag = (it) => Math.max(...it.map(Math.abs));
const isEdge = (it) => it.some((v) => v <= 0);
const isBig = (it) => mag(it) >= BIG;
const isPlain = (it) => it.every((v) => v > 0 && v < BIG);   // 普通的正数输入
const bucket = (it) => it.map((v) => (v < 0 ? 'n' : v === 0 ? 'z' : 'p') + (Math.abs(v) >= BIG ? 'B' : '')).join('');

// 等价判定用的固定检查序列
const CHK1 = [0, 1, 2, 3, -1, -2, 5, 7, 10, -10, 12, 15, 21, 35, 49, 50, 77, 100, 101, -100, 123, 999, 6, 4, -7, 14, 9, 11, -3, 30];
const CHK2 = [[0, 0], [1, 1], [2, 1], [1, 2], [3, 5], [5, 3], [-2, 4], [4, -2], [0, 7], [7, 0], [-3, -3], [10, 12], [12, 10], [100, 3], [2, 50], [-5, 1], [6, 6], [14, 7], [1, -1], [9, 2]];
function sig(rule) {
  const base = rule.arity === 1 ? CHK1.map((x) => [x]) : CHK2;
  const seqs = [base, base.slice().reverse(), [base[3], base[3], base[3], 'R', base[1], base[1], base[6], base[6]]];
  return JSON.stringify(seqs.map((q) => evalSeq(rule, q)));
}

// 常见的错误猜想（通用部分）
function genericDecoys(rule) {
  const d = [];
  const f = (x, y) => at(rule, x, y);
  if (rule.arity === 1) {
    const a = f(2) - f(1), b = f(1) - a;
    d.push(R('d:linfit12', `一次式 ${L(a, b)}`, (x) => a * x + b));
    const a2 = f(3) - f(2), b2 = f(2) - 2 * a2;
    d.push(R('d:linfit23', `一次式 ${L(a2, b2)}`, (x) => a2 * x + b2));
    d.push(R('d:abs', '不管正负号', (x) => f(Math.abs(x))));
    d.push(R('d:odd', '负数取相反', (x) => (x < 0 ? -f(-x) : f(x))));
    d.push(R('d:small', '只在 0–20 里成立', (x) => f(mod(x, 20))));
  } else {
    const c0 = f(1, 1), a = f(2, 1) - c0, b = f(1, 2) - c0, c = c0 - a - b;
    d.push(R('d:lin2', `一次式 ${L2(a, b, c)}`, (x, y) => a * x + b * y + c, 2));
    d.push(R('d:onlyx', '只看 x', (x) => f(x, 1), 2));
    d.push(R('d:onlyy', '只看 y', (x, y) => f(1, y), 2));
    d.push(R('d:swap', 'x、y 对调也一样', (x, y) => f(y, x), 2));
    d.push(R('d:abs2', '不管正负号', (x, y) => f(Math.abs(x), Math.abs(y)), 2));
  }
  if (rule.stateful) d.push(R('d:nomem', '没有记忆', (x, y) => f(x, y), rule.arity));
  if (rule.base) d.push(rule.base);   // 例外箱：不带例外的原规则
  return d;
}

function withExc(base, e) {
  const r = R(base.fam, `${base.name}；但 ${e.t}`, (x, y) => (e.trig(x, y) ? e.f(x, y) : at(base, x, y)), base.arity);
  r.exc = e; r.base = { ...base, fam: 'd:noexc' };
  return r;
}
// 例外必须真的改变至少两个候选输入的输出
function excUseful(base, e) {
  let n = 0;
  for (const it of candidates(base.arity)) if (e.trig(...it) && e.f(...it) !== at(base, ...it)) n++;
  return n >= 2;
}

function pickStateless(lv, arity, r) {
  const T = arity === 1 ? ONE : TWO;
  const lvl = Math.min(lv, 4);
  return r.pick(T[lvl])(r);
}

// 选一个箱子的规则
export function makeRule(level, arity, r, { casual = false, noExcept = false } = {}) {
  let lv = level;
  if (level >= 2 && r.chance(0.3)) lv = r.int(Math.max(1, level - 2), level - 1); // 偶尔复习低档
  let rule;
  if (lv <= 4) rule = pickStateless(lv, arity, r);
  else if (lv === 5) rule = pickStateless(r.int(1, arity === 2 ? 4 : 3), arity, r);
  else if (lv === 6) rule = arity === 1 ? chainOne(r) : chainTwo(r);
  else rule = r.pick(arity === 1 ? STATE_ONE : STATE_TWO)(r);
  const wantExc = !casual && !noExcept && !rule.stateful && (lv === 5 || (level >= 6 && r.chance(0.2)));
  if (wantExc) {
    const list = r.shuffle(arity === 1 ? EXC_ONE : EXC_TWO);
    const e = list.find((x) => excUseful(rule, x));
    if (e) rule = withExc(rule, e);
  }
  rule.lv = lv;
  return rule;
}

// 贪心选测验题：每步挑能排除最多“仍活着”的错误猜想的输入，同时保证有 0/负数、有大数、例外箱有触发和不触发
export function pickTests(rule, decoys, T, r) {
  const reqs = [isEdge, isBig, isPlain];
  if (rule.exc) { reqs.push((it) => rule.exc.trig(...it)); reqs.push((it) => !rule.exc.trig(...it)); }
  const met = reqs.map(() => false);
  const pool = candidates(rule.arity);
  const chosen = [];
  const seenB = new Set();
  let alive = decoys.slice();
  for (let k = 0; k < T; k++) {
    const unmet = met.filter((m) => !m).length;
    const left = T - k;
    let best = null, bestS = -Infinity;
    for (const c of pool) {
      if (chosen.some((z) => z.length === c.length && z.every((v, i) => v === c[i]))) continue;
      const seq = [...chosen, c];
      const tv = evalSeq(rule, seq)[k];
      if (!Number.isSafeInteger(tv) || Math.abs(tv) > 1e7) continue;
      let kills = 0;
      for (const d of alive) if (evalSeq(d, seq)[k] !== tv) kills++;
      const rb = reqs.reduce((n, q, j) => n + (!met[j] && q(c) ? 1 : 0), 0);
      // 错误猜想都排除后，尽量让题目覆盖不同区间（负/零/正 × 小/大），数字别太大
      const noise = r.next() * 3 - mag(c) / 150 + (seenB.has(bucket(c)) ? 0 : 4);
      const sc = left <= unmet ? rb * 1000 + kills * 10 + noise : kills * 10 + rb * 6 + noise;
      if (sc > bestS) { bestS = sc; best = c; }
    }
    chosen.push(best);
    seenB.add(bucket(best));
    const tv = evalSeq(rule, chosen);
    alive = alive.filter((d) => evalSeq(d, chosen).every((v, i) => v === tv[i]));
    reqs.forEach((q, j) => { if (q(best)) met[j] = true; });
  }
  return { tests: chosen, expected: evalSeq(rule, chosen), survivors: alive };
}

// 纯函数：生成一组黑箱。opts.casual：休闲（不出例外、试探次数 +5）
export function generate(params, rng, opts = {}) {
  const p = normParams(params);
  const casual = !!opts.casual;
  const probes = casual ? Math.min(25, p.probes + CASUAL_EXTRA_PROBES) : p.probes;
  const boxes = [];
  let lastFam = null;
  for (let i = 0; i < p.boxes; i++) {
    let rule;
    for (let t = 0; t < 6; t++) { rule = makeRule(p.level, p.inputs, rng, { casual }); if (rule.fam !== lastFam) break; }
    lastFam = rule.fam;
    const ts = sig(rule);
    const seen = new Set([ts]);
    const decoys = [];
    for (const d of genericDecoys(rule)) {
      const ds = sig(d);
      if (seen.has(ds)) continue;
      seen.add(ds); decoys.push(d);
    }
    const pt = pickTests(rule, decoys, p.tests, rng);
    boxes.push({
      i, lv: rule.lv, fam: rule.fam, name: rule.name, arity: rule.arity, stateful: !!rule.stateful, exc: !!rule.exc,
      rule, decoys, tests: pt.tests, expected: pt.expected, survivors: pt.survivors.length,
    });
  }
  return { boxes, probes, casual, params: p };
}

// ---------- 计分 ----------
const fmtIn = (it) => it.join(',');
export function fmtLog(log) {
  return log.map((e) => (e.reset ? '|' : `${fmtIn(e.in)}→${e.out}`)).join(' ');
}

// log：[{in:[x]或[x,y], out} | {reset:true}]；answers：[{v, rtMs}]，可能少于题数（中途结束）
export function scoreBox(box, log, answers, guess, ms) {
  const probes = log.filter((e) => !e.reset);
  const vals = probes.flatMap((e) => e.in);
  const seq = log.map((e) => (e.reset ? 'R' : e.in));
  const tv = evalSeq(box.rule, seq);
  let ruled = 0;
  for (const d of box.decoys) { const o = evalSeq(d, seq); if (o.some((v, i) => v !== tv[i])) ruled++; }
  const T = box.tests.length;
  const marks = answers.map((a, k) => a.v === box.expected[k]);
  const nc = marks.filter(Boolean).length;
  const detail = answers.map((a, k) => `${fmtIn(box.tests[k])}:${box.expected[k]}${marks[k] ? '✓' : `✗(答${a.v})`}`).join(' ');
  return {
    i: box.i, fam: box.fam, rule: box.name, exc: box.exc, stateful: box.stateful,
    probes: fmtLog(log), used: probes.length,
    zero: vals.includes(0) ? 1 : 0,
    neg: vals.some((v) => v < 0) ? 1 : 0,
    ext: vals.some((v) => Math.abs(v) >= BIG) ? 1 : 0,
    resets: log.filter((e) => e.reset).length,
    ruled_out: `${ruled}/${box.decoys.length}`,
    n_tests: T, n_answered: answers.length, n_correct: nc,
    cracked: answers.length === T && nc === T,
    tests: detail,
    guess: String(guess || '').replace(/s+/g, ' ').trim(),
    t_s: round(ms / 1000, 1),
  };
}

export function summarize(recs, gen) {
  const n = recs.reduce((a, r) => a + r.n_answered, 0);
  const c = recs.reduce((a, r) => a + r.n_correct, 0);
  const cnt = (k) => recs.filter((r) => r[k]).length;
  const used = recs.map((r) => r.used);
  return {
    level: gen.params.level,
    level_name: LEVEL_NAMES[gen.params.level - 1],
    inputs: gen.params.inputs,
    n_boxes: recs.length,
    n_trials: n,
    n_correct: c,
    acc: n ? round(c / n, 3) : null,
    boxes_cracked: cnt('cracked'),
    probes_budget: gen.probes,
    probes_avg: used.length ? round(used.reduce((a, b) => a + b, 0) / used.length, 1) : null,
    probed_zero_boxes: cnt('zero'),
    probed_neg_boxes: cnt('neg'),
    probed_extreme_boxes: cnt('ext'),
    time_s: round(recs.reduce((a, r) => a + r.t_s, 0), 1),
    boxes: recs.map((r) => ({
      fam: r.fam, rule: r.rule, probes: r.probes, used: r.used, zero: r.zero, neg: r.neg, ext: r.ext,
      ruled_out: r.ruled_out, tests: `${r.n_correct}/${r.n_tests}${r.n_answered < r.n_tests ? `（只答了${r.n_answered}）` : ''}`,
      detail: r.tests, guess: r.guess, t_s: r.t_s,
    })),
  };
}

export function buildDisplay(sm) {
  const d = [['测验答对', sm.n_trials ? `${sm.n_correct}/${sm.n_trials}（${Math.round((sm.acc || 0) * 100)}%）` : '—']];
  d.push(['破解黑箱', `${sm.boxes_cracked}/${sm.n_boxes} 个`]);
  d.push(['平均试探', sm.probes_avg == null ? '—' : `${sm.probes_avg} / ${sm.probes_budget} 次`]);
  d.push(['试过 0 / 负数 / 大数', `${sm.probed_zero_boxes} / ${sm.probed_neg_boxes} / ${sm.probed_extreme_boxes} 个箱子`]);
  return d;
}

export function describe(params, mode) {
  const p = normParams(params);
  const probes = mode === 'casual' ? Math.min(25, p.probes + CASUAL_EXTRA_PROBES) : p.probes;
  return `第 ${p.level} 档「${LEVEL_NAMES[p.level - 1]}」：${LEVEL_DESC[p.level - 1]}。共 ${p.boxes} 个黑箱，每个最多试 ${probes} 次，`
    + `${p.inputs === 2 ? '每次输入两个整数' : '每次输入一个整数'}；然后做 ${p.tests} 道预测题${p.showFeedback ? '，答完马上告诉你对错和真规则' : ''}。`;
}

// ---------- 界面 ----------
const CSS = `
.bb-wrap{display:flex;flex-direction:column;gap:8px;width:100%;max-width:760px;margin:0 auto;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.bb-main{display:grid;grid-template-columns:minmax(0,1fr);gap:8px}
@media (min-width:700px){.bb-main{grid-template-columns:minmax(0,1fr) minmax(0,310px);align-items:start}}
.bb-box{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:8px 10px;position:relative;min-width:0;box-sizing:border-box}
.bb-title{display:flex;justify-content:space-between;align-items:baseline;gap:8px;font-weight:700;font-size:15px;margin-bottom:4px}
.bb-left{font-weight:400;font-size:13px;color:var(--muted)}
.bb-left.bb-low{color:var(--bad)}
.bb-log{max-height:min(30vh,300px);min-height:72px;overflow-y:auto;overscroll-behavior:contain}
@media (min-width:700px){.bb-log{max-height:min(52vh,420px)}}
.bb-log table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:16px}
.bb-log th{font-size:12px;color:var(--muted);font-weight:400;text-align:right;padding:2px 6px;position:sticky;top:0;background:var(--card)}
.bb-log td{text-align:right;padding:3px 6px;border-top:1px solid var(--line);word-break:break-all}
.bb-log td:first-child,.bb-log th:first-child{text-align:left;color:var(--muted);font-size:12px;width:3.2em;word-break:keep-all}
.bb-log tr.bb-rs td{border-top:2px dashed var(--muted);color:var(--muted);font-size:11px;text-align:center;padding:1px}
.bb-log tr.bb-t td{background:color-mix(in srgb,var(--accent) 8%,transparent)}
.bb-log td.bb-empty{color:var(--muted);font-size:13px;text-align:center;padding:14px 0;width:auto}
.bb-ok{color:var(--ok);font-weight:700}
.bb-bad{color:var(--bad);font-weight:700}
.bb-entry{display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;margin:2px 0 6px}
.bb-lab{font-size:14px;color:var(--muted)}
.bb-q{font-size:18px;font-weight:700;font-variant-numeric:tabular-nums}
.bb-field{min-width:4.6em;min-height:46px;padding:4px 10px;border:2px solid var(--line);border-radius:10px;background:var(--bg);color:var(--fg);font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;display:flex;align-items:center;justify-content:center;cursor:pointer;box-sizing:border-box}
.bb-field.bb-on{border-color:var(--accent)}
.bb-ph{color:var(--muted);font-weight:400;font-size:14px}
.bb-pad{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}
.bb-pad[hidden],.bb-guess[hidden]{display:none}
.bb-wrap .bb-pad .g-btn{min-height:48px;font-size:21px;font-weight:600;padding:4px;margin:0;min-width:0}
.bb-acts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:6px}
.bb-acts.bb-one{grid-template-columns:minmax(0,1fr)}
.bb-wrap .bb-acts .g-btn{min-height:50px;padding:4px 6px;font-size:15px;margin:0;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.2}
.bb-key{font-size:11px;font-weight:400;opacity:.75}
.bb-guess{width:100%;box-sizing:border-box;min-height:42px;padding:6px 10px;margin:0 0 6px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg);font-size:16px}
.bb-msg{min-height:1.4em;text-align:center;font-size:13px;margin:4px 0 0;color:var(--muted)}
.bb-msg.bb-warn{color:var(--bad)}
.bb-reveal{text-align:center;line-height:1.6;padding:6px 0;font-size:15px}
.bb-reveal b{color:var(--accent)}
.g-casual .bb-wrap .bb-pad .g-btn,.g-casual .bb-wrap .bb-acts .g-btn{min-height:58px}
.p-nokeys .bb-key{display:none}
@media (max-width:360px){.bb-wrap .bb-pad .g-btn{min-height:44px;font-size:19px}.bb-field{font-size:19px;min-width:4em}}
`;

function injectStyle() {
  if (document.getElementById(`style-${ID}`)) return;
  const st = document.createElement('style');
  st.id = `style-${ID}`;
  st.textContent = CSS;
  document.head.append(st);
}

const parseInt0 = (s) => (/^-?\d+$/.test(s) ? Z(Number(s)) : null);

export default {
  id: ID,
  name: NAME,
  line: 'blackbox',
  casual: true,
  blurb: '每个黑箱藏着一条规则：自己挑数字去试，看懂了再预测它的输出。',
  aiDescription:
    '黑箱实验室，练假设检验，可休闲。每箱藏一条整数规则，用户自己输入数字看输出（次数=probes，可随时清零不扣次数），然后做 tests 道预测题。'
    + '测验输入由程序挑选，专门区分真规则和常见错误猜想（一次式拟合、忽略正负号、只看一个输入、没有记忆、忽略例外），且必含 0 或负数和 |x|≥50 的大数。'
    + 'level 对应格物八目：1 一次式，2 绝对值/平方/分段/封顶，3 奇偶/余数/数位和/倒序，4 更绕的规则或两数交互，5 带例外，6 子规则串联或三段，7 有记忆；高档约三成箱子复习低档。inputs=2 每次输入两个数。休闲模式试探 +5、不出例外。'
    + 'summary：probed_zero/neg/extreme_boxes 是主动试过 0、负数、大数的箱子数（看是否会找反例）；probes_avg 平均试探数；boxes 每箱含隐藏规则 rule、按顺序的试探记录 probes（| 表示清零）、ruled_out 为试探已排除的错误猜想数/总数、tests 答对数、detail 每题输入:正确输出、guess 用户写的规则、t_s 用时秒。',
  defaults: { ...DEFAULTS },
  paramSpec: {
    level: { type: 'int', min: 1, max: 7, desc: '规则难度档=格物八目：1格物 一次式；2致知 绝对值/平方/分段/封顶（0、负数、大数才露馅）；3诚意 奇偶/余数/数位和/倒序；4正心 更绕，inputs=2 时两数交互；5修身 简单规则+个别例外；6齐家 两步串联或三段分段；7治国 有记忆' },
    boxes: { type: 'int', min: 1, max: 6, desc: '本组黑箱个数' },
    probes: { type: 'int', min: 3, max: 20, desc: '每箱最多试探次数（休闲自动 +5）；越少越要挑有信息量的输入' },
    inputs: { type: 'int', min: 1, max: 2, desc: '1=每次输入一个整数；2=输入 x、y 两个整数（规则用到两者）' },
    tests: { type: 'int', min: 3, max: 5, desc: '每箱测验题数' },
    showFeedback: { type: 'bool', desc: '测验每题后显示对错，每箱结束公布真规则' },
  },
  describe,

  async run(root, ctx) {
    const signal = ctx.signal;
    injectStyle();
    const casual = ctx.mode === 'casual';
    const gen = generate(ctx.params, makeRng(ctx.seed), { casual });
    const p = gen.params;
    const nBox = gen.boxes.length;
    const desk = !isMobile();
    if (casual) root.classList.add('g-casual');
    root.innerHTML = '';

    // ---------- DOM ----------
    const head = progressHead(NAME);
    head.set(0, nBox, `0/${nBox}`);
    const title = h('span');
    const leftEl = h('span', { class: 'bb-left' });
    const thead = h('thead');
    const tbody = h('tbody');
    const logBox = h('div', { class: 'bb-log' }, h('table', null, thead, tbody));
    const logCard = h('div', { class: 'bb-box' }, h('div', { class: 'bb-title' }, title, leftEl), logBox);
    const guess = h('input', { class: 'bb-guess', type: 'text', placeholder: '我猜的规则（选填，可以用语音输入）', autocomplete: 'off', enterkeyhint: 'done' });
    const entry = h('div', { class: 'bb-entry' });
    const PAD = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '±', '0', '⌫'];
    const padBtns = PAD.map((k) => h('button', { class: 'g-btn', type: 'button', 'aria-label': k === '±' ? '正负号' : k === '⌫' ? '删除' : k },
      k === '±' ? '−/+' : k, desk && k === '±' ? h('span', { class: 'bb-key' }, ' -') : null));
    const pad = h('div', { class: 'bb-pad' }, padBtns);
    const acts = h('div', { class: 'bb-acts' });
    const msg = h('p', { class: 'bb-msg' });
    const ctrlCard = h('div', { class: 'bb-box' }, guess, entry, pad, acts, msg);
    const hint = h('div', { class: 'g-note' });
    root.append(h('div', { class: 'bb-wrap' }, head.el, h('div', { class: 'bb-main' }, logCard, ctrlCard), hint));

    // ---------- 输入框（自绘，不弹系统键盘） ----------
    let fields = [];   // {val, max}
    let active = 0;
    let fieldEls = [];
    const paint = () => fields.forEach((f, i) => {
      const el = fieldEls[i];
      el.classList.toggle('bb-on', i === active);
      el.replaceChildren(f.val ? f.val.replace('-', '−') : h('span', { class: 'bb-ph' }, f.ph));
    });
    const setEntry = (parts) => {
      fieldEls = [];
      entry.replaceChildren(...parts.map((pt) => {
        if (typeof pt === 'string') return h('span', { class: 'bb-lab' }, pt);
        if (pt.q) return h('span', { class: 'bb-q' }, pt.q);
        const i = fieldEls.length;
        const el = h('div', { class: 'bb-field', role: 'textbox', onclick: () => { active = i; paint(); } });
        fieldEls.push(el);
        return el;
      }));
      active = 0;
      paint();
    };
    const say = (t, bad) => { msg.textContent = t || ''; msg.classList.toggle('bb-warn', !!bad); };
    const edit = (k) => {
      const f = fields[active];
      if (!f) return;
      let neg = f.val.startsWith('-');
      let dg = neg ? f.val.slice(1) : f.val;
      if (k === '±') neg = !neg;
      else if (k === '⌫') { if (dg) dg = dg.slice(0, -1); else neg = false; }
      else if (/^\d$/.test(k)) { if (dg === '0') dg = k; else if (dg.length < f.max) dg += k; }
      f.val = (neg ? '-' : '') + dg;
      say('');
      paint();
    };
    padBtns.forEach((b, i) => b.addEventListener('click', () => edit(PAD[i])));

    // ---------- 事件 ----------
    let waiter = null;
    const emit = (ev) => { if (waiter) { const w = waiter; waiter = null; w(ev); } };
    const nextEv = () => new Promise((res, rej) => {
      if (signal?.aborted) return rej(new AbortedError());
      const onA = () => { waiter = null; rej(new AbortedError()); };
      signal?.addEventListener('abort', onA, { once: true });
      waiter = (ev) => { signal?.removeEventListener('abort', onA); res(ev); };
    });
    const actBtn = (label, type, key, primary) => h('button', { class: 'g-btn' + (primary ? ' primary' : ''), type: 'button', onclick: () => emit({ type }) },
      h('span', null, label), desk && key ? h('span', { class: 'bb-key' }, key) : null);
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tg = e.target;
      if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA')) {
        if (e.key === 'Enter' && tg === guess) { e.preventDefault(); guess.blur(); }
        return;
      }
      const k = e.key;
      if (/^[0-9]$/.test(k)) edit(k);
      else if (k === '-' || k === '_') edit('±');
      else if (k === 'Backspace') edit('⌫');
      else if (k === 'Tab' && fields.length > 1) { active = (active + 1) % fields.length; paint(); }
      else if (k === 'Enter') { if (!e.repeat) emit({ type: 'enter' }); }
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    const cleanup = () => { window.removeEventListener('keydown', onKey); waiter = null; };

    // ---------- 日志表 ----------
    const cols = (box) => (box.arity === 2 ? 4 : 3);
    const scroll = () => { logBox.scrollTop = logBox.scrollHeight; };
    const clearEmpty = () => { const e = tbody.querySelector('.bb-empty'); if (e) e.parentElement.remove(); };
    const addRow = (n, vals, out) => { clearEmpty(); tbody.append(h('tr', null, h('td', null, `#${n}`), vals.map((v) => h('td', null, v)), h('td', null, out))); scroll(); };
    const addSep = (box, text) => { clearEmpty(); tbody.append(h('tr', { class: 'bb-rs' }, h('td', { colspan: cols(box) }, text))); scroll(); };
    const updLeft = (used) => {
      const left = gen.probes - used;
      leftEl.textContent = `还能试 ${left}/${gen.probes} 次`;
      leftEl.classList.toggle('bb-low', left <= 2);
    };

    const recs = [];
    let cur = null;
    const t0All = performance.now();
    try {
      if (signal?.aborted) throw new AbortedError();
      for (let bi = 0; bi < nBox; bi++) {
        const box = gen.boxes[bi];
        const last = bi === nBox - 1;
        cur = { box, log: [], answers: [], t0: performance.now() };
        head.set(bi, nBox, `${bi + 1}/${nBox}`);
        title.textContent = `黑箱 ${bi + 1}`;
        thead.replaceChildren(h('tr', null, h('th', null, '#'),
          box.arity === 2 ? [h('th', null, 'x'), h('th', null, 'y')] : h('th', null, '输入'), h('th', null, '输出')));
        tbody.replaceChildren(h('tr', null, h('td', { class: 'bb-empty', colspan: cols(box) }, '还没试过。输入一个数，看看黑箱怎么回答。')));
        guess.value = '';
        guess.hidden = true;
        pad.hidden = false;
        fields = box.arity === 2 ? [{ val: '', max: 4, ph: 'x' }, { val: '', max: 4, ph: 'y' }] : [{ val: '', max: 4, ph: '整数' }];
        setEntry(box.arity === 2 ? ['x', 0, 'y', 1] : ['输入', 0]);
        acts.className = 'bb-acts';
        acts.replaceChildren(actBtn('试探', 'enter', 'Enter', true), actBtn('清零', 'reset', '不扣次数'), actBtn('去测验', 'test'));
        hint.textContent = `输入整数（-${MAX_ABS} 到 ${MAX_ABS}）${box.arity === 2 ? '，x、y 两格都要填（点格子切换' + (desk ? '，或按 Tab' : '') + '）' : ''}，点“试探”看输出。“清零”让黑箱回到初始状态。有把握了就去测验。`;
        say('');

        // ---- 试探 ----
        let st = box.rule.init();
        let used = 0;
        updLeft(0);
        while (used < gen.probes) {
          const ev = await nextEv();
          if (ev.type === 'enter') {
            const vals = fields.map((f) => parseInt0(f.val));
            if (vals.some((v) => v === null)) {
              if (fields.length === 2 && vals[active] !== null && vals[1 - active] === null) { active = 1 - active; paint(); continue; }
              say(fields.length === 2 ? 'x、y 都要填整数' : '先输入一个整数', true);
              continue;
            }
            const [o, ns] = box.rule.step(st, vals[0], vals[1]);
            st = ns;
            used++;
            cur.log.push({ in: vals, out: o });
            addRow(used, vals, o);
            fields.forEach((f) => { f.val = ''; });
            active = 0; paint();
            updLeft(used);
            say('');
          } else if (ev.type === 'reset') {
            st = box.rule.init();
            if (cur.log.length && !cur.log[cur.log.length - 1].reset) { cur.log.push({ reset: true }); addSep(box, '清零'); }
            say('黑箱已清零');
          } else if (ev.type === 'test') {
            if (!used) { say('先至少试探一次', true); continue; }
            break;
          }
        }
        if (used >= gen.probes) { say('试探次数用完，开始测验'); await wait(800, signal); }

        // ---- 测验 ----
        addSep(box, '测验 · 黑箱已清零');
        guess.hidden = false;
        acts.className = 'bb-acts bb-one';
        acts.replaceChildren(actBtn('提交预测', 'enter', 'Enter', true));
        hint.textContent = '按顺序预测黑箱对这些输入的输出（测验前已清零）。上面的“我猜的规则”选填，写给教练看。';
        say('');
        const T = box.tests.length;
        for (let k = 0; k < T; k++) {
          const it = box.tests[k];
          fields = [{ val: '', max: 8, ph: '输出？' }];
          setEntry([`第 ${k + 1}/${T} 题`, { q: box.arity === 2 ? `x=${it[0]}, y=${it[1]}` : `输入 ${it[0]}` }, '→', 0]);
          const ts = performance.now();
          let v = null;
          while (v === null) {
            const ev = await nextEv();
            if (ev.type !== 'enter') continue;
            v = parseInt0(fields[0].val);
            if (v === null) say('输入你预测的输出（整数）', true);
          }
          const ok = v === box.expected[k];
          cur.answers.push({ v, rtMs: Math.round(performance.now() - ts) });
          clearEmpty();
          tbody.append(h('tr', { class: 'bb-t' }, h('td', null, `测${k + 1}`), it.map((x) => h('td', null, x)),
            h('td', null, p.showFeedback ? h('span', { class: ok ? 'bb-ok' : 'bb-bad' }, ok ? `${v} ✓` : `${v} ✗ 应为 ${box.expected[k]}`) : `答 ${v}`)));
          scroll();
          say('');
          if (p.showFeedback) await flash(logCard, ok, ok ? '✓' : `✗ 应为 ${box.expected[k]}`, signal, ok ? 500 : 1100);
        }
        const rec = scoreBox(box, cur.log, cur.answers, guess.value.trim(), performance.now() - cur.t0);
        recs.push(rec);
        cur = null;
        head.set(bi + 1, nBox, `${bi + 1}/${nBox}`);

        // ---- 揭晓 ----
        if (p.showFeedback || !last) {
          guess.hidden = true;
          pad.hidden = true;
          entry.replaceChildren(h('div', { class: 'bb-reveal' },
            p.showFeedback ? [h('div', null, '规则是：', h('b', null, box.name)), h('div', null, `测验答对 ${rec.n_correct}/${rec.n_tests}${rec.cracked ? '，破解！' : ''}`)]
              : h('div', null, '已提交。')));
          fields = [];
          acts.replaceChildren(actBtn(last ? '完成' : '下一个黑箱', 'enter', 'Enter', true));
          hint.textContent = '';
          say('');
          let ev;
          do { ev = await nextEv(); } while (ev.type !== 'enter');
        }
      }
    } catch (e) {
      if (!(e instanceof AbortedError) && !signal?.aborted) { cleanup(); throw e; }
    }
    cleanup();
    if (cur && cur.log.some((e) => !e.reset)) recs.push(scoreBox(cur.box, cur.log, cur.answers, guess.value.trim(), performance.now() - cur.t0));

    const summary = summarize(recs, gen);
    if (!recs.length) summary.time_s = round((performance.now() - t0All) / 1000, 1);
    return {
      aborted: recs.length < nBox || recs.some((r) => r.n_answered < r.n_tests),
      trials: recs,
      summary,
      display: buildDisplay(summary),
      accuracy: summary.n_trials ? summary.acc : null,
    };
  },
};
