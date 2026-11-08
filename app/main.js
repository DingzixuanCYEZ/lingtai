// 首页（段位 + 今日清单 + 跟教练说）→ 开局页 → 游戏 → 复盘页 → 判定页。记录、设置在 pages.js，导航和小部件在 ui.js。

import { h } from './core/gamekit.js';
import { LINES, LINE_IDS, rankLabel, xpCap, xpShow, XP_SCALE, TOTAL_STARS } from './core/ranks.js';
import { getState, save, today, dayKey, hhmm, initSync, onSyncChange, syncStatus, markDeleted } from './core/store.js';
import { ensurePlan, judge, talk, explain, fullParams, lineState, totalNow } from './core/coach.js';
import { canCall } from './core/api.js';
import { applyDisplay, rootClasses, gamePrefs, withPrefs, prefSummary } from './core/prefs.js';
import {
  GAMES, gameById, pages, go, back, goHome, startRouter, shell, playShell,
  card, btn, actions, kv, modeName, armedBtn, waiting, waitNote, aiTask, costLine, prefsBlock,
} from './ui.js';
import { historyPage, settingsPage } from './pages.js';
import { renderBlocks } from './blocks.js';

const KEEP_TRIALS = 50; // 只保留最近 50 组的逐题明细，防止本地存储撑满

const toPrepare = (opt, replace = false) => go('#/prepare', (sg) => prepare(opt, sg), { replace });
const toFeedback = (s, replace = false) => go('#/feedback', (sg) => feedbackPage(s, sg), { replace });

export function lineCard(id) {
  const L = getState().lines[id];
  const cap = xpCap(id, L.rank);
  const ready = L.rank != null && L.xp >= cap;
  return h('div', { class: 'ui-line' },
    h('div', { class: 'ui-lname' }, `${LINES[id].name} · ${LINES[id].ladder}`),
    h('div', { class: 'ui-rank' + (L.rank == null ? ' unset' : '') },
      L.rank == null ? '未定级' : rankLabel(id, L.rank),
      L.unstable ? h('span', { class: 'ui-tag warn' }, '根基不稳') : null,
      ready ? h('span', { class: 'ui-tag hot' }, '可考核') : null),
    L.rank == null
      ? h('div', { class: 'ui-muted' }, '教练会先安排几组探底')
      : [h('div', { class: 'ui-xp' }, h('div', { style: `width:${Math.round((100 * L.xp) / cap)}%` })),
         h('div', { class: 'ui-muted', style: 'margin-top:4px' }, `修为 ${xpShow(L.xp)} / ${cap * XP_SCALE}`)]);
}

// 删掉一组（“这组不算”）：连同它在今日清单里打的勾
function discard(s) {
  const st = getState();
  st.sessions = st.sessions.filter((x) => x.id !== s.id);
  markDeleted('session', s.id);
  const day = st.days[s.day];
  if (s.markedDone && day?.done) day.done = day.done.filter((i) => i !== s.taskIndex);
  save();
}

// ---------- 首页 ----------

