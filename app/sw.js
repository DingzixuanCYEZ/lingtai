// 离线可用：先上网取（3 秒没回就用缓存），取到了顺手更新缓存。只管本站的文件，DeepSeek、GitHub 的请求不碰。
// VERSION 和 PRECACHE 由 开发/publish.mjs 发布时填好；这里是开发版（电脑上 serve.mjs 打开时不注册）。
const VERSION = 'e9bd94055923';
const PRECACHE = [
 "./",
 "./assets/dnb/c.wav",
 "./assets/dnb/h.wav",
 "./assets/dnb/k.wav",
 "./assets/dnb/l.wav",
 "./assets/dnb/q.wav",
 "./assets/dnb/r.wav",
 "./assets/dnb/s.wav",
 "./assets/dnb/silence.wav",
 "./assets/dnb/t.wav",
 "./blocks.js",
 "./core/api.js",
 "./core/blocks.js",
 "./core/coach.js",
 "./core/gamekit.js",
 "./core/merge.js",
 "./core/prefs.js",
 "./core/ranks.js",
 "./core/store.js",
 "./games/blackbox.js",
 "./games/dnb.js",
 "./games/path.js",
 "./games/pattern.js",
 "./games/spatial.js",
 "./games/storm.js",
 "./icon-192.png",
 "./icon-512.png",
 "./main.js",
 "./manifest.webmanifest",
 "./pages.js",
 "./styles.css",
 "./ui.js",
 "./index.html",
 "../段位释义.md"
];
const CACHE = 'lingtai-' + VERSION;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k.startsWith('lingtai-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(networkFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  const net = fetch(req).then((r) => {
    if (r.status === 200) cache.put(req, r.clone()).catch(() => {});
    return r;
  });
  try {
    const r = await Promise.race([net, new Promise((res) => setTimeout(res, 3000))]);
    if (r && r.status < 500) return r; // 5xx 多半是代理 / 网关在说连不上，也用缓存
  } catch { /* 没网 */ }
  const hit = await cache.match(req, { ignoreSearch: true });
  return hit || net;
}
