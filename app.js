/* Report HK — logika tampilan. Data & antrean: kirim.js (IndexedDB). */
var A = { akun: null, master: [], kamarMap: {}, serverHariIni: [], form: null };
function $(id) { return document.getElementById(id); }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function msg(el, jenis, teks) { el.innerHTML = teks ? '<div class="msg ' + jenis + '">' + esc(teks) + '</div>' : ''; }
function pad(n) { return ('0' + n).slice(-2); }
// tanggal & jam SELALU WITA (lihat kirim.js: sekarangWita/waktuWita) — tidak tergantung bahasa / zona / jam HP
function hariIni() { return tanggalWita(); }
function show(id) { ['sLogin', 'sHome', 'sForm', 'sManual'].forEach(function (s) { $(s).classList.toggle('hidden', s !== id); }); window.scrollTo(0, 0); }
function kodeBaru() { var a = new Uint8Array(4); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join(''); }
/** B06JS107 → {mess:'B6', kode3:'B06', lantai:'1', no:'107'} */
function infoKamar(k) { var m = A.kamarMap[k] || {}; return { mess: m.m || k.slice(0, 3), kode3: k.slice(0, 3), lantai: k.charAt(5), no: k.slice(5) }; }
function namaKamar(k) { var i = infoKamar(k); return 'Mess ' + i.mess + ' · ' + i.no; }

/* ---------------- mulai ---------------- */
function mulai() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () { });
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () { });   // minta browser tidak menghapus data offline
  Promise.all([metaAmbil('akun'), metaAmbil('master'), muatSelisihJam()]).then(function (r) {
    A.akun = r[0] || null; setMaster((r[1] && r[1].kamar) || []);
    if (!A.akun) { show('sLogin'); return; }
    keHome(); segarkanDariServer();
  }).catch(function (e) { show('sLogin'); msg($('mLogin'), 'err', 'Penyimpanan HP tidak bisa dibuka: ' + e.message); });
  window.addEventListener('online', function () { netUi(); kirim(); });
  window.addEventListener('offline', netUi);
  setInterval(function () { if (navigator.onLine) kirim(true); }, 45000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && navigator.onLine) kirim(true); });
}
function setMaster(k) { A.master = k; A.kamarMap = {}; k.forEach(function (x) { A.kamarMap[x.k] = x; }); }
function segarkanDariServer() {
  if (!navigator.onLine || !A.akun) return;
  metaAmbil('master').then(function (m) {
    if (m && m.kamar && m.kamar.length && Date.now() - (m.disimpan || 0) < 864e5) return;
    return api({ aksi: 'master', token: A.akun.token }).then(function (j) {
      if (j.ok) { j.disimpan = Date.now(); setMaster(j.kamar); return metaSimpan('master', j); }
      if (j.sesi === false) sesiHabis();
    });
  }).catch(function () { });
  api({ aksi: 'hariIni', token: A.akun.token }).then(function (j) {
    if (j.ok) { A.serverHariIni = j.list; renderHome(); } else if (j.sesi === false) sesiHabis();
  }).catch(function () { });
  kirim(true);
}

