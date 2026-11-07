// 灵台试炼 · 路径棋局（path）
// 规划：钥匙门迷宫 / 冰面滑行 / 推箱子 / 多目标。每关按 seed 生成，用 BFS 验证可解并求出最少步数。
// 导入时不碰 DOM：normParams / band / generateLevel / generate / step / solve / scoreLevel / summarize / buildDisplay 都是纯函数。

import { makeRng, h, s, wait, progressHead, flash, isMobile, AbortedError, mean, median, round } from '../core/gamekit.js';

const ID = 'path';
const NAME = '路径棋局';
export const KINDS = ['keys', 'ice', 'sokoban', 'multi'];
export const KIND_NAME = { keys: '钥匙门迷宫', ice: '冰面滑行', sokoban: '推箱子', multi: '多目标' };
const KIND_SHORT = { keys: 'K', ice: 'I', sokoban: 'S', multi: 'M' };
export const BFS_CAP = { keys: 20000, ice: 5000, sokoban: 40000, multi: 20000 };
const TRIES = { keys: 120, ice: 80, sokoban: 30, multi: 60 };
export const SOKO_MAX = 7;        // 推箱子房间内部边长上限（控制 BFS 规模）
const DIRS = 'URDL';

const DEFAULTS = {
  kinds: ['keys', 'ice', 'multi'],
  size: 5,
  boxes: 1,
  keys: 1,
  targets: 3,
  levels: 4,
  undo: true,
  planFirst: false,
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

export function normParams(params) {
  const q = { ...DEFAULTS, ...(params || {}) };
  let raw = params?.kinds ?? params?.kind ?? DEFAULTS.kinds;
  raw = Array.isArray(raw) ? raw : (typeof raw === 'string' ? raw.split(/[,+\s]+/) : []);
  let kinds = KINDS.filter((k) => raw.includes(k));
  if (!kinds.length) kinds = DEFAULTS.kinds.slice();
  return {
    kinds,
    size: clampInt(q.size, 5, 9, DEFAULTS.size),
    boxes: clampInt(q.boxes, 1, 3, DEFAULTS.boxes),
    keys: clampInt(q.keys, 1, 3, DEFAULTS.keys),
    targets: clampInt(q.targets, 2, 5, DEFAULTS.targets),
    levels: clampInt(q.levels, 1, 12, DEFAULTS.levels),
    undo: toBool(q.undo, true),
    planFirst: toBool(q.planFirst, false),
    timeLimitMs: clampInt(q.timeLimitMs, 0, 600000, 0),
    showFeedback: toBool(q.showFeedback, true),
  };
}

const odd = (n) => (n % 2 ? n : n + 1);
// 每种关卡实际的内部边长
export function dimOf(kind, p) {
  if (kind === 'keys' || kind === 'multi') return odd(p.size);
  if (kind === 'sokoban') return Math.min(p.size, SOKO_MAX);
  return p.size;
}
export const keysOf = (p) => Math.min(p.keys, dimOf('keys', p) <= 5 ? 2 : 3);

// 最少步数应落在的区间 [lo, hi]
export function band(kind, p) {
  const n = dimOf(kind, p);
  if (kind === 'ice') return [Math.max(3, n - 2), 4 + 2 * n];
  if (kind === 'sokoban') return [6 + 4 * p.boxes, 100 + 20 * p.boxes];
  if (kind === 'keys') return [Math.round(n * n * 0.32) + 2 * keysOf(p), n * n * 2];
  return [Math.round(n * n * 0.3) + 2 * p.targets, n * n * 2];
}

// ---------- 规则（BFS 与游戏共用同一个 step，保证一致） ----------

const AUX = new WeakMap();
export function aux(L) {
  let a = AUX.get(L);
  if (a) return a;
  const N = L.W * L.H;
  const doorAt = new Int8Array(N).fill(-1), keyAt = new Int8Array(N).fill(-1), tgtAt = new Int8Array(N).fill(-1);
  const goalAt = new Uint8Array(N), dead = new Uint8Array(N);
  (L.doors || []).forEach((c, i) => { doorAt[c] = i; });
  (L.keys || []).forEach((c, i) => { keyAt[c] = i; });
  (L.targets || []).forEach((c, i) => { tgtAt[c] = i; });
  (L.goals || []).forEach((c) => { goalAt[c] = 1; });
  if (L.kind === 'sokoban') {
    const g = L.grid, W = L.W;
    for (let c = 0; c < N; c++) {
      if (g[c] === 1 || goalAt[c]) continue;
      if ((g[c - W] === 1 || g[c + W] === 1) && (g[c - 1] === 1 || g[c + 1] === 1)) dead[c] = 1;
    }
  }
  a = { doorAt, keyAt, tgtAt, goalAt, dead };
  AUX.set(L, a);
  return a;
}

const delta = (L, d) => [-L.W, 1, L.W, -1][d];

export function initState(L) {
  return { p: L.start, m: 0, b: (L.boxes || []).slice().sort((x, y) => x - y) };
}

// 返回新状态；走不动返回 null。推箱子时 pushedTo = 箱子被推到的格
export function step(L, st, d) {
  const dd = delta(L, d), g = L.grid;
  if (L.kind === 'ice') {
    let p = st.p;
    while (g[p + dd] !== 1) p += dd;
    return p === st.p ? null : { p, m: 0, b: st.b };
  }
  const q = st.p + dd;
  if (g[q] === 1) return null;
  const A = aux(L);
  if (L.kind === 'keys') {
    const di = A.doorAt[q];
    if (di >= 0 && !((st.m >> di) & 1)) return null;
    const ki = A.keyAt[q];
    return { p: q, m: ki >= 0 ? st.m | (1 << ki) : st.m, b: st.b };
  }
  if (L.kind === 'multi') {
    const ti = A.tgtAt[q];
    return { p: q, m: ti >= 0 ? st.m | (1 << ti) : st.m, b: st.b };
  }
  const k = st.b.indexOf(q);
  if (k < 0) return { p: q, m: 0, b: st.b };
  const r = q + dd;
  if (g[r] === 1 || st.b.includes(r)) return null;
  const b = st.b.slice();
  b[k] = r;
  b.sort((x, y) => x - y);
  return { p: q, m: 0, b, pushedTo: r };
}

export function isWin(L, st) {
  if (L.kind === 'keys' || L.kind === 'ice') return st.p === L.goal;
  if (L.kind === 'multi') return st.m === (1 << L.targets.length) - 1;
  const A = aux(L);
  return st.b.every((c) => A.goalAt[c]);
}

// 格子编号 < 128（边长 ≤ 11）
function enc(st) {
  let k = st.p + st.m * 128;
  for (let i = 0; i < st.b.length; i++) k += st.b[i] * 2 ** (7 * (i + 1));
  return k;
}

// BFS 求最少步数。超过 cap 个状态就放弃（capped=true）
export function solve(L, cap = BFS_CAP[L.kind]) {
  const s0 = initState(L);
  if (isWin(L, s0)) return { opt: 0, path: '', states: 1, capped: false };
  const dead = L.kind === 'sokoban' ? aux(L).dead : null;
  const par = new Map([[enc(s0), -1]]);
  const dirOf = new Map();
  let q = [s0], states = 1;
  while (q.length) {
    const nq = [];
    for (const st of q) {
      const k0 = enc(st);
      for (let d = 0; d < 4; d++) {
        const ns = step(L, st, d);
        if (!ns) continue;
        if (dead && ns.pushedTo !== undefined && dead[ns.pushedTo]) continue; // 推进死角：不可能再赢
        const k = enc(ns);
        if (par.has(k)) continue;
        par.set(k, k0); dirOf.set(k, d); states++;
        if (isWin(L, ns)) {
          let path = '', c = k;
          while (par.get(c) !== -1) { path = DIRS[dirOf.get(c)] + path; c = par.get(c); }
          return { opt: path.length, path, states, capped: false };
        }
        if (states >= cap) return { opt: null, path: null, states, capped: true };
        nq.push(ns);
      }
    }
    q = nq;
  }
  return { opt: null, path: null, states, capped: false };
}

// ---------- 生成工具 ----------

function bfsDist(g, W, from) {
  const dist = new Int16Array(g.length).fill(-1);
  dist[from] = 0;
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    for (const dd of [-W, 1, W, -1]) {
      const n = c + dd;
      if (g[n] === 0 && dist[n] < 0) { dist[n] = dist[c] + 1; q.push(n); }
    }
  }
  return dist;
}
function pathCells(g, W, a, b) {
  const dist = bfsDist(g, W, b);
  if (dist[a] < 0) return null;
  const out = [a];
  let c = a;
  while (c !== b) {
    for (const dd of [-W, 1, W, -1]) if (dist[c + dd] === dist[c] - 1 && g[c + dd] === 0) { c += dd; break; }
    out.push(c);
  }
  return out;
}
const nbrCount = (g, W, c) => (g[c - W] === 0) + (g[c + W] === 0) + (g[c - 1] === 0) + (g[c + 1] === 0);
const isCorridor = (g, W, c) =>
  (g[c - 1] === 0 && g[c + 1] === 0 && g[c - W] === 1 && g[c + W] === 1) ||
  (g[c - W] === 0 && g[c + W] === 0 && g[c - 1] === 1 && g[c + 1] === 1);
