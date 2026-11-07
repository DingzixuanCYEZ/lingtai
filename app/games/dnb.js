// 灵台试炼 · 双重 N-back（dnb）
// 位置流（3×3 方格）+ 声音流（字母读音），判断是否与 N 个试次之前相同。
// 导入时不碰 DOM：generate / scoreDnb / buildResult 都是纯函数，可在 node 里自测。

import { makeRng, h, wait, choose, progressHead, isMobile, AbortedError, mean, round } from '../core/gamekit.js';

const ID = 'dnb';
const NAME = '双重N-back';
export const LETTERS = ['c', 'h', 'k', 'l', 'q', 'r', 's', 't'];

const DEFAULTS = {
  n: 2,
  intervalMs: 3000,
  displayMs: 500,
  trials: 0,
  targetPct: 30,
  lurePct: 0,
  useCenter: true,
  showFeedback: false,
};

function clampInt(v, lo, hi, d) {
  const x = Math.round(Number(v));
  if (!Number.isFinite(x)) return d;
  return Math.max(lo, Math.min(hi, x));
}

export function normParams(params) {
  const p = { ...DEFAULTS, ...(params || {}) };
  const intervalMs = clampInt(p.intervalMs, 1000, 5000, DEFAULTS.intervalMs);
  return {
    n: clampInt(p.n, 1, 12, DEFAULTS.n),
    intervalMs,
    // 方块显示时间必须短于试次间隔，留 100ms 空白
    displayMs: Math.min(clampInt(p.displayMs, 200, 1500, DEFAULTS.displayMs), intervalMs - 100),
    trials: clampInt(p.trials, 0, 120, 0),
    targetPct: clampInt(p.targetPct, 15, 50, DEFAULTS.targetPct),
    lurePct: clampInt(p.lurePct, 0, 30, 0),
    useCenter: p.useCenter !== false,
    showFeedback: !!p.showFeedback,
  };
}

// 试次总数：trials>0 用它（但至少 n+1，保证有可计分试次）；0 = 旧 app 的 "linear" 默认 20+n
export function trialCount(p) {
  return p.trials > 0 ? Math.max(p.trials, p.n + 1) : 20 + p.n;
}

function lureBacks(n) {
  // n-1 回溯（n=1 时是 0 回溯，即自身，不算）和 n+1 回溯
  return n > 1 ? [n - 1, n + 1] : [n + 1];
}

// 生成一个通道的序列
function genChannel(len, n, pool, targetP, lureP, rng) {
  const vals = [], tgt = [], lure = [];
  const backs = lureBacks(n);
  for (let i = 0; i < len; i++) {
    const near = backs.filter((k) => i - k >= 0).map((k) => vals[i - k]);
    if (i < n) {
      // 前 n 个没有目标；顺带避开会在后面形成 n±1 诱饵的重复
      const cand = pool.filter((x) => !near.includes(x));
      vals.push(rng.pick(cand.length ? cand : pool));
      tgt.push(false); lure.push(false);
      continue;
    }
    const nb = vals[i - n];
    if (rng.chance(targetP)) {
      vals.push(nb); tgt.push(true); lure.push(false);
      continue;
    }
    const lureVals = [...new Set(near.filter((x) => x !== nb))];
    let v;
    if (lureP > 0 && lureVals.length && rng.chance(lureP)) {
      v = rng.pick(lureVals);
    } else {
      const cand = pool.filter((x) => x !== nb && !lureVals.includes(x));
      v = rng.pick(cand.length ? cand : pool.filter((x) => x !== nb));
    }
    vals.push(v); tgt.push(false); lure.push(lureVals.includes(v));
  }
  return { vals, tgt, lure };
}

// 纯函数：生成一组试次
export function generate(params, rng) {
  const p = normParams(params);
  const n = p.n;
  const total = trialCount(p);
  const posPool = p.useCenter ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [0, 1, 2, 3, 5, 6, 7, 8];
  const tP = p.targetPct / 100, lP = p.lurePct / 100;
  const P = genChannel(total, n, posPool, tP, lP, rng);
  const S = genChannel(total, n, LETTERS, tP, lP, rng);
  const trials = [];
  for (let i = 0; i < total; i++) {
    trials.push({
      pos: P.vals[i], letter: S.vals[i],
      posTarget: P.tgt[i], sndTarget: S.tgt[i],
      posLure: P.lure[i], sndLure: S.lure[i],
    });
  }
  return { trials, n, total, scoreable: total - n, useCenter: p.useCenter, targetPct: p.targetPct, lurePct: p.lurePct };
}

