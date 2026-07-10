/* eslint-disable no-restricted-globals */
/**
 * TalentFlow Service Worker
 * ---------------------------------------------------------------
 * Handgebouwd (geen next-pwa) om bundle-grootte en gedrag exact
 * onder controle te houden. Bevat:
 *   - cache-first voor static assets (/_next/static, /icons)
 *   - network-first voor /api/* met offline-fallback
 *   - network-first voor pages + RSC (zodat een deploy METEEN zichtbaar is;
 *     stale-while-revalidate serveerde de oude app tot de SW zichzelf verving)
 *   - push-notification handler
 *   - notification-click tracker (best-effort)
 *
 * Cache-versie omhoog gooien => alle oudere caches worden in
 * 'activate' geleegd. Doe dit bij elke breaking SW-wijziging.
 */

const CACHE_VERSION = 'tf-v3';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;

const PRECACHE_URLS = [
  '/manifest.json',
  '/offline.html',
  '/icons/icon.svg',
];

// ---------------------------------------------------------------
// Install: precache offline-fallback + manifest
// ---------------------------------------------------------------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) =>
        // addAll faalt atomic — gebruik per-URL add met try/catch zodat
        // ontbrekende icons (PNG nog niet gegenereerd) install niet breken.
        Promise.all(
          PRECACHE_URLS.map((url) =>
            cache.add(url).catch((err) => {
              console.warn('[SW] precache miss:', url, err);
            }),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

// ---------------------------------------------------------------
// Activate: oude caches opruimen
// ---------------------------------------------------------------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => !k.startsWith(CACHE_VERSION))
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// ---------------------------------------------------------------
// Fetch routing
// ---------------------------------------------------------------
self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Alleen GET — POST/PUT/DELETE zijn nooit cacheable
  if (req.method !== 'GET') return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // Schemes die geen cache hebben (chrome-extension://, data:, etc.)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return;

  // Cross-origin requests laten we direct door (bv. analytics, Sentry)
  if (url.origin !== self.location.origin) return;

  // Static assets: cache-first
  if (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    url.pathname === '/manifest.json' ||
    url.pathname === '/favicon.ico'
  ) {
    event.respondWith(cacheFirst(req, STATIC_CACHE));
    return;
  }

  // API: network-first met offline-fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirst(req, API_CACHE));
    return;
  }

  // Service worker zelf — nooit cachen, altijd fresh
  if (url.pathname === '/sw.js') return;

  // Pages: network-first (alleen navigatie + same-origin docs). Zo ziet de
  // gebruiker na een deploy direct de nieuwe app; cache is enkel offline-vangnet.
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(networkFirstPage(req, PAGE_CACHE));
    return;
  }

  // Overige same-origin requests (RSC-payloads, /_next/data, fonts) →
  // network-first zodat verse RSC-data wordt geserveerd na een deploy.
  event.respondWith(networkFirstPage(req, PAGE_CACHE));
});

// ---------------------------------------------------------------
// Push handler
// ---------------------------------------------------------------
self.addEventListener('push', (event) => {
  if (!event.data) return;

  /** @type {{
   *   title: string;
   *   body?: string;
   *   icon?: string;
   *   badge?: string;
   *   tag?: string;
   *   requireInteraction?: boolean;
   *   data?: { url?: string; logId?: string; [k: string]: unknown };
   * }} */
  let payload;
  try {
    payload = event.data.json();
  } catch {
    // Plain-text fallback
    payload = { title: 'TalentFlow', body: event.data.text() };
  }

  const title = payload.title || 'TalentFlow';
  const options = {
    body: payload.body || '',
    icon: payload.icon || '/icons/icon-192.png',
    badge: payload.badge || '/icons/icon-192.png',
    data: payload.data || {},
    tag: payload.tag,
    requireInteraction: payload.requireInteraction ?? false,
    actions: [
      { action: 'open', title: 'Bekijk' },
      { action: 'dismiss', title: 'Sluit' },
    ],
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ---------------------------------------------------------------
// Notification click handler — focus existing window of open URL
// ---------------------------------------------------------------
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'dismiss') {
    return;
  }

  const data = event.notification.data || {};
  const targetUrl = data.url || '/hm';
  const logId = data.logId;

  event.waitUntil(
    (async () => {
      // Best-effort click-tracker — beacon-style, niet blokkerend
      if (logId) {
        try {
          await fetch(`/api/notifications/log/${encodeURIComponent(logId)}/clicked`, {
            method: 'POST',
            keepalive: true,
            credentials: 'include',
          });
        } catch {
          // negeer — analytics mag stilletjes falen
        }
      }

      // Bestaand venster focussen of nieuw openen
      const wins = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true,
      });
      for (const w of wins) {
        try {
          const wUrl = new URL(w.url);
          if (wUrl.pathname === targetUrl || w.url.endsWith(targetUrl)) {
            return w.focus();
          }
        } catch {
          // ignore parse errors
        }
      }
      return self.clients.openWindow(targetUrl);
    })(),
  );
});

// ---------------------------------------------------------------
// Message handler — laat de page handmatig SKIP_WAITING triggeren
// ---------------------------------------------------------------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ===============================================================
// Cache-strategie helpers
// ===============================================================

async function cacheFirst(req, cacheName) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const fresh = await fetch(req);
    if (fresh.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch (err) {
    // Static asset niet beschikbaar + offline = fallback (kan undefined zijn)
    const fallback = await caches.match('/offline.html');
    if (fallback) return fallback;
    throw err;
  }
}

async function networkFirst(req, cacheName) {
  try {
    const fresh = await fetch(req);
    if (fresh.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    return new Response(
      JSON.stringify({
        error: 'offline',
        message: 'Geen internetverbinding en geen cache beschikbaar.',
      }),
      {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}

// Network-first voor navigatie/RSC: altijd verse app na een deploy; cache en
// offline.html zijn alleen het offline-vangnet.
async function networkFirstPage(req, cacheName) {
  try {
    const fresh = await fetch(req);
    if (fresh && fresh.ok) {
      const cache = await caches.open(cacheName);
      cache.put(req, fresh.clone()).catch(() => {});
    }
    return fresh;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    const offline = await caches.match('/offline.html');
    if (offline) return offline;
    return new Response('Offline', { status: 503 });
  }
}

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);

  const fetchPromise = fetch(req)
    .then((fresh) => {
      if (fresh && fresh.ok) {
        cache.put(req, fresh.clone()).catch(() => {});
      }
      return fresh;
    })
    .catch(async () => {
      if (cached) return cached;
      const offline = await caches.match('/offline.html');
      if (offline) return offline;
      return new Response('Offline', { status: 503 });
    });

  return cached || fetchPromise;
}
