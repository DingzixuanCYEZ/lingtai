// 灵台试炼 · 规则风暴（storm）
// 干扰控制 + 任务切换：stroop 颜色字 / flanker 箭头 / switch 颜色-形状换规则 / nogo ★ 别按。
// 导入时不碰 DOM：normParams / generate / scoreTrial / summarize / buildDisplay 都是纯函数，可在 node 里自测。

import { makeRng, h, s, wait, progressHead, flash, isMobile, AbortedError, mean, median, round } from '../core/gamekit.js';

const ID = 'storm';
const NAME = '规则风暴';
export const TASKS = ['stroop', 'flanker', 'switch', 'nogo'];
export const COLORS = [
  { name: '红', hex: '#d62828' },
  { name: '绿', hex: '#1f9d3a' },
  { name: '蓝', hex: '#1f5fd1' },
  { name: '黄', hex: '#e2b100' },
];
const SW_COLOR = [0, 2];          // switch 任务：0=红，1=蓝（COLORS 下标）
const SHAPE_NAME = ['圆', '方'];
const ARROW = ['←', '→'];         // 0=左，1=右
export const ANTICIPATION_MS = 150;
export const HIDDEN_RUN = [5, 9];  // 静默切换：每段 5–9 个 switch 试次后悄悄换规则
export const NOGO_FALLBACK_PCT = 20; // tasks 含 nogo 但 nogoPct=0 时用
const ADAPT_STREAK = 3;
const DIST_SHAPES = ['●', '■', '▲', '◆', '✚', '◯']; // 不含 ★，避免和 nogo 信号混淆

const DEFAULTS = {
  tasks: ['flanker', 'stroop'],
  trials: 40,
  responseWindowMs: 1600,
  itiMs: 500,
  incongruentPct: 50,
  switchPct: 30,
  nogoPct: 0,
  hiddenSwitch: false,
  distractors: false,
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
  let raw = Array.isArray(q.tasks) ? q.tasks : (typeof q.tasks === 'string' ? q.tasks.split(/[,+\s]+/) : []);
  let tasks = TASKS.filter((t) => raw.includes(t));
  if (!tasks.length) tasks = DEFAULTS.tasks.slice();
  return {
    tasks,
    trials: clampInt(q.trials, 20, 200, DEFAULTS.trials),
    responseWindowMs: clampInt(q.responseWindowMs, 500, 3000, DEFAULTS.responseWindowMs),
    itiMs: clampInt(q.itiMs, 200, 1500, DEFAULTS.itiMs),
    incongruentPct: clampInt(q.incongruentPct, 0, 100, DEFAULTS.incongruentPct),
    switchPct: clampInt(q.switchPct, 0, 100, DEFAULTS.switchPct),
    nogoPct: clampInt(q.nogoPct, 0, 40, DEFAULTS.nogoPct),
    hiddenSwitch: toBool(q.hiddenSwitch, false),
    distractors: toBool(q.distractors, false),
    showFeedback: toBool(q.showFeedback, true),
  };
}

// 按配额生成 m 个布尔，true 的个数 = m*pct/100 的随机取整（整批无偏），打乱
function quota(m, pct, rng) {
  const x = (m * pct) / 100;
  const k = Math.floor(x) + (rng.chance(x - Math.floor(x)) ? 1 : 0);
  const a = [];
  for (let j = 0; j < m; j++) a.push(j < k);
  return rng.shuffle(a);
}

function makeDistract(rng) {
  const items = [];
  const cnt = rng.int(2, 4);
  for (let k = 0; k < cnt; k++) {
    const ang = rng.float(0, Math.PI * 2);
    const r = rng.float(36, 46);
    items.push({
      x: round(50 + r * Math.cos(ang), 1),
      y: round(50 + r * 0.9 * Math.sin(ang), 1),
      shape: rng.pick(DIST_SHAPES),
      color: rng.chance(0.75) ? rng.pick(COLORS).hex : '#777777',
      delayMs: rng.int(0, 500),
      durMs: rng.int(150, 350),
    });
  }
  return { items, shake: rng.chance(0.3), shakeDelayMs: rng.int(0, 300) };
}

