// 灵台试炼 · 空间工坊（spatial）
// 平面旋转 rot2d / 立体积木 rot3d（Shepard–Metzler 式）/ 展开图 net。
// 导入时不碰 DOM：几何、generate、scoreTrial、summarize、buildDisplay 都是纯函数，可在 node 里自测。

import { makeRng, h, s, wait, progressHead, flash, isMobile, AbortedError, median, round } from '../core/gamekit.js';

const ID = 'spatial';
const NAME = '空间工坊';
export const KINDS = ['rot2d', 'rot3d', 'net'];
export const NET_QS = ['opposite', 'arrow', 'fold'];
export const CASUAL_MAX_TRIALS = 10;
export const SYMBOLS = ['●', '▲', '■', '◆', '✚'];
const KIND_NAME = { rot2d: '平面旋转', rot3d: '立体积木', net: '展开图' };
const ROT_CHOICES = ['同一个', '镜像'];

const DEFAULTS = {
  kinds: ['rot2d'],
  trials: 12,
  cells: 5,
  freeAngle: false,
  blocks: 6,
  rotAxes: 1,
  netQs: ['opposite', 'fold'],
  netHard: false,
  mirrorPct: 50,
  timeLimitMs: 0,
  showFeedback: true,
};

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
function toSet(v, options, d) {
  const raw = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/[,+\s]+/) : []);
  const out = options.filter((o) => raw.includes(o));
  return out.length ? out : d.slice();
}

export function normParams(params) {
  const q = { ...DEFAULTS, ...(params || {}) };
  return {
    kinds: toSet(q.kinds, KINDS, DEFAULTS.kinds),
    trials: clampInt(q.trials, 4, 40, DEFAULTS.trials),
    cells: clampInt(q.cells, 4, 8, DEFAULTS.cells),
    freeAngle: toBool(q.freeAngle, false),
    blocks: clampInt(q.blocks, 4, 10, DEFAULTS.blocks),
    rotAxes: clampInt(q.rotAxes, 1, 2, DEFAULTS.rotAxes),
    netQs: toSet(q.netQs, NET_QS, DEFAULTS.netQs),
    netHard: toBool(q.netHard, false),
    mirrorPct: clampInt(q.mirrorPct, 0, 100, DEFAULTS.mirrorPct),
    timeLimitMs: clampInt(q.timeLimitMs, 0, 30000, DEFAULTS.timeLimitMs),
    showFeedback: toBool(q.showFeedback, true),
  };
}

// 按配额生成 m 个布尔，true 的个数 = m*pct/100 的随机取整，打乱
function quota(m, pct, rng) {
  const x = (m * pct) / 100;
  const k = Math.floor(x) + (rng.chance(x - Math.floor(x)) ? 1 : 0);
  const a = [];
  for (let j = 0; j < m; j++) a.push(j < k);
  return rng.shuffle(a);
}

