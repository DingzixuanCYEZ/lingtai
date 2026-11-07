// 灵台试炼 · 游戏公用工具（所有 games/*.js 只依赖这个文件）
// 不要在游戏里 import 其他 core 文件。

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeRng(seed) {
  const r = mulberry32(seed);
  return {
    next: r,
    int(a, b) { return a + Math.floor(r() * (b - a + 1)); }, // 含两端
    float(a, b) { return a + r() * (b - a); },
    pick(arr) { return arr[Math.floor(r() * arr.length)]; },
    chance(p) { return r() < p; },
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    },
  };
}

// h('div', {class:'x', onclick: fn, style:'...'}, child1, 'text', ...)
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
      else if (k === 'class') el.className = v;
      else if (k === 'html') el.innerHTML = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

const SVGNS = 'http://www.w3.org/2000/svg';
export function s(tag, attrs, ...children) {
  const el = document.createElementNS(SVGNS, tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}

export class AbortedError extends Error { constructor() { super('aborted'); this.name = 'AbortedError'; } }

export function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError());
    const t = setTimeout(() => { signal?.removeEventListener('abort', on); resolve(); }, ms);
    const on = () => { clearTimeout(t); reject(new AbortedError()); };
    signal?.addEventListener('abort', on, { once: true });
  });
}

// 等用户点击 buttons 中的某一个（或按 keys 中对应的键）。返回 {index, rtMs}。
// keys: 与 buttons 同长度的数组，每项是 KeyboardEvent.key（小写）或 null。
// timeoutMs: 0 或不传 = 不限时；超时返回 {index:-1, rtMs:timeoutMs}
export function choose(buttons, { signal, keys, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortedError());
    const t0 = performance.now();
    let timer = null;
    const cleanup = () => {
      buttons.forEach((b, i) => b.removeEventListener('click', handlers[i]));
      window.removeEventListener('keydown', onKey);
      signal?.removeEventListener('abort', onAbort);
      if (timer) clearTimeout(timer);
    };
    const done = (index) => { cleanup(); resolve({ index, rtMs: Math.round(performance.now() - t0) }); };
    const handlers = buttons.map((b, i) => () => done(i));
    buttons.forEach((b, i) => b.addEventListener('click', handlers[i]));
    const onKey = (e) => {
      if (!keys || e.isComposing) return;
      const k = e.key.toLowerCase();
      const i = keys.indexOf(k);
      if (i >= 0) { e.preventDefault(); done(i); }
    };
    window.addEventListener('keydown', onKey);
    const onAbort = () => { cleanup(); reject(new AbortedError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
    if (timeoutMs > 0) timer = setTimeout(() => { cleanup(); resolve({ index: -1, rtMs: timeoutMs }); }, timeoutMs);
  });
}

// 简单的进度条头部。返回 {el, set(done,total,label)}
export function progressHead(title) {
  const bar = h('div', { class: 'g-bar-fill' });
  const label = h('span', { class: 'g-head-label' });
  const el = h('div', { class: 'g-head' }, h('span', { class: 'g-head-title' }, title), label, h('div', { class: 'g-bar' }, bar));
  return {
    el,
    set(done, total, text) {
      bar.style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
      label.textContent = text ?? `${done}/${total}`;
    },
  };
}

// 题后即时反馈闪一下（不阻塞太久）
export async function flash(root, ok, text, signal, ms = 650) {
  const el = h('div', { class: `g-flash ${ok ? 'ok' : 'bad'}` }, text ?? (ok ? '✓' : '✗'));
  root.append(el);
  try { await wait(ms, signal); } finally { el.remove(); }
}

export const isMobile = () => matchMedia('(pointer: coarse)').matches || window.innerWidth < 700;

export function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
export function median(xs) {
  if (!xs.length) return null;
  const a = xs.slice().sort((x, y) => x - y); const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
export function round(x, d = 2) { return x == null ? null : Math.round(x * 10 ** d) / 10 ** d; }