async function home(signal) {
  const st = getState();
  const d = today();
  const ok = await canCall();
  if (signal.aborted) return;
  const lines = LINE_IDS.filter((id) => GAMES.some((g) => g.line === id));
  const pending = st.sessions.filter((s) => !s.judgment);

  let pend = null;
  if (pending.length) {
    const s = pending[0];
    pend = card(
      h('div', null, `有 ${pending.length} 组还没判定（中途离开了，或者断网了）。`,
        h('span', { class: 'ui-muted' }, ` 最早的一组：${s.day} ${s.time} ${gameById(s.game)?.name || s.game}`)),
      actions(
        armedBtn('这组不算', '再点一次：删掉这组', () => { discard(s); goHome(); }),
        btn('写复盘并判定', () => toFeedback(s), true)));
  }

  const todayCard = card(h('h2', null, `今日清单 · ${dayKey()}`));
  const planBox = h('div');
  const planErr = h('div', { class: 'ui-err' });
  if (!ok) {
    todayCard.append(
      h('div', { class: 'ui-muted' }, '还没有 DeepSeek key。电脑上用 serve.mjs 启动并设置环境变量 DEEPSEEK_API_KEY；手机上在设置里填。'),
      actions(btn('去设置', () => go('#/settings', pages.settings), true)));
  } else if (!d.plan) {
    const ask = btn('请教练排今天的清单', async () => {
      planErr.textContent = '';
      ask.hidden = true;
      try {
        const p = await aiTask(planBox, '教练在排今天的清单……', signal, (sg) => ensurePlan(GAMES, { signal: sg }));
        if (p) { goHome(); return; }
      } catch (e) { planErr.textContent = e.message; ask.textContent = '重试'; }
      ask.hidden = false;
    }, true);
    todayCard.append(actions(ask), planBox, planErr);
  } else {
    const p = d.plan;
    if (p.greeting) todayCard.append(h('div', { style: 'margin-bottom:8px;line-height:1.6' }, p.greeting));
    p.tasks.forEach((t, i) => {
      const g = gameById(t.game);
      if (!g) return;
      const done = d.done.includes(i);
      todayCard.append(h('div', { class: 'ui-task' + (done ? ' done' : '') },
        h('div', { class: 'ui-tbody' },
          h('div', { class: 'ui-tname' }, `第 ${i + 1} 项 · ${g.name}`,
            h('span', { class: 'ui-tag' }, modeName(t.mode)),
            t.exam ? h('span', { class: 'ui-tag hot' }, '考核') : null),
          t.goal ? h('div', { class: 'ui-muted', style: 'margin-top:2px' }, t.goal) : null),
        h('button', { class: 'g-btn' + (done ? '' : ' primary'), onclick: () => toPrepare({ taskIndex: i }) }, done ? '再练' : '开始')));
    });
    if (!p.tasks.length) todayCard.append(h('div', { class: 'ui-muted' }, '清单是空的，可以自由练习，或者跟教练说一声让它重排。'));
    const allDone = p.tasks.length && d.done.length >= p.tasks.length;
    if (allDone) todayCard.append(h('div', { class: 'ui-banner', style: 'margin-top:10px' }, h('b', null, '今日清单完成'), p.free_note || '之后可以自由练习。'));
    else if (p.free_note) todayCard.append(h('div', { class: 'g-note', style: 'margin-top:8px' }, '清单做完以后：' + p.free_note));
  }

  const tot = totalNow();
  const noGame = LINE_IDS.filter((l) => !GAMES.some((g) => g.line === l)).map((l) => LINES[l].name);
  const ranks = card(
    h('h2', null, '段位',
      h('span', { class: 'ui-muted', style: 'font-weight:400;margin-left:8px' },
        `总段位 ${tot.label} ${'★'.repeat(tot.stars)}${'☆'.repeat(TOTAL_STARS - tot.stars)}`)),
    h('div', { class: 'ui-muted', style: 'margin:-4px 0 8px' }, tot.top
      ? `积分 ${tot.points}，已经到顶`
      : `积分 ${tot.points}，再 ${tot.need - tot.into} 分涨一颗星。每练一组按修为档位得分，定级、半步、突破另加。`),
    st.total.comment ? h('div', { style: 'margin-bottom:8px;line-height:1.7' }, `本周点评（${st.total.reviewedAt}）：${st.total.comment}`) : null,
    h('div', { class: 'ui-grid' }, ...lines.map(lineCard)),
    noGame.length ? h('div', { class: 'g-note', style: 'margin-top:8px' }, `${noGame.join('、')}线的游戏还在做。`) : null);

  const free = card(h('h2', null, '自由练习'),
    h('div', { class: 'g-row', style: 'justify-content:flex-start' },
      ...GAMES.map((g) => btn(g.name, () => toPrepare({ free: true, gameId: g.id })))));

  const sy = syncStatus();
  const unsafe = !sy.server && !sy.gist && st.sessions.length
    ? h('div', { class: 'ui-banner', style: 'text-align:left;padding:10px 14px' },
        '这台设备还没开同步，记录只存在这个浏览器里，清缓存就没了。去“设置 → 同步和存档”填 GitHub token，或者定期导出。')
    : null;
  shell(unsafe, pend, todayCard, ranks, ok ? free : null, ok ? talkCard(signal) : null, costLine());
}

