// 两份存档合并成一份（纯函数，不碰 DOM / localStorage，开发/selftest-merge.mjs 测它）。
// local：这台设备的存档，就地修改（页面手里拿着的 session、day、line 对象都还有效）；
// remote：另一边（电脑文件 / Gist / 导入的 JSON）；base：上次两边一致时的存档，没有就传 null。
//
// 规则：
// - 记录类（每组、名册、建议、用量、跟教练说的话、偏好清单）按 id 取并集。只增不减，
//   真删掉的（“这组不算”、删偏好）记在 deleted 里，合并时不会复活；
// - 段位线：只有一边动过用那边；两边都动过、段位都没变，两边涨的修为相加；
//   段位变了的那边赢（两边都变了用后存的）；没有 base 时取进度高的；
// - 其他字段（清单、档案、设置、显示偏好……）：只有一边改过用那边，两边都改过用后存的那边；
// - 清空过所有记录（epoch 不同）：用后清空的那边整份。

import { LINE_IDS, xpCap, roundXp } from './ranks.js';

// 键排好序的 JSON，用来比较两份是否一样（两台设备写出的键顺序可能不同）
export function stable(x) {
  if (x === undefined || x === null || typeof x !== 'object') return JSON.stringify(x ?? null) ?? 'null';
  if (Array.isArray(x)) return '[' + x.map(stable).join(',') + ']';
  return '{' + Object.keys(x).filter((k) => x[k] !== undefined).sort()
    .map((k) => JSON.stringify(k) + ':' + stable(x[k])).join(',') + '}';
}

const eq = (a, b) => stable(a) === stable(b);
const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
const isObj = (x) => x != null && typeof x === 'object' && !Array.isArray(x);

function setKey(o, k, v) {
  if (v === undefined) delete o[k];
  else o[k] = v;
}

// 把 target 的内容换成 src 的（保留 target 这个对象本身）
function replaceInPlace(target, src) {
  for (const k of Object.keys(target)) if (!(k in src)) delete target[k];
  Object.assign(target, src);
}

// 三方选一：一样就不动；有 base 时只有一边改过用那边；都改过（或没有 base）用 localWins 指定的那边
function pick(l, r, b, hasBase, localWins) {
  if (eq(l, r)) return l;
  if (hasBase) {
    if (eq(l, b)) return r;
    if (eq(r, b)) return l;
  } else {
    if (l == null) return r;
    if (r == null) return l;
  }
  return localWins ? l : r;
}

// 普通对象逐键合并（嵌套对象往下走），就地改 l
function mergeObj(l, r, b, localWins, skip = []) {
  const hasBase = b != null;
  for (const k of new Set([...Object.keys(l), ...Object.keys(r || {})])) {
    if (skip.includes(k)) continue;
    const lv = l[k], rv = r?.[k], bv = b?.[k];
    if (isObj(lv) && isObj(rv)) mergeObj(lv, rv, hasBase ? (isObj(bv) ? bv : {}) : null, localWins);
    else setKey(l, k, pick(lv, rv, bv, hasBase, localWins));
  }
  return l;
}

// 列表按 key 合并，就地改 la。both(lx, rx)：两边都有时怎么办。
// ba 给了就会推断删除：base 里有、某一边没了的算删掉（只用于小队列；正经记录不推断，靠 deleted）
function mergeList(la, ra, ba, key, both) {
  const out = Array.isArray(la) ? la : [];
  const lk = new Map(out.map((x) => [key(x), x]));
  const rk = new Map((ra || []).map((x) => [key(x), x]));
  const bk = ba ? new Set(ba.map(key)) : null;
  const gone = (k) => bk && bk.has(k) && (!lk.has(k) || !rk.has(k));
  for (const [k, rx] of rk) {
    if (!lk.has(k)) { if (!gone(k)) out.push(rx); }
    else if (both) both(lk.get(k), rx, k);
  }
  for (let i = out.length - 1; i >= 0; i--) if (gone(key(out[i]))) out.splice(i, 1);
  return out;
}

function sortBy(arr, f) {
  arr.sort((a, b) => (f(a) || 0) - (f(b) || 0));
  return arr;
}