const floorsOf = (g) => { const f = []; for (let c = 0; c < g.length; c++) if (g[c] === 0) f.push(c); return f; };

// n 为奇数：在奇数坐标上挖完美迷宫，再打通 loops 堵墙形成回路
function carveMaze(n, rng, loops) {
  const W = n + 2, g = new Array(W * W).fill(1);
  const inside = (c) => { const x = c % W, y = (c / W) | 0; return x >= 1 && x <= n && y >= 1 && y <= n; };
  const start = (1 + 2 * rng.int(0, (n - 1) / 2)) * W + 1 + 2 * rng.int(0, (n - 1) / 2);
  g[start] = 0;
  const stack = [start];
  while (stack.length) {
    const c = stack[stack.length - 1];
    const nb = [-2 * W, 2, 2 * W, -2].filter((dd) => inside(c + dd) && g[c + dd] === 1);
    if (!nb.length) { stack.pop(); continue; }
    const dd = rng.pick(nb);
    g[c + dd / 2] = 0; g[c + dd] = 0;
    stack.push(c + dd);
  }
  const cand = [];
  for (let c = 0; c < g.length; c++) {
    if (g[c] !== 1 || !inside(c)) continue;
    if ((g[c - 1] === 0 && g[c + 1] === 0) || (g[c - W] === 0 && g[c + W] === 0)) cand.push(c);
  }
  for (const c of rng.shuffle(cand).slice(0, loops)) g[c] = 0;
  return { W, g };
}

function search(kind, p, rng, tries, once) {
  const [lo, hi] = band(kind, p);
  let best = null, bk = Infinity;
  for (let a = 0; a < tries; a++) {
    const L = once(lo, hi);
    if (!L) continue;
    const off = L.opt < lo ? lo - L.opt : L.opt > hi ? L.opt - hi : 0;
    const key = off * 10 + (L.trap ? 0 : 1);
    if (key < bk) { best = L; bk = key; }
    if (key === 0) break;
  }
  if (best) best.inBand = best.opt >= lo && best.opt <= hi;
  return best;
}

function finish(L, r) {
  L.opt = r.opt; L.solution = r.path; L.states = r.states;
  return L;
}

// ---------- 四种关卡 ----------