// 纯函数：生成一组试次（含正确答案）
export function generate(params, rng) {
  const p = normParams(params);
  const n = p.trials;
  let base = p.tasks.filter((t) => t !== 'nogo');
  if (!base.length) base = ['flanker'];      // 只选了 nogo：以箭头为底
  const hidden = p.hiddenSwitch && base.includes('switch');
  const nogoPct = p.tasks.includes('nogo') ? (p.nogoPct > 0 ? p.nogoPct : NOGO_FALLBACK_PCT) : 0;

  // 任务均衡分配后打乱
  const order = [];
  const baseMix = rng.shuffle(base);   // 除不尽时多出来的试次随机给某个任务
  for (let i = 0; i < n; i++) order.push(baseMix[i % baseMix.length]);
  const taskOf = rng.shuffle(order);
  const idx = { stroop: [], flanker: [], switch: [] };
  taskOf.forEach((t, i) => idx[t].push(i));

  const trials = new Array(n);

  const incS = quota(idx.stroop.length, p.incongruentPct, rng);
  idx.stroop.forEach((i, j) => {
    const ink = rng.int(0, 3);
    const inc = incS[j];
    const word = inc ? rng.pick([0, 1, 2, 3].filter((x) => x !== ink)) : ink;
    trials[i] = { task: 'stroop', word, ink, congruent: !inc, correctResp: ink };
  });

  const incF = quota(idx.flanker.length, p.incongruentPct, rng);
  idx.flanker.forEach((i, j) => {
    const center = rng.int(0, 1);
    const inc = incF[j];
    const flank = inc ? 1 - center : center;
    const arrows = ARROW[flank] + ARROW[flank] + ARROW[center] + ARROW[flank] + ARROW[flank];
    trials[i] = { task: 'flanker', center, flank, arrows, congruent: !inc, correctResp: center };
  });

  const m = idx.switch.length;
  let swFlags;
  if (!hidden) {
    swFlags = [false, ...quota(Math.max(0, m - 1), p.switchPct, rng)].slice(0, m);
  } else {
    swFlags = [];
    let left = rng.int(HIDDEN_RUN[0], HIDDEN_RUN[1]);
    for (let j = 0; j < m; j++) {
      if (j > 0 && left === 0) { swFlags.push(true); left = rng.int(HIDDEN_RUN[0], HIDDEN_RUN[1]); }
      else swFlags.push(false);
      left--;
    }
  }
  let rule = rng.pick(['color', 'shape']);
  idx.switch.forEach((i, j) => {
    const sw = swFlags[j];
    if (sw) rule = rule === 'color' ? 'shape' : 'color';
    const color = rng.int(0, 1);
    // 静默切换后的第一个试次必须两条规则答案不同，否则切换无从察觉
    const shape = hidden && sw ? 1 - color : rng.int(0, 1);
    trials[i] = {
      task: 'switch', color, shape, rule,
      switch: sw, swFirst: j === 0,
      ruleCongruent: color === shape,
      cue: !hidden,
      congruent: null,
      correctResp: rule === 'color' ? color : shape,
    };
  });

  for (let i = 0; i < n; i++) {
    const t = trials[i];
    if (t.switch === undefined) t.switch = false;
    t.nogo = false;
    t.taskSwitch = i > 0 && trials[i - 1].task !== t.task;
  }

  // nogo：第 1 个试次不放；静默切换点不放
  if (nogoPct > 0) {
    const cand = [];
    for (let i = 1; i < n; i++) if (!(hidden && trials[i].switch)) cand.push(i);
    const x = ((n - 1) * nogoPct) / 100;
    const k = Math.min(cand.length, Math.floor(x) + (rng.chance(x - Math.floor(x)) ? 1 : 0));
    for (const i of rng.shuffle(cand).slice(0, k)) {
      trials[i].nogo = true;
      trials[i].goResp = trials[i].correctResp;
      trials[i].correctResp = -1;
    }
  }

  if (p.distractors) for (const t of trials) t.distract = makeDistract(rng);

  return { trials, n, base, hidden, nogoPct, params: p };
}

