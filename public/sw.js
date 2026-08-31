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
