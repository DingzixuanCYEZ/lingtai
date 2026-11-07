// 记录页、设置页。

import { h } from './core/gamekit.js';
import { getState, save, today, dayKey, hhmm, exportJSON, importJSON, resetAll, syncStatus, syncNow, gistToken, setGistToken, markDeleted } from './core/store.js';
import { ensurePlan, addPrefs, queueNote } from './core/coach.js';
import { detectProxy, costSummary, DEFAULT_MODEL } from './core/api.js';
import { applyDisplay } from './core/prefs.js';
import {
  GAMES, gameById, back, goHome, shell, card, btn, actions, kv, modeName, armedBtn, aiTask, yuan, displayBlock, prefsBlock,
} from './ui.js';

// ---------- 记录 ----------

export function historyPage() {
  const st = getState();
  const list = st.sessions.slice(-100).reverse();
  shell(card(
    h('div', { class: 'g-row', style: 'justify-content:space-between' },
      h('h2', { style: 'margin:0' }, `记录（共 ${st.sessions.length} 组，显示最近 100 组）`),
      btn('返回', back)),
    list.length ? list.map((s) => {
      const g = gameById(s.game);
      const j = s.judgment;
      const said = j?.feedback_digest || s.feedback?.text || s.feedback?.note;
      return h('div', { class: 'ui-hist' },
        h('div', null, h('b', null, j ? j.grade : '未判定'), ` ${s.day} ${s.time} · ${g ? g.name : s.game} · ${modeName(s.mode)}${s.situation ? ` · ${s.situation}` : ''}`,
          s.exam ? h('span', { class: 'ui-tag hot' }, '考核') : null, s.result.aborted ? h('span', { class: 'ui-tag warn' }, '中断') : null),
        h('div', { class: 'ui-muted' }, (s.result.display || []).map(([k, v]) => `${k} ${v}`).join(' ｜ ')),
        said ? h('div', { class: 'ui-muted', style: 'margin-top:2px' }, '复盘：' + said) : null,
        j ? h('div', { style: 'margin-top:2px' }, j.verdict) : null);
    }) : h('div', { class: 'ui-muted' }, '还没有记录。')));
}

// ---------- 设置 ----------

function seg(options, current, onPick) {
  const box = h('div', { class: 'ui-seg sm' });
  const draw = (cur) => box.replaceChildren(...options.map(([v, name]) =>
    h('button', { class: 'g-btn' + (cur === v ? ' on' : ''), onclick: () => { onPick(v); draw(v); } }, name)));
  draw(current);
  return box;
}

function prefsDocCard() {
  const st = getState();
  const box = h('div');
  const draw = () => {
    const doc = st.prefsDoc || [];
    box.replaceChildren(...(doc.length
      ? doc.map((p) => h('div', { class: 'ui-doc' },
          h('div', null, p.text, h('div', { class: 'g-note' }, `${p.since} · ${p.source === 'user' ? '你加的' : '教练记的'}`)),
          armedBtn('删除', '确认删除', () => {
            st.prefsDoc = doc.filter((x) => x.id !== p.id);
            markDeleted('pref', p.id);
            queueNote(`用户删掉了这条偏好，以后不要再照它做：${p.text}`);
            save();
            draw();
          })))
      : [h('div', { class: 'ui-muted' }, '还没有。复盘和“跟教练说”里提到的长期习惯和喜好，教练会自己记在这里。')]));
  };
  draw();
  const inp = h('input', { type: 'text', placeholder: '自己加一条，例如：晚上只想玩休闲的' });
  const add = btn('添加', () => {
    const t = inp.value.trim();
    if (!t) return;
    addPrefs(dayKey(), [t], 'user');
    queueNote(`用户新加了一条偏好：${t}`);
    save();
    inp.value = '';
    draw();
  });
  return card(h('h2', null, '我的偏好'),
    h('div', { class: 'g-note' }, '教练每次排清单和判定都会看这份清单。说得不对的可以删掉，删了会告诉教练。'),
    box, h('label', { class: 'ui-field' }, inp), actions(add));
}