function talkCard(signal) {
  const d = today();
  const log = h('div');
  const drawLog = () => log.replaceChildren(...(d.talks || []).slice(-3).flatMap((t) => [
    h('div', { class: 'ui-said' }, '你：' + t.text),
    h('div', { class: 'ui-reply' }, t.reply || '（教练没有回话）'),
    ...renderBlocks((t.blocks || []).filter((b) => b.type === 'demo')),
    t.prefs?.length ? h('div', { class: 'g-note', style: 'margin-top:4px' }, '已记进“我的偏好”：' + t.prefs.join('；')) : null,
  ]));
  drawLog();
  const ta = h('textarea', { rows: 3, placeholder: '想说什么都行：今天的状态、对安排的意见、你的习惯和喜好、哪句话没看懂……以后都适用的，教练会记进“我的偏好”。' });
  const box = h('div');
  const err = h('div', { class: 'ui-err' });
  const extra = h('div');
  const replan = btn('按刚才说的重排今天的清单', async () => {
    extra.replaceChildren();
    try {
      const p = await aiTask(box, '教练在重排……', signal, (sg) => ensurePlan(GAMES, { force: true, signal: sg }));
      if (p) { goHome(); return; }
    } catch (e) { err.textContent = e.message; }
    extra.replaceChildren(actions(replan));
  }, true);
  const send = btn('发送', async () => {
    const text = ta.value.trim();
    if (!text) return;
    err.textContent = '';
    extra.replaceChildren();
    send.hidden = true;
    try {
      const item = await aiTask(box, '教练在想……', signal, (sg) => talk(GAMES, text, { signal: sg }));
      if (item) {
        ta.value = '';
        drawLog();
        if (item.replan) extra.replaceChildren(actions(replan));
      }
    } catch (e) { err.textContent = e.message; }
    send.hidden = false;
  });
  return card(h('h2', null, '跟教练说'), log, h('label', { class: 'ui-field' }, ta), actions(send), box, err, extra);
}

// 教练写的话下面放“没看懂 / 问一句”：教练换个说法重讲；它改了练法就用 onNewDirection 替换
// choices：教练给的选项，点了等于把这句话发给教练；教练回话里的组件也画出来
function askAbout(where, quoted, signal, onNewDirection, choices = []) {
  const out = h('div');
  const box = h('div');
  const err = h('div', { class: 'ui-err' });
  const inp = h('input', { type: 'text', placeholder: '或者直接问，例如：为什么要这样练？' });
  const pick = (t) => run(t, true);
  const run = async (question, picked = false) => {
    err.textContent = '';
    row.hidden = true;
    try {
      const item = await aiTask(box, question ? '教练在想……' : '教练在换个说法……', signal,
        (sg) => explain(GAMES, { where, quoted: quoted(), question, picked }, { signal: sg }));
      if (item) {
        inp.value = '';
        out.append(
          question ? h('div', { class: 'ui-said' }, (picked ? '你选了：' : '你问：') + question) : null,
          h('div', { class: 'ui-reply' }, item.reply || '（教练没有回话）'),
          ...renderBlocks(item.blocks, { onChoice: pick }),
          item.newDirection && onNewDirection ? h('div', { class: 'g-note' }, '教练换了练法，上面已经改成新的。') : null,
          item.prefs?.length ? h('div', { class: 'g-note' }, '已记进“我的偏好”：' + item.prefs.join('；')) : null);
        if (item.newDirection && onNewDirection) onNewDirection(item.newDirection);
      }
    } catch (e) { err.textContent = e.message; }
    row.hidden = false;
  };
  const ask = btn('问', () => { if (inp.value.trim()) run(inp.value.trim()); });
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') ask.click(); });
  const row = h('div', { class: 'ui-ask-row' }, btn('没看懂', () => run('')), inp, ask);
  const first = choices.length ? renderBlocks([{ type: 'choices', options: choices }], { onChoice: pick }) : [];
  return h('div', { class: 'ui-ask' }, ...first, out, row, box, err);
}

