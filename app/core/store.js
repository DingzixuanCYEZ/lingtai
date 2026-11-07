// 本地存档（localStorage）+ 同步 + 导出/导入 JSON。所有状态都在一个对象里。

import { LINE_IDS } from './ranks.js';
import { mergeStates, stable } from './merge.js';

const KEY = 'lingtai.v1';
const DAY_CUTOFF_HOUR = 4; // 凌晨 4 点前算前一天

function freshLine() {
  return { rank: null, xp: 0, unstable: false, placedAt: null, exam: null };
}

export function freshState() {
  const lines = {};
  for (const id of LINE_IDS) lines[id] = freshLine();
  return {
    version: 1,
    settings: { apiKey: '', model: '', endpoint: '' },
    lines,
    total: { rank: null, reviewedAt: null },
    sessions: [],   // 每组一条，按时间追加
    roster: [],     // 策略名册：{ name, line, desc, since }，只追加
    days: {},       // 'YYYY-MM-DD' -> { profile, convo, plan, done: [taskIndex] }
    suggestions: [],// AI 的开发建议：{ day, text }
    usage: [],      // 每次调用的 token 用量：{ ts, kind, hit, miss, out }
    deleted: [],    // 删掉的记录（'session:<id>'、'pref:<id>'），同步合并时不让另一台设备的副本复活
  };
}

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return freshState();
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.error('存档读取失败', e);
    return freshState();
  }
}

function migrate(s) {
  const base = freshState();
  const out = { ...base, ...s, settings: { ...base.settings, ...(s.settings || {}) } };
  for (const id of LINE_IDS) out.lines[id] = { ...freshLine(), ...(s.lines?.[id] || {}) };
  return out;
}

export function getState() { return state; }

function writeLocal() {
  localStorage.setItem(KEY, JSON.stringify(state));
}

export function save() {
  state.savedAt = Date.now();
  if (hasRemote()) schedule(2500);
  try {
    writeLocal();
  } catch (e) {
    console.error('存档写入失败', e);
    if (hasRemote()) return; // 电脑 / Gist 上还有
    throw new Error('本地存储写不进去了（可能满了）。请先导出 JSON 备份。');
  }
}

// 删掉一条记录时调用，同步时另一台设备上的副本也跟着删
export function markDeleted(kind, id) {
  (state.deleted ||= []).push(`${kind}:${id}`);
}

// ---------- 同步 ----------
// 两条路，都是“拉下来 → 合并（merge.js）→ 推上去”：
// 1. 电脑：serve.mjs 的 /api/state → 数据/state.json（只有用 serve.mjs 打开时有）
// 2. GitHub 私密 Gist：手机、电脑都能用。token 只存在这台设备的浏览器里，不进存档、不进导出
// 离线时照常存本地，联网后下一次同步合并进去。两条路都没有时，靠导出 / 导入 JSON（导入也是合并）。
// 什么时候同步：打开时、保存后 2.5 秒、切回来 / 切走时、联网时、开着时每分钟一次。

const GIST_KEY = 'lingtai.gist';      // { token, id }
const GIST_FILE = 'lingtai-state.json';
const baseKey = (ch) => 'lingtai.base.' + ch; // 上次和这条路一致时的存档，合并时用来判断哪边改过

const sync = { server: false, busy: false, again: false, timer: null, lastOk: null, errors: {} };
const changeFns = [];
export const onSyncChange = (fn) => changeFns.push(fn);

let gist = readGist();
function readGist() {
  try { return JSON.parse(localStorage.getItem(GIST_KEY)) || {}; } catch { return {}; }
}
function writeGist(cfg) {
  gist = cfg;
  if (cfg.token) localStorage.setItem(GIST_KEY, JSON.stringify(cfg));
  else localStorage.removeItem(GIST_KEY);
}
const hasRemote = () => sync.server || !!gist.token;

export const gistToken = () => gist.token || '';
export function setGistToken(token) {
  const t = String(token || '').trim();
  if (t !== gist.token) localStorage.removeItem(baseKey('gist'));
  sync.errors.gist = '';
  writeGist(t ? { token: t, id: t === gist.token ? gist.id : null } : {});
}

