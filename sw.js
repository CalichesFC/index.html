// Caliche's Operations Hub — Service Worker
// Caches the app shell so it loads even with weak/no signal

const CACHE_NAME = 'caliches-hub-v2';
const ASSETS = [
  './index.html',
  './splash-logo.png',
  './catering-logo.png',
  './caliches-cone.png'
];

// Install: cache the app shell
// Cache each asset individually so a single missing file
// (e.g. an icon not uploaded yet) doesn't fail the whole install.
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return Promise.all(
        ASSETS.filter(Boolean).map(function(url) {
          return cache.add(url).catch(function(err) {
            console.warn('SW: skipping uncacheable asset', url, err);
          });
        })
      );
    })
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) { return key !== CACHE_NAME; })
            .map(function(key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

// Fetch: serve from cache, fall back to network
self.addEventListener('fetch', function(event) {
  // Skip non-GET and cross-origin requests (Supabase, GAS, CDN)
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then(function(cached) {
      if (cached) return cached;
      return fetch(event.request).then(function(response) {
        // Cache successful responses for local assets
        if (response && response.status === 200 && response.type === 'basic') {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      }).catch(function() {
        // Offline fallback: return the cached app shell
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html');
        }
      });
    })
  );
});