function onceKeys(p, rng) {
  const n = dimOf('keys', p), k = keysOf(p);
  const { W, g } = carveMaze(n, rng, rng.int(0, 1 + (n >> 2)));
  const floors = floorsOf(g);
  const S = rng.pick(floors);
  const d0 = bfsDist(g, W, S);
  let maxd = 0;
  for (const c of floors) maxd = Math.max(maxd, d0[c]);
  const G = rng.pick(floors.filter((c) => d0[c] >= maxd * 0.6));
  const P = pathCells(g, W, S, G);
  if (!P || P.length < 2 * k + 4) return null;
  const doors = [];
  const seg = (P.length - 4) / k;
  for (let i = 0; i < k; i++) {
    const a = 2 + Math.floor(seg * i), b = 2 + Math.floor(seg * (i + 1)) - 1;
    const cand = [];
    for (let j = a; j <= b; j++) if (isCorridor(g, W, P[j])) cand.push(P[j]);
    if (!cand.length) return null;
    doors.push(rng.pick(cand));
  }
  const onP = new Set(P), used = new Set([S, G, ...doors]), keys = [];
  let prev = null;
  for (let i = 0; i < k; i++) {
    const g2 = g.slice();
    for (let j = i; j < k; j++) g2[doors[j]] = 1;
    const di = bfsDist(g2, W, S);
    const R = floors.filter((c) => di[c] >= 0 && !used.has(c));
    let cand = R.filter((c) => !onP.has(c) && (!prev || prev[c] < 0)); // 优先放在上一道门后面：强制先后顺序
    if (!cand.length) cand = R.filter((c) => !onP.has(c));
    if (!cand.length) cand = R;
    if (!cand.length) return null;
    const ends = cand.filter((c) => nbrCount(g, W, c) === 1);
    const c = ends.length && rng.chance(0.75) ? rng.pick(ends) : rng.pick(cand);
    keys.push(c); used.add(c); prev = di;
  }
  const L = { kind: 'keys', n, W, H: W, grid: g, start: S, goal: G, doors, keys };
  const r = solve(L);
  if (r.opt == null) return null;
  for (let i = 0; i < k; i++) { // 每道门都必须是绕不过去的
    const g3 = g.slice(); g3[doors[i]] = 1;
    if (solve({ ...L, grid: g3 }).opt != null) return null;
  }
  L.trap = true;
  return finish(L, r);
}

function onceIce(p, rng, lo, hi) {
  const n = dimOf('ice', p), W = n + 2, g = new Array(W * W).fill(1);
  const dens = rng.float(0.1, 0.2);
  for (let y = 1; y <= n; y++) for (let x = 1; x <= n; x++) g[y * W + x] = rng.chance(dens) ? 1 : 0;
  const floors = floorsOf(g);
  if (floors.length < n * 2) return null;
  const S = rng.pick(floors);
  const L = { kind: 'ice', n, W, H: W, grid: g, start: S, goal: -1 };
  const dep = new Map([[S, 0]]);
  let q = [S];
  while (q.length) {
    const nq = [];
    for (const c of q) for (let d = 0; d < 4; d++) {
      const ns = step(L, { p: c, m: 0, b: [] }, d);
      if (ns && !dep.has(ns.p)) { dep.set(ns.p, dep.get(c) + 1); nq.push(ns.p); }
    }
    q = nq;
  }
  // 从起点直接滑过（但停不下来）的格：看起来像捷径
  const over = new Set();
  for (const dd of [-W, 1, W, -1]) { let c = S; while (g[c + dd] !== 1) { c += dd; if (g[c + dd] !== 1) over.add(c); } }
  let cand = [...dep.keys()].filter((c) => c !== S && dep.get(c) >= lo && dep.get(c) <= hi);
  if (!cand.length) {
    let md = 0;
    for (const v of dep.values()) md = Math.max(md, v);
    if (md < 1) return null;
    cand = [...dep.keys()].filter((c) => dep.get(c) === md);
  }
  const traps = cand.filter((c) => over.has(c));
  L.goal = traps.length ? rng.pick(traps) : rng.pick(cand);
  L.trap = traps.length > 0;
  const r = solve(L);
  if (r.opt == null) return null;
  return finish(L, r);
}