// 旧 app 口径：命中 / (命中 + 漏报 + 误报)
function accOld(list) {
  let num = 0, den = 0;
  for (const o of list) { num += o.h; den += o.h + o.m + o.f; }
  return den ? num / den : null;
}

// 纯函数：按每个试次的按键（rt 或 null）计分。responses 只包含已完整结束的试次。
export function scoreDnb(seq, responses, n, audioFailed = false) {
  const chans = audioFailed ? ['pos'] : ['pos', 'snd'];
  const ch = {
    pos: { hit: 0, miss: 0, fa: 0, cr: 0, hitRts: [] },
    snd: { hit: 0, miss: 0, fa: 0, cr: 0, hitRts: [] },
  };
  const recs = [], perScored = [];
  for (let i = 0; i < responses.length; i++) {
    const t = seq[i], r = responses[i] || {};
    const rec = {
      i, pos: t.pos, letter: t.letter,
      posTarget: t.posTarget, sndTarget: t.sndTarget,
      posLure: t.posLure, sndLure: t.sndLure,
      posRt: r.pos ?? null, sndRt: audioFailed ? null : (r.snd ?? null),
      posOut: null, sndOut: null, scored: i >= n,
    };
    if (i >= n) {
      const o = { h: 0, m: 0, f: 0 };
      for (const c of chans) {
        const target = c === 'pos' ? t.posTarget : t.sndTarget;
        const rt = c === 'pos' ? rec.posRt : rec.sndRt;
        const pressed = rt != null;
        const out = target ? (pressed ? 'hit' : 'miss') : (pressed ? 'fa' : 'cr');
        ch[c][out]++;
        if (out === 'hit') { o.h++; ch[c].hitRts.push(rt); }
        else if (out === 'miss') o.m++;
        else if (out === 'fa') o.f++;
        rec[c + 'Out'] = out;
      }
      perScored.push(o);
    }
    recs.push(rec);
  }
  const m = perScored.length;
  const half = Math.floor(m / 2);
  const stat = (c) => {
    const x = ch[c];
    return {
      hit: x.hit, miss: x.miss, fa: x.fa, cr: x.cr,
      hitRate: x.hit + x.miss ? x.hit / (x.hit + x.miss) : null,
      faRate: x.fa + x.cr ? x.fa / (x.fa + x.cr) : null,
      meanHitRtMs: x.hitRts.length ? Math.round(mean(x.hitRts)) : null,
    };
  };
  return {
    recs, nScored: m,
    pos: stat('pos'),
    snd: audioFailed ? null : stat('snd'),
    accOld: accOld(perScored),
    accFirst: half >= 1 ? accOld(perScored.slice(0, half)) : null,
    accSecond: m - half >= 1 && half >= 1 ? accOld(perScored.slice(half)) : null,
  };
}

const pct = (x) => (x == null ? '—' : `${Math.round(x * 100)}%`);

