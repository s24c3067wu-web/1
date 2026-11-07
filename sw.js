/* えふいーさん Service Worker：オフラインでも使えるようにアプリ本体をキャッシュする */
const CACHE = 'fesan-v2';
const LIB = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/';
const FILES = [
  './', 'index.html', 'css/style.css', 'manifest.webmanifest',
  'js/data-a.js', 'js/data-b.js', 'js/data-terms.js', 'js/drills.js', 'js/ipa-import.js', 'js/app.js',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// ネットワーク優先（更新をすぐ反映）、オフライン時はキャッシュを使う
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // PDF読込み用ライブラリ（バージョン固定）はキャッシュ優先で、オフラインでも問題冊子を表示できるようにする
  if (e.request.url.startsWith(LIB)) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    })));
    return;
  }
  if (new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