export const syncStatus = () => ({
  server: sync.server, gist: !!gist.token, busy: sync.busy, lastOk: sync.lastOk,
  error: Object.values(sync.errors).filter(Boolean).join('；'),
});

const forServer = () => ({ ...state, settings: { ...state.settings, apiKey: '' } }); // key 不写进文件
const blankKey = (s) => ({ ...s, settings: { ...(s.settings || {}), apiKey: '' } });

function loadBase(ch) {
  try { const t = localStorage.getItem(baseKey(ch)); return t ? JSON.parse(t) : null; } catch { return null; }
}
function saveBase(ch, text) {
  try { localStorage.setItem(baseKey(ch), text); } catch { localStorage.removeItem(baseKey(ch)); }
}

const serverChannel = {
  name: 'server', label: '电脑',
  async pull() {
    const r = await fetch('/api/state', { cache: 'no-store' });
    if (!r.ok) throw new Error('读取失败 ' + r.status);
    const j = await r.json();
    return { state: j.state || null, tag: j.state?.savedAt || 0 };
  },
  // 电脑上的存档在拉下来之后又被别的设备改过时返回 false（409），重来一遍
  async push(text, pulled) {
    const r = await fetch('/api/state', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: `{"base":${pulled.tag},"force":false,"state":${text}}`,
    });
    if (r.status === 409) return false;
    if (!r.ok) throw new Error('写入失败 ' + r.status);
    return true;
  },
};

