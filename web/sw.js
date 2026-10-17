// @ts-check
// Offline cache: the app shell is precached, everything else same-origin (PDF.js
// cmaps/fonts) is cached on first use. Stale-while-revalidate keeps it fresh.
/// <reference lib="webworker" />

const CACHE = "pdfoku-v2";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "tokens.css",
  "manifest.webmanifest",
  "icons/icon-192.png",
  "js/main.js",
  "js/layout.js",
  "js/items.js",
  "js/pdf.js",
  "js/storage.js",
  "js/formats/book.js",
  "js/formats/errors.js",
  "js/formats/markup.js",
  "js/formats/mobi.js",
  "js/formats/rtf.js",
  "js/formats/text.js",
  "js/formats/zip.js",
  "vendor/pdfjs/pdf.min.mjs",
  "vendor/pdfjs/pdf.worker.min.mjs",
];

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

sw.addEventListener("install", (event) => {
  // cache: "reload" bypasses the HTTP cache so a new version never mixes old and new modules.
  const fresh = SHELL.map((url) => new Request(url, { cache: "reload" }));
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(fresh)).then(() => sw.skipWaiting()));
});

sw.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== sw.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((res) => {
          if (res.ok) void cache.put(request, res.clone());
          return res;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    }),
  );
});