export function buildResult(sc, p, audioFailed, aborted) {
  const nCorrect = sc.pos.hit + sc.pos.cr + (sc.snd ? sc.snd.hit + sc.snd.cr : 0);
  const accO = sc.accOld == null ? null : round(sc.accOld, 3);
  const summary = {
    n: p.n,
    intervalMs: p.intervalMs,
    n_trials: sc.nScored,
    n_correct: nCorrect,
    pos_hit: sc.pos.hit, pos_miss: sc.pos.miss, pos_fa: sc.pos.fa,
    snd_hit: sc.snd ? sc.snd.hit : null, snd_miss: sc.snd ? sc.snd.miss : null, snd_fa: sc.snd ? sc.snd.fa : null,
    acc_old: accO,
    acc_first_half: sc.accFirst == null ? null : round(sc.accFirst, 3),
    acc_second_half: sc.accSecond == null ? null : round(sc.accSecond, 3),
    audio_failed: !!audioFailed,
  };
  const chLine = (x) => `命中 ${x.hit}/${x.hit + x.miss} · 误报 ${x.fa}`;
  const display = [
    ['N', `${p.n}-back · ${(p.intervalMs / 1000).toFixed(1)} 秒`],
    ['位置', chLine(sc.pos)],
    ['声音', sc.snd ? chLine(sc.snd) : '声音未加载，本组未练'],
    ['准确率(旧口径)', pct(sc.accOld)],
    ['前半/后半', `${pct(sc.accFirst)} / ${pct(sc.accSecond)}`],
  ];
  return {
    aborted: !!aborted,
    audioFailed: !!audioFailed,
    trials: sc.recs,
    channels: { pos: sc.pos, snd: sc.snd },  // hitRate / faRate / 命中平均反应时
    summary,
    display,
    accuracy: accO,
  };
}

const CSS = `
.dnb-wrap{display:flex;flex-direction:column;align-items:center;gap:10px;padding:4px 0 10px;user-select:none;-webkit-user-select:none}
.dnb-info{width:min(78vw,52vh,420px);display:flex;justify-content:space-between;align-items:baseline}
.dnb-n{font-size:22px;font-weight:700;color:var(--fg)}
.dnb-count{font-size:13px;color:var(--muted)}
.dnb-grid{position:relative;box-sizing:border-box;width:min(78vw,52vh,420px);height:min(78vw,52vh,420px);display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:6px;padding:6px;background:var(--line);border-radius:12px}
.dnb-cell{background:var(--card);border-radius:8px}
.dnb-cell.dnb-unused{background:var(--bg)}
.dnb-cell.dnb-on{background:var(--accent)}
.dnb-overlay{position:absolute;inset:0;display:flex;flex-direction:column;gap:12px;align-items:center;justify-content:center;font-size:clamp(36px,12vw,72px);font-weight:700;color:var(--fg);background:color-mix(in srgb,var(--card) 72%,transparent);border-radius:12px;text-align:center;padding:12px;box-sizing:border-box}
.dnb-overlay.dnb-small{font-size:18px;font-weight:600}
.dnb-overlay[hidden]{display:none}
.dnb-btns{width:min(78vw,52vh,420px);min-width:min(280px,92vw);display:flex;gap:12px}
.dnb-btn{flex:1;min-height:72px;font-size:20px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;touch-action:manipulation;border-radius:12px;transition:background-color 80ms,transform 60ms,color 80ms}
.dnb-key{font-size:12px;color:var(--muted)}
.dnb-btn.dnb-press{transform:scale(.96);background:var(--line)}
.dnb-btn.dnb-good{background:var(--ok);border-color:var(--ok);color:#fff}
.dnb-btn.dnb-bad{background:var(--bad);border-color:var(--bad);color:#fff}
.dnb-btn.dnb-good .dnb-key,.dnb-btn.dnb-bad .dnb-key{color:#fff}
.dnb-btn:disabled{opacity:.45}
.dnb-err{color:var(--bad);font-size:14px;text-align:center;max-width:min(92vw,420px)}
.dnb-err[hidden]{display:none}
`;

function injectStyle() {
  if (document.getElementById(`style-${ID}`)) return;
  const st = document.createElement('style');
  st.id = `style-${ID}`;
  st.textContent = CSS;
  document.head.append(st);
}

function decodeAsync(actx, ab) {
  return new Promise((resolve, reject) => {
    // 兼容旧 Safari 的回调形式
    const pr = actx.decodeAudioData(ab, resolve, reject);
    if (pr && typeof pr.then === 'function') pr.then(resolve, reject);
  });
}