export const SOKO_REV_CAP = 12000;
function onceSoko(p, rng, lo, hi) {
  const n = dimOf('sokoban', p), nb = p.boxes, W = n + 2;
  let g = new Array(W * W).fill(1);
  // 多箱子时把地面控制在 34–36 格左右，否则 BFS 状态数爆炸（手机上要 <300 ms）
  const aimFloor = nb >= 3 ? 34 : nb === 2 ? 36 : Infinity, maxFloor = aimFloor + 4;
  const dens = nb >= 2 ? Math.max(0.06, 1 - Math.min(n * n * 0.85, aimFloor) / (n * n)) + rng.float(-0.03, 0.05) : rng.float(0.06, 0.2);
  for (let y = 1; y <= n; y++) for (let x = 1; x <= n; x++) g[y * W + x] = rng.chance(dens) ? 1 : 0;
  // 只留最大的连通块
  let fl = floorsOf(g), bestC = null;
  const seen = new Uint8Array(g.length);
  for (const c of fl) {
    if (seen[c]) continue;
    const d = bfsDist(g, W, c), comp = fl.filter((x) => d[x] >= 0);
    comp.forEach((x) => { seen[x] = 1; });
    if (!bestC || comp.length > bestC.length) bestC = comp;
  }
  if (!bestC || bestC.length < 3 * nb + 10 || bestC.length > maxFloor) return null;
  const keep = new Set(bestC);
  g = g.map((v, c) => (v === 0 && keep.has(c) ? 0 : 1));
  fl = bestC;
  const goals = rng.shuffle(fl).slice(0, nb).sort((a, b) => a - b);
  const goalSet = new Set(goals);
  // 倒推：从所有“箱子都在目标上”的终局出发，对“走/拉”做多源 BFS。
  // 每个状态的层数 = 正着玩到终局的最少步数（准确值）；顺着父指针就是最优解。
  const DD = [-W, 1, W, -1];
  const par = new Map(), dirOf = new Map();
  let q = [];
  for (const c of fl) {
    if (goalSet.has(c)) continue;
    const st = { p: c, m: 0, b: goals };
    const k = enc(st);
    par.set(k, -1); q.push(st);
  }
  let states = q.length, best = [], bestD = 0, dep = 0;
  grow: while (q.length && dep < hi) {
    const nq = [];
    dep++;
    for (const st of q) {
      const k0 = enc(st);
      for (let d = 0; d < 4; d++) {
        const dd = DD[d], nq_ = st.p + dd;
        if (g[nq_] === 1 || st.b.includes(nq_)) continue;
        const outs = [{ p: nq_, m: 0, b: st.b }];
        const bi = st.b.indexOf(st.p - dd);
        if (bi >= 0) { const b = st.b.slice(); b[bi] = st.p; b.sort((x, y) => x - y); outs.push({ p: nq_, m: 0, b }); }
        for (const ns of outs) {
          const k = enc(ns);
          if (par.has(k)) continue;
          par.set(k, k0); dirOf.set(k, (d + 2) % 4); states++;
          nq.push(ns);
          if (states >= SOKO_REV_CAP) break grow;
          if (dep >= lo && ns.b.every((c) => !goalSet.has(c))) {
            if (dep > bestD) { bestD = dep; best = []; }
            if (dep === bestD) best.push(ns);
          }
        }
      }
    }
    q = nq;
  }
  if (!best.length) return null;
  const s0 = rng.pick(best);
  let path = '', c = enc(s0);
  while (par.get(c) !== -1) { path += DIRS[dirOf.get(c)]; c = par.get(c); }
  const L = { kind: 'sokoban', n, W, H: W, grid: g, start: s0.p, goals, boxes: s0.b.slice() };
  let st = initState(L), pushes = 0;
  for (const ch of path) { st = step(L, st, DIRS.indexOf(ch)); if (!st) return null; if (st.pushedTo !== undefined) pushes++; }
  if (!isWin(L, st) || pushes < 2 * nb) return null;
  L.pushes = pushes;
  L.trap = true;
  return finish(L, { opt: path.length, path, states });
}

function onceMulti(p, rng) {
  const n = dimOf('multi', p), T = p.targets;
  const { W, g } = carveMaze(n, rng, rng.int(1, 2 + (n >> 1)));
  const floors = floorsOf(g);
  const S = rng.pick(floors);
  let pool = rng.shuffle(floors.filter((c) => c !== S));
  if (rng.chance(0.5)) pool = [...pool.filter((c) => nbrCount(g, W, c) === 1), ...pool.filter((c) => nbrCount(g, W, c) !== 1)];
  const dS = bfsDist(g, W, S), targets = [], dists = [];
  for (const c of pool) {
    if (targets.length >= T) break;
    if (dS[c] < 2 || dists.some((d) => d[c] < 2)) continue;
    targets.push(c); dists.push(bfsDist(g, W, c));
  }
  if (targets.length < T) return null;
  const L = { kind: 'multi', n, W, H: W, grid: g, start: S, targets };
  const r = solve(L);
  if (r.opt == null) return null;
  // 贪心（总去最近的点）要多走，说明顺序真有讲究
  let cur = S, len = 0;
  const left = new Set(targets);
  while (left.size) {
    const dc = bfsDist(g, W, cur);
    let bt = -1;
    for (const t of targets) if (left.has(t) && (bt < 0 || dc[t] < dc[bt])) bt = t;
    const pc = pathCells(g, W, cur, bt);
    for (const c of pc) left.delete(c);
    len += pc.length - 1; cur = bt;
  }
  L.greedy = len;
  L.trap = len > r.opt;
  return finish(L, r);
}

const ONCE = { keys: onceKeys, ice: onceIce, sokoban: onceSoko, multi: onceMulti };

export function generateLevel(kind, params, seed) {
  const p = normParams(params);
  const rng = makeRng(seed);
  const t0 = Date.now();
  let L = null;
  for (let round_ = 0; round_ < 5 && !L; round_++) {
    L = search(kind, p, rng, TRIES[kind], (lo, hi) => ONCE[kind](p, rng, lo, hi));
  }
  if (!L) throw new Error(`path: 生成失败 ${kind} seed=${seed}`);
  L.seed = seed;
  L.genMs = Date.now() - t0;
  return L;
}

// 一组的关卡种类与种子（便宜）；关卡本身在 run 里逐关生成
export function planSet(params, rng) {
  const p = normParams(params);
  const mix = rng.shuffle(p.kinds);
  const order = [];
  for (let i = 0; i < p.levels; i++) order.push(mix[i % mix.length]);
  const kinds = rng.shuffle(order);
  return { params: p, list: kinds.map((kind) => ({ kind, seed: rng.int(1, 0x7ffffffe) })) };
}

export function generate(params, rng) {
  const plan = planSet(params, rng);
  return { params: plan.params, levels: plan.list.map((x) => generateLevel(x.kind, plan.params, x.seed)) };
}

// ---------- 计分 ----------

// o: {outcome:'solved'|'gaveup'|'timeout', moves, movesTotal, undos, restarts, thinkMs, totalMs}
export function scoreLevel(L, i, o) {
  const solved = o.outcome === 'solved';
  const items = L.kind === 'sokoban' ? L.boxes.length : L.kind === 'keys' ? L.keys.length : L.kind === 'multi' ? L.targets.length : 0;
  return {
    i, kind: L.kind, size: L.n, items, opt: L.opt,
    moves: o.moves, moves_total: o.movesTotal, undos: o.undos, restarts: o.restarts,
    solved, outcome: o.outcome,
    optimal: solved && o.moves === L.opt,
    first_try: solved && !o.undos && !o.restarts,
    ratio: solved && L.opt ? round(o.moves / L.opt, 3) : null,
    think_ms: o.thinkMs ?? null,
    total_ms: o.totalMs,
  };
}

