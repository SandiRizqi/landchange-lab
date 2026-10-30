# TODO: Perbaikan Hasil Review LandChange-Lab

Detail & acceptance criteria: `tasks/plan.md`.
Verifikasi: `npm test` + `npx vite build` + manual `npm run tauri dev`.

Keputusan: Blend dihapus (tanpa Difference) · kontrol mode di panel kanan (VIEW) ·
overlay auto-hide saat kursor tool di canvas + toggle [H] · utamakan UI/UX nyaman.

## Baseline
- [x] Commit Index View (`21defdb`) + rencana (`943aba1`)

## Phase 1 — Kebenaran Data
- [x] **T1** `commitMask` + `maskUtils.js`: eraser tak membuat label palsu, undo pulihkan status, setTiles saat mouseup, project/ZIP lama diperbaiki saat dimuat [#3] — ⏳ verifikasi manual di tauri dev
- [x] **T2** Shortcut tidak dobel saat tombol fokus (Enter/Space); slider melepas fokus setelah digeser

### ✅ Checkpoint A — data benar, menggambar lancar

## Phase 2 — UX Digitasi
- [x] **T3** Toolbar stabil + seksi VIEW (slider swipe/flicker pindah ke panel kanan, shortcut `,` `.`) [#5b, #7] — diverifikasi di browser (mock Tauri): posisi canvas konstan
- [x] **T4** Layer overlay indikator + auto-hide saat kursor tool di canvas + toggle [H]; hapus handle ⇔ [#6, #7] — diverifikasi di browser; header satu baris (r·c + status selalu terlihat)
- [x] **T5** Kursor outline ganda + konstanta warna [#5a] — diverifikasi di atas mask merah 100% (brush, eraser, polygon)

### ✅ Checkpoint B — canvas tidak bergeser, overlay tak menutupi, kursor terlihat

## Phase 3 — Mode Tampilan
- [x] **T6** Hapus tint flicker [#2] — piksel flicker T1 = swipe T1 (0/1.166.400 berbeda)
- [x] **T7** Hapus mode Blend [#1] (+ README: daftar fitur & tabel shortcut diperbarui/dikoreksi)
- [x] **T8** Peringatan dimensi T1 ≠ T2 (+ rumus grid di 4 tempat → `gridDims`) — Batal/Lanjutkan diverifikasi di browser

### ✅ Checkpoint C — swipe = flicker, Blend hilang

## Phase 4 — Opsional
- [x] **T9** Daftar tile memo + windowing + auto-scroll ke tile aktif — 1.140 tile: ±28 baris di DOM, tile aktif selalu terlihat

## Selesai
- [x] **#4 Index View** (minimap lokasi tile) — dibuat, masuk baseline commit