// ---------- 平面：多格骨牌 ----------
export function norm2(cells) {
  const mx = Math.min(...cells.map((c) => c[0])), my = Math.min(...cells.map((c) => c[1]));
  return cells.map(([x, y]) => [x - mx, y - my]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
export const key2 = (cells) => norm2(cells).map((c) => c.join(',')).join(';');
export const mirror2 = (cells) => cells.map(([x, y]) => [-x, y]);
export function rot2(cells, k) { // 每次 90°：(x,y)→(-y,x)，y 向下时为顺时针
  let c = cells;
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) c = c.map(([x, y]) => [-y, x]);
  return norm2(c);
}
export function same2(a, b) { // b 能否由 a 旋转得到（不含翻转）
  const kb = key2(b);
  for (let k = 0; k < 4; k++) if (key2(rot2(a, k)) === kb) return true;
  return false;
}
export const chiral2 = (cells) => !same2(cells, mirror2(cells));

const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function growPoly(n, rng) {
  const cells = [[0, 0]];
  const has = new Set(['0,0']);
  while (cells.length < n) {
    const [x, y] = rng.pick(cells);
    const [dx, dy] = rng.pick(D4);
    const k = `${x + dx},${y + dy}`;
    if (has.has(k)) continue;
    has.add(k); cells.push([x + dx, y + dy]);
  }
  return norm2(cells);
}

function genRot2d(p, mirror, rng) {
  let a;
  for (let t = 0; t < 400; t++) { a = growPoly(p.cells, rng); if (chiral2(a)) break; }
  if (!chiral2(a)) throw new Error('genRot2d 失败');
  a = rot2(rng.chance(0.5) ? mirror2(a) : a, rng.int(0, 3));
  const b = norm2(mirror ? mirror2(a) : a);
  let angle;
  if (p.freeAngle) {
    const opts = [];
    for (let d = 15; d < 360; d += 15) if (d % 90) opts.push(d);
    angle = rng.pick(opts);
  } else {
    // 不旋转的“同一个”太容易；旋转后和原图一模一样（中心对称）也换个角度
    const opts = [90, 180, 270].filter((d) => mirror || key2(rot2(a, d / 90)) !== key2(a));
    angle = rng.pick(opts.length ? opts : [90]);
  }
  return { kind: 'rot2d', a, b, angle, mirror, nCells: p.cells, choices: ROT_CHOICES, answer: mirror ? 1 : 0 };
}

// ---------- 立体：多立方体 ----------
const det3 = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
export const ROT24 = (() => {
  const out = [];
  const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
  for (const pm of perms) for (let sg = 0; sg < 8; sg++) {
    const m = [0, 1, 2].map((r) => [0, 1, 2].map((c) => (c === pm[r] ? ((sg >> r) & 1 ? -1 : 1) : 0)));
    if (det3(m) === 1) out.push(m);
  }
  return out;
})();
export const mulMV = (m, v) => [0, 1, 2].map((r) => m[r][0] * v[0] + m[r][1] * v[1] + m[r][2] * v[2]);
const mulMM = (a, b) => [0, 1, 2].map((r) => [0, 1, 2].map((c) => a[r][0] * b[0][c] + a[r][1] * b[1][c] + a[r][2] * b[2][c]));
const AXIS90 = [
  [[1, 0, 0], [0, 0, -1], [0, 1, 0]],
  [[0, 0, 1], [0, 1, 0], [-1, 0, 0]],
  [[0, -1, 0], [1, 0, 0], [0, 0, 1]],
];
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
export function axisRot(axis, q) {
  let m = I3;
  for (let i = 0; i < ((q % 4) + 4) % 4; i++) m = mulMM(AXIS90[axis], m);
  return m;
}
const mkey = (m) => m.flat().join(',');
const SINGLE_AXIS = new Set([0, 1, 2].flatMap((a) => [0, 1, 2, 3].map((q) => mkey(axisRot(a, q)))));

export function norm3(cells) {
  const mn = [0, 1, 2].map((i) => Math.min(...cells.map((c) => c[i])));
  return cells.map((c) => c.map((v, i) => v - mn[i])).sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}
export const key3 = (cells) => norm3(cells).map((c) => c.join(',')).join(';');
export const mirror3 = (cells, axis = 0) => cells.map((c) => c.map((v, i) => (i === axis ? -v : v)));
export const applyM = (m, cells) => norm3(cells.map((c) => mulMV(m, c)));
export function same3(a, b) {
  const kb = key3(b);
  return ROT24.some((m) => key3(applyM(m, a)) === kb);
}
export const chiral3 = (cells) => !same3(cells, mirror3(cells));
// 等轴测投影下 (1,1,1) 方向重叠的方块会被完全挡住，避免
export function viewOK(cells) {
  const has = new Set(cells.map((c) => c.join(',')));
  for (const [x, y, z] of cells) for (let k = 1; k <= 10; k++) if (has.has(`${x + k},${y + k},${z + k}`)) return false;
  return true;
}

export function genPolycube(n, rng) {
  for (let att = 0; att < 2000; att++) {
    const cells = [[0, 0, 0]];
    const has = new Set(['0,0,0']);
    let pos = [0, 0, 0], prev = -1, ok = true;
    const used = new Set();
    while (cells.length < n && ok) {
      const axis = rng.pick([0, 1, 2].filter((a) => a !== prev));
      const sign = rng.chance(0.5) ? 1 : -1;
      const len = Math.min(rng.int(1, 3), n - cells.length);
      for (let k = 0; k < len; k++) {
        const nx = pos.slice(); nx[axis] += sign;
        const key = nx.join(',');
        if (has.has(key)) { ok = false; break; }
        has.add(key); cells.push(nx); pos = nx;
      }
      used.add(axis); prev = axis;
    }
    if (!ok || used.size < 3) continue;
    const c = norm3(cells);
    if (chiral3(c)) return c;
  }
  throw new Error('genPolycube 失败');
}

const AX = ['x', 'y', 'z'];
function genRot3d(p, mirror, rng) {
  for (let att = 0; att < 500; att++) {
    const shape = genPolycube(p.blocks, rng);
    const a = applyM(rng.pick(ROT24), shape);
    if (!viewOK(a)) continue;
    let M, rot;
    if (p.rotAxes === 1) {
      const ax = rng.int(0, 2), q = rng.pick([1, 1, 2, 3]);
      M = axisRot(ax, q); rot = `${AX[ax]}${q * 90}`;
    } else {
      const a1 = rng.int(0, 2), a2 = rng.pick([0, 1, 2].filter((x) => x !== a1));
      const q1 = rng.pick([1, 2, 3]), q2 = rng.pick([1, 3]);
      M = mulMM(axisRot(a2, q2), axisRot(a1, q1)); rot = `${AX[a1]}${q1 * 90}+${AX[a2]}${q2 * 90}`;
      if (SINGLE_AXIS.has(mkey(M))) continue;
    }
    const base = mirror ? mirror3(a, rng.int(0, 2)) : a;
    const b = applyM(M, base);
    if (!viewOK(b)) continue;
    if (key3(b) === key3(a)) continue; // 转完和原图一模一样，太容易
    return { kind: 'rot3d', a, b, mirror, rot, nAxes: p.rotAxes, blocks: p.blocks, choices: ROT_CHOICES, answer: mirror ? 1 : 0 };
  }
  throw new Error('genRot3d 失败');
}

// ---------- 展开图 ----------
const neg = (v) => v.map((x) => -x);
const vkey = (v) => v.join(',');
// 折叠：返回与 cells 对齐的 [{N,R,D}]（N=外法向，R=网格向右在立体里的方向，D=网格向下）
export function fold(cells) {
  const idx = new Map(cells.map((c, i) => [c.join(','), i]));
  const fr = new Array(cells.length).fill(null);
  fr[0] = { N: [0, 0, 1], R: [1, 0, 0], D: [0, 1, 0] };
  const queue = [0];
  while (queue.length) {
    const i = queue.shift();
    const [x, y] = cells[i];
    const { N, R, D } = fr[i];
    const nb = [
      [[x + 1, y], { N: R, R: neg(N), D }],
      [[x - 1, y], { N: neg(R), R: N, D }],
      [[x, y + 1], { N: D, R, D: neg(N) }],
      [[x, y - 1], { N: neg(D), R, D: N }],
    ];
    for (const [c, f] of nb) {
      const j = idx.get(c.join(','));
      if (j !== undefined && !fr[j]) { fr[j] = f; queue.push(j); }
    }
  }
  return fr;
}
export function isNet(cells) {
  if (cells.length !== 6) return false;
  const fr = fold(cells);
  if (fr.some((f) => !f)) return false;
  return new Set(fr.map((f) => vkey(f.N))).size === 6;
}
export function has2x2(cells) {
  const has = new Set(cells.map((c) => c.join(',')));
  return cells.some(([x, y]) => has.has(`${x + 1},${y}`) && has.has(`${x},${y + 1}`) && has.has(`${x + 1},${y + 1}`));
}
let HEX = null;
export function hexominoes() { // 全部 216 个固定六格骨牌，分成能折/不能折
  if (HEX) return HEX;
  let level = new Map([['0,0', [[0, 0]]]]);
  for (let n = 2; n <= 6; n++) {
    const next = new Map();
    for (const cells of level.values()) {
      const has = new Set(cells.map((c) => c.join(',')));
      for (const [x, y] of cells) for (const [dx, dy] of D4) {
        if (has.has(`${x + dx},${y + dy}`)) continue;
        const c = norm2([...cells, [x + dx, y + dy]]);
        const k = key2(c);
        if (!next.has(k)) next.set(k, c);
      }
    }
    level = next;
  }
  const all = [...level.values()];
  HEX = { all, valid: all.filter(isNet), invalid: all.filter((c) => !isNet(c)) };
  return HEX;
}

function genNet(q, p, valid, rng) {
  const hx = hexominoes();
  const hard = p.netHard;
  if (q === 'fold') {
    let pool = valid ? hx.valid : hx.invalid;
    if (!valid && hard) pool = pool.filter((c) => !has2x2(c)); // 难：不给一眼能看出的 2×2 方块
    const cells = rng.pick(pool);
    return { kind: 'net', q, cells, labels: cells.map(() => ''), arrow: null, valid, hard, choices: ['能折成', '折不成'], answer: valid ? 0 : 1 };
  }
  for (let att = 0; att < 500; att++) {
    const cells = rng.pick(hx.valid);
    const fr = fold(cells);
    const m = rng.int(0, 5);
    const N = fr[m].N;
    const syms = rng.shuffle(SYMBOLS);
    const labels = [];
    let si = 0;
    for (let i = 0; i < 6; i++) labels.push(i === m ? (q === 'opposite' ? '★' : '') : syms[si++]);
    const adj = [], adjIdx = [];
    for (let i = 0; i < 6; i++) if (i !== m && vkey(fr[i].N) !== vkey(neg(N))) { adj.push(labels[i]); adjIdx.push(i); }
    if (q === 'opposite') {
      const o = fr.findIndex((f) => vkey(f.N) === vkey(neg(N)));
      const [mx, my] = cells[m], [ox, oy] = cells[o];
      const straight = (mx === ox && Math.abs(my - oy) === 2) || (my === oy && Math.abs(mx - ox) === 2);
      if (hard && straight) continue; // 难：不出“隔一格同一行”的直观对面
      const wrong = rng.shuffle(adj).slice(0, hard ? 3 : 2);
      const choices = rng.shuffle([labels[o], ...wrong]);
      return { kind: 'net', q, cells, labels, arrow: null, mark: m, target: o, straight, hard, choices, answer: choices.indexOf(labels[o]) };
    }
    // arrow：箭头画在 m 格，指向网格方向 g；折好后箭头所指的那一面
    const g = rng.int(0, 3);
    const [dx, dy] = D4[g];
    const dir3 = dx === 1 ? fr[m].R : dx === -1 ? neg(fr[m].R) : dy === 1 ? fr[m].D : neg(fr[m].D);
    const t = fr.findIndex((f) => vkey(f.N) === vkey(dir3));
    const [mx, my] = cells[m];
    const direct = cells[t][0] === mx + dx && cells[t][1] === my + dy;
    if (hard && direct) continue; // 难：箭头所指不是展开图上紧挨着的那格
    const choices = rng.shuffle(adj);
    return { kind: 'net', q, cells, labels, arrow: { cell: m, dir: g }, mark: m, target: t, direct, hard, choices, answer: choices.indexOf(labels[t]) };
  }
  throw new Error('genNet 失败');
}

// ---------- 生成一组 ----------
// opts.mode='casual'：题数封顶 CASUAL_MAX_TRIALS、不限时
export function generate(params, rng, opts = {}) {
  const p = normParams(params);
  const casual = opts.mode === 'casual';
  const n = casual ? Math.min(p.trials, CASUAL_MAX_TRIALS) : p.trials;
  const timeLimitMs = casual ? 0 : p.timeLimitMs;
  const mix = rng.shuffle(p.kinds);
  const order = [];
  for (let i = 0; i < n; i++) order.push(mix[i % mix.length]);
  const kindOf = rng.shuffle(order);
  const idx = { rot2d: [], rot3d: [], net: [] };
  kindOf.forEach((k, i) => idx[k].push(i));
  const trials = new Array(n);

  const m2 = quota(idx.rot2d.length, p.mirrorPct, rng);
  idx.rot2d.forEach((i, j) => { trials[i] = genRot2d(p, m2[j], rng); });
  const m3 = quota(idx.rot3d.length, p.mirrorPct, rng);
  idx.rot3d.forEach((i, j) => { trials[i] = genRot3d(p, m3[j], rng); });

  const qmix = rng.shuffle(p.netQs);
  const qs = rng.shuffle(idx.net.map((_, j) => qmix[j % qmix.length]));
  const nFold = qs.filter((q) => q === 'fold').length;
  const vFold = quota(nFold, 50, rng);
  let fj = 0;
  idx.net.forEach((i, j) => { trials[i] = genNet(qs[j], p, qs[j] === 'fold' ? vFold[fj++] : true, rng); });

  return { trials, n, kinds: p.kinds, timeLimitMs, casual, params: p };
}

// ---------- 计分 ----------
export function scoreTrial(t, i, resp, rtMs) {
  const timeout = resp < 0;
  const rec = { i, kind: t.kind, answer: t.answer, resp, correct: !timeout && resp === t.answer, rtMs: timeout ? null : rtMs, timeout };
  if (t.kind === 'rot2d') Object.assign(rec, { mirror: t.mirror, angle: t.angle, cells: t.nCells });
  else if (t.kind === 'rot3d') Object.assign(rec, { mirror: t.mirror, rot: t.rot, blocks: t.blocks });
  else Object.assign(rec, { q: t.q, hard: !!t.hard });
  return rec;
}

export function summarize(recs, gen) {
  const n = recs.length;
  const nc = recs.filter((r) => r.correct).length;
  const accOf = (a) => (a.length ? round(a.filter((r) => r.correct).length / a.length, 3) : null);
  const rtOf = (a) => { const x = a.filter((r) => r.correct && r.rtMs != null).map((r) => r.rtMs); return x.length ? Math.round(median(x)) : null; };
  const by = (k) => recs.filter((r) => r.kind === k);
  const rot = recs.filter((r) => r.kind !== 'net');
  return {
    kinds: gen.kinds.join('+'),
    n_trials: n,
    n_correct: nc,
    acc: n ? round(nc / n, 3) : null,
    rt_median_ms: rtOf(recs),
    acc_rot2d: accOf(by('rot2d')),
    acc_rot3d: accOf(by('rot3d')),
    acc_net: accOf(by('net')),
    rt_rot2d_ms: rtOf(by('rot2d')),
    rt_rot3d_ms: rtOf(by('rot3d')),
    rt_net_ms: rtOf(by('net')),
    acc_same: accOf(rot.filter((r) => !r.mirror)),
    acc_mirror: accOf(rot.filter((r) => r.mirror)),
    timeouts: recs.filter((r) => r.timeout).length,
    time_limit_ms: gen.timeLimitMs,
  };
}

export function buildDisplay(sm, gen) {
  const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);
  const sec = (x) => (x == null ? '—' : `${(x / 1000).toFixed(1)} 秒`);
  const d = [['正确率', sm.n_trials ? `${sm.n_correct}/${sm.n_trials}（${pct(sm.acc)}）` : '—'], ['中位用时', sec(sm.rt_median_ms)]];
  if (gen.kinds.length > 1) for (const k of gen.kinds) d.push([KIND_NAME[k], pct(sm[`acc_${k}`])]);
  if (d.length < 5 && (sm.acc_same != null || sm.acc_mirror != null)) d.push(['同一个 / 镜像', `${pct(sm.acc_same)} / ${pct(sm.acc_mirror)}`]);
  if (d.length < 5 && gen.timeLimitMs > 0) d.push(['超时', `${sm.timeouts} 题`]);
  return d.slice(0, 5);
}

