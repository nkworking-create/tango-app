const CACHE = 'tango-v73';
const STATIC = ['/', '/recommended-words.js'];

// インストール時にキャッシュ
self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)));
  self.skipWaiting();
});

// 古いキャッシュを削除
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // API → ネットワーク優先
  if (url.pathname.startsWith('/api/')) {
    e.respondWith(
      fetch(e.request).catch(() =>
        new Response(JSON.stringify({ error: 'オフラインです' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        })
      )
    );
    return;
  }

  // 外部リソース（CDN等）→ キャッシュ優先
  if (url.origin !== self.location.origin) {
    e.respondWith(
      caches.open(CACHE).then(c =>
        c.match(e.request).then(cached => {
          if (cached) return cached;
          return fetch(e.request).then(resp => {
            if (resp.ok) c.put(e.request, resp.clone());
            return resp;
          }).catch(() => new Response('', { status: 408 }));
        })
      )
    );
    return;
  }

  // HTML（index.html）→ ネットワーク優先、オフライン時のみキャッシュ
  if (url.pathname === '/' || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(e.request).then(resp => {
        if (resp.ok) {
          caches.open(CACHE).then(c => c.put(e.request, resp.clone()));
        }
        return resp;
      }).catch(() =>
        caches.open(CACHE).then(c => c.match(e.request))
      )
    );
    return;
  }

  // その他JS等 → キャッシュ優先、バックグラウンド更新
  e.respondWith(
    caches.open(CACHE).then(c =>
      c.match(e.request).then(cached => {
        const fresh = fetch(e.request).then(resp => {
          if (resp.ok) c.put(e.request, resp.clone());
          return resp;
        }).catch(() => null);
        return cached || fresh;
      })
    )
  );
});