export function summarize(recs, p) {
  const n = recs.length;
  const ok = recs.filter((r) => r.solved);
  const ratios = ok.map((r) => r.ratio).filter((x) => x != null);
  const thinks = recs.map((r) => r.think_ms).filter((x) => x != null);
  const sec = (ms) => (ms == null ? '-' : `${round(ms / 1000, 1)}s`);
  const out = { solved: 'ok', gaveup: 'give', timeout: 'time' };
  return {
    kinds: [...new Set(recs.map((r) => r.kind))].join('+') || p.kinds.join('+'),
    size: p.size,
    plan_first: p.planFirst,
    n_trials: n,
    n_correct: ok.length,
    solve_rate: n ? round(ok.length / n, 3) : null,
    first_try_rate: n ? round(recs.filter((r) => r.first_try).length / n, 3) : null,
    optimal_rate: ok.length ? round(ok.filter((r) => r.optimal).length / ok.length, 3) : null,
    move_ratio_mean: ratios.length ? round(mean(ratios), 3) : null,
    undos: recs.reduce((a, r) => a + r.undos, 0),
    restarts: recs.reduce((a, r) => a + r.restarts, 0),
    think_ms_median: thinks.length ? Math.round(median(thinks)) : null,
    level_ms_median: n ? Math.round(median(recs.map((r) => r.total_ms))) : null,
    per_level: recs.map((r) => `${KIND_SHORT[r.kind]}${r.size}:${r.opt}/${r.moves},u${r.undos},r${r.restarts},${out[r.outcome]},${sec(r.think_ms)},${sec(r.total_ms)}`).join('; '),
  };
}

export function buildDisplay(sm) {
  return [
    ['过关', sm.n_trials ? `${sm.n_correct}/${sm.n_trials}` : '—'],
    ['步数 ÷ 最少步数', sm.move_ratio_mean == null ? '—' : `${sm.move_ratio_mean.toFixed(2)} 倍`],
    ['一次走通', sm.n_trials ? `${Math.round((sm.first_try_rate || 0) * sm.n_trials)} 关` : '—'],
    ['开走前想了', sm.think_ms_median == null ? '—' : `中位 ${round(sm.think_ms_median / 1000, 1)} 秒`],
  ];
}

export function describe(params) {
  const p = normParams(params);
  const parts = [`${p.levels} 关，${p.kinds.map((k) => KIND_NAME[k]).join('、')}`, `棋盘约 ${p.size}×${p.size}`];
  if (p.kinds.includes('keys')) parts.push(`${keysOf(p)} 把钥匙`);
  if (p.kinds.includes('sokoban')) parts.push(`${p.boxes} 个箱子`);
  if (p.kinds.includes('multi')) parts.push(`${p.targets} 个目标点`);
  parts.push(p.planFirst ? '先想后走：开走后不能撤销' : p.undo ? '可以撤销' : '不能撤销');
  parts.push(p.timeLimitMs ? `每关限时 ${Math.round(p.timeLimitMs / 1000)} 秒（休闲不限时）` : '不限时');
  return parts.join('，') + '。';
}

// ---------- 界面 ----------

const KEY_COLORS = ['#e0a100', '#d64545', '#2f9e44'];
const CSS = `
.pa-wrap{display:flex;flex-direction:column;gap:8px;width:100%;max-width:860px;margin:0 auto;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.pa-main{display:flex;flex-direction:column;align-items:center;gap:10px}
@media (min-width:700px){.pa-main{flex-direction:row;align-items:flex-start;justify-content:center;gap:18px}}
.pa-boardbox{position:relative;width:min(100%,52vh,520px);flex:0 0 auto}
.pa-board{display:block;width:100%;height:auto;touch-action:none;border-radius:10px;background:var(--line)}
.pa-side{display:flex;flex-direction:column;gap:8px;align-items:center;width:100%;max-width:340px}
.pa-info{display:flex;justify-content:space-between;gap:8px;width:100%;font-size:14px;flex-wrap:wrap}
.pa-info b{font-weight:600}
.pa-msg{min-height:1.4em;font-size:13px;color:var(--bad);text-align:center}
.pa-pad{display:grid;grid-template-columns:repeat(3,64px);grid-template-rows:repeat(2,54px);gap:6px}
.pa-wrap .pa-pad .g-btn{min-height:0;padding:0;font-size:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}
.g-casual .pa-pad{grid-template-columns:repeat(3,76px);grid-template-rows:repeat(2,62px)}
.pa-acts{display:flex;gap:8px;flex-wrap:wrap;justify-content:center}
.pa-wrap .pa-acts .g-btn{min-width:80px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;line-height:1.15;padding:6px 10px}
.pa-acts .g-btn[hidden]{display:none}
.pa-wrap .pa-start{width:100%;max-width:340px;display:flex;flex-direction:column;align-items:center}
.pa-wrap .pa-start[hidden]{display:none}
.pa-key{font-size:11px;opacity:.7;font-weight:400}
.p-nokeys .pa-key{display:none}
.pa-hint{text-align:center;margin:0;min-height:2.6em}
.pa-wall{fill:color-mix(in srgb,var(--fg) 58%,var(--bg))}
.pa-floor{fill:var(--card)}
.pa-icef{fill:color-mix(in srgb,#4aa3df 18%,var(--card))}
.pa-rock{fill:color-mix(in srgb,var(--fg) 45%,var(--card))}
.pa-goal{fill:color-mix(in srgb,var(--ok) 28%,var(--card));stroke:var(--ok);stroke-width:.8}
.pa-sgoal{fill:none;stroke:var(--ok);stroke-width:.9}
.pa-box{fill:#b7833f;stroke:#7a4f1f;stroke-width:.6}
.pa-box.pa-on{fill:var(--ok);stroke:color-mix(in srgb,var(--ok) 60%,#000)}
.pa-box.pa-dead{stroke:var(--bad);stroke-width:1}
.pa-tgt{fill:#e0a100}
.pa-tgt.pa-done{fill:none;stroke:var(--ok);stroke-width:.8}
.pa-pl{transition:transform 110ms ease-out}
.pa-pl.pa-slide{transition-duration:170ms}
.pa-pl circle{fill:var(--accent);stroke:var(--card);stroke-width:.7}
.pa-bump{animation:pa-bump 160ms ease-in-out}
@keyframes pa-bump{0%,100%{transform:translateX(0)}33%{transform:translateX(-3px)}66%{transform:translateX(3px)}}
.p-nopress .pa-bump{animation:none}
@media (max-width:360px){.pa-pad{grid-template-columns:repeat(3,58px);grid-template-rows:repeat(2,50px)}}
`;

