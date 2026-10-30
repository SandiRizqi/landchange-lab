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
- [ ] **T3** Toolbar stabil + seksi VIEW (slider swipe/flicker pindah ke panel kanan, shortcut `,` `.`) [#5b, #7]
- [ ] **T4** Layer overlay indikator + auto-hide saat kursor tool di canvas + toggle [H]; hapus handle ⇔ [#6, #7]
- [ ] **T5** Kursor outline ganda + konstanta warna [#5a]

### ✅ Checkpoint B — canvas tidak bergeser, overlay tak menutupi, kursor terlihat

## Phase 3 — Mode Tampilan
- [ ] **T6** Hapus tint flicker [#2]
- [ ] **T7** Hapus mode Blend [#1]
- [ ] **T8** Peringatan dimensi T1 ≠ T2

### ✅ Checkpoint C — swipe = flicker, Blend hilang

## Phase 4 — Opsional
- [ ] **T9** Daftar tile memo + windowing

## Selesai
- [x] **#4 Index View** (minimap lokasi tile) — dibuat, masuk baseline commit