export function stimLabel(t) {
  if (t.task === 'stroop') return `${COLORS[t.word].name}字${COLORS[t.ink].name}墨`;
  if (t.task === 'flanker') return t.arrows;
  return `${COLORS[SW_COLOR[t.color]].name}${SHAPE_NAME[t.shape]}`;
}

// 纯函数：一个试次的计分记录。resp=-1 表示没按；prePress=刺激出现前的间隔里按过键
export function scoreTrial(t, i, resp, rtMs, prePress) {
  const responded = resp >= 0;
  const anticipation = responded && rtMs < ANTICIPATION_MS;
  let correct, timeout = false;
  if (t.nogo) correct = !responded;
  else { timeout = !responded; correct = responded && !anticipation && resp === t.correctResp; }
  const rec = {
    i, task: t.task, stim: stimLabel(t),
    congruent: t.congruent, switch: !!t.switch, nogo: !!t.nogo,
    correctResp: t.correctResp, resp, correct,
    rtMs: responded ? rtMs : null,
    anticipation, timeout, prePress: !!prePress,
  };
  if (t.task === 'switch') { rec.rule = t.rule; rec.ruleCongruent = t.ruleCongruent; rec.swFirst = t.swFirst; }
  if (t.distract) rec.distract = true;
  return rec;
}

function adaptTrials(recs) {
  const seq = recs.filter((r) => r.task === 'switch' && !r.nogo);
  const out = [];
  for (let a = 0; a < seq.length; a++) {
    if (!seq[a].switch) continue;
    let b = a + 1;
    while (b < seq.length && !seq[b].switch) b++;
    const run = seq.slice(a, b);
    let k = -1;
    for (let j = 0; j + ADAPT_STREAK - 1 < run.length; j++) {
      let ok = true;
      for (let d = 0; d < ADAPT_STREAK; d++) if (!run[j + d].correct) { ok = false; break; }
      if (ok) { k = j; break; }
    }
    if (k >= 0) out.push(k);
    else if (b < seq.length) out.push(run.length); // 整段都没适应（截尾值）
  }
  return out;
}

// 纯函数：gen 只需 {base, hidden, nogoPct}
export function summarize(recs, gen) {
  const n = recs.length;
  const nCorrect = recs.filter((r) => r.correct).length;
  const ok = (r) => !r.nogo && r.correct && !r.anticipation && r.rtMs != null;
  const rts = recs.filter(ok).map((r) => r.rtMs);

  const costs = [], weights = [];
  for (const t of ['stroop', 'flanker']) {
    const c = recs.filter((r) => r.task === t && ok(r) && r.congruent === true).map((r) => r.rtMs);
    const ic = recs.filter((r) => r.task === t && ok(r) && r.congruent === false).map((r) => r.rtMs);
    if (c.length && ic.length) { costs.push(median(ic) - median(c)); weights.push(c.length + ic.length); }
  }
  const wsum = weights.reduce((a, b) => a + b, 0);
  const interference = costs.length ? Math.round(costs.reduce((a, c, k) => a + c * weights[k], 0) / wsum) : null;

  const goCI = recs.filter((r) => (r.task === 'stroop' || r.task === 'flanker') && !r.nogo);
  const errRate = (a) => (a.length ? a.filter((r) => !r.correct).length / a.length : null);
  const eI = errRate(goCI.filter((r) => r.congruent === false));
  const eC = errRate(goCI.filter((r) => r.congruent === true));

  let switchCost = null;
  if (!gen.hidden) {
    const sw = recs.filter((r) => r.task === 'switch' && ok(r));
    const s1 = sw.filter((r) => r.switch).map((r) => r.rtMs);
    const s0 = sw.filter((r) => !r.switch && !r.swFirst).map((r) => r.rtMs);
    if (s1.length && s0.length) switchCost = Math.round(median(s1) - median(s0));
  }

  const ng = recs.filter((r) => r.nogo);
  const half = Math.floor(n / 2);
  const accOf = (a) => (a.length ? round(a.filter((r) => r.correct).length / a.length, 3) : null);
  const adapt = gen.hidden ? adaptTrials(recs) : [];

  const tag = gen.base.join('+') + (gen.nogoPct > 0 ? '+nogo' : '') + (gen.hidden ? '+hidden' : '');
  return {
    tasks: tag,
    n_trials: n,
    n_correct: nCorrect,
    acc: n ? round(nCorrect / n, 3) : null,
    rt_median_ms: rts.length ? Math.round(median(rts)) : null,
    interference_cost_ms: interference,
    interference_err_diff: eI != null && eC != null ? round(eI - eC, 3) : null,
    switch_cost_ms: switchCost,
    nogo_false_alarm_rate: ng.length ? round(ng.filter((r) => r.resp >= 0).length / ng.length, 3) : null,
    timeouts: recs.filter((r) => r.timeout).length,
    anticipations: recs.filter((r) => r.anticipation || r.prePress).length,
    acc_first_half: half >= 1 ? accOf(recs.slice(0, half)) : null,
    acc_second_half: half >= 1 ? accOf(recs.slice(half)) : null,
    hidden_switch_adapt_trials: adapt.length ? round(mean(adapt), 1) : null,
  };
}