const freshLine = (x) => x.rank == null && !x.xp && !x.placedAt && !x.exam;
const progress = (x) => (x.rank ?? -1) * 1000 + (x.xp || 0);

function mergeLine(id, l, r, b, localNewer) {
  if (!r || eq(l, r)) return;
  if (b) {
    if (eq(l, b)) return replaceInPlace(l, r);
    if (eq(r, b)) return;
  }
  if (freshLine(l)) return replaceInPlace(l, r);
  if (freshLine(r)) return;
  if (b) {
    if (l.rank === b.rank && r.rank === b.rank) {
      // 两边都练了、都没升降段：两边涨的修为都算
      const xp = roundXp(Math.max(0, Math.min(xpCap(id, l.rank), (r.xp || 0) + (l.xp || 0) - (b.xp || 0))));
      return replaceInPlace(l, { ...(localNewer ? l : r), xp });
    }
    const lMoved = l.rank !== b.rank, rMoved = r.rank !== b.rank;
    if (lMoved && !rMoved) return;
    if (rMoved && !lMoved) return replaceInPlace(l, r);
    if (!localNewer) replaceInPlace(l, r);
    return;
  }
  // 没有共同的 base（导入 JSON、第一次同步）：取进度高的
  if (progress(r) > progress(l) || (progress(r) === progress(l) && !localNewer)) replaceInPlace(l, r);
}

const planId = (p) => (p ? p.madeAt || stable((p.tasks || []).map((t) => [t.game, t.mode, !!t.exam])) : null);

function mergeConvo(l, r, b, hasBase, localNewer) {
  if (eq(l, r)) return l;
  const isPrefix = (a, c) => Array.isArray(a) && Array.isArray(c) && a.length <= c.length && a.every((m, i) => eq(m, c[i]));
  if (isPrefix(l, r)) return r;
  if (isPrefix(r, l)) return l;
  return pick(l, r, b, hasBase, localNewer);
}

function mergeDay(l, r, b, localNewer) {
  const hasBase = b != null;
  const bd = hasBase ? b : null;
  for (const k of new Set([...Object.keys(l), ...Object.keys(r)])) {
    const lv = l[k], rv = r[k], bv = bd?.[k];
    switch (k) {
      case 'plan': case 'done': break; // 下面一起处理
      case 'talks':
        l.talks = sortBy(mergeList(lv, rv, null, (t) => t.ts), (t) => t.ts);
        break;
      case 'notes':
        l.notes = mergeList(lv, rv, hasBase ? bv || [] : null, stable);
        break;
      case 'convo':
        setKey(l, k, mergeConvo(lv, rv, bv, hasBase, localNewer));
        break;
      case 'next': {
        if (!isObj(lv) || !isObj(rv)) { setKey(l, k, pick(lv, rv, bv, hasBase, localNewer)); break; }
        for (const g of Object.keys(rv)) {
          const a = lv[g], c = rv[g];
          setKey(lv, g, pick(a, c, bv?.[g], hasBase, (a?.ts || 0) >= (c?.ts || 0)));
        }
        break;
      }
      default:
        setKey(l, k, pick(lv, rv, bv, hasBase, localNewer));
    }
  }
  // 清单和打勾：同一份清单就合并打勾；换过清单就整份用选中的那边
  const lp = l.plan, rp = r.plan;
  if (planId(lp) === planId(rp)) {
    if (!eq(lp, rp)) l.plan = pick(lp, rp, bd?.plan, hasBase, localNewer);
    const baseDone = hasBase && planId(bd.plan) === planId(lp) ? bd.done || [] : null;
    l.done = sortBy(mergeList(l.done, r.done, baseDone, (x) => x), (x) => x);
  } else {
    const useR = lp && rp && lp.madeAt && rp.madeAt
      ? rp.madeAt > lp.madeAt
      : pick(lp, rp, bd?.plan, hasBase, localNewer) === rp;
    if (useR) { l.plan = rp; l.done = r.done || []; }
  }
}

