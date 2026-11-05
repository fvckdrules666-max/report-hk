/* Report HK — penyimpanan offline (IndexedDB) + pengiriman antrean ke server.
 * Dipakai bersama oleh halaman (app.js) dan service worker (sw.js, untuk kirim di latar belakang di Android). */
var API_URL = 'https://script.google.com/macros/s/AKfycbz5OReGyoLNvlMosAgsqE1cYRxPcIsk2OIyRJmqj3KUuSw4UpCvSvin93HS8sF_dxQK/exec';
var APP_VERSI = '2026-11-06d';

var DB_NAMA = 'reporthk', DB_VERSI = 1;
function dbBuka() {
  return new Promise(function (res, rej) {
    var r = indexedDB.open(DB_NAMA, DB_VERSI);
    r.onupgradeneeded = function () {
      var db = r.result;
      if (!db.objectStoreNames.contains('lap')) db.createObjectStore('lap', { keyPath: 'kode' });   // laporan (antrean + riwayat)
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');                       // akun, master kamar, dll.
    };
    r.onsuccess = function () { res(r.result); };
    r.onerror = function () { rej(r.error); };
  });
}
function dbJalan(store, mode, fn) {
  return dbBuka().then(function (db) {
    return new Promise(function (res, rej) {
      var tx = db.transaction(store, mode), st = tx.objectStore(store), hasil;
      Promise.resolve(fn(st)).then(function (h) { hasil = h; });
      tx.oncomplete = function () { res(hasil); };
      tx.onerror = function () { rej(tx.error); };
      tx.onabort = function () { rej(tx.error || new Error('Penyimpanan HP penuh / ditolak.')); };
    });
  });
}
function req(r) { return new Promise(function (res, rej) { r.onsuccess = function () { res(r.result); }; r.onerror = function () { rej(r.error); }; }); }
function metaAmbil(k) { return dbJalan('meta', 'readonly', function (st) { return req(st.get(k)); }); }
function metaSimpan(k, v) { return dbJalan('meta', 'readwrite', function (st) { return req(st.put(v, k)); }); }
function metaHapus(k) { return dbJalan('meta', 'readwrite', function (st) { return req(st.delete(k)); }); }
function lapSemua() { return dbJalan('lap', 'readonly', function (st) { return req(st.getAll()); }); }
function lapSimpan(l) { return dbJalan('lap', 'readwrite', function (st) { return req(st.put(l)); }); }
function lapHapus(kode) { return dbJalan('lap', 'readwrite', function (st) { return req(st.delete(kode)); }); }

/** Panggil server. Content-Type text/plain = permintaan "sederhana" (tanpa preflight CORS) — cara yang didukung Apps Script.
 *  Setiap jawaban membawa jam server → selisih jam HP disimpan (dipakai saat membuat laporan offline). */
function api(isi) {
  var t0 = Date.now();
  // batas waktu: kiriman yang macet (sinyal hilang / iPhone dikunci saat mengirim) tidak menahan antrean selamanya.
  // Bila habis waktu → dianggap putus → dicoba lagi otomatis (server menolak dobel lewat Kode Unik).
  var ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  var batas = setTimeout(function () { if (ctl) ctl.abort(); }, isi.aksi === 'kirim' ? 90000 : 30000);
  return fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(isi), redirect: 'follow', cache: 'no-store', signal: ctl ? ctl.signal : undefined })
    .then(function (r) { clearTimeout(batas); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }, function (e) { clearTimeout(batas); throw e; })
    .then(function (j) {
      if (j && j.now) { var t1 = Date.now(), sel = j.now - Math.round((t0 + t1) / 2); if (t1 - t0 < 20000) { JAM.selisih = sel; metaSimpan('selisihJam', sel).catch(function () { }); } }
      return j;
    });
}

