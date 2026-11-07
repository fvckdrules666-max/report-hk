/* Service worker Report HK: menyimpan tampilan aplikasi agar bisa dibuka TANPA sinyal,
 * dan (Android) mengirim antrean laporan di latar belakang begitu sinyal kembali.
 * PENTING: setiap rilis WAJIB menaikkan SW_VERSI (= APP_VERSI di kirim.js). Browser (terutama Safari iPhone)
 * hanya memasang versi baru bila isi file sw.js ini berubah. */
var SW_VERSI = '2026-11-07a';
importScripts('kirim.js?v=' + SW_VERSI);
var CACHE = 'reporthk-' + SW_VERSI;
var BERKAS = ['./', './index.html', './app.js', './kirim.js', './jsQR.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './icon.svg'];

self.addEventListener('install', function (e) {
  // ambil SEMUA file versi baru langsung dari server (lewati cache browser), simpan sebagai satu paket
  e.waitUntil(caches.open(CACHE).then(function (c) {
    return Promise.all(BERKAS.map(function (f) {
      return fetch(new Request(f, { cache: 'reload' })).then(function (r) { if (!r.ok) throw new Error(f + ' ' + r.status); return c.put(f, r); });
    }));
  }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k.indexOf('reporthk-') === 0 && k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== self.location.origin) return;   // panggilan server tidak di-cache
  // tampilan aplikasi: dari paket versi ini saja (file lama & baru tidak pernah tercampur); bila tidak ada → internet
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(e.request, { ignoreSearch: true }).then(function (hit) { return hit || fetch(e.request); });
  }));
});
// Android: dipanggil browser saat sinyal kembali (meski aplikasi ditutup)
self.addEventListener('sync', function (e) {
  if (e.tag === 'kirim-laporan') e.waitUntil(kirimAntrean().then(function (r) { if (r.putus) throw new Error('belum terkirim'); }));
});