// ---------- 开局页 ----------

function prepare(opt, signal) {
  const { taskIndex = null, free = false, gameId = null } = opt;
  const d = today();
  const task = taskIndex != null ? d.plan?.tasks[taskIndex] : null;
  const game = gameById(task ? task.game : gameId);
  if (!game) { goHome(); return; }
  const nx = d.next?.[game.id];
  const exam = !!(task && task.exam && lineState(game.line).exam_ready);
  // 考核按清单的参数；平时以上一组判定后给的 next 为准（比早上的清单新）
  const patch = exam ? { ...(nx?.params || {}), ...(task?.params || {}) } : { ...(task?.params || {}), ...(nx?.params || {}) };
  const params = fullParams(game, patch);
  let direction = exam ? task.direction : (nx?.direction || task?.direction || '');
  let mode = game.casual && task?.mode === 'casual' ? 'casual' : 'focus';
  const dirEl = h('div', { class: 'ui-dir' }, direction);
  const dirBox = h('div', null, h('h3', null, '这组怎么练'), dirEl);
  dirBox.hidden = !direction;
  // 组件跟着练法走：练法来自上一组判定就用判定里的演示，否则用清单里的
  const fromNext = !exam && !!nx?.direction;
  const demos = (fromNext ? nx.demos : task?.blocks?.filter((b) => b.type === 'demo')) || [];
  const choices = fromNext ? [] : (task?.blocks?.find((b) => b.type === 'choices')?.options || []);

  const seg = h('div', { class: 'ui-seg' });
  const drawSeg = () => seg.replaceChildren(...['focus', 'casual'].map((m) =>
    h('button', { class: 'g-btn' + (mode === m ? ' on' : ''), disabled: m === 'casual' && !game.casual, onclick: () => { mode = m; drawSeg(); } },
      m === 'focus' ? '认真（戴耳机、专心）' : '休闲（边吃边玩）')));
  drawSeg();

  // 具体情况（选填）：默认沿用今天上一组写的，点短语追加
  const lastSit = getState().sessions.filter((s) => s.day === dayKey()).at(-1)?.situation || '';
  const sit = h('input', { type: 'text', value: lastSit, placeholder: '选填，例如：在吃饭、单手拿手机、有点困' });
  const chips = h('div', { class: 'ui-chips' }, ...['在吃饭', '单手', '戴耳机', '外面吵', '有点累', '刚睡醒', '在路上'].map((w) =>
    h('button', { class: 'g-btn', onclick: () => {
      const v = sit.value.trim();
      if (!v.split(/[，,、\s]+/).includes(w)) sit.value = v ? v + '，' + w : w;
    } }, w)));

  const start = () => {
    const cfg = { game, params, mode, situation: sit.value.trim() || null, exam, free: !task, taskIndex: task ? taskIndex : null, goal: task?.goal || '', direction, origin: opt };
    go('#/play', (sg) => play(cfg, sg), { replace: true, reenter: pages.home });
  };

  shell(card(
    h('h2', null, task ? `今日清单第 ${taskIndex + 1} 项 · ${game.name}` : game.name,
      exam ? h('span', { class: 'ui-tag hot' }, '考核') : null,
      free || !task ? h('span', { class: 'ui-tag' }, '自由练习') : null),
    h('div', { class: 'ui-muted' }, game.blurb),
    task?.goal ? [h('h3', null, exam ? '这次考什么' : '这组想看到'), h('div', null, task.goal)] : null,
    dirBox,
    ...renderBlocks(demos),
    task?.goal || direction ? askAbout(`${game.name}开局页（“这组想看到”和“这组怎么练”）`,
      () => [task?.goal, direction].filter(Boolean).join(' / '), signal, (nd) => {
        direction = nd;
        dirEl.textContent = nd;
        dirBox.hidden = false;
        if (!exam && nx) nx.direction = nd; else if (task) task.direction = nd;
        save();
      }, choices) : null,
    h('h3', null, '模式'), seg,
    game.casual ? null : h('div', { class: 'g-note', style: 'margin-top:4px' }, '这个游戏只有认真模式。'),
    h('h3', null, '具体情况（选填）'), sit, chips,
    h('div', { class: 'g-note' }, '会跟这组记录一起存下来，教练判定时会参考。'),
    h('details', { style: 'margin-top:10px' },
      h('summary', { class: 'ui-muted' }, '显示设置（只改看着舒不舒服，不改难度）'),
      prefsBlock([game.id]),
      h('div', { class: 'g-note' }, '在“设置”里可以给所有游戏一起设。')),
    h('details', null, h('summary', { class: 'ui-muted' }, '本组参数'),
      h('pre', { class: 'g-note', style: 'white-space:pre-wrap' }, JSON.stringify(params, null, 1))),
    actions(btn('返回', back), btn('开始', start, true))));
}