async function gh(path, init = {}) {
  const r = await fetch('https://api.github.com' + path, {
    ...init, cache: 'no-store',
    headers: { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + gist.token, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
  });
  if (r.status === 401) throw new Error('token 无效或过期了，请在设置里重新填');
  if (r.status === 403) throw new Error('token 没有 Gist 权限，或者请求太频繁（403）');
  if (!r.ok) { const e = new Error('GitHub 返回 ' + r.status); e.status = r.status; throw e; }
  return r.json();
}

const gistChannel = {
  name: 'gist', label: 'GitHub',
  async pull() {
    if (!gist.id) {
      // 找别的设备建好的那份
      for (let page = 1; page <= 10; page++) {
        const list = await gh(`/gists?per_page=100&page=${page}`);
        const hit = list.find((g) => g.files && g.files[GIST_FILE]);
        if (hit) { writeGist({ ...gist, id: hit.id }); break; }
        if (list.length < 100) break;
      }
      if (!gist.id) return { state: null };
    }
    let g;
    try { g = await gh('/gists/' + gist.id); }
    catch (e) {
      if (e.status === 404) writeGist({ ...gist, id: null }); // 被删了：下次重新找 / 新建
      throw e;
    }
    const f = g.files?.[GIST_FILE];
    if (!f) return { state: null };
    // 超过 1MB 的文件接口只给一部分，要去 raw_url 拿全的
    const text = f.truncated ? await (await fetch(f.raw_url, { cache: 'no-store' })).text() : f.content;
    return { state: JSON.parse(text) };
  },
  async push(text) {
    const files = { [GIST_FILE]: { content: text } };
    if (gist.id) await gh('/gists/' + gist.id, { method: 'PATCH', body: JSON.stringify({ files }) });
    else {
      const g = await gh('/gists', { method: 'POST', body: JSON.stringify({ description: '灵台试炼存档（自动同步，不要手动改）', public: false, files }) });
      writeGist({ ...gist, id: g.id });
    }
    return true;
  },
};

// 比内容不比 savedAt：每次推送都会把 savedAt 记成当时，电脑和 Gist 两边推的时间总差几毫秒，
// 要是连它一起比，两边会永远“不一样”，每分钟互相再写一遍
const content = (s) => stable({ ...s, savedAt: 0 });

// 拉 → 合并 → 不一样就推。返回这台的存档有没有被改
async function syncChannel(ch) {
  let changed = false;
  for (let tries = 0; tries < 4; tries++) {
    const pulled = await ch.pull();
    if (pulled.state) {
      const before = content(forServer());
      mergeStates(state, migrate(pulled.state), loadBase(ch.name));
      if (content(forServer()) !== before) changed = true;
    }
    if (pulled.state && content(forServer()) === content(blankKey(migrate(pulled.state)))) {
      saveBase(ch.name, JSON.stringify(forServer()));
      return changed;
    }
    state.savedAt = Math.max(Date.now(), state.savedAt || 0);
    const text = JSON.stringify(forServer());
    if (await ch.push(text, pulled)) {
      saveBase(ch.name, text);
      try { writeLocal(); } catch { /* 远端有 */ }
      return changed;
    }
  }
  throw new Error('存档一直在被别的设备改，稍后再同步');
}

function schedule(ms) {
  clearTimeout(sync.timer);
  sync.timer = setTimeout(syncNow, ms);
}

const offline = (e) => e instanceof TypeError || !navigator.onLine;

export async function syncNow() {
  if (sync.busy) { sync.again = true; return; }
  clearTimeout(sync.timer);
  const chans = [sync.server && serverChannel, gist.token && gistChannel].filter(Boolean);
  if (!chans.length) return;
  sync.busy = true;
  let changed = false, allOk = true;
  const run = async (ch) => {
    try {
      if (await syncChannel(ch)) changed = true;
      sync.errors[ch.name] = '';
    } catch (e) {
      allOk = false;
      sync.errors[ch.name] = `${ch.label}：${offline(e) ? '没连上（记录先存在这台设备，连上后自动合并）' : e.message}`;
    }
  };
  try {
    for (const ch of chans) await run(ch);
    if (changed && chans.length > 1) await run(chans[0]); // Gist 带来的新记录也写进电脑
    if (changed) try { writeLocal(); } catch { /* 远端有 */ }
    if (allOk) sync.lastOk = Date.now();
  } finally {
    sync.busy = false;
    changeFns.forEach((f) => f({ changed }));
    if (sync.again) { sync.again = false; schedule(500); }
  }
}

// 打开时调用：先找电脑上的 serve.mjs，再同步一次（最多等 3.5 秒，超时就先用本地的，同步完再刷新）
export async function initSync() {
  if (location.protocol.startsWith('http')) {
    try {
      const r = await fetch('/api/ping', { cache: 'no-store' });
      sync.server = r.ok && !!(await r.json())?.proxy;
    } catch { sync.server = false; }
  }
  addEventListener('online', () => schedule(0));
  document.addEventListener('visibilitychange', () => schedule(document.hidden ? 0 : 300));
  setInterval(() => { if (!document.hidden) schedule(0); }, 60e3);
  await Promise.race([syncNow(), new Promise((r) => setTimeout(r, 3500))]);
}

export function dayKey(d = new Date()) {
  const t = new Date(d.getTime() - DAY_CUTOFF_HOUR * 3600e3);
  const p = (x) => String(x).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

export function hhmm(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400e3);
}

export function today() {
  const k = dayKey();
  if (!state.days[k]) state.days[k] = { profile: null, convo: [], plan: null, done: [] };
  return state.days[k];
}

// 返回要给用户看的一句话（安卓 App 里存到“下载”文件夹；浏览器里直接下载，不用说）
export function exportJSON() {
  const name = `灵台试炼-${dayKey()}.json`;
  const text = JSON.stringify(forServer(), null, 1);
  if (globalThis.LingtaiApp) return globalThis.LingtaiApp.saveFile(name, text);
  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

// 导入 = 和这台的合并（不覆盖）：离线时在另一台玩的，导出再导进来就接上了
export function importJSON(text) {
  const s = JSON.parse(text);
  if (!s || s.version !== 1 || !Array.isArray(s.sessions)) throw new Error('不是灵台试炼的存档文件');
  mergeStates(state, migrate(s), null);
  save();
}

// 清空：换一个 epoch，同步时别的设备上的旧记录不会合并回来，而是被这份替掉
export function resetAll() {
  const settings = state.settings;
  state = freshState();
  state.settings = settings;
  state.epoch = Date.now();
  save();
}