export default {
  id: ID,
  name: NAME,
  line: 'wm',
  casual: false,
  blurb: '方格位置和字母读音同时记：和 N 步之前一样就按。',
  aiDescription:
    '双重 N-back，练工作记忆。3×3 方格每个试次亮一格，同时播一个字母读音（8 个字母）。位置与 N 个试次前相同按 A/左键“位置”，读音相同按 L/右键“声音”，两通道独立，可同时按。' +
    '参数：n 回溯步数，主要难度旋钮；intervalMs 试次间隔，越短越难；displayMs 方块亮的时长；trials=0 时为 20+n 个试次；targetPct 每通道目标比例；lurePct 为 n±1 步诱饵比例，越高越易误报；useCenter=false 只用外圈 8 格；showFeedback 按键和漏按时按钮变色。' +
    'summary：前 n 个试次不计分；pos_/snd_ 的 hit、miss、fa 为命中、漏报、误报；acc_old=命中/(命中+漏报+误报)，两通道合计，是用户旧 app 的口径，可与旧记录直接比；acc_first_half/acc_second_half 为前后半段同口径准确率，后半段明显下降说明疲劳或策略崩溃；audio_failed=true 表示只练了位置。' +
    '用户的策略（默念字母、位置编码、分组复述、凭直觉等）因人因时而异，由用户用自然语言另外汇报，解读成绩要结合。',
  defaults: { ...DEFAULTS },
  paramSpec: {
    n: { type: 'int', min: 1, max: 12, desc: '回溯步数 N，主要难度旋钮' },
    intervalMs: { type: 'int', min: 1000, max: 5000, desc: '试次间隔（毫秒），越短越难；旧 app 默认 3000' },
    displayMs: { type: 'int', min: 200, max: 1500, desc: '方块亮的时长（毫秒），会被限制在 intervalMs-100 以内' },
    trials: { type: 'int', min: 0, max: 120, desc: '试次总数；0=自动 20+n；至少 n+1' },
    targetPct: { type: 'int', min: 15, max: 50, desc: '每个通道每个计分试次为目标的概率（%）' },
    lurePct: { type: 'int', min: 0, max: 30, desc: '非目标试次故意等于 n-1 或 n+1 步前的概率（%），0=尽量不出现' },
    useCenter: { type: 'bool', desc: 'false=中心格不用，只有 8 个位置' },
    showFeedback: { type: 'bool', desc: '按键时按钮变绿/红，漏按在试次结束时变红' },
  },

  async run(root, ctx) {
    const signal = ctx.signal;
    const p = normParams(ctx.params);

    // AudioContext 尽量在用户点击“开始”的同一调用栈里创建
    let actx = null;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) actx = new AC();
    } catch { actx = null; }

    injectStyle();
    const gen = generate(p, makeRng(ctx.seed));
    const total = gen.total;

    // ---------- DOM ----------
    root.innerHTML = '';
    const head = progressHead(NAME);
    head.set(0, total, `第 0 / ${total}`);
    const nEl = h('div', { class: 'dnb-n' }, `${p.n}-back`);
    const cntEl = h('div', { class: 'dnb-count' }, `第 0 / ${total}`);
    const cells = [];
    const grid = h('div', { class: 'dnb-grid' });
    for (let k = 0; k < 9; k++) {
      const c = h('div', { class: 'dnb-cell' + (k === 4 && !p.useCenter ? ' dnb-unused' : '') });
      cells.push(c); grid.append(c);
    }
    const overlay = h('div', { class: 'dnb-overlay dnb-small' }, '加载声音…');
    grid.append(overlay);
    const desk = !isMobile();
    const mkBtn = (label, key) => h('button', { class: 'g-btn dnb-btn', type: 'button' },
      h('span', null, label), desk ? h('span', { class: 'dnb-key' }, key) : null);
    const bPos = mkBtn('位置', 'A');
    const bSnd = mkBtn('声音', 'L');
    const errEl = h('div', { class: 'dnb-err', hidden: true });
    root.append(h('div', { class: 'dnb-wrap' },
      head.el,
      h('div', { class: 'dnb-info' }, nEl, cntEl),
      grid,
      h('div', { class: 'dnb-btns' }, bPos, bSnd),
      errEl,
      h('div', { class: 'g-note' }, `位置或读音和 ${p.n} 步之前相同就按，两个可以同时按。`),
    ));

    // ---------- 状态 ----------
    const timers = new Set();
    const sources = new Set();
    const responses = [];     // responses[i] = {pos: rt|null, snd: rt|null}
    const onsets = [];
    let cur = -1;             // 当前接受按键的试次
    let doneCount = 0;        // 已完整结束的试次数
    let audioFailed = false;
    let buffers = null;
    let aborted = false;
    let outNode = null;
    const volume = Math.max(0, Math.min(100, Number(ctx.prefs?.volume ?? 100)));

    const later = (fn, ms) => {
      const t = setTimeout(() => { timers.delete(t); fn(); }, ms);
      timers.add(t);
    };
    const flashBtn = (btn, cls, ms) => {
      btn.classList.remove(cls);
      void btn.offsetWidth; // 重复按时重新触发
      btn.classList.add(cls);
      later(() => btn.classList.remove(cls), ms);
    };
    const btnOf = (c) => (c === 'pos' ? bPos : bSnd);

    const press = (c) => {
      if (cur < 0 || cur < doneCount) return; // 没有进行中的试次
      if (c === 'snd' && audioFailed) return;
      const r = responses[cur];
      if (!r || r[c] != null) return; // 同一试次同一通道只记第一次
      r[c] = Math.round(performance.now() - onsets[cur]);
      const btn = btnOf(c);
      flashBtn(btn, 'dnb-press', 150);
      if (p.showFeedback && cur >= p.n) {
        const t = gen.trials[cur];
        const target = c === 'pos' ? t.posTarget : t.sndTarget;
        flashBtn(btn, target ? 'dnb-good' : 'dnb-bad', 400);
      }
    };
    const endTrial = (i) => {
      if (i < 0 || i < doneCount) return;
      doneCount = i + 1;
      if (p.showFeedback && i >= p.n) {
        const t = gen.trials[i], r = responses[i];
        if (t.posTarget && r.pos == null) flashBtn(bPos, 'dnb-bad', 400);
        if (!audioFailed && t.sndTarget && r.snd == null) flashBtn(bSnd, 'dnb-bad', 400);
      }
    };

    const onKey = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = (e.key || '').toLowerCase();
      if (k === 'a') { e.preventDefault(); press('pos'); }
      else if (k === 'l') { e.preventDefault(); press('snd'); }
    };
    const onPos = (e) => { e.preventDefault(); press('pos'); };
    const onSnd = (e) => { e.preventDefault(); press('snd'); };

    const cleanup = () => {
      window.removeEventListener('keydown', onKey);
      bPos.removeEventListener('pointerdown', onPos);
      bSnd.removeEventListener('pointerdown', onSnd);
      for (const t of timers) clearTimeout(t);
      timers.clear();
      for (const s of sources) { try { s.stop(); } catch { /* 已停 */ } }
      sources.clear();
      if (actx) { try { actx.close()?.catch?.(() => {}); } catch { /* ignore */ } }
      cells.forEach((c) => c.classList.remove('dnb-on'));
    };

    const waitUntil = (t) => wait(Math.max(0, t - performance.now()), signal);

    // 尝试恢复音频（最多等 400ms）；不留未处理的 rejection
    const resumeAudio = async () => {
      let pr = null;
      try { pr = actx.resume?.(); } catch { pr = null; }
      const tasks = [wait(400, signal).catch(() => {})];
      if (pr && typeof pr.then === 'function') tasks.push(pr.catch(() => {}));
      await Promise.race(tasks);
      if (signal?.aborted) throw new AbortedError();
    };

    const playAt = (letter, tStart) => {
      if (audioFailed || !buffers || !actx) return;
      try {
        const src = actx.createBufferSource();
        src.buffer = buffers[letter];
        if (!outNode) {
          outNode = actx.createGain();
          outNode.gain.value = (volume / 100) ** 2; // 平方更接近听感
          outNode.connect(actx.destination);
        }
        src.connect(outNode);
        const when = actx.currentTime + Math.max(0, (tStart - performance.now()) / 1000);
        src.onended = () => sources.delete(src);
        src.start(when);
        sources.add(src);
      } catch { /* 单次播放失败不影响位置流 */ }
    };

    try {
      if (signal?.aborted) throw new AbortedError();

      // ---------- 加载声音 ----------
      try {
        if (!actx) throw new Error('浏览器不支持 Web Audio');
        try { actx.resume?.()?.catch?.(() => {}); } catch { /* ignore */ }
        const bufs = {};
        await Promise.all(LETTERS.map(async (L) => {
          const url = new URL(`../assets/dnb/${L}.wav`, import.meta.url);
          const res = await fetch(url, { signal });
          if (!res.ok) throw new Error(`${L}.wav HTTP ${res.status}`);
          bufs[L] = await decodeAsync(actx, await res.arrayBuffer());
        }));
        buffers = bufs;
      } catch (e) {
        if (signal?.aborted) throw new AbortedError();
        audioFailed = true;
        bSnd.disabled = true;
        errEl.textContent = `声音加载失败（${e?.message || e}），本组只练位置。`;
        errEl.hidden = false;
      }

      // 某些手机浏览器要求再点一下才能出声
      if (!audioFailed && actx.state !== 'running') {
        await resumeAudio();
        if (actx.state !== 'running') {
          overlay.textContent = '';
          const go = h('button', { class: 'g-btn primary', type: 'button' }, '点这里开始（开启声音）');
          overlay.append(go);
          await choose([go], { signal });
          await resumeAudio();
          overlay.textContent = '';
          if (actx.state !== 'running') {
            errEl.textContent = '浏览器没有允许播放声音；如果听不到字母，请结束本组后重试。';
            errEl.hidden = false;
          }
        }
      }

      window.addEventListener('keydown', onKey);
      bPos.addEventListener('pointerdown', onPos);
      bSnd.addEventListener('pointerdown', onSnd);

      // 蓝牙耳机、一些声卡和手机静音一会儿就休眠，醒来时会吞掉第一个字母：
      // 从倒计时起放一段听不见的底噪（约 -80 dB），让声音输出一直醒着
      if (!audioFailed) {
        try {
          const buf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
          const ch = buf.getChannelData(0);
          for (let k = 0; k < ch.length; k++) ch[k] = (Math.random() * 2 - 1) * 1e-4;
          const keep = actx.createBufferSource();
          keep.buffer = buf;
          keep.loop = true;
          keep.connect(actx.destination);
          keep.start();
          sources.add(keep);
        } catch { /* 没有也能玩 */ }
      }

      // ---------- 3 秒倒计时 ----------
      overlay.classList.remove('dnb-small');
      const cd0 = performance.now();
      for (let k = 3; k >= 1; k--) {
        overlay.textContent = String(k);
        await waitUntil(cd0 + (4 - k) * 1000);
      }
      overlay.hidden = true;
      if (!audioFailed && actx.state !== 'running') await resumeAudio();

      // ---------- 试次：所有时刻都从 base 推算，不累积漂移 ----------
      // 遮罩消失是一次整块的明暗变化，紧跟着的短方块会被“盖掉”看不见；先空着格子停 0.8 秒再出第一个
      const base = performance.now() + 800;
      for (let i = 0; i < total; i++) {
        const tS = base + i * p.intervalMs;
        await waitUntil(tS - 60);
        playAt(gen.trials[i].letter, tS);   // 用音频时钟精确排到 tS
        await waitUntil(tS);
        endTrial(cur);
        responses[i] = { pos: null, snd: null };
        onsets[i] = performance.now();
        cur = i;
        const cell = cells[gen.trials[i].pos];
        cell.classList.add('dnb-on');
        cntEl.textContent = `第 ${i + 1} / ${total}`;
        head.set(i + 1, total, `第 ${i + 1} / ${total}`);
        await waitUntil(tS + p.displayMs);
        cell.classList.remove('dnb-on');
      }
      await waitUntil(base + total * p.intervalMs);
      endTrial(cur);
    } catch (e) {
      if (!(e instanceof AbortedError) && !signal?.aborted) { cleanup(); throw e; }
      aborted = true;
    }
    cleanup();

    const sc = scoreDnb(gen.trials, responses.slice(0, doneCount), p.n, audioFailed);
    return buildResult(sc, p, audioFailed, aborted);
  },
};