// ---------- 游戏 ----------

async function play(cfg, signal) {
  const { game, mode } = cfg;
  const params = withPrefs(game, cfg.params); // 实时反馈按偏好改；其余参数照教练的
  const root = h('div', { class: [mode === 'casual' ? 'g-casual' : '', rootClasses(game.id)].filter(Boolean).join(' ') });
  const ac = new AbortController();
  const onLeave = () => ac.abort();
  signal.addEventListener('abort', onLeave, { once: true });
  const stop = btn('结束本组', () => { ac.abort(); stop.disabled = true; });
  playShell(h('div', { class: 'ui-play' }, root), actions(stop));

  const unlock = keepAwake();
  const ts = Date.now();
  const seed = (ts ^ Math.floor(Math.random() * 0x7fffffff)) & 0x7fffffff;
  let result;
  try {
    result = await game.run(root, { params, mode, seed, signal: ac.signal, prefs: gamePrefs(game.id) });
  } catch (e) {
    if (e && e.name === 'AbortedError') result = { aborted: true, trials: [], summary: { n_trials: 0, n_correct: 0 }, display: [], accuracy: null };
    else {
      if (signal.aborted) return;
      shell(card(h('h2', null, '游戏出错了'), h('div', { class: 'ui-err' }, String(e && e.stack || e)), actions(btn('回首页', goHome))));
      return;
    }
  } finally {
    signal.removeEventListener('abort', onLeave);
    unlock();
  }

  const left = signal.aborted; // 玩到一半按了后退
  const nDone = result.trials?.length || result.summary?.n_trials || 0;
  if (!nDone) {
    // 一题都没做：不记这组
    if (!left) toPrepare(cfg.origin, true);
    return;
  }

  const st = getState();
  const d = today();
  const session = {
    id: String(ts), day: dayKey(new Date(ts)), time: hhmm(new Date(ts)), ts,
    game: game.id, line: game.line, mode, situation: cfg.situation || null, exam: cfg.exam, free: cfg.free, taskIndex: cfg.taskIndex,
    params, seed, goal: cfg.goal, direction: cfg.direction,
    displayPrefs: prefSummary(game.id),
    result: { aborted: !!result.aborted, summary: result.summary, display: result.display, accuracy: result.accuracy, trials: result.trials, audioFailed: result.audioFailed },
    feedback: null, judgment: null,
  };
  st.sessions.push(session);
  if (!st.lastParams) st.lastParams = {};
  st.lastParams[game.id] = cfg.params;
  if (cfg.taskIndex != null && !result.aborted && !d.done.includes(cfg.taskIndex)) {
    d.done.push(cfg.taskIndex);
    session.markedDone = true;
  }
  for (let i = 0; i < st.sessions.length - KEEP_TRIALS; i++) delete st.sessions[i].result.trials;
  save();
  // 中途后退离开的，存成“未判定”，首页会提示
  if (!left) toFeedback(session, true);
  else if (location.hash === '#/') goHome();
}

