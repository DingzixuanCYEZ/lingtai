// DeepSeek 调用。电脑上走 serve.mjs 的 /api/chat 代理（key 来自环境变量 DEEPSEEK_API_KEY，不进浏览器）；
// 手机或没开代理时，用设置里填的 key 直连官方接口。

import { getState, save } from './store.js';

const DIRECT = 'https://api.deepseek.com/chat/completions';
export const DEFAULT_MODEL = 'deepseek-flash';

let proxy = null; // { hasKey } 或 false

export async function detectProxy() {
  if (proxy !== null) return proxy;
  proxy = false;
  if (location.protocol.startsWith('http')) {
    try {
      const r = await fetch('/api/ping', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j && j.proxy) proxy = { hasKey: !!j.hasKey };
      }
    } catch { /* 没有代理 */ }
  }
  return proxy;
}

export async function canCall() {
  const p = await detectProxy();
  if (p && p.hasKey) return true;
  return !!getState().settings.apiKey;
}

// 官方价（美元 / 百万 token，2026-11-02）：北京时间工作日 9–12、14–18 点是高峰，其他时间半价。节假日按高峰算（偏高估）。
const PEAK = { hit: 0.006, miss: 0.30, out: 1.20 };
export const USD_CNY = 7.1;

function isPeak(ts) {
  const d = new Date(ts);
  const wd = d.getUTCDay(), hr = d.getUTCHours();
  return wd >= 1 && wd <= 5 && ((hr >= 1 && hr < 4) || (hr >= 6 && hr < 10));
}

export function callCost(u) {
  const k = isPeak(u.ts) ? 1 : 0.5;
  return (k * (u.hit * PEAK.hit + u.miss * PEAK.miss + u.out * PEAK.out)) / 1e6;
}

// { today, total, calls, hitRate }，金额单位美元
export function costSummary(dayOf) {
  const u = getState().usage;
  const todayKey = dayOf(new Date());
  let today = 0, total = 0, hit = 0, miss = 0;
  for (const x of u) {
    const c = callCost(x);
    total += c;
    if (dayOf(new Date(x.ts)) === todayKey) today += c;
    hit += x.hit; miss += x.miss;
  }
  return { today, total, calls: u.length, hitRate: hit + miss ? hit / (hit + miss) : 0 };
}

async function post(body, signal) {
  const st = getState();
  const p = await detectProxy();
  let url, headers = { 'Content-Type': 'application/json' };
  if (st.settings.endpoint) {
    url = st.settings.endpoint;
    if (st.settings.apiKey) headers.Authorization = 'Bearer ' + st.settings.apiKey;
  } else if (p && p.hasKey && !st.settings.apiKey) {
    url = '/api/chat';
  } else if (st.settings.apiKey) {
    url = DIRECT;
    headers.Authorization = 'Bearer ' + st.settings.apiKey;
  } else {
    throw new Error('没有 API key：电脑上请用 serve.mjs 启动并设置环境变量 DEEPSEEK_API_KEY，手机上请在“设置”里填 key。');
  }
  let r;
  try {
    r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('连不上 DeepSeek（' + e.message + '）。看看网络，或者在设置里检查接口地址。');
  }
  const text = await r.text();
  if (!r.ok) {
    const err = new Error(`DeepSeek 返回 ${r.status}：${text.slice(0, 300)}`);
    err.status = r.status;
    err.body = text;
    throw err;
  }
  return JSON.parse(text);
}

function parseJSONLoose(s) {
  try { return JSON.parse(s); } catch { /* 继续 */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) return JSON.parse(s.slice(a, b + 1));
  throw new Error('不是 JSON');
}

// 返回 { json, raw, usage }。空回复、不是 JSON 时自动重试一次。
export async function chatJSON(messages, { thinking = false, kind = 'set', signal } = {}) {
  const st = getState();
  const body = {
    model: st.settings.model || DEFAULT_MODEL,
    messages,
    thinking: { type: thinking ? 'enabled' : 'disabled' },
    response_format: { type: 'json_object' },
    max_tokens: thinking ? 24000 : 3000,
  };
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    let res;
    try {
      res = await post(body, signal);
    } catch (e) {
      // 思考模式可能不支持 JSON 模式：去掉 response_format 再试
      if (e.status === 400 && body.response_format && /response_format|json/i.test(e.body || '')) {
        delete body.response_format;
        lastErr = e;
        continue;
      }
      throw e;
    }
    const msg = res.choices?.[0]?.message || {};
    const raw = (msg.content || '').trim();
    const u = res.usage || {};
    st.usage.push({
      ts: Date.now(), kind, thinking,
      hit: u.prompt_cache_hit_tokens ?? 0,
      miss: u.prompt_cache_miss_tokens ?? (u.prompt_tokens ?? 0),
      out: u.completion_tokens ?? 0,
    });
    if (st.usage.length > 2000) st.usage.splice(0, st.usage.length - 2000);
    save();
    if (!raw) { lastErr = new Error('DeepSeek 返回了空内容'); continue; }
    try {
      return { json: parseJSONLoose(raw), raw, usage: u };
    } catch {
      lastErr = new Error('DeepSeek 返回的不是 JSON：' + raw.slice(0, 200));
    }
  }
  throw lastErr;
}
