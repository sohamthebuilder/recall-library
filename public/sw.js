// Minimal service worker: lets browsers that still ask for one treat the app as installable.
// It caches nothing; every request goes to the network as usual.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {});