/* ---- Jam WITA yang seragam, apa pun setelan bahasa / zona / jam HP ----
 * waktu = jam HP + selisih terhadap jam server (diukur saat online), lalu dihitung sebagai UTC+8 (WITA)
 * tanpa memakai zona jam HP. Hasil "yyyy-MM-ddTHH:mm:ss" (angka saja, tidak tergantung bahasa HP). */
var JAM = { selisih: 0 };
function muatSelisihJam() { return metaAmbil('selisihJam').then(function (s) { if (typeof s === 'number') JAM.selisih = s; }).catch(function () { }); }
function sekarangWita() { return new Date(Date.now() + JAM.selisih + 8 * 36e5); }   // baca dengan getUTC*()
function p2(n) { return ('0' + n).slice(-2); }
function waktuWita(d) { d = d || sekarangWita(); return d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate()) + 'T' + p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds()); }
function tanggalWita() { return waktuWita().slice(0, 10); }

/** Kirim semua laporan berstatus "antri", satu per satu (paling lama dulu). Aman dipanggil berkali-kali (dikunci). */
var _sedangKirim = null;
function kirimAntrean(kabar) {
  if (_sedangKirim) return _sedangKirim;
  _sedangKirim = (function () {
    var ringkas = { terkirim: 0, gagal: 0, sisa: 0, sesiHabis: false, putus: false };
    return metaAmbil('akun').then(function (akun) {
      if (!akun || !akun.token) { ringkas.sesiHabis = true; return ringkas; }
      return lapSemua().then(function (semua) {
        var antre = semua.filter(function (l) { return l.status === 'antri'; }).sort(function (a, b) { return a.dibuat - b.dibuat; });
        ringkas.sisa = antre.length;
        var i = 0;
        function lanjut() {
          if (i >= antre.length) return ringkas;
          var l = antre[i++];
          return api({ aksi: 'kirim', token: akun.token, lap: { kode: l.kode, waktu: l.waktu, bagian: l.bagian, terkunci: l.terkunci, before: l.before, after: l.after || null, jamBefore: l.jamBefore || '', jamAfter: l.jamAfter || '', perangkat: l.perangkat, app: APP_VERSI } })
            .then(function (j) {
              if (j && j.ok) {
                // terkirim: foto dibuang dari HP (hemat memori), data ringkas disimpan untuk riwayat hari ini
                l.status = 'terkirim'; l.terkirim = Date.now(); delete l.before; delete l.after; l.pesan = j.dobel ? 'sudah ada di server' : '';
                ringkas.terkirim++; ringkas.sisa--;
                return lapSimpan(l).then(function () { if (kabar) kabar(ringkas); return lanjut(); });
              }
              if (j && j.sesi === false) { ringkas.sesiHabis = true; return ringkas; }          // laporan TETAP di antrean
              if (j && j.tolak) {                                                              // data tidak valid: jangan dikirim ulang terus
                l.status = 'gagal'; l.pesan = j.error || 'Ditolak server'; ringkas.gagal++; ringkas.sisa--;
                return lapSimpan(l).then(function () { if (kabar) kabar(ringkas); return lanjut(); });
              }
              ringkas.putus = true; return ringkas;                                            // server sibuk: coba lagi nanti
            }, function () { ringkas.putus = true; return ringkas; });                         // tidak ada sinyal
        }
        return lanjut();
      });
    });
  })().then(function (r) { _sedangKirim = null; return r; }, function (e) { _sedangKirim = null; throw e; });
  return _sedangKirim;
}

/** Bersihkan riwayat terkirim yang lebih dari 3 hari (antrean & gagal tidak pernah dihapus otomatis). */
function bersihkanLama() {
  var batas = Date.now() - 3 * 864e5;
  return lapSemua().then(function (semua) {
    return Promise.all(semua.filter(function (l) { return l.status === 'terkirim' && (l.terkirim || l.dibuat) < batas; }).map(function (l) { return lapHapus(l.kode); }));
  });
}