export function buildDisplay(sm, gen) {
  const ms = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${x} ms`);
  const d = [['正确率', sm.n_trials ? `${sm.n_correct}/${sm.n_trials}（${Math.round((sm.acc || 0) * 100)}%）` : '—']];
  d.push(['中位反应时', sm.rt_median_ms == null ? '—' : `${sm.rt_median_ms} ms`]);
  if (gen.base.includes('stroop') || gen.base.includes('flanker')) d.push(['冲突代价', ms(sm.interference_cost_ms)]);
  if (gen.base.includes('switch')) {
    if (gen.hidden) d.push(['静默换规则后适应', sm.hidden_switch_adapt_trials == null ? '—' : `平均 ${sm.hidden_switch_adapt_trials} 次`]);
    else d.push(['切换代价', ms(sm.switch_cost_ms)]);
  }
  if (gen.nogoPct > 0 && d.length < 5) d.push(['★ 误按', sm.nogo_false_alarm_rate == null ? '—' : `${Math.round(sm.nogo_false_alarm_rate * 100)}%`]);
  return d;
}

const CSS = `
.st-wrap{display:flex;flex-direction:column;gap:8px;width:100%;max-width:640px;margin:0 auto;padding:0 0 8px;box-sizing:border-box;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}
.st-stage{position:relative;height:min(44vh,340px);min-height:210px;background:var(--card);border:1px solid var(--line);border-radius:14px;overflow:hidden;display:flex;align-items:center;justify-content:center}
.st-center{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;max-width:100%}
.st-cue{min-height:1.5em;font-size:clamp(16px,4.6vw,22px);font-weight:700;color:var(--accent);padding:2px 14px;border-radius:999px;background:rgba(0,0,0,.05)}
.st-cue.st-off{visibility:hidden}
.st-star{font-size:clamp(28px,9vw,44px);line-height:1;color:#f08c00;visibility:hidden}
.st-star.st-on{visibility:visible}
.st-stim{min-height:clamp(84px,27vw,140px);display:flex;align-items:center;justify-content:center}
.st-word{font-size:clamp(64px,22vw,120px);font-weight:800;line-height:1}
.st-word.st-yel{-webkit-text-stroke:1.5px rgba(0,0,0,.28)}
.st-arrows{font-size:clamp(36px,11.5vw,72px);font-weight:700;letter-spacing:.04em;white-space:nowrap;color:var(--fg);line-height:1}
.st-shape{width:clamp(90px,28vw,140px);height:clamp(90px,28vw,140px)}
.st-fix{font-size:40px;color:var(--muted);line-height:1}
.st-dist{position:absolute;inset:0;pointer-events:none;z-index:0}
.st-dot{position:absolute;transform:translate(-50%,-50%);font-size:clamp(22px,7vw,36px);line-height:1;opacity:0;animation-name:st-blink;animation-iteration-count:2;animation-timing-function:linear;animation-fill-mode:both}
@keyframes st-blink{0%,45%{opacity:1}50%,100%{opacity:0}}
.st-shake{animation:st-shake 280ms ease-in-out 1 both}
@keyframes st-shake{0%,100%{transform:translateX(0)}20%{transform:translateX(-9px)}40%{transform:translateX(8px)}60%{transform:translateX(-5px)}80%{transform:translateX(4px)}}
.st-overlay{position:absolute;inset:0;z-index:3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:color-mix(in srgb,var(--card) 95%,transparent);text-align:center;padding:12px;box-sizing:border-box}
.st-overlay[hidden]{display:none}
.st-count{font-size:clamp(48px,16vw,84px);font-weight:800;color:var(--fg);line-height:1}
.st-rules{font-size:14px;color:var(--muted);line-height:1.6;max-width:30em}
.st-hint{min-height:2.8em;margin:0;text-align:center;font-size:13px;line-height:1.4}
.st-resp{display:grid;gap:10px}
.st-resp[hidden]{display:none}
.st-four{grid-template-columns:repeat(4,minmax(0,1fr))}
.st-two{grid-template-columns:repeat(2,minmax(0,1fr))}
.st-wrap .st-btn{min-height:68px;margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;font-size:20px;font-weight:700;touch-action:manipulation;border-radius:12px;padding:6px 4px;transition:transform 60ms;min-width:0}
.st-wrap .st-two .st-btn{min-height:78px;font-size:24px}
.st-wrap .st-color{background:var(--st-c);border-color:var(--st-c);color:#fff}
.st-wrap .st-color.st-yel{color:#3a2a00}
.st-key{font-size:11px;font-weight:400;opacity:.75}
.st-wrap .st-btn.st-press{transform:scale(.95)}
@media (max-width:360px){.st-wrap .st-btn{min-height:62px;font-size:18px}.st-wrap .st-two .st-btn{min-height:70px;font-size:21px}}
`;

function injectStyle() {
  if (document.getElementById(`style-${ID}`)) return;
  const st = document.createElement('style');
  st.id = `style-${ID}`;
  st.textContent = CSS;
  document.head.append(st);
}

const HINT = {
  stroop: '按字的<b>墨水颜色</b>，别管字义',
  flanker: '按<b>中间</b>那个箭头的方向',
  switch: '看颜色：红←　蓝→；看形状：圆←　方→',
  switchHidden: '规则不提示、会悄悄换：靠对错反馈猜现在看颜色还是形状',
};
const KEYS = {
  four: { 1: 0, 2: 1, 3: 2, 4: 3, d: 0, f: 1, j: 2, k: 3 },
  two: { arrowleft: 0, arrowright: 1, f: 0, j: 1 },
};
const ALL_KEYS = new Set([...Object.keys(KEYS.four), ...Object.keys(KEYS.two)]);

export default {
  id: ID,
  name: NAME,
  line: 'storm',
  casual: false,
  blurb: '颜色字、箭头、换规则、★别按：又快又准，不被干扰带跑。',
  aiDescription:
    '规则风暴，练干扰控制与任务切换，仅认真模式。限时刺激流：stroop 按字的墨色（4键）；flanker 按中间箭头方向；switch 按提示“看颜色/看形状”判红蓝圆方；nogo 叠加规则，带★不按。' +
    '参数：tasks 可混合；nogoPct 为★比例（开 nogo 但填0按20%）；responseWindowMs 越短越难；incongruentPct 冲突比例；switchPct 换规则比例；hiddenSwitch 不给提示、规则每5–9个switch试次悄悄换，强制反馈；distractors 周围闪图形并抖动。' +
    'summary：rt_median_ms 正确试次中位反应时；interference_cost_ms/interference_err_diff 为冲突减一致的反应时差与错误率差，switch_cost_ms 为切换减重复，越小抗干扰和切换越好；nogo_false_alarm_rate 低=冲动控制好；anticipations 为<150ms或提前按；acc_second_half 不低于前半=专注稳定；hidden_switch_adapt_trials 为静默换规则后到连续3次答对前的试次数，越小越灵活。',
  defaults: { ...DEFAULTS, tasks: DEFAULTS.tasks.slice() },
  paramSpec: {
    tasks: { type: 'set', options: TASKS.slice(), desc: '启用的任务，多选时随机混合；nogo 是叠加在其他任务上的“★ 别按”开关（只选 nogo 时以箭头为底）' },
    trials: { type: 'int', min: 20, max: 200, desc: '本组试次数' },
    responseWindowMs: { type: 'int', min: 500, max: 3000, desc: '每个刺激最长显示时间（毫秒），超时算漏按；越短越难' },
    itiMs: { type: 'int', min: 200, max: 1500, desc: '两个刺激之间的空白间隔（毫秒），越短节奏越紧' },
    incongruentPct: { type: 'int', min: 0, max: 100, desc: 'stroop/flanker 中冲突试次（字义≠墨色、两侧箭头反向）的比例 %' },
    switchPct: { type: 'int', min: 0, max: 100, desc: 'switch 任务中规则相对上一个 switch 试次改变的比例 %（静默模式不用）' },
    nogoPct: { type: 'int', min: 0, max: 40, desc: 'tasks 含 nogo 时带 ★ 的试次比例 %；0 时按 20%' },
    hiddenSwitch: { type: 'bool', desc: 'true=switch 任务不显示规则提示，规则每 5–9 个 switch 试次悄悄换，靠反馈推断；高难度用' },
    distractors: { type: 'bool', desc: 'true=刺激周围随机闪烁图形、刺激偶尔抖动（无声音）' },
    showFeedback: { type: 'bool', desc: '每次反应后闪一下对错；hiddenSwitch 时强制打开' },
  },

  async run(root, ctx) {
    const signal = ctx.signal;
    injectStyle();
    const gen = generate(ctx.params, makeRng(ctx.seed));
    const p = gen.params;
    const total = gen.n;
    const feedbackOn = p.showFeedback || gen.hidden;
    const desk = !isMobile();

    // ---------- DOM ----------
    root.innerHTML = '';
    const head = progressHead(NAME);
    head.set(0, total, `0/${total}`);
    const cue = h('div', { class: 'st-cue st-off' }, '');
    const star = h('div', { class: 'st-star' }, '★');
    const stim = h('div', { class: 'st-stim' });
    const center = h('div', { class: 'st-center' }, cue, stim, star);
    const dist = h('div', { class: 'st-dist' });
    const overlay = h('div', { class: 'st-overlay' });
    const stage = h('div', { class: 'st-stage' }, dist, center, overlay);
    const hint = h('div', { class: 'g-note st-hint' });

    const fourBtns = COLORS.map((c, k) => h('button', {
      class: 'g-btn st-btn st-color' + (k === 3 ? ' st-yel' : ''), type: 'button', style: `--st-c:${c.hex}`,
    }, h('span', null, c.name), desk ? h('span', { class: 'st-key' }, `${k + 1} / ${'DFJK'[k]}`) : null));
    const twoLabels = [h('span'), h('span')];
    const twoBtns = [0, 1].map((k) => h('button', { class: 'g-btn st-btn', type: 'button' },
      twoLabels[k], desk ? h('span', { class: 'st-key' }, k ? '→ / J' : '← / F') : null));
    const rowFour = h('div', { class: 'st-resp st-four', hidden: true }, fourBtns);
    const rowTwo = h('div', { class: 'st-resp st-two' }, twoBtns);
    root.append(h('div', { class: 'st-wrap' }, head.el, stage, hint, rowFour, rowTwo));

    // ---------- 输入 ----------
    let phase = 'idle';     // idle | prep | stim | iti
    let pending = null;     // {set, t0, timer, resolve}
    let early = false;
    let itiStart = 0;
    const press = (btn) => {
      btn.classList.remove('st-press'); void btn.offsetWidth; btn.classList.add('st-press');
      setTimeout(() => btn.classList.remove('st-press'), 120);
    };
    const markEarly = () => { if (phase === 'iti' && performance.now() - itiStart > 120) early = true; };
    const give = (set, index) => {
      if (phase === 'iti') { markEarly(); return; }
      if (phase !== 'stim' || !pending || pending.set !== set) return;
      const t = performance.now();
      const r = pending; pending = null;
      clearTimeout(r.timer);
      r.resolve({ index, rtMs: Math.round(t - r.t0) });
    };
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = (e.key || '').toLowerCase();
      if (!ALL_KEYS.has(k) || phase === 'idle') return;
      e.preventDefault();
      if (e.repeat) return;
      if (phase === 'iti') { markEarly(); return; }
      if (phase === 'stim' && pending) {
        const i = KEYS[pending.set][k];
        if (i !== undefined) { press(pending.set === 'four' ? fourBtns[i] : twoBtns[i]); give(pending.set, i); }
      }
    };
    const btnHandlers = [];
    const bind = (btns, set) => btns.forEach((b, i) => {
      const fn = (e) => { e.preventDefault(); if (phase === 'idle') return; press(b); give(set, i); };
      b.addEventListener('pointerdown', fn);
      btnHandlers.push([b, fn]);
    });
    bind(fourBtns, 'four');
    bind(twoBtns, 'two');
    window.addEventListener('keydown', onKey);

    const waitResp = (set, t0, ms) => new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new AbortedError());
      const onAbort = () => {
        if (pending) { clearTimeout(pending.timer); pending = null; }
        reject(new AbortedError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      const fin = (v) => { signal?.removeEventListener('abort', onAbort); resolve(v); };
      pending = { set, t0, resolve: fin, timer: null };
      pending.timer = setTimeout(() => {
        if (pending) { pending = null; fin({ index: -1, rtMs: null }); }
      }, Math.max(0, t0 + ms - performance.now()));
    });
    const nextFrame = () => new Promise((res) => {
      let done = false;
      const f = () => { if (!done) { done = true; res(); } };
      try { requestAnimationFrame(f); } catch { /* ignore */ }
      setTimeout(f, 50);
    });

    // ---------- 画面 ----------
    const clearStim = () => {
      stim.innerHTML = '';
      stim.append(h('span', { class: 'st-fix' }, '+'));
      cue.classList.add('st-off');
      star.classList.remove('st-on');
      center.classList.remove('st-shake');
      dist.innerHTML = '';
    };
    const setButtons = (t) => {
      const four = t.task === 'stroop';
      rowFour.hidden = !four; rowTwo.hidden = four;
      if (t.task === 'flanker') { twoLabels[0].textContent = '←'; twoLabels[1].textContent = '→'; }
      else if (t.task === 'switch') { twoLabels[0].textContent = '红 · 圆'; twoLabels[1].textContent = '蓝 · 方'; }
    };
    const renderTrial = (t) => {
      stim.innerHTML = '';
      if (t.task === 'stroop') {
        stim.append(h('span', { class: 'st-word' + (t.ink === 3 ? ' st-yel' : ''), style: `color:${COLORS[t.ink].hex}` }, COLORS[t.word].name));
      } else if (t.task === 'flanker') {
        stim.append(h('span', { class: 'st-arrows' }, t.arrows));
      } else {
        const fill = COLORS[SW_COLOR[t.color]].hex;
        stim.append(s('svg', { viewBox: '0 0 100 100', class: 'st-shape' },
          t.shape === 0 ? s('circle', { cx: 50, cy: 50, r: 42, fill }) : s('rect', { x: 10, y: 10, width: 80, height: 80, rx: 6, fill })));
      }
      if (t.task === 'switch') {
        cue.textContent = t.cue ? (t.rule === 'color' ? '看颜色' : '看形状') : '规则？';
        cue.classList.remove('st-off');
      } else {
        cue.classList.add('st-off');
      }
      star.classList.toggle('st-on', !!t.nogo);
      setButtons(t);
      let ht = t.task === 'switch' ? (gen.hidden ? HINT.switchHidden : HINT.switch) : HINT[t.task];
      if (gen.nogoPct > 0) ht += '；出现 <b>★</b> 不要按';
      hint.innerHTML = ht;
      if (t.distract) {
        for (const d of t.distract.items) {
          dist.append(h('span', {
            class: 'st-dot',
            style: `left:${d.x}%;top:${d.y}%;color:${d.color};animation-delay:${d.delayMs}ms;animation-duration:${d.durMs}ms`,
          }, d.shape));
        }
        if (t.distract.shake) {
          center.style.animationDelay = `${t.distract.shakeDelayMs}ms`;
          void center.offsetWidth;
          center.classList.add('st-shake');
        }
      }
    };
    const fbText = (r) => {
      if (r.anticipation) return '太早';
      if (r.nogo) return r.correct ? '✓' : '★ 不要按';
      if (r.timeout) return '太慢';
      return r.correct ? '✓' : '✗';
    };

    const cleanup = () => {
      window.removeEventListener('keydown', onKey);
      for (const [b, fn] of btnHandlers) b.removeEventListener('pointerdown', fn);
      if (pending) { clearTimeout(pending.timer); pending = null; }
      phase = 'idle';
      dist.innerHTML = '';
    };

    const recs = [];
    try {
      if (signal?.aborted) throw new AbortedError();
      // ---------- 3 秒倒计时 + 规则 ----------
      const rules = [];
      if (gen.base.includes('stroop')) rules.push('颜色字：按墨水颜色');
      if (gen.base.includes('flanker')) rules.push('箭头：按中间那个');
      if (gen.base.includes('switch')) rules.push(gen.hidden ? '圆方红蓝：规则不提示，会悄悄换' : '圆方红蓝：按上方提示的规则');
      if (gen.nogoPct > 0) rules.push('带 ★ 的不要按');
      const num = h('div', { class: 'st-count' }, '3');
      overlay.append(num, h('div', { class: 'st-rules' }, rules.join('　·　')));
      clearStim();
      if (total) setButtons(gen.trials[0]);
      hint.textContent = '又快又准。准备好手指。';
      for (let k = 3; k >= 1; k--) { num.textContent = String(k); await wait(1000, signal); }
      overlay.hidden = true;
      phase = 'iti'; itiStart = performance.now(); early = false;
      await wait(400, signal);

      for (let i = 0; i < total; i++) {
        const t = gen.trials[i];
        phase = 'prep';
        const pre = early; early = false;
        renderTrial(t);
        await nextFrame();
        if (signal?.aborted) throw new AbortedError();
        const set = t.task === 'stroop' ? 'four' : 'two';
        const t0 = performance.now();
        phase = 'stim';
        const res = await waitResp(set, t0, p.responseWindowMs);
        phase = 'iti'; itiStart = performance.now(); early = false;
        clearStim();
        const rec = scoreTrial(t, i, res.index, res.rtMs, pre);
        recs.push(rec);
        head.set(i + 1, total, `${i + 1}/${total}`);
        if (feedbackOn) flash(stage, rec.correct, fbText(rec), signal, Math.min(450, Math.max(180, p.itiMs - 40))).catch(() => {});
        await wait(i < total - 1 ? p.itiMs : Math.min(p.itiMs, 450), signal);
      }
    } catch (e) {
      if (!(e instanceof AbortedError) && !signal?.aborted) { cleanup(); throw e; }
    }
    cleanup();

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