function injectStyle() {
  if (document.getElementById(`style-${ID}`)) return;
  const st = document.createElement('style');
  st.id = `style-${ID}`;
  st.textContent = CSS;
  document.head.append(st);
}

const HINT = {
  keys: '走到绿色终点。门要先拿到同色钥匙才能过，钥匙拿了一直有效。',
  ice: '冰面上一走就滑到撞墙或石头才停，要正好停在绿色终点上。',
  sokoban: '把所有箱子推到绿圈上。只能推不能拉，推进死角就出不来。',
  multi: '把所有黄点都走到，顺序自己定，步数越少越好。',
};
const MOVE_KEYS = { arrowup: 0, w: 0, arrowright: 1, d: 1, arrowdown: 2, s: 2, arrowleft: 3, a: 3 };

function drawBoard(L) {
  const C = 10, W = L.W, H = L.H;
  const svg = s('svg', { viewBox: `0 0 ${W * C} ${H * C}`, class: 'pa-board', role: 'img', 'aria-label': KIND_NAME[L.kind] });
  const base = s('g');
  for (let c = 0; c < W * H; c++) {
    const x = (c % W) * C, y = ((c / W) | 0) * C, inner = x > 0 && y > 0 && x < (W - 1) * C && y < (H - 1) * C;
    if (L.grid[c] === 1) {
      if (L.kind === 'ice' && inner) {
        base.append(s('rect', { x, y, width: C, height: C, class: 'pa-icef' }));
        base.append(s('rect', { x: x + 1.2, y: y + 1.2, width: C - 2.4, height: C - 2.4, rx: 2.5, class: 'pa-rock' }));
      } else base.append(s('rect', { x, y, width: C + 0.05, height: C + 0.05, class: 'pa-wall' }));
    } else base.append(s('rect', { x: x + 0.25, y: y + 0.25, width: C - 0.5, height: C - 0.5, rx: 1, class: L.kind === 'ice' ? 'pa-icef' : 'pa-floor' }));
  }
  const xy = (c) => [(c % W) * C, ((c / W) | 0) * C];
  if (L.goal >= 0 && (L.kind === 'keys' || L.kind === 'ice')) {
    const [x, y] = xy(L.goal);
    base.append(s('rect', { x: x + 1.3, y: y + 1.3, width: C - 2.6, height: C - 2.6, rx: 1.5, class: 'pa-goal' }));
  }
  for (const c of L.goals || []) { const [x, y] = xy(c); base.append(s('circle', { cx: x + C / 2, cy: y + C / 2, r: 3.6, class: 'pa-sgoal' })); }
  const dyn = s('g');
  const pl = s('g', { class: 'pa-pl' }, s('circle', { cx: C / 2, cy: C / 2, r: 3.3 }));
  svg.append(base, dyn, pl);
  const A = aux(L);
  const render = (st, slide) => {
    dyn.replaceChildren();
    (L.doors || []).forEach((c, i) => {
      const [x, y] = xy(c), col = KEY_COLORS[i], open = (st.m >> i) & 1;
      dyn.append(s('rect', open
        ? { x: x + 1, y: y + 1, width: C - 2, height: C - 2, rx: 1, fill: 'none', stroke: col, 'stroke-width': 0.8, 'stroke-dasharray': '1.6 1.2' }
        : { x: x + 0.6, y: y + 0.6, width: C - 1.2, height: C - 1.2, rx: 1, fill: col }));
      if (!open) dyn.append(s('circle', { cx: x + C / 2, cy: y + C / 2 - 0.8, r: 1.3, fill: '#222' }), s('rect', { x: x + C / 2 - 0.6, y: y + C / 2, width: 1.2, height: 2.4, fill: '#222' }));
    });
    (L.keys || []).forEach((c, i) => {
      if ((st.m >> i) & 1) return;
      const [x, y] = xy(c), col = KEY_COLORS[i];
      dyn.append(s('g', { fill: 'none', stroke: col, 'stroke-width': 1.3, 'stroke-linecap': 'round' },
        s('circle', { cx: x + 3.4, cy: y + C / 2, r: 1.9 }),
        s('path', { d: `M${x + 5.3} ${y + 5}H${x + 8.4}M${x + 7.4} ${y + 5}V${y + 6.8}M${x + 8.4} ${y + 5}V${y + 6.4}` })));
    });
    (L.targets || []).forEach((c, i) => {
      const [x, y] = xy(c), done = (st.m >> i) & 1;
      dyn.append(s('circle', { cx: x + C / 2, cy: y + C / 2, r: done ? 2.2 : 2.6, class: 'pa-tgt' + (done ? ' pa-done' : '') }));
    });
    for (const c of st.b) {
      const [x, y] = xy(c);
      dyn.append(s('rect', { x: x + 1.2, y: y + 1.2, width: C - 2.4, height: C - 2.4, rx: 1.6, class: 'pa-box' + (A.goalAt[c] ? ' pa-on' : A.dead[c] ? ' pa-dead' : '') }));
    }
    const [x, y] = xy(st.p);
    pl.style.transition = slide == null ? 'none' : '';
    pl.classList.toggle('pa-slide', !!slide);
    pl.style.transform = `translate(${x}px,${y}px)`;
  };
  return { svg, render };
}

