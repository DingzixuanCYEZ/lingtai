// 外壳共用：导航、顶栏、小部件、显示偏好面板。
// 导航用 history：浏览器后退、手机返回键都能用；换页会取消上一页正在等的 AI 请求或正在玩的这组。

import { h } from './core/gamekit.js';
import dnb from './games/dnb.js';
import storm from './games/storm.js';
import spatial from './games/spatial.js';
import blackbox from './games/blackbox.js';
import path from './games/path.js';
import pattern from './games/pattern.js';
import { getState, dayKey } from './core/store.js';
import { costSummary, USD_CNY } from './core/api.js';
import { DISPLAY_SPEC, COMMON_SPEC, specFor, display, setDisplay, rawPref, setPref } from './core/prefs.js';

export const GAMES = [dnb, storm, spatial, blackbox, pattern, path];
export const gameById = (id) => GAMES.find((g) => g.id === id);
export const pages = {}; // main.js 填 home / history / settings

const app = document.getElementById('app');

// ---------- 导航 ----------

const LOAD = Math.random().toString(36).slice(2, 8); // 刷新后，旧历史记录的 key 不会撞上新的
let seq = 0;
const routes = new Map(); // 历史记录 key → 回到这条记录时怎么画
let pageCtl = null;

function show(render) {
  if (pageCtl) pageCtl.abort();
  const ctl = new AbortController();
  pageCtl = ctl;
  const fail = (e) => {
    if (ctl.signal.aborted || e?.name === 'AbortError') return;
    shell(card(h('h2', null, '出错了'), h('div', { class: 'ui-err' }, String(e?.stack || e)), actions(btn('回首页', goHome, true))));
  };
  // 同步调用：DNB 要在“开始”的点击里创建 AudioContext
  try {
    const r = render(ctl.signal);
    if (r && typeof r.then === 'function') r.catch(fail);
  } catch (e) { fail(e); }
}

// reenter：用户后退 / 前进回到这条记录时怎么画（默认同 render；游戏页不能重放，要另给）
export function go(hash, render, { replace = false, reenter } = {}) {
  const depth = (history.state?.depth || 0) + (replace ? 0 : 1);
  const key = LOAD + ++seq;
  routes.set(key, reenter || render);
  history[replace ? 'replaceState' : 'pushState']({ key, depth }, '', hash);
  show(render);
}

export function goHome() {
  go('#/', pages.home, { replace: location.hash === '#/' || location.hash === '' });
}

export function back() {
  if ((history.state?.depth || 0) > 0) history.back();
  else go('#/', pages.home, { replace: true });
}

function byHash() {
  return { '#/history': pages.history, '#/settings': pages.settings }[location.hash] || pages.home;
}

export function startRouter() {
  window.addEventListener('popstate', (e) => {
    const r = e.state?.key && routes.get(e.state.key);
    show(r || byHash());
  });
  const r = byHash();
  const key = LOAD + ++seq;
  routes.set(key, r);
  history.replaceState({ key, depth: 0 }, '', r === pages.home ? '#/' : location.hash);
  show(r);
}

// ---------- 页面骨架 ----------

export function shell(...children) {
  const cur = location.hash;
  const nav = (label, hash, render) => h('button', {
    class: 'ui-iconbtn' + (cur === hash ? ' on' : ''),
    onclick: () => go(hash, render, { replace: cur === hash }),
  }, label);
  app.replaceChildren(h('div', { class: 'ui-app ui-page' },
    h('div', { class: 'ui-top' },
      h('h1', { onclick: goHome }, '灵台试炼'),
      h('span', { class: 'ui-sp' }),
      nav('首页', '#/', pages.home), nav('记录', '#/history', pages.history), nav('设置', '#/settings', pages.settings)),
    ...children));
  window.scrollTo(0, 0);
}

// 游戏页：没有顶栏，字号设置也不作用（游戏按屏幕大小自己排）
export function playShell(...children) {
  app.replaceChildren(h('div', { class: 'ui-app' }, ...children));
  window.scrollTo(0, 0);
}

// ---------- 小部件 ----------

export const card = (...c) => h('div', { class: 'ui-card' }, ...c);
export const btn = (text, onclick, primary = false) => h('button', { class: 'g-btn' + (primary ? ' primary' : ''), onclick }, text);
export const actions = (...b) => h('div', { class: 'ui-actions' }, ...b);
export const modeName = (m) => (m === 'casual' ? '休闲' : '认真');

export function kv(rows) {
  return h('div', { class: 'ui-kv' }, ...rows.flatMap(([k, v]) => [h('div', null, k), h('div', null, String(v))]));
}

