// SW — DROC Visita v3
// IMPORTANTE: cachea solo recursos estáticos (CSS, iconos, manifest)
// El HTML y JS NUNCA se cachean para que los cambios se apliquen al instante
const CACHE = 'droc-visita-v8';
const FILES_ESTATICOS = [
  '/droc-visita/style.css',
  '/droc-visita/manifest.json',
  '/droc-visita/icon-192.png',
  '/droc-visita/icon-512.png',
  '/droc-visita/icon-64.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(FILES_ESTATICOS).catch(() => null))
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Nunca cachear Apps Script ni APIs externas
  if (url.hostname.includes('script.google') || url.hostname.includes('googleapis')) {
    return;
  }

  // HTML y JS: SIEMPRE red, nunca caché (para que los cambios se apliquen)
  if (e.request.url.endsWith('.html') || e.request.url.endsWith('.js') || e.request.url.endsWith('/')) {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' }).catch(() => caches.match(e.request))
    );
    return;
  }

  // Recursos estáticos: caché primero, red después
  e.respondWith(
    caches.match(e.request).then(c => c || fetch(e.request))
  );
});
