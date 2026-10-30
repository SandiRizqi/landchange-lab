# Rencana Implementasi: Perbaikan Hasil Review LandChange-Lab (Labeling)

## Overview
Memperbaiki 7 kendala user + temuan review pada aplikasi labeling (`src/App.jsx`, Tauri + React).
Prioritas: **kebenaran data training dulu** (eraser membuat label palsu), lalu **UX digitasi**
(layout bergeser, overlay menutupi, kursor tak terlihat), lalu **mode tampilan** (flicker, blend),
terakhir performa & polish. Index View (#4) sudah selesai (belum di-commit).

## Baseline
- Commit dulu perubahan Index View yang sudah ada (`package.json`, `App.jsx`, `IndexMap.jsx`,
  `indexMapUtils.js`, `indexMapUtils.test.js`) agar setiap task berikut jadi commit terpisah.
- Verifikasi otomatis: `npm test` (node:test, logika murni) + `npx vite build`.
- Verifikasi UI **manual** via `npm run tauri dev` (pemuatan citra butuh backend Tauri,
  tidak bisa diotomasi di browser biasa). Tiap task menyertakan checklist manual.

## Architecture Decisions
1. **Satu jalur commit mask.** Semua edit mask (brush, eraser, polygon, fill, clear, undo) lewat
   `commitMask(idx, canvas)` yang menghitung isi mask → status. Menghapus 6 salinan logika status
   dan 4 salinan "gambar ulang layer mask". Logika murni (`maskHasContent`, `statusAfterEdit`)
   di `src/maskUtils.js` agar bisa dites.
2. **State tile diperbarui saat stroke selesai, bukan per mousemove.** Selama stroke, canvas mask
   dimutasi in-place dan layer mask digambar langsung; `setTiles` sekali di mouseup.
   (Memperbaiki data #3 sekaligus performa — ±4.774 tile direkonsiliasi tiap gerakan mouse.)
3. **Indikator tidak lagi dibakar ke canvas citra.** Label T1/T2, garis swipe, label mode pindah ke
   layer overlay terpisah (`pointerEvents: none`) yang bisa disembunyikan otomatis saat digitasi.
4. **Layout toolbar tetap.** Tidak ada elemen berlebar dinamis di toolbar; kontrol mode
   (slider swipe, kecepatan flicker, gain difference) dipindah ke seksi **VIEW** di panel kanan.
5. **Warna terpusat.** Konstanta `MASK_RGB`, `CURSOR_*` menggantikan hex merah yang tersebar.

## Task List

### Phase 1: Kebenaran Data
- [ ] **T1** — Eraser/brush/polygon lewat `commitMask` (status dari isi mask) + setTiles saat mouseup
- [ ] **T2** — Shortcut keyboard tidak dobel saat tombol sedang fokus

### Checkpoint A
- [ ] `npm test` + build hijau
- [ ] Manual: eraser di tile kosong tetap "Belum"; hapus semua → "Belum"; export tak berisi tile
      "Berubah" dengan mask kosong; menggambar terasa lancar di citra besar
- [ ] Review manusia

### Phase 2: UX Digitasi
- [ ] **T3** — Toolbar stabil + seksi VIEW di panel kanan (slider swipe & flicker pindah) [#5b, #7]
- [ ] **T4** — Layer overlay indikator + auto-hide saat digitasi + toggle [H]; hapus handle ⇔ [#6, #7]
- [ ] **T5** — Kursor kontras (outline ganda) + konstanta warna [#5a]

### Checkpoint B
- [ ] Build hijau
- [ ] Manual: aktifkan polygon & klik titik → canvas tidak bergeser; label/garis hilang saat
      menggambar; kursor terlihat di atas mask opacity 100%
- [ ] Review manusia

### Phase 3: Mode Tampilan
- [ ] **T6** — Hapus tint warna pada flicker [#2]
- [ ] **T7** — Hapus mode Blend [#1]
- [ ] **T8** — Peringatan saat dimensi T1 ≠ T2 (asumsi selaras piksel)

### Checkpoint C
- [ ] Build hijau; manual: swipe vs flicker tampil identik; tidak ada sisa Blend
- [ ] Review manusia

### Phase 4: Performa & Polish (opsional)
- [ ] **T9** — Daftar tile: `React.memo` per baris + windowing sederhana

### Checkpoint Selesai
- [ ] Semua acceptance criteria terpenuhi; user verifikasi di aplikasi

---

## Detail Task

### T1: Satu jalur commit mask (eraser tidak lagi membuat label palsu) — #3
**Description:** Tambah `src/maskUtils.js` (`maskHasContent(imageData, alphaThreshold=100)`,
`statusAfterEdit(prevStatus, hasContent)`). Di `App.jsx`: `commitMask(idx, mc)` memeriksa isi mask —
kosong → `maskCanvas: null`, status kembali `pending`; berisi → `labeled`. Stroke brush/eraser
memutasi canvas in-place selama drag dan memanggil `commitMask` sekali di mouseup/mouseleave.
Eraser pada tile tanpa mask = no-op. `finishPolygon`, `fillAll`, `clearMask` lewat jalur yang sama.
Snapshot undo menyimpan `{canvas, status}` agar undo memulihkan status asli.
Ekstrak `paintMaskLayer(mc)` menggantikan 4 salinan kode gambar ulang.

**Acceptance criteria:**
- [ ] Eraser di tile tanpa mask: status tetap seperti semula, `maskCanvas` tetap null.
- [ ] Menghapus seluruh mask (eraser/polygon eraser) → `maskCanvas: null`, status `pending`.
- [ ] Undo memulihkan mask **dan** status sebelumnya (termasuk `no_change`/`skipped`).
- [ ] `setTiles` tidak dipanggil di setiap mousemove (hanya saat stroke selesai).
- [ ] Export: tidak ada tile `labeled` dengan mask seluruhnya hitam.

**Verification:**
- [ ] `npm test` — test baru `maskUtils.test.js` (mask kosong/berisi/threshold alpha; transisi status)
- [ ] `npx vite build`
- [ ] Manual (tauri dev): skenario di acceptance criteria + export ZIP, cek `masks/` tile berstatus labeled

**Dependencies:** Baseline commit
**Files:** `src/maskUtils.js` (baru), `src/maskUtils.test.js` (baru), `src/App.jsx`
**Scope:** Medium

### T2: Shortcut tidak dobel saat tombol fokus
**Description:** Handler keydown global (`App.jsx` ±:700) mengabaikan event bila target adalah
`BUTTON`/`SELECT`/`TEXTAREA`, dan tombol toolbar tidak mengambil fokus
(`onMouseDown={e => e.preventDefault()}`), sehingga Enter/Space tidak mengaktifkan tombol terakhir.

**Acceptance criteria:**
- [ ] Klik "Skip" lalu tekan Enter → hanya `confirmNext` (bukan skip + confirm).
- [ ] Space+drag (pan) setelah klik tombol tidak memicu tombol tersebut.

**Verification:** build + manual di tauri dev (WebView2)
**Dependencies:** None
**Files:** `src/App.jsx`
**Scope:** Small

### T3: Toolbar stabil + seksi VIEW — #5b, #7
**Description:** Hapus span "N titik · …" dari toolbar (sudah ada di panel kanan). Toolbar
`flexWrap: "nowrap"` + `overflowX: auto`. Hapus bar swipe kondisional di atas canvas; buat seksi
**VIEW** di panel kanan berisi tombol mode + kontrol sesuai mode (slider swipe / kecepatan flicker /
gain difference) dengan tinggi tetap. Tambah shortcut swipe `,` / `.` (±5%).

**Acceptance criteria:**
- [ ] Mengaktifkan polygon, menambah titik, mengganti mode → posisi canvas tidak bergeser
      (tinggi area di atas canvas konstan).
- [ ] Slider swipe ada di panel kanan; swipe bisa juga via `,` / `.`.

**Verification:** build + manual (ukur: canvas tidak melompat saat ganti tool/mode)
**Dependencies:** T1 (konflik edit di area render yang sama — kerjakan berurutan)
**Files:** `src/App.jsx` (pertimbangkan ekstrak `ViewControls` ke file sendiri)
**Scope:** Medium

### T4: Layer overlay indikator + auto-hide — #6, #7
**Description:** `redrawDisplay` hanya menggambar citra. Tambah canvas/DOM overlay di atas mask
(`pointerEvents: none`) untuk garis swipe (tipis, tanpa lingkaran ⇔), label T1/T2, label mode.
Overlay disembunyikan saat sedang menggambar, saat polygon punya titik, dan saat kursor tool
berada di atas canvas; toggle manual `[H]`.

**Acceptance criteria:**
- [ ] Tidak ada teks/handle di atas citra selama digitasi.
- [ ] Lingkaran ⇔ dihapus; garis swipe tipis tetap (bila overlay tampil).
- [ ] `[H]` menampilkan/menyembunyikan overlay; status tersimpan selama sesi.

**Verification:** build + manual
**Dependencies:** T3
**Files:** `src/App.jsx` (opsional `src/CanvasOverlay.jsx`)
**Scope:** Medium

### T5: Kursor kontras + konstanta warna — #5a
**Description:** Kursor brush/eraser/polygon digambar dengan outline ganda (hitam luar + putih dalam;
eraser tetap dibedakan dengan garis putus-putus). Konstanta `MASK_RGB`/`MASK_FILL` dan `CURSOR_*`
menggantikan `#ff3232` / `rgba(255,50,50,…)` yang tersebar.

**Acceptance criteria:**
- [ ] Kursor terlihat jelas di atas mask merah dengan opacity 100% dan di atas citra terang/gelap.
- [ ] Tidak ada lagi literal `#ff3232`/`255,50,50` di luar konstanta.

**Verification:** `grep` literal warna; build; manual
**Dependencies:** None (boleh paralel dengan T3/T4, tapi commit terpisah)
**Files:** `src/App.jsx`
**Scope:** Small

### T6: Hapus tint flicker — #2
**Description:** Hapus `fillRect` tint biru/oranye pada mode flicker; penanda T1/T2 lewat overlay (T4).
**Acceptance criteria:** [ ] Piksel citra di flicker identik dengan sisi yang sama di swipe.
**Verification:** build + manual (bandingkan screenshot swipe kiri vs flicker T1)
**Dependencies:** T4
**Files:** `src/App.jsx` · **Scope:** XS

### T7: Hapus mode Blend — #1
**Description:** Hapus mode `diff` (Blend): tombol, cabang render di `redrawDisplay`, shortcut `[3]`,
dan warna tema `blendLabel`. Mode tersisa: Swipe `[1]`, Flicker `[2]`.
**Acceptance criteria:**
- [ ] Tidak ada tombol/shortcut/kode Blend tersisa (`grep -n "diff\|blend" src/App.jsx` bersih).
- [ ] Swipe & Flicker tetap berfungsi.
**Verification:** grep + build + manual
**Dependencies:** T3, T4 (area render yang sama)
**Files:** `src/App.jsx` · **Scope:** XS

### T8: Peringatan dimensi T1 ≠ T2
**Description:** Saat generate tiles, bila ukuran T1 dan T2 berbeda, tampilkan peringatan
(tile hanya menutupi area tumpang-tindih dari kiri-atas; citra mungkin tidak sejajar).
**Acceptance criteria:** [ ] Dialog peringatan muncul dengan dimensi kedua citra; user bisa lanjut/batal.
**Verification:** build + manual (dua citra beda ukuran)
**Dependencies:** None · **Files:** `src/App.jsx` · **Scope:** XS

### T9 (opsional): Performa daftar tile
**Description:** Ekstrak baris daftar tile ke komponen `React.memo`; windowing sederhana
(render hanya baris yang terlihat berdasarkan scrollTop, tinggi baris tetap) — tanpa dependency baru.
**Acceptance criteria:** [ ] Proyek ±5.000 tile: scroll & navigasi responsif; hanya ±30 baris di DOM.
**Verification:** build + manual (DevTools: jumlah node baris)
**Dependencies:** T1 · **Files:** `src/App.jsx`, `src/TileList.jsx` (baru) · **Scope:** Medium

---

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| UI tidak bisa dites otomatis (butuh backend Tauri) | High | Logika murni dipisah & dites; checklist manual tiap task; checkpoint dengan user |
| Edit beruntun di `App.jsx` (1916 baris) saling bentrok | Med | Urutan T1→T3→T4→T6/T7; satu commit per task |
| Stroke in-place + commit di mouseup: stroke hilang bila mouse keluar canvas | Med | `commitMask` juga dipanggil di mouseleave & saat ganti tile |
| Mengubah semantik undo memengaruhi project lama | Low | Snapshot baru `{canvas,status}`; undo stack tidak disimpan ke file project |

## Out of Scope (ditunda)
- Koordinat geografis di Index View (butuh pembacaan tag GeoTIFF di `src-tauri/src/main.rs`).
- Konversi 16-bit (`to_rgba8`) dan pembatasan path pada command Tauri kustom.
- Font Google dibundel lokal.

## Keputusan (dijawab user)
1. **Blend dihapus**, tidak diganti Difference → T7 menjadi "Hapus mode Blend" (mode tersisa: Swipe, Flicker).
2. **Kontrol mode di seksi VIEW panel kanan.**
3. **Overlay auto-hide setiap kursor tool berada di atas canvas** (+ toggle [H]).
4. Utamakan UI/UX yang nyaman: tiap task UI dicek konsistensi gaya, tooltip/shortcut, dan tidak ada lompatan layout.
