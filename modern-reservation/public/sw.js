/* TIFLISI RESERVATION — installable PWA. Requests stay on the network; do not intercept them. */
self.addEventListener('install', function () {
  self.skipWaiting();
});
self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});
