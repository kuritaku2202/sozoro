// アプリシェルだけをキャッシュする。
// 目的地データ（Overpass）はキャッシュしない。古い場所を出さないため、
// また位置情報に紐づく応答を端末に残さないため。

const CACHE = 'sozoro-shell-v6';
const SHELL = [
  './',
  './index.html',
  './app.css',
  './manifest.webmanifest',
  './js/main.js',
  './js/geo.js',
  './js/compass.js',
  './js/congestion.js',
  './js/map.js',
  './js/api.js',
  './data/congestion.json',
  './vendor/leaflet.js',
  './vendor/leaflet.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Overpass は素通しする

  // ネットワーク優先。キャッシュは「圏外でも開ける」ための保険として使う。
  // キャッシュ優先にすると、開発中の修正が端末に届かなくなるため。
  event.respondWith(
    fetch(request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(request, copy));
        return response;
      })
      .catch(() => caches.match(request).then((cached) => cached ?? caches.match('./index.html')))
  );
});
