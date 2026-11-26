// Offline support: app files come from the network when online (so updates arrive), from the cache when not.
const CACHE = 'economist-v3';
const SHELL = ['./', 'index.html', 'app.js', 'core.js', 'manifest.webmanifest', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // GitHub API and fonts go straight to the network
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const net = await Promise.race([fetch(e.request, { cache: 'no-cache' }), new Promise((_, j) => setTimeout(() => j(new Error('timeout')), 4000))]);
      if (net && net.ok) cache.put(e.request, net.clone());
      return net;
    } catch (err) {
      return (await cache.match(e.request, { ignoreSearch: true })) || (await cache.match('index.html')) || Response.error();
    }
  })());
});