/* ---------------- login ---------------- */
$('fLogin').addEventListener('submit', function (e) {
  e.preventDefault();
  var b = $('bLogin'); msg($('mLogin'), '', '');
  if (!navigator.onLine) { msg($('mLogin'), 'err', 'Login perlu sinyal internet. Cari sinyal dulu, lalu coba lagi.'); return; }
  b.disabled = true; b.innerHTML = '<span class="spin"></span> Memeriksa…';
  api({ aksi: 'login', nrp: $('lNrp').value, pwd: $('lPw').value }).then(function (j) {
    if (!j.ok) { msg($('mLogin'), 'err', j.error || 'Login gagal.'); return; }
    var lama = A.akun;
    if (lama && lama.nrp !== j.nrp) {   // ganti akun di HP yang sama: laporan yang belum terkirim tetap atas nama pemilik lama
      return lapSemua().then(function (s) {
        if (s.some(function (l) { return l.status === 'antri' || l.status === 'draf'; })) { msg($('mLogin'), 'err', 'Masih ada laporan ' + lama.label + ' yang belum terkirim. Login dengan akun ' + lama.nrp + ' dulu sampai semua terkirim.'); return; }
        return simpanAkun(j);
      });
    }
    return simpanAkun(j);
  }).catch(function () { msg($('mLogin'), 'err', 'Tidak bisa menghubungi server. Periksa sinyal, lalu coba lagi.'); })
    .then(function () { b.disabled = false; b.textContent = 'Masuk'; });
});
function simpanAkun(j) {
  A.akun = { token: j.token, nrp: j.nrp, nama: j.nama, label: j.label, perusahaan: j.perusahaan, exp: j.exp };
  return metaSimpan('akun', A.akun).then(function () { $('lPw').value = ''; $('hSesi').classList.add('hidden'); keHome(); segarkanDariServer(); });
}
function sesiHabis() { $('hSesi').classList.remove('hidden'); }
$('bLoginUlang').onclick = function () { $('lNrp').value = A.akun ? A.akun.nrp : ''; show('sLogin'); };
$('bKeluar').onclick = function () {
  lapSemua().then(function (s) {
    var n = s.filter(function (l) { return l.status === 'antri' || l.status === 'draf'; }).length;
    if (n) { alert('Masih ada ' + n + ' laporan yang belum terkirim / belum selesai (foto AFTER). Selesaikan dulu sebelum keluar.'); return; }
    if (!confirm('Keluar dari aplikasi?')) return;
    metaHapus('akun').then(function () { A.akun = null; show('sLogin'); });
  });
};

