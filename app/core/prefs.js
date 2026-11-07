// 显示偏好：只管看着舒不舒服（主题、字号、隐藏界面元素、音量），不改难度，教练也改不了。
// 判定时把和默认不同的几项告诉教练（display_prefs），方便它解读成绩。

import { getState, save } from './store.js';

const SHOW = [[true, '显示'], [false, '隐藏']];

export const DISPLAY_SPEC = [
  { key: 'theme', label: '主题', options: [['auto', '跟随系统'], ['light', '亮色'], ['dark', '暗色']], def: 'auto' },
  { key: 'font', label: '字号（游戏画面不变）', options: [['0.9', '小'], ['1', '中'], ['1.15', '大'], ['1.3', '特大']], def: '1' },
];

// 所有游戏共用的项。每个游戏可以单独改；没单独改就跟“所有游戏”。off：隐藏时给游戏外框加的 class
export const COMMON_SPEC = [
  { key: 'feedback', label: '实时对错反馈', options: [['coach', '听教练的'], ['on', '总是开'], ['off', '总是关']], def: 'coach' },
  { key: 'progress', label: '进度条', options: SHOW, def: true, off: 'p-noprogress' },
  { key: 'count', label: '第几题 / 共几题', options: SHOW, def: true, off: 'p-nocount' },
  { key: 'press', label: '按下时按钮动一下', options: SHOW, def: true, off: 'p-nopress' },
  { key: 'keys', label: '按键提示（电脑上）', options: SHOW, def: true, off: 'p-nokeys' },
  { key: 'hint', label: '画面下方的说明文字', options: SHOW, def: true, off: 'p-nohint' },
];

// 只有某个游戏才有的项
export const GAME_SPEC = {
  dnb: [
    { key: 'nlabel', label: '左上角的 N 值', options: SHOW, def: true, off: 'p-non' },
    { key: 'volume', label: '音量', range: [0, 100], def: 100 },
  ],
};

function bag() {
  const st = getState();
  if (!st.prefs) st.prefs = { display: {}, all: {}, games: {} };
  return st.prefs;
}

export function display() {
  const d = bag().display;
  return Object.fromEntries(DISPLAY_SPEC.map((s) => [s.key, d[s.key] ?? s.def]));
}

export function setDisplay(key, v) {
  bag().display[key] = v;
  save();
  applyDisplay();
}

export function applyDisplay() {
  const d = display();
  const el = document.documentElement;
  if (d.theme === 'auto') el.removeAttribute('data-theme');
  else el.dataset.theme = d.theme;
  el.style.setProperty('--zoom', d.font);
}

export const specFor = (gameId) => [...COMMON_SPEC, ...(GAME_SPEC[gameId] || [])];

// scope：'all' 或游戏 id。返回 undefined 表示没单独设
export function rawPref(scope, key) {
  const b = bag();
  return scope === 'all' ? b.all[key] : b.games[scope]?.[key];
}

// v 为 undefined 表示清掉（游戏跟“所有游戏”，“所有游戏”回到默认）
export function setPref(scope, key, v) {
  const b = bag();
  const t = scope === 'all' ? b.all : (b.games[scope] ||= {});
  if (v === undefined) delete t[key];
  else t[key] = v;
  save();
}

// 某个游戏最终生效的偏好
export function gamePrefs(gameId) {
  const b = bag();
  const own = b.games[gameId] || {};
  const out = {};
  for (const s of COMMON_SPEC) out[s.key] = own[s.key] ?? b.all[s.key] ?? s.def;
  for (const s of GAME_SPEC[gameId] || []) out[s.key] = own[s.key] ?? s.def;
  return out;
}

export function rootClasses(gameId) {
  const p = gamePrefs(gameId);
  return specFor(gameId).filter((s) => s.off && p[s.key] === false).map((s) => s.off).join(' ');
}

// 按偏好改实时反馈（只对有 showFeedback 参数的游戏）
export function withPrefs(game, params) {
  const p = gamePrefs(game.id);
  if (p.feedback === 'coach' || !('showFeedback' in params)) return params;
  return { ...params, showFeedback: p.feedback === 'on' };
}

// 给教练看的：和默认不同的项，例如 {"进度条":"隐藏"}；都是默认就返回 null
export function prefSummary(gameId) {
  const p = gamePrefs(gameId);
  const out = {};
  for (const s of specFor(gameId)) {
    if (p[s.key] === s.def) continue;
    out[s.label] = s.range ? p[s.key] : (s.options.find(([v]) => v === p[s.key])?.[1] ?? p[s.key]);
  }
  return Object.keys(out).length ? out : null;
}