// ---------- 画图（只在浏览器里调用） ----------
const CSS = `
.sp-wrap{display:flex;flex-direction:column;gap:8px;width:100%;max-width:640px;margin:0 auto;padding:0 0 8px;box-sizing:border-box;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.sp-q{text-align:center;font-size:clamp(15px,4.2vw,18px);line-height:1.4;margin:0;min-height:2.8em;display:flex;align-items:center;justify-content:center}
.sp-stage{position:relative;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;padding:8px;box-sizing:border-box;height:min(44vh,340px);min-height:190px;display:flex;align-items:center;justify-content:center}
.sp-pair{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);width:100%;height:100%}
.sp-fig{display:flex;align-items:center;justify-content:center;min-width:0;min-height:0;padding:4px}
.sp-fig+.sp-fig{border-left:1px dashed var(--line)}
.sp-fig svg,.sp-one svg{width:100%;height:100%;display:block}
.sp-one{width:100%;height:100%;display:flex;align-items:center;justify-content:center}
.sp-cell{fill:color-mix(in srgb,var(--accent) 60%,#fff);stroke:#22262c;stroke-width:.06;stroke-linejoin:round}
.sp-ft{fill:color-mix(in srgb,var(--accent) 28%,#fff)}
.sp-fr{fill:color-mix(in srgb,var(--accent) 68%,#fff)}
.sp-fl{fill:color-mix(in srgb,var(--accent) 78%,#000)}
.sp-ft,.sp-fr,.sp-fl{stroke:#22262c;stroke-width:.045;stroke-linejoin:round}
.sp-ncell{fill:var(--bg);stroke:var(--fg);stroke-width:.04}
.sp-sym{fill:var(--fg);font-size:.5px;text-anchor:middle;dominant-baseline:central}
.sp-star{fill:var(--gold)}
.sp-arrow{fill:var(--accent)}
.sp-timer{position:absolute;left:0;right:0;bottom:0;height:4px}
.sp-tfill{height:100%;background:var(--accent);transform-origin:left center;animation:sp-t linear forwards}
@keyframes sp-t{from{transform:scaleX(1)}to{transform:scaleX(0)}}
.sp-hint{margin:0;text-align:center;min-height:1.5em}
.sp-resp{display:grid;gap:10px;grid-template-columns:repeat(var(--sp-n,2),minmax(0,1fr))}
.sp-wrap .sp-btn{min-height:72px;margin:0;padding:6px 4px;min-width:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:21px;font-weight:700;border-radius:12px;touch-action:manipulation;transition:transform 60ms}
.sp-wrap .sp-btn.sp-symbtn{font-size:28px}
.g-casual .sp-wrap .sp-btn{min-height:88px;font-size:23px}
.sp-key{font-size:11px;font-weight:400;opacity:.75}
.p-nokeys .sp-key{display:none}
.sp-wrap .sp-btn.sp-press{transform:scale(.95)}
.p-nopress .sp-wrap .sp-btn.sp-press{transform:none}
@media (max-width:360px){.sp-wrap .sp-btn{min-height:64px;font-size:19px}}
`;