export default {
  id: ID,
  name: NAME,
  line: 'path',
  casual: true,
  blurb: '钥匙门、冰面滑行、推箱子、多目标：先想好路线，用最少的步数走通。',
  aiDescription:
    '路径棋局，练规划，可休闲。每关是小方格谜题，程序用 BFS 验证可解并算出最少步数 opt。kinds 可多选混合：keys 迷宫里拿钥匙开同色门，钥匙一般要按顺序拿；ice 冰面一走就滑到撞墙，要正好停在终点，常有看似直达其实停不住的陷阱；sokoban 推箱子，推错进死角只能撤销或重来；multi 走遍几个目标点，顺序决定步数，贪心走最近的点往往不是最优。' +
    '参数：size 棋盘边长（迷宫取奇数，推箱子最多 7）；keys 钥匙数（5 格最多 2）；boxes 箱子数；targets 目标点数；levels 关数；undo 能否撤销；planFirst 先想后走，看图想好后按开始，开走后不能撤销，用来测规划；timeLimitMs 每关限时，休闲不限时。' +
    'summary：solve_rate 过关率；first_try_rate 不撤销不重来就过关的比例；optimal_rate 过关里正好最少步数的比例；move_ratio_mean 过关时步数除以最少步数，越接近 1 越好；think_ms_median 每关第一步前的思考时间；per_level 每关一段，格式为“种类首字母+边长:最少/实走,u撤销,r重来,结果,思考,总用时”。',
  defaults: { ...DEFAULTS, kinds: DEFAULTS.kinds.slice() },
  paramSpec: {
    kinds: { type: 'set', options: KINDS.slice(), desc: '关卡种类，多选时混合：keys 钥匙门迷宫，ice 冰面滑行，sokoban 推箱子，multi 多目标' },
    size: { type: 'int', min: 5, max: 9, desc: '棋盘内部边长；迷宫类取奇数（6→7），推箱子最多 7；越大越难' },
    boxes: { type: 'int', min: 1, max: 3, desc: '推箱子的箱子数' },
    keys: { type: 'int', min: 1, max: 3, desc: '钥匙门迷宫的钥匙/门数（棋盘 5 时最多 2）' },
    targets: { type: 'int', min: 2, max: 5, desc: '多目标关要走到的点数' },
    levels: { type: 'int', min: 1, max: 12, desc: '本组关数' },
    undo: { type: 'bool', desc: '能否撤销（撤销计数）；planFirst 时无效' },
    planFirst: { type: 'bool', desc: '先想后走：先看图，按“开始”后才能走，且不能撤销（可重来，计数）' },
    timeLimitMs: { type: 'int', min: 0, max: 600000, desc: '每关限时毫秒，0=不限（最少按 5000）；休闲模式忽略' },
    showFeedback: { type: 'bool', desc: '显示最少步数并在过关后提示是否最优' },
  },
  describe,

  async run(root, ctx) {
    const signal = ctx.signal;
    injectStyle();
    const plan = planSet(ctx.params, makeRng(ctx.seed));
    const p = plan.params;
    const total = plan.list.length;
    const casual = ctx.mode === 'casual';
    const limit = casual ? 0 : p.timeLimitMs > 0 ? Math.max(5000, p.timeLimitMs) : 0;
    const undoOn = p.undo && !p.planFirst;
    const desk = !isMobile();

    // ---------- DOM ----------
    root.innerHTML = '';
    const head = progressHead(NAME);
    head.set(0, total, `0/${total}`);
    const boardBox = h('div', { class: 'pa-boardbox' });
    const infoL = h('span'), infoR = h('span');
    const msg = h('div', { class: 'pa-msg' });
    const hint = h('div', { class: 'g-note pa-hint' });
    const kb = (t) => (desk ? h('span', { class: 'pa-key' }, t) : null);
    let ctl = null;
    const POS = ['grid-column:2;grid-row:1', 'grid-column:3;grid-row:2', 'grid-column:2;grid-row:2', 'grid-column:1;grid-row:2'];
    const arrow = (d, t, k) => h('button', { class: 'g-btn', type: 'button', 'aria-label': t, style: POS[d], onclick: () => ctl?.move(d) }, t, kb(k));
    const pad = h('div', { class: 'pa-pad' }, arrow(0, '↑', 'W'), arrow(3, '←', 'A'), arrow(2, '↓', 'S'), arrow(1, '→', 'D'));
    const undoBtn = h('button', { class: 'g-btn', type: 'button', onclick: () => ctl?.undo() }, '撤销', kb('U'));
    const restartBtn = h('button', { class: 'g-btn', type: 'button', onclick: () => ctl?.restart() }, '重来', kb('R'));
    const giveBtn = h('button', { class: 'g-btn', type: 'button', onclick: () => ctl?.giveUp() }, '放弃本关');
    if (!undoOn) undoBtn.hidden = true;
    const startBtn = h('button', { class: 'g-btn primary pa-start', type: 'button', hidden: true, onclick: () => ctl?.start() }, '想好了，开始走', kb('Enter'));
    const side = h('div', { class: 'pa-side' }, h('div', { class: 'pa-info' }, infoL, infoR), msg, startBtn, pad, h('div', { class: 'pa-acts' }, undoBtn, restartBtn, giveBtn), hint);
    root.append(h('div', { class: 'pa-wrap' }, head.el, h('div', { class: 'pa-main' }, boardBox, side)));

    // ---------- 输入 ----------
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || !ctl) return;
      const k = (e.key || '').toLowerCase();
      if (k in MOVE_KEYS) { e.preventDefault(); ctl.move(MOVE_KEYS[k]); }
      else if (k === 'u' || k === 'z' || k === 'backspace') { e.preventDefault(); ctl.undo(); }
      else if (k === 'r') { e.preventDefault(); ctl.restart(); }
      else if ((k === 'enter' || k === ' ') && !ctl.started) { e.preventDefault(); ctl.start(); }
    };
    window.addEventListener('keydown', onKey);
    let sw = null;
    const onDown = (e) => { sw = { x: e.clientX, y: e.clientY, id: e.pointerId }; try { boardBox.setPointerCapture(e.pointerId); } catch { /* ignore */ } };
    const onUp = (e) => {
      if (!sw || sw.id !== e.pointerId || !ctl) { sw = null; return; }
      const dx = e.clientX - sw.x, dy = e.clientY - sw.y;
      sw = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 18) return;
      ctl.move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
    };
    const onCancel = () => { sw = null; };
    boardBox.addEventListener('pointerdown', onDown);
    boardBox.addEventListener('pointerup', onUp);
    boardBox.addEventListener('pointercancel', onCancel);

    const playLevel = (L, i) => new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new AbortedError());
      const board = drawBoard(L);
      boardBox.replaceChildren(board.svg);
      let st = initState(L), hist = [], movesTotal = 0, undos = 0, restarts = 0, tFirst = null, done = false, timer = null, tick = null;
      const t0 = performance.now();
      const A = aux(L);
      const c = {
        started: !p.planFirst,
        move(d) {
          if (done) return;
          if (!c.started) { msg.textContent = '先看图想好，再按“开始走”'; return; }
          const ns = step(L, st, d);
          if (!ns) { board.svg.classList.remove('pa-bump'); void board.svg.getBoundingClientRect(); board.svg.classList.add('pa-bump'); return; }
          if (tFirst == null) tFirst = performance.now();
          hist.push(st); st = ns; movesTotal++;
          update(L.kind === 'ice');
          if (isWin(L, st)) end('solved');
        },
        undo() { if (done || !undoOn || !hist.length) return; st = hist.pop(); undos++; update(false); },
        restart() { if (done || !hist.length) return; st = initState(L); hist = []; restarts++; update(false); },
        giveUp() { end('gaveup'); },
        start() { if (done || c.started) return; c.started = true; startBtn.hidden = true; msg.textContent = ''; update(false); },
      };
      const left = () => Math.max(0, Math.ceil((limit - (performance.now() - t0)) / 1000));
      function update(slide) {
        board.render(st, slide);
        infoL.replaceChildren(h('b', null, KIND_NAME[L.kind]), `　第 ${i + 1} 关`);
        infoR.textContent = `步数 ${hist.length}` + (p.showFeedback ? ` · 最少 ${L.opt}` : '') + (limit ? ` · 剩 ${left()} 秒` : '');
        undoBtn.disabled = !hist.length; restartBtn.disabled = !hist.length;
        if (c.started) msg.textContent = L.kind === 'sokoban' && st.b.some((b) => A.dead[b]) ? '有箱子推进死角了：' + (undoOn ? '撤销或重来' : '只能重来') : '';
      }
      function cleanupLevel() {
        if (timer) clearTimeout(timer);
        if (tick) clearInterval(tick);
        signal?.removeEventListener('abort', onAbort);
        ctl = null;
      }
      function end(outcome) {
        if (done) return;
        done = true; cleanupLevel();
        resolve({ outcome, moves: hist.length, movesTotal, undos, restarts, thinkMs: tFirst == null ? null : Math.round(tFirst - t0), totalMs: Math.round(performance.now() - t0) });
      }
      function onAbort() { if (done) return; done = true; cleanupLevel(); reject(new AbortedError()); }
      signal?.addEventListener('abort', onAbort, { once: true });
      hint.textContent = HINT[L.kind] + (desk ? ' 方向键或 WASD 移动。' : ' 在棋盘上滑动或点箭头移动。') + (p.planFirst ? ' 先想后走：开走后不能撤销。' : '');
      startBtn.hidden = c.started;
      msg.textContent = '';
      ctl = c;
      update(null);
      if (limit) {
        timer = setTimeout(() => end('timeout'), limit);
        tick = setInterval(() => { if (!done) update(false); }, 1000);
      }
    });

    const cleanup = () => {
      window.removeEventListener('keydown', onKey);
      boardBox.removeEventListener('pointerdown', onDown);
      boardBox.removeEventListener('pointerup', onUp);
      boardBox.removeEventListener('pointercancel', onCancel);
      ctl = null;
    };

    const recs = [];
    try {
      for (let i = 0; i < total; i++) {
        if (signal?.aborted) throw new AbortedError();
        head.set(i, total, `${i + 1}/${total}`);
        const L = generateLevel(plan.list[i].kind, p, plan.list[i].seed);
        const o = await playLevel(L, i);
        const rec = scoreLevel(L, i, o);
        recs.push(rec);
        head.set(i + 1, total, `${i + 1}/${total}`);
        if (p.showFeedback) {
          const t = rec.solved ? (rec.optimal ? '✓ 最少步数' : `✓ ${rec.moves} 步（最少 ${rec.opt}）`) : rec.outcome === 'timeout' ? '时间到' : '已放弃';
          await flash(boardBox, rec.solved, t, signal, 950);
        } else await wait(350, signal);
      }
    } catch (e) {
      if (!(e instanceof AbortedError) && !signal?.aborted) { cleanup(); throw e; }
    }
    cleanup();

    const summary = summarize(recs, p);
    return {
      aborted: recs.length < total,
      trials: recs,
      summary,
      display: buildDisplay(summary),
      accuracy: recs.length ? summary.solve_rate : null,
    };
  },
};
