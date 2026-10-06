// Nucleus service worker — enables offline + installability.
// Strategy: never cache HTML (always network); cache static assets.
const CACHE_NAME = 'nucleus-v10-model';
const PRECACHE = [
  '/manifest.json',
  '/icons/icon-192.png',
  '/assets/gage.jpg',
  '/assets/kaylene.jpeg',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // The code under /js/ is built with the page and must match it: network
  // first, kept in the cache only for offline.
  if (url.pathname.startsWith('/js/')) {
    e.respondWith(fetch(e.request).then(resp => {
      if (resp.ok) {
        const copy = resp.clone();
        caches.open(CACHE_NAME).then(c => c.put(e.request, copy));
      }
      return resp;
    }).catch(() => caches.match(e.request)));
    return;
  }
  // Always network for HTML — keep deploys live, never serve stale shell.
  if (e.request.mode === 'navigate' ||
      url.pathname === '/' ||
      url.pathname.endsWith('.html')) {
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  // Static assets: cache-first, but always try network in background.
  e.respondWith(
    caches.match(e.request).then(cached =>
      cached || fetch(e.request).then(resp => {
        if (resp.ok && url.origin === location.origin) {
          const copy = resp.clone();
          caches.open(CACHE_NAME).then(c => c.put(e.request, copy));
        }
        return resp;
      })
    )
  );
});