// 同步：电脑上的 serve.mjs 自动接上；GitHub Gist 要每台设备填一次 token
function syncCard(signal, fileIn, syncMsg) {
  const status = h('div');
  const draw = () => {
    const s = syncStatus();
    const ways = [s.server ? '电脑上的项目文件夹（数据/state.json，每天一份备份在 数据/备份/）' : null, s.gist ? 'GitHub 私密 Gist' : null].filter(Boolean);
    status.replaceChildren(
      h('div', { class: 'ui-muted' }, ways.length
        ? `自动同步到：${ways.join('、')}。${s.busy ? '正在同步……' : s.lastOk ? `上次同步成功 ${hhmm(new Date(s.lastOk))}。` : ''}`
        : '还没开同步：记录只存在这个浏览器里，清缓存、换浏览器都会丢。'),
      ...(s.error ? [h('div', { class: 'ui-err' }, s.error)] : []));
  };
  draw();
  const timer = setInterval(draw, 1000);
  signal.addEventListener('abort', () => clearInterval(timer), { once: true });
  const tok = h('input', { type: 'password', value: gistToken(), placeholder: 'github_pat_… 或 ghp_…', autocomplete: 'off' });
  const now = async () => { syncMsg.textContent = ''; await syncNow(); draw(); };
  return card(h('h2', null, '同步和存档'), status,
    h('label', { class: 'ui-field' }, h('span', null, 'GitHub token（只存在这台设备的浏览器里，不进存档、不进导出）'), tok),
    actions(
      btn('保存并同步', () => { setGistToken(tok.value); now(); }, true),
      btn('立即同步', now),
      gistToken() ? armedBtn('断开 GitHub', '再点一次：这台不再同步到 GitHub', () => { setGistToken(''); tok.value = ''; draw(); }) : null),
    h('details', null, h('summary', { class: 'ui-muted' }, '怎么拿 token（每台设备填同一个）'),
      h('ol', { class: 'g-note', style: 'padding-left:20px;line-height:1.8' },
        h('li', null, '电脑浏览器打开 github.com/settings/personal-access-tokens/new（Fine-grained token）'),
        h('li', null, 'Token name 随便写；Expiration 选久一点（到期后这里会提示，重新生成一个填上就行）'),
        h('li', null, 'Permissions → Account permissions → Gists 选 Read and write，别的都不用开'),
        h('li', null, '生成后复制，填进每台设备的这一栏。存档放在你账号下一个私密 Gist 里，第一台设备会自动建好，其他设备自动找到它'),
        h('li', null, '也可以用老式 token（github.com/settings/tokens/new），只勾 gist'))),
    h('h3', null, '没网的时候'),
    h('div', { class: 'g-note' }, '没网照常玩，记录先存在这台设备，连上网自动合并（两台都玩过也不会互相覆盖）。两台都长期没网，就在一台“导出 JSON”，传到另一台“导入 JSON”——导入也是合并。'),
    actions(btn('导出 JSON', () => { syncMsg.textContent = exportJSON() || ''; }), btn('导入 JSON（合并）', () => fileIn.click()),
      armedBtn('清空所有记录', '再点一次确认清空（先导出备份）', () => { resetAll(); applyDisplay(); goHome(); })),
    syncMsg, fileIn,
    /Android/.test(navigator.userAgent) && !globalThis.LingtaiApp && location.protocol === 'https:'
      ? h('div', { class: 'g-note', style: 'margin-top:12px' }, '安卓可以装 App 版：', h('a', { href: '../lingtai.apk' }, '下载 lingtai.apk'),
        '。App 里的数据和浏览器里的分开存，装好后在 App 里重新填 DeepSeek key 和 GitHub token，同步一下记录就都过来了。')
      : null);
}

