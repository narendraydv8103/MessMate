// MessMate Service Worker (PWA Shell + Web Push)
const CACHE_NAME = 'messmate-v1';

const SHELL_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/icon-maskable-512.png',
  '/icons/icon-192.svg',
  '/icons/icon-512.svg',
  '/icons/icon-maskable.svg',
  '/icons/apple-touch-icon.svg',
];

// Install: Pre-cache app shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(SHELL_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate: Delete any outdated caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Fetch: Intercept requests
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // CRITICAL RULE: NEVER CACHE /api/* OR /_next/data/*
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_next/data') || url.pathname.includes('/_next/data')) {
    event.respondWith(fetch(event.request, { cache: 'no-store' }));
    return;
  }

  // Non-GET requests (POST, PUT, DELETE) must never be cached
  if (event.request.method !== 'GET') {
    return;
  }

  // Navigation requests (HTML pages): Network-first, fallback to cache
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(event.request);
          if (cached) return cached;
          const rootCached = await caches.match('/');
          if (rootCached) return rootCached;
          return new Response('You are offline. Please reconnect to access MessMate.', {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
          });
        })
    );
    return;
  }

  // Static assets: Cache-first, network fallback
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(event.request).then((networkResponse) => {
        if (
          networkResponse &&
          networkResponse.status === 200 &&
          (url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/'))
        ) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      });
    })
  );
});

// Push Notification Handler
self.addEventListener('push', (event) => {
  let data = {};
  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { title: 'MessMate Alert', body: event.data.text() };
    }
  }

  const title = data.title || 'MessMate Alert';
  const tag = data.tag || 'messmate-alert'; // Tag per type so repeats replace, not stack
  const options = {
    body: data.body || 'Tap to view mess attendance status.',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: tag,
    renotify: true,
    // No action buttons that submit decisions. Only opens / in app.
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Notification Click Handler: Focus or open app strictly at /, re-fetch status
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((clientList) => {
        // If a window is already open, focus it and notify to re-fetch
        for (const client of clientList) {
          if ('focus' in client) {
            client.postMessage({ type: 'REFETCH_STATUS' });
            return client.focus();
          }
        }
        // Otherwise open the app at /
        if (self.clients.openWindow) {
          return self.clients.openWindow('/');
        }
      })
  );
});

// Push Subscription Change: Re-subscribe or notify clients
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      clients.forEach((client) => {
        client.postMessage({ type: 'PUSH_SUBSCRIPTION_CHANGED' });
      });
    })
  );
});
