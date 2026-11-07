// 把教练给的小组件（已经过 core/blocks.js 检查）画出来。
// onChoice(text)：用户点了选项；不给就不画选项。

import { h } from './core/gamekit.js';
import { POS_NAMES } from './core/blocks.js';

export function renderBlocks(blocks, { onChoice = null } = {}) {
  return (blocks || []).map((b) => {
    if (b.type === 'demo') return demoBlock(b);
    if (b.type === 'choices' && onChoice) return choicesBlock(b, onChoice);
    return null;
  });
}

function choicesBlock(b, onChoice) {
  const row = h('div', { class: 'ui-choices' });
  row.append(...b.options.map((t) => h('button', {
    class: 'g-btn', type: 'button',
    onclick: () => { row.querySelectorAll('button').forEach((x) => { x.disabled = true; }); onChoice(t); },
  }, t)));
  return row;
}

// 双重N-back 演示：小九宫格一步步放，下面一条序列，当前这个和 n 步前那个都标出来
function demoBlock(b) {
  const { n, steps } = b;
  const hasLetters = steps[0].letter != null;
  let i = 0, timer = null;

  const cells = POS_NAMES.map(() => h('div', { class: 'dm-cell' }));
  const grid = h('div', { class: 'dm-grid' }, cells);
  const letter = h('div', { class: 'dm-letter' });
  const stepEl = h('div', { class: 'dm-step' });
  const pressEl = h('div', { class: 'dm-press' });
  const noteEl = h('div', { class: 'dm-note' });
  const chips = steps.map((s, k) => h('button', { class: 'dm-chip', type: 'button', onclick: () => { stop(); show(k); } },
    h('span', { class: 'dm-k' }, String(k + 1)), POS_NAMES[s.pos], s.letter ? ' ' + s.letter : ''));
  const strip = h('div', { class: 'dm-strip' }, chips);

  const show = (k) => {
    i = k;
    const s = steps[k];
    cells.forEach((c, j) => c.classList.toggle('on', j === s.pos));
    cells.forEach((c, j) => c.classList.toggle('back', k >= n && j === steps[k - n].pos && j !== s.pos));
    letter.textContent = s.letter || '';
    chips.forEach((c, j) => { c.classList.toggle('cur', j === k); c.classList.toggle('back', k >= n && j === k - n); });
    stepEl.textContent = k < n ? `第 ${k + 1} 个：前面还不够 ${n} 个，只记住，不用比` : `第 ${k + 1} 个：和 ${n} 步前的第 ${k - n + 1} 个比`;
    const keys = [s.press.pos ? '位置键' : null, s.press.snd ? '字母键' : null].filter(Boolean);
    pressEl.textContent = k < n ? '' : keys.length ? `按 ${keys.join(' + ')}` : '都不按';
    pressEl.classList.toggle('hit', keys.length > 0);
    noteEl.textContent = s.note || '';
    chips[k].scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  };
  const stop = () => { clearInterval(timer); timer = null; playBtn.textContent = '▶ 播放'; };
  const playBtn = h('button', { class: 'g-btn', type: 'button', onclick: () => {
    if (timer) { stop(); return; }
    if (i >= steps.length - 1) show(0);
    playBtn.textContent = '⏸ 暂停';
    timer = setInterval(() => { if (i >= steps.length - 1 || !playBtn.isConnected) stop(); else show(i + 1); }, 1600);
  } }, '▶ 播放');
  const prev = h('button', { class: 'g-btn', type: 'button', onclick: () => { stop(); if (i > 0) show(i - 1); } }, '上一步');
  const next = h('button', { class: 'g-btn', type: 'button', onclick: () => { stop(); if (i < steps.length - 1) show(i + 1); } }, '下一步');

  show(0);
  return h('div', { class: 'dm' },
    h('div', { class: 'dm-title' }, b.title || `演示：记 ${n} 步前${hasLetters ? '（位置和字母）' : '（只看位置）'}`),
    h('div', { class: 'dm-main' }, h('div', { class: 'dm-left' }, grid, hasLetters ? letter : null),
      h('div', { class: 'dm-right' }, stepEl, pressEl, noteEl)),
    strip,
    h('div', { class: 'dm-ctrl' }, prev, playBtn, next),
    h('div', { class: 'g-note' }, '例子里该不该按是程序算的，不会错。点下面任意一格可以跳到那一步。'));
}
