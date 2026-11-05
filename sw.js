/* Service worker Report HK: menyimpan tampilan aplikasi agar bisa dibuka TANPA sinyal,
 * dan (Android) mengirim antrean laporan di latar belakang begitu sinyal kembali. */
importScripts('kirim.js');
var CACHE = 'reporthk-' + APP_VERSI;
var BERKAS = ['./', './index.html', './app.js', './kirim.js', './jsQR.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon.svg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(BERKAS); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('reporthk-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;   // panggilan server tidak di-cache
  // tampilan aplikasi: ambil dari cache dulu (cepat & offline), perbarui di belakang bila ada sinyal
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(e.request, { ignoreSearch: true }).then(function (hit) {
      var baru = fetch(e.request).then(function (r) { if (r && r.ok) c.put(e.request, r.clone()); return r; }).catch(function () { return hit; });
      return hit || baru;
    });
  }));
});
// Android: dipanggil browser saat sinyal kembali (meski aplikasi ditutup)
self.addEventListener('sync', function (e) {
  if (e.tag === 'kirim-laporan') e.waitUntil(kirimAntrean().then(function (r) { if (r.putus) throw new Error('belum terkirim'); }));
});
