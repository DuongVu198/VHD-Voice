const prefix = "vhd-voice-shell-";
const cacheName = prefix + "v2.0.0";
const scope = self.registration.scope;
const files = [
  "./", "./index.html", "./field.html", "./field.css", "./unified.mjs", "./unified-data.mjs",
  "./field-import.mjs", "./commands.mjs", "./legacy.html", "./styles.css", "./app.js",
  "./parser.mjs", "./manifest.webmanifest",
];
const shell = new Set(files.map(path => new URL(path, scope).href));

self.addEventListener("install", event => {
  event.waitUntil(caches.open(cacheName).then(cache =>
    cache.addAll(files.map(path => new Request(new URL(path, scope), { cache: "reload" })))
  ).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(prefix) && key !== cacheName).map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const { request } = event;
  if (request.method !== "GET" || !shell.has(request.url)) return;
  const cache = caches.open(cacheName);
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(async () => (await cache).match(request)));
  } else {
    event.respondWith(cache.then(async store => (await store.match(request)) ?? fetch(request)));
  }
});