// 玩的时候不让屏幕自己灭（手机放桌上边吃边玩）。切走再切回来要重新申请
function keepAwake() {
  const app = globalThis.LingtaiApp; // 安卓 App 版（开发/android）
  if (app) { app.keepScreenOn(true); return () => app.keepScreenOn(false); }
  if (!navigator.wakeLock) return () => {};
  let lock = null, done = false;
  const get = () => { if (!done && !document.hidden) navigator.wakeLock.request('screen').then((l) => { lock = l; }, () => {}); };
  document.addEventListener('visibilitychange', get);
  get();
  return () => { done = true; document.removeEventListener('visibilitychange', get); lock?.release().catch(() => {}); };
}

// ---------- 复盘页 ----------

function slider(label, init) {
  let val = init ?? null;
  const out = h('output', null, val == null ? '–' : String(val));
  const inp = h('input', { type: 'range', min: 0, max: 10, step: 1, value: val ?? 5, style: val == null ? 'opacity:.4' : null });
  const set = () => { val = Number(inp.value); out.textContent = val; inp.style.opacity = 1; };
  inp.addEventListener('input', set);
  inp.addEventListener('change', set);
  inp.addEventListener('pointerup', set);
  const clear = h('button', { class: 'ui-iconbtn ui-skip', onclick: () => { val = null; out.textContent = '–'; inp.style.opacity = 0.4; } }, '不填');
  return { el: h('div', { class: 'ui-field' }, h('span', null, label), h('div', { class: 'ui-slider' }, inp, out, clear)), get: () => val };
}