export async function settingsPage(signal) {
  const st = getState();
  const p = await detectProxy();
  if (signal.aborted) return;
  const key = h('input', { type: 'password', value: st.settings.apiKey, placeholder: 'sk-…（电脑上用环境变量就不用填）', autocomplete: 'off' });
  const model = h('input', { type: 'text', value: st.settings.model, placeholder: DEFAULT_MODEL });
  const endpoint = h('input', { type: 'text', value: st.settings.endpoint, placeholder: '留空自动选择' });
  const msg = h('div', { class: 'ui-muted' });
  const syncMsg = h('div', { class: 'ui-muted' });

  const u = st.usage;
  const sum = (k) => u.reduce((a, x) => a + (x[k] || 0), 0);
  const c = costSummary(dayKey);

  const fileIn = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    if (!f) return;
    try { importJSON(await f.text()); applyDisplay(); syncMsg.textContent = '已合并进来'; setTimeout(goHome, 800); }
    catch (e) { syncMsg.textContent = '导入失败：' + e.message; }
  });

  const d = today();
  const planBox = h('div');
  const planErr = h('div', { class: 'ui-err' });
  const replan = btn('重新排今天的清单', async () => {
    planErr.textContent = '';
    replan.hidden = true;
    try {
      const r = await aiTask(planBox, '教练在重排……', signal, (sg) => ensurePlan(GAMES, { force: true, signal: sg }));
      if (r) { goHome(); return; }
    } catch (e) { planErr.textContent = e.message; }
    replan.hidden = false;
  });

  shell(
    card(h('h2', null, 'DeepSeek'),
      h('div', { class: 'ui-muted' }, p ? `本地代理：已连接，${p.hasKey ? '环境变量里有 key' : '但环境变量里没有 DEEPSEEK_API_KEY'}` : '本地代理：没有（直连官方接口，需要填 key）'),
      h('label', { class: 'ui-field' }, h('span', null, 'API key（只存在这台设备的浏览器里）'), key),
      h('label', { class: 'ui-field' }, h('span', null, '模型'), model),
      h('label', { class: 'ui-field' }, h('span', null, '接口地址（一般不用改）'), endpoint),
      actions(btn('保存', () => {
        st.settings.apiKey = key.value.trim(); st.settings.model = model.value.trim(); st.settings.endpoint = endpoint.value.trim();
        save(); msg.textContent = '已保存';
      }, true)), msg,
      h('div', { class: 'ui-pref' }, h('span', null, '思考模式'),
        seg([['all', '全部开（默认）'], ['exam', '只在考核时开']], st.settings.thinking === 'exam' ? 'exam' : 'all',
          (v) => { st.settings.thinking = v; save(); })),
      h('div', { class: 'g-note' }, '开着思考，排清单和判定更细，但每次多等十几秒到一分钟，花费大约翻几倍（仍然很便宜）。')),
    syncCard(signal, fileIn, syncMsg),
    card(h('h2', null, '花费'),
      kv([
        ['今天', yuan(c.today)],
        ['累计', `${yuan(c.total)}（$${c.total.toFixed(4)}）`],
        ['调用次数', c.calls],
        ['缓存命中率', Math.round(100 * c.hitRate) + '%'],
        ['输入 / 输出 token', `${sum('hit') + sum('miss')} / ${sum('out')}`],
      ]),
      h('div', { class: 'g-note', style: 'margin-top:8px' }, '按 DeepSeek 官方价估算（北京时间工作日 9–12 点、14–18 点是高峰价，其他时间半价），实际以 DeepSeek 后台账单为准。')),
    card(h('h2', null, '显示偏好'),
      h('div', { class: 'g-note' }, '只改看着舒不舒服，不改难度，教练也改不了；判定时会告诉教练你关了哪些。'),
      displayBlock(),
      prefsBlock(['all', ...GAMES.map((g) => g.id)])),
    prefsDocCard(),
    card(h('h2', null, '今天'), d.plan ? [actions(replan), planBox, planErr] : h('div', { class: 'ui-muted' }, '还没排清单。')),
    card(h('h2', null, `教练的开发建议（${st.suggestions.length}）`),
      st.suggestions.length ? st.suggestions.slice(-50).reverse().map((s) => h('div', { class: 'ui-hist' }, h('span', { class: 'ui-muted' }, s.day + ' '), s.text)) : h('div', { class: 'ui-muted' }, '暂无')),
    actions(btn('返回', back)));
}
