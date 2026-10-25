// ReelPick service worker: makes the app installable and lets it open offline.
// Bump VERSION to force phones to refresh their cached copy.
const VERSION = 'reelpick-v5';
const SHARE_CACHE = 'reelpick-share';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION && k !== SHARE_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);

  // Screenshots shared to ReelPick from the phone's Share menu: keep them, then open the app to read them
  if (req.method === 'POST' && url.pathname === '/share-target') {
    e.respondWith((async () => {
      let count = 0, hasLink = false;
      try {
        const form = await req.formData();
        const files = form.getAll('images').filter((f) => f && typeof f !== 'string' && /^image\//.test(f.type));
        hasLink = Boolean(form.get('url') || form.get('text'));
        const cache = await caches.open(SHARE_CACHE);
        for (const k of await cache.keys()) await cache.delete(k);
        for (const f of files.slice(0, 20)) {
          await cache.put(`/shared/${count}`, new Response(f, { headers: { 'Content-Type': f.type } }));
          count += 1;
        }
      } catch {}
      return Response.redirect(`/?shared=${count}${hasLink && !count ? '&link=1' : ''}`, 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;

  // Search and suggestions always go to the network
  if (url.pathname.startsWith('/.netlify/functions/')) return;

  // The page itself: network first so updates show straight away, cached copy when offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put('/index.html', copy)); return res; })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Everything else (libraries, fonts, posters, icons): serve from cache, refresh in the background
  e.respondWith(
    caches.open(VERSION).then((cache) =>
      cache.match(req).then((hit) => {
        const live = fetch(req).then((res) => { if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || live;
      })
    )
  );
});
