// AURA VS service worker.
//
// IMPORTANT: do not call event.respondWith(fetch(event.request)) here.
// Safari/iOS can surface "FetchEvent.respondWith ... TypeError: Load failed"
// for cross-origin signalling requests made by WebRTC clients (AURA LIVE / LiveKit).
// Leaving the fetch event untouched gives the browser its native network path,
// which is exactly what this app wants because we intentionally do not cache app data.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

// Keep a fetch listener for PWA compatibility, but DO NOT intercept the request.
// With no respondWith(), the browser performs the normal network request directly.
self.addEventListener('fetch', () => {});

// ============================================================
// Push notifications
// ============================================================
self.addEventListener('push', (event) => {
  let data = { title: 'AURA VS', body: 'Tienes una novedad ⚔️', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // Keep the generic notification if the payload is not valid JSON.
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of allClients) {
        if (new URL(client.url).origin === self.location.origin) {
          if ('navigate' in client) await client.navigate(targetUrl);
          await client.focus();
          return;
        }
      }
      await self.clients.openWindow(targetUrl);
    })(),
  );
});
