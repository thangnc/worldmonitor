// The old dashboard registered a Workbox service worker at /sw.js. Lite has no
// service worker, so this replacement clears the old caches, unregisters
// itself and reloads open tabs onto the network. Browsers fetch /sw.js on
// their next update check and pick this up.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    for (const client of clients) client.navigate(client.url);
  })());
});