/* ---------------- beranda ---------------- */
function keHome() { show('sHome'); renderHome(); netUi(); petunjukPasang(); }
function netUi() { var on = navigator.onLine; $('hNet').classList.toggle('off', !on); $('hNet').querySelector('span').textContent = on ? 'Online' : 'Offline'; $('bKirim').disabled = !on; }
function petunjukPasang() {
  var standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  var el = $('hInstal');
  if (standalone) { el.classList.add('hidden'); return; }
  el.innerHTML = ios ? '📲 <b>Pasang aplikasi:</b> tekan tombol <b>Bagikan</b> (kotak panah) di Safari → <b>Tambah ke Layar Utama</b>. Setelah itu buka dari ikon di layar HP.'
    : '📲 <b>Pasang aplikasi:</b> buka menu ⋮ Chrome → <b>Tambahkan ke layar utama / Instal aplikasi</b>, lalu buka dari ikon di layar HP.';
  el.classList.remove('hidden');
}
function laporanHariIni() {
  var hari = hariIni();
  return lapSemua().then(function (lokal) {
    var map = {};
    A.serverHariIni.forEach(function (s) { map[s.kode] = { kode: s.kode, bagian: s.bagian, terkunci: s.terkunci, jam: s.jam, status: 'terkirim' }; });
    lokal.forEach(function (l) { if (l.status === 'draf') return; if (l.waktu.slice(0, 10) === hari || l.status !== 'terkirim') map[l.kode] = { kode: l.kode, bagian: l.bagian, terkunci: l.terkunci, jam: l.waktu.slice(11, 16), status: l.status, pesan: l.pesan, tanggal: l.waktu.slice(0, 10) }; });
    return Object.keys(map).map(function (k) { return map[k]; });
  });
}
function renderHome() {
  if (!A.akun) return;
  var w = sekarangWita(), j = w.getUTCHours();
  var HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'], BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  $('hSalam').textContent = (j < 4 ? 'Selamat malam' : j < 11 ? 'Selamat pagi' : j < 15 ? 'Selamat siang' : j < 18 ? 'Selamat sore' : 'Selamat malam') + ' 👋';
  $('hNama').textContent = A.akun.nama || A.akun.label;
  $('hTgl').textContent = HARI[w.getUTCDay()] + ', ' + w.getUTCDate() + ' ' + BULAN[w.getUTCMonth()] + ' ' + w.getUTCFullYear() + ' · ' + A.akun.nrp;
  renderDraf();
  laporanHariIni().then(function (list) {
    var hari = hariIni(), kini = list.filter(function (x) { return (x.tanggal || hari) === hari; });
    var n = function (st) { return list.filter(function (x) { return x.status === st; }).length; };
    $('nKirim').textContent = kini.filter(function (x) { return x.status === 'terkirim'; }).length;
    $('nTunggu').textContent = n('antri'); $('nGagal').textContent = n('gagal');
    renderTarget(kini);
    list.sort(function (a, b) { return (b.tanggal || hari) + b.jam < (a.tanggal || hari) + a.jam ? -1 : 1; });
    $('hList').innerHTML = list.length ? list.map(function (x) {
      var tag = x.status === 'terkirim' ? '<span class="tag s-ok">✓ Terkirim</span>' : x.status === 'antri' ? '<span class="tag s-wait">⏳ Menunggu sinyal</span>' : '<span class="tag s-bad">✗ Gagal</span>';
      return '<div class="it"><div class="k"><b>' + esc(namaKamar(x.bagian)) + '</b><span class="muted">' + (x.tanggal && x.tanggal !== hari ? esc(x.tanggal) + ' ' : '') + esc(x.jam) + ' · ' + (x.terkunci ? '🔒 Terkunci' : '🧹 Dibersihkan') + '</span>' +
        (x.status === 'gagal' ? '<div class="muted" style="color:var(--bad)">' + esc(x.pesan || '') + ' <button class="link" style="color:var(--bad)" data-hapus="' + esc(x.kode) + '">Hapus</button></div>' : '') + '</div>' + tag + '</div>';
    }).join('') : '<p class="muted">Belum ada laporan hari ini.</p>';
  });
}
/** Kartu "Sedang dibersihkan": kamar yang sudah foto BEFORE, menunggu foto AFTER. */
function renderDraf() {
  drafSaya().then(function (ds) {
    $('hDrafCard').classList.toggle('hidden', !ds.length);
    var kini = waktuWita();
    $('hDraf').innerHTML = ds.map(function (d) {
      var m = selisihMenit(d.jamBefore, kini);
      return '<div class="it" data-draf="' + esc(d.kode) + '"><div class="k"><b>' + esc(namaKamar(d.bagian)) + '</b><span class="muted">' +
        (d.jamBefore ? 'Mulai ' + esc(d.jamBefore.slice(11, 16)) + (m != null && m >= 0 ? ' · ' + m + ' menit lalu' : '') : 'Belum ada foto BEFORE') +
        ' · <button class="link" type="button" data-hapusdraf="' + esc(d.kode) + '" style="color:var(--bad);font-size:13px">Hapus</button></span></div>' +
        '<button class="go" type="button">📷 Foto AFTER</button></div>';
    }).join('');
  });
}
$('hDraf').addEventListener('click', function (e) {
  var h = e.target.closest('[data-hapusdraf]');
  if (h) { if (confirm('Hapus laporan kamar ini dari HP? Foto BEFORE ikut terhapus.')) lapHapus(h.dataset.hapusdraf).then(renderHome); return; }
  var it = e.target.closest('[data-draf]'); if (!it) return;
  drafSaya().then(function (ds) { var d = ds.filter(function (x) { return x.kode === it.dataset.draf; })[0]; if (d) bukaDraf(d); });
});
/** Target: kamar DIBERSIHKAN setara ≥1 lantai per hari (Σ kamar bersih ÷ jumlah kamar di lantai itu ≥ 100%). Terkunci tidak dihitung. */
function renderTarget(kini) {
  var per = {};
  kini.forEach(function (x) {
    if (x.terkunci) return;
    var i = infoKamar(x.bagian), key = i.kode3 + '|' + i.lantai;
    (per[key] = per[key] || { mess: i.mess, kode3: i.kode3, lantai: i.lantai, kamar: {} }).kamar[x.bagian] = 1;
  });
  var total = 0, rows = Object.keys(per).map(function (key) {
    var p = per[key], semua = A.master.filter(function (m) { return m.k.slice(0, 3) === p.kode3 && m.k.charAt(5) === p.lantai; }).length || 1;
    var bersih = Object.keys(p.kamar).length, pr = Math.min(1, bersih / semua); total += bersih / semua;
    return '<div class="lt"><div class="h"><span>Mess ' + esc(p.mess) + ' · Lantai ' + esc(p.lantai) + '</span><span>' + bersih + '/' + semua + ' kamar</span></div><div class="bar"><i style="width:' + Math.round(pr * 100) + '%"></i></div></div>';
  });
  var persen = Math.round(total * 100);
  $('hTarget').innerHTML = '<div class="target ' + (persen >= 100 ? 's-ok' : 's-wait') + '">' + (persen >= 100 ? '🎉 Target 1 lantai tercapai (' + persen + '%)' : 'Capaian ' + persen + '% dari target 1 lantai') + '</div>' +
    '<p class="muted" style="margin:0">Dihitung dari kamar yang <b>dibersihkan</b> hari ini (kamar terkunci tidak dihitung).</p>';
  $('hLantai').innerHTML = rows.join('');
}
$('hList').addEventListener('click', function (e) {
  var b = e.target.closest('[data-hapus]'); if (!b) return;
  if (confirm('Hapus laporan yang gagal ini dari HP? (tidak terkirim ke server)')) lapHapus(b.dataset.hapus).then(renderHome);
});

