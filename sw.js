/* ============================================================
   Hey Chat — Service Worker
   Caches the app shell (this page + its CDN scripts/fonts) so the
   app opens instantly on repeat visits and still loads while
   offline. This does NOT cache or proxy any chat data — messages,
   photos, and calls continue to go directly peer-to-peer and are
   stored only in the browser's own IndexedDB, exactly as before.

   DEPLOYMENT: place this file as sw.js in the same folder as
   index.html. If it's not deployed, the app works exactly as it
   did before — registration below simply fails silently.
   ============================================================ */

const CACHE_NAME = 'hey-chat-shell-v2';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  'https://unpkg.com/peerjs@1.5.2/dist/peerjs.min.js',
  'https://cdn.jsdelivr.net/npm/qrcode@1.5.3/build/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
  'https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.all(
        APP_SHELL.map((url) => cache.add(url).catch(() => {
          /* a single asset failing to pre-cache (e.g. offline during install,
             or a CDN hiccup) shouldn't block the whole install */
        }))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never intercept POSTs etc.

  event.respondWith(
    caches.match(req).then((cached) => {
      // Network-first for the app's own files so updates are picked up
      // promptly; fall back to cache when offline. Cached CDN libraries
      // are served instantly, with a background refresh attempt.
      const fetchPromise = fetch(req)
        .then((networkRes) => {
          if (networkRes && networkRes.ok){
            const copy = networkRes.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, copy)).catch(() => {});
          }
          return networkRes;
        })
        .catch(() => cached); // offline — use whatever we have cached, if anything

      return cached || fetchPromise;
    })
  );
});

/* ════════════════════════════════════════════════════════════
   BACKGROUND SYNC — when the app goes offline with pending
   (queued) messages, it registers a 'hey-flush-outbox' sync
   tag. The service worker fires this event as soon as
   connectivity is restored (even if the tab isn't focused),
   telling the app to flush any queued messages immediately.
   The actual flush is done inside the page via postMessage
   since this SW has no direct access to the peer connection.
   ════════════════════════════════════════════════════════════ */
self.addEventListener('sync', (event) => {
  if (event.tag === 'hey-flush-outbox') {
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
        clients.forEach(client => client.postMessage({ type: 'bg-sync-flush' }));
      })
    );
  }
});