function injectStyle() {
  if (document.getElementById(`style-${ID}`)) return;
  const st = document.createElement('style');
  st.id = `style-${ID}`;
  st.textContent = CSS;
  document.head.append(st);
}

const f2 = (x) => Math.round(x * 1000) / 1000;

// 平面图：以重心为中心，半径 R 统一两边比例
function mean2(cells, i) { return cells.reduce((a, c) => a + c[i] + 0.5, 0) / cells.length; }
function poly2Radius(cells) {
  const cx = mean2(cells, 0), cy = mean2(cells, 1);
  let r = 0;
  for (const [x, y] of cells) for (const [u, v] of [[x, y], [x + 1, y], [x, y + 1], [x + 1, y + 1]]) r = Math.max(r, Math.hypot(u - cx, v - cy));
  return r;
}
function svg2d(cells, angle, R) {
  const cx = mean2(cells, 0), cy = mean2(cells, 1), r = R + 0.25;
  return s('svg', { viewBox: `${f2(cx - r)} ${f2(cy - r)} ${f2(2 * r)} ${f2(2 * r)}`, preserveAspectRatio: 'xMidYMid meet' },
    s('g', { transform: `rotate(${angle} ${f2(cx)} ${f2(cy)})` },
      cells.map(([x, y]) => s('rect', { x, y, width: 1, height: 1, class: 'sp-cell' }))));
}