export function mergeStates(local, remoteIn, baseIn = null) {
  const L = local;
  const R = clone(remoteIn);
  let B = baseIn;
  if (!R) return L;
  const localNewer = (L.savedAt || 0) >= (R.savedAt || 0);

  // 清空过：用后清空的那边整份（key 留这台的）
  const le = L.epoch || 0, re = R.epoch || 0;
  if (le !== re) {
    if (re > le) {
      const key = L.settings?.apiKey || '';
      replaceInPlace(L, R);
      L.settings = { ...(L.settings || {}), apiKey: key };
    }
    return L;
  }
  if (B && (B.epoch || 0) !== le) B = null;
  const hasBase = !!B;

  const handled = new Set(['version', 'savedAt', 'epoch', 'deleted', 'settings', 'lines', 'sessions', 'roster', 'suggestions', 'usage', 'prefsDoc', 'days']);

  L.deleted = mergeList(L.deleted, R.deleted, null, (x) => x);
  if (L.deleted.length > 2000) L.deleted.splice(0, L.deleted.length - 2000);
  const dead = new Set(L.deleted);

  L.settings = mergeObj(L.settings || {}, R.settings || {}, B?.settings || (hasBase ? {} : null), localNewer, ['apiKey']);

  L.lines ||= {};
  for (const id of new Set([...LINE_IDS, ...Object.keys(R.lines || {})])) {
    if (!L.lines[id]) { if (R.lines?.[id]) L.lines[id] = R.lines[id]; continue; }
    mergeLine(id, L.lines[id], R.lines?.[id], B?.lines?.[id], localNewer);
  }

  // 每组：两边都有且不一样时，只有一边改过用那边；都改过取走得更远的（判定过 > 写了复盘 > 没写）
  const bSessions = new Map((B?.sessions || []).map((s) => [s.id, s]));
  const stage = (s) => (s.judgment ? 2 : 0) + (s.feedback ? 1 : 0);
  mergeList(L.sessions ||= [], R.sessions, null, (s) => s.id, (ls, rs) => {
    if (eq(ls, rs)) return;
    const bs = bSessions.get(ls.id);
    let useR;
    if (bs && eq(ls, bs)) useR = true;
    else if (bs && eq(rs, bs)) useR = false;
    else useR = stage(rs) > stage(ls) || (stage(rs) === stage(ls) && !localNewer);
    if (useR) replaceInPlace(ls, rs);
  });
  for (let i = L.sessions.length - 1; i >= 0; i--) if (dead.has('session:' + L.sessions[i].id)) L.sessions.splice(i, 1);
  sortBy(L.sessions, (s) => s.ts);

  L.roster = mergeList(L.roster, R.roster, null, (x) => `${x.line}|${x.name}`);
  L.suggestions = mergeList(L.suggestions, R.suggestions, null, (x) => `${x.day}|${x.text}`);
  L.usage = sortBy(mergeList(L.usage, R.usage, null, (x) => `${x.ts}|${x.kind}`), (x) => x.ts);
  if (L.usage.length > 2000) L.usage.splice(0, L.usage.length - 2000);
  if (L.prefsDoc || R.prefsDoc) {
    L.prefsDoc = mergeList(L.prefsDoc, R.prefsDoc, null, (x) => String(x.id)).filter((x) => !dead.has('pref:' + x.id));
  }

  L.days ||= {};
  for (const k of Object.keys(R.days || {})) {
    if (!L.days[k]) L.days[k] = R.days[k];
    else mergeDay(L.days[k], R.days[k], hasBase ? B.days?.[k] || {} : null, localNewer);
  }

  // 其余字段（total、lastParams、prefs、以后加的）
  for (const k of Object.keys(R)) {
    if (handled.has(k)) continue;
    const lv = L[k], rv = R[k], bv = B?.[k];
    if (isObj(lv) && isObj(rv)) mergeObj(lv, rv, hasBase ? (isObj(bv) ? bv : {}) : null, localNewer);
    else setKey(L, k, pick(lv, rv, bv, hasBase, localNewer));
  }

  L.savedAt = Math.max(L.savedAt || 0, R.savedAt || 0) || undefined;
  return L;
}
