// Caliche's Operations Hub - Service Worker
// Provides basic offline caching so the app shell loads even with a flaky connection.

const CACHE_NAME = 'caliches-hub-2026.07.10.1054';
const CORE_ASSETS = [
  './index.html',
  './js/01_part01.js',
  './js/02_on_load.js',
  './js/03_settings_account.js',
  './js/04_employee_roster.js',
  './js/05_admin_tasks_pip_disciplinary.js',
  './js/06_disciplinary_actions.js',
  './js/07_assignable_tasks_messaging.js',
  './js/08_availability.js',
  './js/09_work_orders_maintenance_phase.js',
  './js/10_my_maintenance_submissions.js',
  './js/11_customer_history_autosuggest.js',
  './js/12_ai_chat_widget.js',
  './js/13_marketing.js',
  './js/14_admin_config.js',
  './js/15_choice_lists.js',
  './js/16_integrations.js',
  './js/17_team_growth.js',
  './js/18_daily_store_report.js',
  './styles.css',
  './manifest.json',
  './caliches-cone.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Navigations (including ?invoice= / ?accept= customer links) are network-first and must
// NEVER be served a stale cached shell that predates the public-route code; on a true
// network failure, fall back to the freshest cached index.html. Per-token URLs are never
// cached. Static assets stay network-first with cache fallback.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const isNavigation =
    event.request.mode === 'navigate' ||
    (event.request.headers.get('accept') || '').includes('text/html');

  if (isNavigation) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (!url.search) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((c) => c.put('./index.html', copy)).catch(() => {});
          }
          return response;
        })
        .catch(() => caches.match('./index.html').then((r) => r || caches.match(event.request)))
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ── Web Push ───────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (e) { data = { title: "Caliche's Hub", body: event.data ? event.data.text() : '' }; }
  const title = data.title || "Caliche's Hub";
  const options = {
    body: data.body || '',
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { url: data.url || './index.html' },
    vibrate: [80, 40, 80],
    tag: data.tag || undefined,
    renotify: !!data.tag
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || './index.html';
  // Only force navigation when the notification carries a real destination
  // (e.g. './index.html?go=tasks'); plain notifications just focus the app.
  const wantsNav = !!(event.notification.data && event.notification.data.url && target !== './index.html');
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          const focused = client.focus();
          if (wantsNav && typeof client.navigate === 'function') {
            return Promise.resolve(focused)
              .then(() => client.navigate(target))
              .catch(() => { if (self.clients.openWindow) return self.clients.openWindow(target); });
          }
          return focused;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