// 立体图：等轴测，视线来自 (+1,+1,+1)，按 x+y+z 由远到近画
const C30 = Math.cos(Math.PI / 6);
const proj = ([x, y, z]) => [(x - y) * C30, (x + y) * 0.5 - z];
function cubeFaces(cubes) {
  const has = new Set(cubes.map((c) => c.join(',')));
  const out = [];
  const sorted = cubes.slice().sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  for (const [x, y, z] of sorted) {
    if (!has.has(`${x},${y},${z + 1}`)) out.push(['sp-ft', [[x, y, z + 1], [x + 1, y, z + 1], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]]]);
    if (!has.has(`${x + 1},${y},${z}`)) out.push(['sp-fr', [[x + 1, y, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x + 1, y, z + 1]]]);
    if (!has.has(`${x},${y + 1},${z}`)) out.push(['sp-fl', [[x, y + 1, z], [x + 1, y + 1, z], [x + 1, y + 1, z + 1], [x, y + 1, z + 1]]]);
  }
  return out.map(([cls, vs]) => [cls, vs.map(proj)]);
}
function bounds(faces) {
  const xs = [], ys = [];
  for (const [, ps] of faces) for (const [x, y] of ps) { xs.push(x); ys.push(y); }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}
function svg3d(faces, w, hgt) {
  const b = bounds(faces);
  const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, pad = 0.3;
  return s('svg', { viewBox: `${f2(cx - w / 2 - pad)} ${f2(cy - hgt / 2 - pad)} ${f2(w + 2 * pad)} ${f2(hgt + 2 * pad)}`, preserveAspectRatio: 'xMidYMid meet' },
    faces.map(([cls, ps]) => s('polygon', { class: cls, points: ps.map(([x, y]) => `${f2(x)},${f2(y)}`).join(' ') })));
}