function feedbackPage(session, signal) {
  const st = getState();
  if (!st.sessions.some((x) => x.id === session.id)) { goHome(); return; }
  if (session.judgment) { verdictPage(session, signal); return; }
  const game = gameById(session.game);
  const f0 = session.feedback || {};

  const text = h('textarea', { class: 'ui-big', placeholder: '直接说就行，可以用语音输入。想到什么说什么，不用管顺序和措辞。' });
  text.value = f0.text || f0.note || '';
  const focus = slider('专注（0 走神 – 10 全神贯注）', f0.focus);
  const load = slider('负荷（0 轻松 – 10 快撑不住）', f0.load);
  const joy = slider('愉悦（0 煎熬 – 10 很爽）', f0.joy);
  const listId = 'roster-' + game.line;
  const strategy = h('input', { type: 'text', list: listId, value: f0.strategy || '', placeholder: game.line === 'wm' ? '比如：位置编码、默念、凭感觉……' : '这组用了什么方法' });
  const roster = h('datalist', { id: listId }, ...st.roster.filter((r) => r.line === game.line).map((r) => h('option', { value: r.name })));
  let compliance = f0.compliance || null;
  const seg = h('div', { class: 'ui-seg' });
  const drawSeg = () => seg.replaceChildren(...['按要求练了', '部分', '没按要求'].map((c) =>
    h('button', { class: 'g-btn' + (compliance === c ? ' on' : ''), onclick: () => { compliance = compliance === c ? null : c; drawSeg(); keep(); } }, c)));
  drawSeg();

  const collect = () => {
    const f = { text: text.value.trim() || null, focus: focus.get(), load: load.get(), joy: joy.get(), strategy: strategy.value.trim() || null, compliance };
    return Object.values(f).every((v) => v == null) ? null : f;
  };
  // 边写边存：后退、取消判定都不会丢
  let timer = null;
  const keep = () => { clearTimeout(timer); timer = setTimeout(() => { session.feedback = collect(); save(); }, 400); };
  text.addEventListener('input', keep);
  strategy.addEventListener('input', keep);
  for (const s of [focus, load, joy]) s.el.addEventListener('pointerup', keep);
  for (const s of [focus, load, joy]) s.el.addEventListener('click', keep);

  const hasPicked = [f0.focus, f0.load, f0.joy, f0.strategy, f0.compliance].some((v) => v != null);
  const submit = () => {
    clearTimeout(timer);
    session.feedback = collect();
    save();
    go('#/judge', (sg) => runJudge(session, sg), { replace: true, reenter: (sg) => feedbackPage(session, sg) });
  };

  shell(
    card(h('h2', null, `${game.name} · 本组结果`, session.result.aborted ? h('span', { class: 'ui-tag warn' }, '中途结束') : null),
      session.result.display?.length ? kv(session.result.display) : h('div', { class: 'ui-muted' }, '没有完成的题。')),
    card(h('h2', null, '复盘（都可以不填）'),
      session.direction ? h('div', { class: 'ui-dir' }, '这组的要求：' + session.direction) : null,
      h('div', { class: 'ui-hints' },
        '可以说说：累不累、专不专注、觉得难不难、心情怎么样；用了什么方法' +
        (session.direction ? '；有没有按上面的要求练' : '') +
        '；哪里卡住了、哪里顺。说到以后都适用的习惯和喜好，教练会记进“我的偏好”。'),
      h('label', { class: 'ui-field' }, text),
      h('details', { open: hasPicked },
        h('summary', { class: 'ui-muted' }, '也可以点选（选填，和上面说的一样算数）'),
        focus.el, load.el, joy.el,
        h('label', { class: 'ui-field' }, h('span', null, '用了什么策略'), strategy, roster),
        session.direction ? h('div', { class: 'ui-field' }, h('span', null, '有没有按要求练'), seg) : null),
      actions(
        armedBtn('这组不算', '再点一次：这组不算，删掉', () => { clearTimeout(timer); discard(session); go('#/', pages.home, { replace: true }); }),
        btn('提交，让教练判定', submit, true))));
}

// ---------- 判定 ----------

async function runJudge(session, signal) {
  const toFb = () => toFeedback(session, true);
  shell(card(waiting('教练在看这组……', toFb, waitNote(session.exam) + '取消后回到复盘页，写的东西都还在。')));
  try {
    await judge(GAMES, session, { signal, displayPrefs: session.displayPrefs || null });
  } catch (e) {
    if (signal.aborted || e?.name === 'AbortError') return;
    save();
    shell(card(h('h2', null, '这组还没判定'), h('div', { class: 'ui-err' }, e.message),
      h('div', { class: 'g-note' }, '成绩和复盘都存下了，也可以稍后在首页重新判定。'),
      actions(btn('回首页', goHome), btn('改复盘', toFb),
        btn('重试', () => go('#/judge', (sg) => runJudge(session, sg), { replace: true, reenter: (sg) => feedbackPage(session, sg) }), true))));
    return;
  }
  if (signal.aborted) return;
  go('#/verdict', (sg) => verdictPage(session, sg), { replace: true, reenter: (sg) => feedbackPage(session, sg) });
}

