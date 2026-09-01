// AURAXP service worker -- existe SOLO para cumplir el criterio de
// instalabilidad de Android/Chrome (manifest válido + SW registrado con
// un listener de fetch), NO para cachear nada (R10/R11 del bloque PWA):
// la app cambia seguido en desarrollo y los datos dinámicos (Challenges,
// Notificaciones, Ranking, Perfil, Scans) tienen que ser siempre de red,
// nunca de un cache viejo -- el trap clásico de PWA que se pidió evitar
// explícitamente. Por eso cada request se deja pasar tal cual a la red,
// sin interceptar ni guardar una sola respuesta.

self.addEventListener('install', () => {
  // Toma control apenas se instala una versión nueva -- nunca deja a
  // alguien atrapado esperando que cierre todas las pestañas para que el
  // SW nuevo entre en efecto.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Passthrough puro. Agregar cache acá es exactamente el riesgo que se
  // pidió evitar -- así que no se cachea nada, todo va siempre a la red.
  event.respondWith(fetch(event.request));
});

// ============================================================
// Push notifications reales (bloque pre-lanzamiento, A-E)
// ============================================================
// El payload lo arma send-push (ver supabase/functions/send-push) como
// JSON plano {title, body, url, kind} -- nada que interpretar acá salvo
// mostrarlo tal cual. Si por lo que sea el payload no es JSON válido, se
// muestra un aviso genérico en vez de fallar en silencio (mejor una
// notificación con menos detalle que ninguna).
self.addEventListener('push', (event) => {
  let data = { title: 'AURA VS', body: 'Tienes una novedad ⚔️', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // payload no-JSON -- se queda con el genérico de arriba.
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

// Deep link (E): SIEMPRE /c/<token> -- ChallengeLandingScreen entra
// directo al Challenge real para un participante autenticado cuando el
// estado es 'accepted'/'completed' (ver ese archivo), así que un solo
// destino cubre los 4 kinds reales sin rutas nuevas. `WindowClient.
// navigate()` (no postMessage + un listener nuevo en App.tsx): navega la
// pestaña YA abierta al link real, exactamente como si el usuario lo
// hubiera tecleado -- la sesión de Supabase persiste sola (vive en
// localStorage, no en memoria de React), así que "no perder sesión" ya
// queda cubierto sin necesitar puentear nada hacia el router de la app.
// Sin pestaña abierta, abre una nueva con el mismo link.
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