const ARROW_DEG = [0, 180, 90, 270]; // 与 D4 对齐：右 左 下 上
function svgNet(t) {
  const xs = t.cells.map((c) => c[0]), ys = t.cells.map((c) => c[1]);
  const w = Math.max(...xs) + 1, hh = Math.max(...ys) + 1, pad = 0.15;
  const kids = [];
  t.cells.forEach(([x, y], i) => {
    kids.push(s('rect', { x, y, width: 1, height: 1, class: 'sp-ncell' }));
    const lb = t.labels[i];
    if (lb) kids.push(s('text', { x: x + 0.5, y: y + 0.53, class: 'sp-sym' + (lb === '★' ? ' sp-star' : '') }, lb));
    if (t.arrow && t.arrow.cell === i) {
      kids.push(s('path', {
        class: 'sp-arrow', d: 'M -0.3 -0.08 L 0.08 -0.08 L 0.08 -0.22 L 0.34 0 L 0.08 0.22 L 0.08 0.08 L -0.3 0.08 Z',
        transform: `translate(${x + 0.5} ${y + 0.5}) rotate(${ARROW_DEG[t.arrow.dir]})`,
      }));
    }
  });
  return s('svg', { viewBox: `${-pad} ${-pad} ${w + 2 * pad} ${hh + 2 * pad}`, preserveAspectRatio: 'xMidYMid meet' }, kids);
}

