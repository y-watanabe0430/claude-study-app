// 静的アプリのみをキャッシュするService Worker。問題・履歴・画像はIndexedDBにあり、ここには入らない
const CACHE = 'claude-study-static-v1';
const BASE = new URL('./', self.location).href;

self.addEventListener('install', (e) => {
  // 更新は利用者が「更新して再読み込み」を押したときに適用する (skipWaiting は message 経由)
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([BASE, BASE + 'manifest.webmanifest', BASE + 'icon.svg']).catch(() => undefined)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k.startsWith('claude-study-') && k !== CACHE) await caches.delete(k);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (e) => {
  if (e.data === 'SKIP_WAITING') return self.skipWaiting();
  if (e.data && e.data.type === 'CACHE_URLS') {
    e.waitUntil(
      (async () => {
        const c = await caches.open(CACHE);
        const keep = new Set([BASE, BASE + 'manifest.webmanifest', BASE + 'icon.svg', BASE + 'sw.js', ...e.data.urls]);
        await Promise.all(e.data.urls.filter((u) => u.startsWith(BASE) || u === BASE).map((u) => c.add(u).catch(() => undefined)));
        // 旧ビルドのassetを整理
        for (const req of await c.keys()) if (!keep.has(req.url)) await c.delete(req);
      })(),
    );
  }
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // ページはネットワーク優先 (更新を拾う)。オフライン時はキャッシュ
    e.respondWith(
      fetch(req).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(BASE, copy)); return r; })
        .catch(() => caches.match(BASE).then((r) => r || Response.error())),
    );
    return;
  }
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((r) => {
      if (r.ok && url.pathname.startsWith(new URL(BASE).pathname)) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return r;
    })),
  );
});
