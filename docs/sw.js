/* 离线缓存策略：

   - 页面 / 脚本 / 样式（应用外壳）：先走网络，成功后顺手更新缓存，
     断网时用缓存兜底。这样每次发布新版本，刷新一次就是新版。
   - 数据文件（.json 等）：先返回缓存（秒开），同时后台拉一次更新缓存。

   改完这里的代码记得把 CACHE 的版本号 +1，否则老用户的旧缓存不会重建。 */
const CACHE = "box-lookup-v7";
const ASSETS = [
  "./",
  "index.html",
  "assets/style.css",
  "assets/app.js",
  "assets/search.js",
  "assets/favicon.svg",
  "manifest.webmanifest",
];

const SHELL_RE = /\.(?:html|css|js|webmanifest)$/;

function isShell(url) {
  return url.pathname.endsWith("/") || SHELL_RE.test(url.pathname);
}

/** 先网络再缓存：网络不通时用缓存，保证离线也能打开 */
function networkFirst(req) {
  // cache:"no-cache" → 每次都跟服务器核对一遍（文件带 ETag，没变就 304，很快）。
  // 否则 GitHub Pages 给资源打的 max-age=600 会让刚发布的改动「刷新了还是旧版」。
  return fetch(req, { cache: "no-cache" })
    .then((resp) => {
      if (resp && resp.ok) {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return resp;
    })
    .catch(() => caches.match(req).then((cached) => cached || caches.match("index.html")));
}

/** 先缓存再后台更新：立刻显示上次的内容，同时把新版本悄悄存下来 */
function cacheFirst(req) {
  return caches.match(req).then((cached) => {
    const network = fetch(req)
      .then((resp) => {
        if (resp && resp.ok) {
          const copy = resp.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return resp;
      })
      .catch(() => cached || caches.match("index.html"));
    return cached || network;
  });
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;

  event.respondWith(isShell(url) ? networkFirst(req) : cacheFirst(req));
});