const PROMPT = {
  rot2d: '右边能由左边在平面里转过来（同一个），还是翻了面（镜像）？',
  rot3d: '右边的积木是左边转过来的同一个，还是镜像？',
  opposite: '折成正方体后，★ 的对面是哪个？',
  arrow: '折成正方体后，箭头指向哪一面？',
  fold: '这张展开图能折成正方体吗？',
};
const HINT = {
  rot2d: '只许在纸面上转，不许翻过来',
  rot3d: '可以在空间里随便转；镜像就像左右手',
  opposite: '展开图里不相邻的面，折好后不一定是对面',
  arrow: '想象箭头所在的面放平，其余面往上折',
  fold: '折好后 6 个面要不重不漏',
};

// 等用户点按钮或按键；返回 {index, rtMs}，超时 index=-1
function ask(btns, keyMap, signal, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError());
    const t0 = performance.now();
    let timer = null;
    const press = (b) => { b.classList.remove('sp-press'); void b.offsetWidth; b.classList.add('sp-press'); setTimeout(() => b.classList.remove('sp-press'), 120); };
    const handlers = btns.map((b, i) => (e) => { e.preventDefault(); press(b); done(i); });
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      const i = keyMap[(e.key || '').toLowerCase()];
      if (i === undefined || i >= btns.length) return;
      e.preventDefault(); press(btns[i]); done(i);
    };
    const onAbort = () => { cleanup(); reject(new AbortedError()); };
    const cleanup = () => {
      btns.forEach((b, i) => b.removeEventListener('click', handlers[i]));
      window.removeEventListener('keydown', onKey);
      signal?.removeEventListener('abort', onAbort);
      if (timer) clearTimeout(timer);
    };
    const done = (index) => { cleanup(); resolve({ index, rtMs: Math.round(performance.now() - t0) }); };
    btns.forEach((b, i) => b.addEventListener('click', handlers[i]));
    window.addEventListener('keydown', onKey);
    signal?.addEventListener('abort', onAbort, { once: true });
    if (timeoutMs > 0) timer = setTimeout(() => { cleanup(); resolve({ index: -1, rtMs: timeoutMs }); }, timeoutMs);
  });
}
const KEYS2 = { f: 0, j: 1, arrowleft: 0, arrowright: 1, 1: 0, 2: 1 };
const KEYSN = { 1: 0, 2: 1, 3: 2, 4: 3 };