/* ---------------- kirim ---------------- */
function kirim(diam) {
  if (!A.akun) return Promise.resolve();
  if (!diam) $('mSync').textContent = 'Mengirim…';
  return kirimAntrean(function () { renderHome(); }).then(function (r) {
    if (r.sesiHabis) sesiHabis();
    var t = sekarangWita();
    $('mSync').textContent = r.putus && r.sisa ? 'Belum semua terkirim (sinyal lemah / server sibuk). Dicoba lagi otomatis.' : 'Terakhir dicek ' + pad(t.getUTCHours()) + ':' + pad(t.getUTCMinutes()) + ' WITA';
    renderHome();
  }).catch(function (e) { $('mSync').textContent = 'Gagal: ' + e.message; });
}
$('bKirim').onclick = function () { kirim(false); };
function daftarSyncLatar() {   // Android: browser mengirim sendiri saat sinyal kembali walau aplikasi ditutup
  if (navigator.serviceWorker && 'SyncManager' in window) navigator.serviceWorker.ready.then(function (r) { return r.sync.register('kirim-laporan'); }).catch(function () { });
}

/* ---------------- form laporan ---------------- */
// A.form = {kode, bagian, terkunci, before, jamBefore, after, jamAfter}
// Setelah foto BEFORE diambil, laporan langsung disimpan di HP sebagai "draf" (Sedang dibersihkan) supaya
// aman walau HP dikunci / aplikasi tertutup selama membersihkan. Foto AFTER melengkapi draf → masuk antrean kirim.
function formKosong() { return { kode: '', bagian: '', terkunci: null, before: '', jamBefore: '', after: '', jamAfter: '' }; }
function laporanBaru() {
  if (!A.master.length) { alert('Daftar kamar belum tersimpan di HP. Buka aplikasi sekali saat ada sinyal.'); return; }
  A.form = formKosong();
  $('fKamar').textContent = 'Belum dipilih'; $('fKamarInfo').textContent = 'Scan QR di pintu kamar'; $('fDobel').classList.add('hidden');
  ['pBefore', 'pAfter'].forEach(function (id) { resetFoto(id); });
  setKunci(null); msg($('mForm'), '', ''); show('sForm');
  bukaScan();   // langsung buka kamera scan QR (sesedikit mungkin tombol untuk ibu HK)
}
$('bBaru').onclick = laporanBaru;
/** Pesan besar setelah simpan + tombol langsung lapor kamar berikutnya. */
function sukses(judul, isi) {
  var el = $('toast');
  el.querySelector('b').textContent = judul;
  el.querySelector('p').textContent = isi;
  el.classList.remove('hidden');
  clearTimeout(sukses.t); sukses.t = setTimeout(function () { el.classList.add('hidden'); }, 10000);
}
$('bLagi').onclick = function () { $('toast').classList.add('hidden'); laporanBaru(); };
$('bTutupToast').onclick = function () { $('toast').classList.add('hidden'); };
$('bBatal').onclick = function () {
  var f = A.form;
  if (!f || (!f.bagian && !f.before)) { keHome(); return; }
  if (f.kode) { keHome(); return; }                     // sudah tersimpan sebagai "Sedang dibersihkan" — aman
  if (confirm('Batalkan laporan ini?')) keHome();
};
function isiKamarUi(k) {
  var i = infoKamar(k);
  $('fKamar').textContent = 'Mess ' + i.mess + ' · Kamar ' + i.no; $('fKamarInfo').textContent = 'Lantai ' + i.lantai + ' · ' + k;
}
function pilihKamar(k) {
  var f = A.form;
  if (f.bagian && f.bagian !== k && (f.before || f.after)) {
    if (!confirm('Ganti kamar ke ' + namaKamar(k) + '? Foto yang sudah diambil akan dihapus.')) { show('sForm'); return; }
    if (f.kode) lapHapus(f.kode).catch(function () { });
    A.form = f = formKosong(); resetFoto('pBefore'); resetFoto('pAfter'); setKunci(null);
  }
  if (!f.before) {   // kamar ini sedang dibersihkan (ada draf)? → lanjutkan draf itu (tinggal foto AFTER)
    return drafSaya().then(function (ds) {
      var d = ds.filter(function (x) { return x.bagian === k; })[0];
      if (d) { bukaDraf(d); return; }
      pilihKamarBaru(k);
    });
  }
  pilihKamarBaru(k);
}
function pilihKamarBaru(k) {
  A.form.bagian = k; isiKamarUi(k);
  laporanHariIni().then(function (list) {
    var ada = list.filter(function (x) { return x.bagian === k && (x.tanggal || hariIni()) === hariIni(); });
    var el = $('fDobel');
    el.textContent = ada.length ? 'Kamar ini sudah Anda laporkan hari ini (jam ' + ada.map(function (x) { return x.jam; }).join(', ') + '). Lanjutkan hanya bila memang perlu lapor lagi.' : '';
    el.classList.toggle('hidden', !ada.length);
  });
  if (A.form.kode) simpanDraf();
  tombolSimpan(); show('sForm');
}
function setKunci(v) {
  if (A.form) A.form.terkunci = v;
  if (v !== null) msg($('mForm'), '', '');
  document.querySelectorAll('[data-kunci]').forEach(function (b) { b.classList.toggle('on', v !== null && String(+v) === b.dataset.kunci); });
  $('wAfter').classList.toggle('hidden', v === true);
  tombolSimpan();
}
document.querySelectorAll('[data-kunci]').forEach(function (b) { b.onclick = function () { setKunci(b.dataset.kunci === '1'); if (A.form && A.form.kode) simpanDraf(); }; });
/** Tulisan tombol mengikuti langkah: belum ada AFTER → "Mulai membersihkan". */
function tombolSimpan() {
  var f = A.form, b = $('bSimpan'); if (!f) return;
  b.textContent = f.terkunci === false && f.before && !f.after ? '🧹 Simpan & mulai membersihkan' : f.terkunci === false && !f.before ? 'Simpan laporan' : '✅ Kirim laporan';
}
function resetFoto(id) { var p = $(id); p.querySelectorAll('img,.ganti').forEach(function (x) { x.remove(); }); var s = p.querySelector('span'); s.classList.remove('hidden'); s.textContent = id === 'pBefore' ? '📷 Ambil foto BEFORE' : '📷 Ambil foto AFTER'; p.querySelector('input').value = ''; }
function tampilFoto(id, d) {
  var p = $(id); resetFoto(id); p.querySelector('span').classList.add('hidden');
  var img = document.createElement('img'); img.src = d; p.appendChild(img);
  var g = document.createElement('span'); g.className = 'ganti'; g.textContent = 'Ganti foto'; p.appendChild(g);
}
/** "2026-11-06T08:12:33" → "06/11/2026 08:12:33" */
function jamTeks(w) { return w.slice(8, 10) + '/' + w.slice(5, 7) + '/' + w.slice(0, 4) + ' ' + w.slice(11, 19); }
function selisihMenit(a, b) { return a && b ? Math.round((Date.parse(b + 'Z') - Date.parse(a + 'Z')) / 60000) : null; }
/** Cap foto (watermark) di bagian bawah: jenis + jam WITA, mess/kamar, nama pelapor. Huruf mengecil bila teks terlalu panjang. */
function tulisCap(ctx, w, h, baris) {
  var fs = Math.max(14, Math.round(Math.min(w, h) * 0.04)), pad = Math.round(fs * 0.6);
  ctx.font = '700 ' + fs + 'px system-ui,-apple-system,Roboto,Arial,sans-serif';
  var lebar = Math.max.apply(null, baris.map(function (t) { return ctx.measureText(t).width; }));
  if (lebar > w - pad * 2) fs = Math.max(10, Math.floor(fs * (w - pad * 2) / lebar));
  var lh = Math.round(fs * 1.3), tinggi = lh * baris.length + pad * 2;
  ctx.fillStyle = 'rgba(0,0,0,.58)'; ctx.fillRect(0, h - tinggi, w, tinggi);
  ctx.textBaseline = 'top';
  baris.forEach(function (t, i) {
    ctx.font = (i ? '600 ' : '800 ') + fs + 'px system-ui,-apple-system,Roboto,Arial,sans-serif';
    ctx.fillStyle = i ? '#ffffff' : '#fde047';
    ctx.fillText(t, pad, h - tinggi + pad + i * lh + Math.round((lh - fs) / 2));
  });
}
/** Foto diperkecil di HP: sisi terpanjang 1280 px, JPEG kualitas 0,72 (±100–200 KB) + cap foto. */
function kompres(file, cap) {
  return new Promise(function (res, rej) {
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      var m = 1280, s = Math.min(1, m / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * s); c.height = Math.round(img.naturalHeight * s);
      var ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
      if (cap) tulisCap(ctx, c.width, c.height, cap);
      URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', 0.72));
    };
    img.onerror = function () { URL.revokeObjectURL(url); rej(new Error('Foto tidak bisa dibaca. Ambil ulang.')); };
    img.src = url;
  });
}
[['iBefore', 'pBefore', 'before'], ['iAfter', 'pAfter', 'after']].forEach(function (x) {
  $(x[0]).onchange = function () {
    var f = this.files && this.files[0], inp = this; if (!f) return;
    var F = A.form;
    if (!F.bagian) { inp.value = ''; msg($('mForm'), 'err', 'Pilih kamar dulu (scan QR atau pilih manual), baru ambil foto.'); return; }
    var jam = waktuWita(), i = infoKamar(F.bagian), menit = x[2] === 'after' ? selisihMenit(F.jamBefore, jam) : null;
    var cap = [(x[2] === 'before' ? 'BEFORE' : 'AFTER') + ' · ' + jamTeks(jam) + ' WITA' + (menit != null && menit >= 0 ? ' · ' + menit + ' menit' : ''),
      'Mess ' + i.mess + ' · Kamar ' + i.no + ' (' + F.bagian + ')',
      (A.akun.nama || A.akun.label) + ' · ' + A.akun.nrp];
    var p = $(x[1]); p.querySelector('span').textContent = 'Memproses foto…';
    kompres(f, cap).then(function (d) {
      F[x[2]] = d; F[x[2] === 'before' ? 'jamBefore' : 'jamAfter'] = jam;
      if (x[2] === 'before' && F.after) { F.after = ''; F.jamAfter = ''; resetFoto('pAfter'); }   // BEFORE diulang → AFTER diulang juga (durasi)
      tampilFoto(x[1], d); msg($('mForm'), '', '');
      if (!F.kode) F.kode = kodeBaru();
      simpanDraf(); tombolSimpan();
    }).catch(function (e) { p.querySelector('span').textContent = e.message; });
  };
});
/** Simpan form yang belum lengkap ke HP (status "draf" — tidak dikirim). */
function simpanDraf() {
  var f = A.form; if (!f || !f.kode || !f.bagian) return Promise.resolve();
  return lapSimpan({ kode: f.kode, status: 'draf', dibuat: Date.now(), waktu: f.jamBefore || waktuWita(), bagian: f.bagian, terkunci: f.terkunci,
    before: f.before, jamBefore: f.jamBefore, after: f.after, jamAfter: f.jamAfter }).catch(function () { });
}
function drafSaya() { return lapSemua().then(function (s) { return s.filter(function (l) { return l.status === 'draf'; }).sort(function (a, b) { return (a.jamBefore || a.waktu) < (b.jamBefore || b.waktu) ? -1 : 1; }); }); }
function bukaDraf(d) {
  A.form = { kode: d.kode, bagian: d.bagian, terkunci: d.terkunci == null ? null : d.terkunci, before: d.before || '', jamBefore: d.jamBefore || '', after: d.after || '', jamAfter: d.jamAfter || '' };
  isiKamarUi(d.bagian); $('fDobel').classList.add('hidden'); msg($('mForm'), '', '');
  resetFoto('pBefore'); resetFoto('pAfter');
  if (A.form.before) tampilFoto('pBefore', A.form.before);
  if (A.form.after) tampilFoto('pAfter', A.form.after);
  setKunci(A.form.terkunci === null ? false : A.form.terkunci);
  show('sForm');
  if (A.form.before && !A.form.after) setTimeout(function () { $('wAfter').scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
}
$('bSimpan').onclick = function () {
  var f = A.form, err = '';
  if (!f.bagian) err = 'Pilih kamar dulu (scan QR atau pilih manual).';
  else if (f.terkunci === null) err = 'Pilih kondisi kamar: Dibersihkan atau Terkunci.';
  else if (!f.before) err = 'Foto BEFORE wajib.';
  if (err) { msg($('mForm'), 'err', err); return; }
  var nama = namaKamar(f.bagian);
  if (!f.terkunci && !f.after) {   // baru BEFORE: simpan sebagai "Sedang dibersihkan"
    simpanDraf().then(function () {
      A.form = null; keHome();
      sukses('🧹 Silakan mulai membersihkan', nama + ' · setelah selesai, scan QR kamar ini lagi (atau ketuk di Beranda) untuk foto AFTER.');
    });
    return;
  }
  var l = { kode: f.kode || kodeBaru(), waktu: waktuWita(), dibuat: Date.now(), bagian: f.bagian, terkunci: f.terkunci, before: f.before, after: f.terkunci ? null : f.after,
    jamBefore: f.jamBefore, jamAfter: f.terkunci ? '' : f.jamAfter,
    status: 'antri', perangkat: (/iphone|ipad/i.test(navigator.userAgent) ? 'iOS' : /android/i.test(navigator.userAgent) ? 'Android' : 'Lain') + ' ' + (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone ? 'app' : 'browser') };
  var b = $('bSimpan'); b.disabled = true;
  lapSimpan(l).then(function () {
    A.form = null; keHome(); daftarSyncLatar();
    $('mSync').textContent = navigator.onLine ? 'Mengirim…' : 'Tersimpan di HP. Akan terkirim otomatis saat ada sinyal.';
    var menit = selisihMenit(l.jamBefore, l.jamAfter);
    sukses('✅ Tersimpan', nama + (menit != null && !l.terkunci ? ' · ' + menit + ' menit' : '') + (navigator.onLine ? ' · sedang dikirim' : ' · terkirim otomatis saat ada sinyal'));
    if (navigator.onLine) kirim(true);
  }).catch(function (e) { msg($('mForm'), 'err', 'Gagal menyimpan di HP: ' + e.message + '. Memori HP mungkin penuh.'); })
    .then(function () { b.disabled = false; });
};

/* ---------------- pilih kamar manual ---------------- */
$('bManual').onclick = function () {
  var mess = []; A.master.forEach(function (m) { if (mess.indexOf(m.m) < 0) mess.push(m.m); });
  mess.sort(function (a, b) { return a.localeCompare(b, 'id', { numeric: true }); });
  $('mMess').innerHTML = mess.map(function (m) { return '<button type="button" data-mess="' + esc(m) + '">' + esc(m) + '</button>'; }).join('');
  $('mKamar').innerHTML = '<p class="muted" style="grid-column:1/-1">Pilih mess dulu.</p>';
  show('sManual');
};
$('bManualTutup').onclick = function () { show('sForm'); };
$('mMess').addEventListener('click', function (e) {
  var b = e.target.closest('[data-mess]'); if (!b) return;
  document.querySelectorAll('#mMess button').forEach(function (x) { x.classList.toggle('on', x === b); });
  laporanHariIni().then(function (list) {
    var sudah = {}; list.forEach(function (x) { if ((x.tanggal || hariIni()) === hariIni()) sudah[x.bagian] = 1; });
    var ks = A.master.filter(function (m) { return m.m === b.dataset.mess; }).sort(function (a, c) { return a.k.slice(5) < c.k.slice(5) ? -1 : 1; });
    $('mKamar').innerHTML = ks.map(function (m) { return '<button type="button" data-k="' + m.k + '" class="' + (sudah[m.k] ? 'done' : '') + '">' + m.k.slice(5) + '</button>'; }).join('');
  });
});
$('mKamar').addEventListener('click', function (e) { var b = e.target.closest('[data-k]'); if (b) pilihKamar(b.dataset.k); });

/* ---------------- scan QR (jalan offline: jsQR) ---------------- */
var SC = { stream: null, jalan: false };
$('bScan').onclick = function () { bukaScan(); };
function bukaScan() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { alert('Kamera tidak tersedia di browser ini. Pakai "Pilih manual".'); return; }
  $('scanInfo').textContent = 'Arahkan kamera ke QR di pintu kamar'; $('sScan').classList.remove('hidden');
  navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false }).then(function (s) {
    SC.stream = s; var v = $('vid'); v.srcObject = s; v.setAttribute('playsinline', ''); return v.play();
  }).then(function () { SC.jalan = true; requestAnimationFrame(pindai); })
    .catch(function () { tutupScan(); alert('Izin kamera ditolak. Izinkan kamera untuk aplikasi ini, atau pakai "Pilih manual".'); });
};
function pindai() {
  if (!SC.jalan) return;
  var v = $('vid');
  if (v.readyState >= 2 && v.videoWidth) {
    var c = $('cv'), w = 640, h = Math.round(v.videoHeight * w / v.videoWidth);
    c.width = w; c.height = h;
    var ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(v, 0, 0, w, h);
    var q = jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
    if (q && q.data) {
      var m = String(q.data).toUpperCase().match(/[A-Z]\d{2}[A-Z]{2}\d{3}/), k = m && m[0];
      if (k && A.kamarMap[k]) { if (navigator.vibrate) navigator.vibrate(80); tutupScan(); pilihKamar(k); return; }
      $('scanInfo').textContent = 'QR terbaca tapi bukan kode kamar yang dikenal (' + String(q.data).slice(0, 30) + ')';
    }
  }
  setTimeout(function () { requestAnimationFrame(pindai); }, 120);
}
function tutupScan() { SC.jalan = false; if (SC.stream) SC.stream.getTracks().forEach(function (t) { t.stop(); }); SC.stream = null; $('sScan').classList.add('hidden'); }
$('bScanTutup').onclick = tutupScan;

bersihkanLama().catch(function () { });
mulai();