function verdictPage(session, signal) {
  const game = gameById(session.game);
  const j = session.judgment;
  const a = session.applied || { events: [], warn: [], xpGain: 0 };
  const d = today();
  const big = a.events.find((e) => e.startsWith('突破') || e.startsWith('定级'));
  const nextIdx = d.plan ? d.plan.tasks.findIndex((_, i) => !d.done.includes(i)) : -1;
  const again = session.free || nextIdx < 0 ? { free: true, gameId: game.id } : { taskIndex: session.taskIndex };
  const nextEl = h('div', { class: 'ui-dir' }, j.next?.direction || '');

  shell(
    big ? h('div', { class: 'ui-banner' },
      h('b', null, big.startsWith('突破') ? '突破' : '定级'),
      big.startsWith('突破') ? big.slice('突破！'.length) : big.slice('定级：'.length)) : null,
    card(
      h('div', { class: 'g-row', style: 'justify-content:flex-start;gap:16px' },
        h('div', { class: 'ui-grade g-' + j.grade }, j.grade),
        h('div', null,
          h('div', null, `${game.name} · ${modeName(session.mode)}${session.situation ? ` · ${session.situation}` : ''}`),
          h('div', { class: 'ui-muted' }, session.exam ? `考核：${j.exam_result?.result || '—'}` : `修为 ${j.xp_tier}${a.xpGain ? ` +${xpShow(a.xpGain)}` : ''}`),
          typeof a.points === 'number' ? h('div', { class: 'ui-muted' }, `总段位积分 +${a.points}`) : null,
          j.strategy_used ? h('span', { class: 'ui-tag', style: 'margin-left:0' }, j.strategy_used) : null)),
      h('div', { style: 'margin-top:12px;line-height:1.7' }, j.verdict),
      session.exam && j.exam_result?.reason ? h('div', { class: 'ui-muted', style: 'margin-top:6px' }, j.exam_result.reason) : null,
      a.events.filter((e) => e !== big).map((e) => h('div', { class: 'ui-muted', style: 'margin-top:6px' }, '· ' + e)),
      j.next?.direction ? [h('h3', null, '下一组怎么练'), nextEl] : null,
      ...renderBlocks((j.blocks || []).filter((b) => b.type === 'demo')),
      askAbout(`${game.name}这组的判定页（判词${j.next?.direction ? '和“下一组怎么练”' : ''}）`,
        () => [j.verdict, j.next?.direction].filter(Boolean).join(' / '), signal, j.next?.direction ? (nd) => {
          j.next.direction = nd;
          nextEl.textContent = nd;
          const nx = d.next?.[game.id];
          if (nx) nx.direction = nd;
          save();
        } : null, (j.blocks || []).find((b) => b.type === 'choices')?.options || []),
      j.feedback_digest ? h('div', { class: 'g-note', style: 'margin-top:8px' }, '教练从你的复盘里听到：' + j.feedback_digest) : null,
      j.prefs_add?.length ? h('div', { class: 'g-note' }, '已记进“我的偏好”：' + j.prefs_add.join('；')) : null,
      a.warn.length ? h('details', { style: 'margin-top:8px' }, h('summary', { class: 'g-note' }, `程序没执行的 ${a.warn.length} 项`), ...a.warn.map((w) => h('div', { class: 'g-note' }, w))) : null),
    card(lineCard(game.line)),
    actions(
      btn('回首页', goHome),
      btn('同一个再来一组', () => toPrepare(again)),
      nextIdx >= 0 ? btn(`下一项：${gameById(d.plan.tasks[nextIdx].game)?.name || ''}`, () => toPrepare({ taskIndex: nextIdx }), true) : null));
}

// ---------- 启动 ----------

// 同步带来了另一台设备的新记录：停在首页、没在打字时刷新首页（别的页面下次进来就是新的）
onSyncChange(({ changed }) => {
  if (!changed || !['', '#/'].includes(location.hash)) return;
  const typing = [...document.querySelectorAll('textarea, input[type=text]')].some((el) => el.value.trim() || el === document.activeElement);
  if (!typing && !document.querySelector('.ui-spin')) goHome(); // 教练在想的时候不打断
});

// 装到手机主屏幕、离线能打开（只在 https 的网页版上；电脑上 serve.mjs 开的不用）
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});

pages.home = home;
pages.history = historyPage;
pages.settings = settingsPage;
await initSync();
applyDisplay();
startRouter();