// 要点两次才执行的按钮（删除、这组不算之类）；4 秒内不点第二次就复原
export function armedBtn(text, confirmText, fn) {
  let armed = false;
  let timer = null;
  const b = h('button', {
    class: 'g-btn',
    onclick: () => {
      if (armed) { clearTimeout(timer); fn(); return; }
      armed = true;
      b.textContent = confirmText;
      b.classList.add('danger');
      timer = setTimeout(() => { armed = false; b.textContent = text; b.classList.remove('danger'); }, 4000);
    },
  }, text);
  return b;
}

export function waitNote(exam = false) {
  return getState().settings.thinking === 'exam' && !exam ? '一般几秒钟。' : '开着思考模式，一般要十几秒到一分钟。';
}

// 等 AI 时显示的一块，带“取消”
export function waiting(text, onCancel, note = waitNote()) {
  return h('div', null,
    h('div', null, h('span', { class: 'ui-spin' }), text),
    note ? h('div', { class: 'g-note', style: 'margin-top:6px' }, note) : null,
    onCancel ? actions(btn('取消', onCancel)) : null);
}

// 页内的 AI 请求：box 里显示“等待 + 取消”，结束后清空。取消或离开页面返回 null；出错照常抛出。
export async function aiTask(box, text, pageSignal, fn) {
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  pageSignal.addEventListener('abort', stop, { once: true });
  box.replaceChildren(waiting(text, stop));
  try {
    return await fn(ctl.signal);
  } catch (e) {
    if (ctl.signal.aborted || e?.name === 'AbortError') return null;
    throw e;
  } finally {
    pageSignal.removeEventListener('abort', stop);
    box.replaceChildren();
  }
}

export const yuan = (usd) => {
  const y = usd * USD_CNY;
  return '¥' + y.toFixed(y < 1 ? 3 : 2);
};

export function costLine() {
  const c = costSummary(dayKey);
  if (!c.calls) return null;
  return h('div', { class: 'ui-cost' }, `DeepSeek 花费：今天约 ${yuan(c.today)}，累计约 ${yuan(c.total)}`);
}

// ---------- 显示偏好面板 ----------

function segRow(label, options, current, onPick) {
  return h('div', { class: 'ui-pref' },
    h('span', null, label),
    h('div', { class: 'ui-seg sm' }, ...options.map(([v, name, cls]) =>
      h('button', { class: 'g-btn' + (cls ? ' ' + cls : '') + (current === v ? ' on' : ''), onclick: () => onPick(v) }, name))));
}

export function displayBlock() {
  const box = h('div');
  const draw = () => {
    const d = display();
    box.replaceChildren(...DISPLAY_SPEC.map((s) => segRow(s.label, s.options, d[s.key], (v) => { setDisplay(s.key, v); draw(); })));
  };
  draw();
  return box;
}

function prefRow(scope, s, redraw) {
  const raw = rawPref(scope, s.key);
  if (s.range) {
    const v = raw ?? s.def;
    const out = h('output', null, String(v));
    const inp = h('input', { type: 'range', min: s.range[0], max: s.range[1], step: 5, value: v });
    inp.addEventListener('input', () => { out.textContent = inp.value; });
    inp.addEventListener('change', () => setPref(scope, s.key, Number(inp.value)));
    return h('div', { class: 'ui-pref' }, h('span', null, s.label), inp, out);
  }
  const pick = (v) => { setPref(scope, s.key, v); redraw(); };
  if (scope === 'all') return segRow(s.label, s.options, raw ?? s.def, pick);
  if (!COMMON_SPEC.includes(s)) return segRow(s.label, s.options, raw ?? s.def, pick);
  // 游戏里的公共项：多一个“跟所有游戏”
  const allVal = rawPref('all', s.key) ?? s.def;
  const allName = s.options.find(([v]) => v === allVal)?.[1] ?? '';
  return segRow(s.label, [[undefined, `跟所有游戏（${allName}）`, 'follow'], ...s.options], raw, pick);
}

// scopes：['all', 'dnb', …]。多个时带小标题，一起重画（改“所有游戏”会影响各游戏的“跟所有游戏”）
// 各游戏的单独设置默认收起（手机上不然要划很久），重画时保持展开
export function prefsBlock(scopes) {
  const box = h('div');
  const open = new Set();
  const rows = (sc) => (sc === 'all' ? COMMON_SPEC : specFor(sc)).map((s) => prefRow(sc, s, draw));
  const draw = () => box.replaceChildren(...scopes.flatMap((sc) => {
    if (scopes.length === 1) return rows(sc);
    if (sc === 'all') return [h('h3', null, '所有游戏'), ...rows(sc)];
    const d = h('details', null, h('summary', null, `${gameById(sc).name}（单独设置）`), ...rows(sc));
    d.open = open.has(sc);
    d.addEventListener('toggle', () => (d.open ? open.add(sc) : open.delete(sc)));
    return [d];
  }));
  draw();
  return box;
}