export default {
  id: ID,
  name: NAME,
  line: 'spatial',
  casual: true,
  blurb: '转一转、翻一翻、折一折：在脑子里转动图形和积木，看出展开图怎么折。',
  aiDescription:
    '空间工坊，练心理旋转与折叠，可休闲。kinds 选题型并均衡混合：rot2d 平面多格骨牌，右图由左图转一个角度、可能翻面，判“同一个/镜像”；rot3d 立体积木（等轴测图），右图绕坐标轴转、可能镜像，判同一个/镜像，镜像对已用代码验证不能靠旋转重合；net 立方体展开图，netQs 选问法：opposite 问★的对面、arrow 问箭头指向哪一面（方向判断）、fold 问能否折成。' +
    '参数：cells 骨牌格数4–8，freeAngle 为真时平面转15°倍数的任意角（非直角）；blocks 积木方块数4–10；rotAxes 为2时连转两个轴；netHard 为真时不出隔一格同行的对面、箭头不指向紧邻格、不能折的图不含2×2块，选项增到4个；mirrorPct 镜像题比例；timeLimitMs 每题限时，0不限；休闲模式不限时且最多10题。' +
    '段位参考：黑铁rot2d格数4–5；青铜freeAngle、rot3d少方块单轴；白银rot3d双轴、opposite；黄金arrow加netHard。三视图、截面、折纸打孔暂未实现。' +
    'summary：acc_rot2d/acc_rot3d/acc_net 分题型正确率，rt_*_ms 答对题的中位用时，acc_same/acc_mirror 旋转题里同一个与镜像各自的正确率（差距大说明有偏向），timeouts 超时题数。',
  defaults: { ...DEFAULTS, kinds: DEFAULTS.kinds.slice(), netQs: DEFAULTS.netQs.slice() },
  paramSpec: {
    kinds: { type: 'set', options: KINDS.slice(), desc: '题型，多选时均衡混合：rot2d 平面旋转，rot3d 立体积木旋转，net 展开图' },
    trials: { type: 'int', min: 4, max: 40, desc: '本组题数（休闲模式最多 10 题）' },
    cells: { type: 'int', min: 4, max: 8, desc: 'rot2d 骨牌格数，越多越难' },
    freeAngle: { type: 'bool', desc: 'rot2d：true=转 15° 倍数的非直角角度，false=只转 90/180/270°' },
    blocks: { type: 'int', min: 4, max: 10, desc: 'rot3d 积木方块数，越多越难' },
    rotAxes: { type: 'int', min: 1, max: 2, desc: 'rot3d：1=绕一个轴转，2=连续绕两个不同轴转' },
    netQs: { type: 'set', options: NET_QS.slice(), desc: 'net 的问法：opposite ★的对面，arrow 箭头指向哪一面，fold 能否折成' },
    netHard: { type: 'bool', desc: 'net 难度：去掉一眼能看出的情况，opposite 选项增到 4 个' },
    mirrorPct: { type: 'int', min: 0, max: 100, desc: '旋转题中镜像题的比例 %' },
    timeLimitMs: { type: 'int', min: 0, max: 30000, desc: '每题限时（毫秒），0=不限时；休闲模式忽略' },
    showFeedback: { type: 'bool', desc: '每题答完闪一下对错，答错时提示正确答案' },
  },

  async run(root, ctx) {
    const signal = ctx.signal;
    injectStyle();
    const gen = generate(ctx.params, makeRng(ctx.seed), { mode: ctx.mode });
    const p = gen.params;
    const total = gen.n;
    const desk = !isMobile();
    if (gen.casual) root.classList.add('g-casual');

    root.innerHTML = '';
    const head = progressHead(NAME);
    head.set(0, total, `0/${total}`);
    const prompt = h('div', { class: 'sp-q' });
    const stage = h('div', { class: 'sp-stage' });
    const hint = h('div', { class: 'g-note sp-hint' });
    const resp = h('div', { class: 'sp-resp' });
    root.append(h('div', { class: 'sp-wrap' }, head.el, prompt, stage, hint, resp));

    const draw = (t) => {
      stage.innerHTML = '';
      if (t.kind === 'rot2d') {
        const R = Math.max(poly2Radius(t.a), poly2Radius(t.b));
        stage.append(h('div', { class: 'sp-pair' }, h('div', { class: 'sp-fig' }, svg2d(t.a, 0, R)), h('div', { class: 'sp-fig' }, svg2d(t.b, t.angle, R))));
      } else if (t.kind === 'rot3d') {
        const fa = cubeFaces(t.a), fb = cubeFaces(t.b);
        const ba = bounds(fa), bb = bounds(fb);
        const w = Math.max(ba.x1 - ba.x0, bb.x1 - bb.x0), hh = Math.max(ba.y1 - ba.y0, bb.y1 - bb.y0);
        stage.append(h('div', { class: 'sp-pair' }, h('div', { class: 'sp-fig' }, svg3d(fa, w, hh)), h('div', { class: 'sp-fig' }, svg3d(fb, w, hh))));
      } else {
        stage.append(h('div', { class: 'sp-one' }, svgNet(t)));
      }
      if (gen.timeLimitMs > 0) stage.append(h('div', { class: 'sp-timer' }, h('div', { class: 'sp-tfill', style: `animation-duration:${gen.timeLimitMs}ms` })));
      const qk = t.kind === 'net' ? t.q : t.kind;
      prompt.textContent = PROMPT[qk];
      hint.textContent = HINT[qk];
      const two = t.choices.length === 2;
      const sym = t.kind === 'net' && t.q !== 'fold';
      const btns = t.choices.map((c, k) => h('button', { class: 'g-btn sp-btn' + (sym ? ' sp-symbtn' : ''), type: 'button' },
        h('span', null, c), desk ? h('span', { class: 'sp-key' }, two ? (k ? 'J / →' : 'F / ←') : String(k + 1)) : null));
      resp.style.setProperty('--sp-n', String(t.choices.length));
      resp.replaceChildren(...btns);
      return { btns, keys: two ? KEYS2 : KEYSN };
    };

    const recs = [];
    try {
      if (signal?.aborted) throw new AbortedError();
      for (let i = 0; i < total; i++) {
        const t = gen.trials[i];
        const { btns, keys } = draw(t);
        const r = await ask(btns, keys, signal, gen.timeLimitMs);
        btns.forEach((b) => { b.disabled = true; });
        const rec = scoreTrial(t, i, r.index, r.rtMs);
        recs.push(rec);
        head.set(i + 1, total, `${i + 1}/${total}`);
        if (p.showFeedback) {
          const txt = rec.correct ? '✓' : rec.timeout ? `超时 · ${t.choices[t.answer]}` : `✗ 是${t.choices[t.answer]}`;
          await flash(stage, rec.correct, txt, signal, rec.correct ? 550 : 1000);
        } else await wait(250, signal);
      }
    } catch (e) {
      if (!(e instanceof AbortedError) && !signal?.aborted) throw e;
    }
    resp.replaceChildren();

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
