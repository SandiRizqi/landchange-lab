# Spec: Perbaikan UX & Kebenaran Data — LandChange-Lab (Labeling)

## Objective
LandChange-Lab adalah aplikasi desktop (Tauri) untuk melabeli perubahan tutupan lahan antara dua
citra (T1 *before*, T2 *after*). Hasil labeling (ZIP berisi `before/`, `after/`, `masks/`,
`manifest.json`) menjadi **data training** model deteksi perubahan.

**Pengguna:** labeler/analis yang melabeli ribuan tile per citra dengan brush, eraser, dan polygon.

**Tujuan perbaikan ini:** menghilangkan kendala yang dilaporkan user sehingga labeling
**benar secara data** dan **nyaman dipakai berjam-jam**:
1. Mask/status tile selalu konsisten — tidak ada tile "Berubah" dengan mask kosong. *(selesai: T1)*
2. Posisi canvas tidak pernah bergeser saat digitasi.
3. Tidak ada teks/indikator yang menutupi citra saat digitasi.
4. Kursor selalu terlihat, termasuk di atas mask merah opacity 100%.
5. Swipe dan Flicker menampilkan piksel citra yang identik.
6. Mode Blend dihapus (tidak dipakai).
7. Lokasi tile pada citra penuh selalu terlihat. *(selesai: Index View)*

## Tech Stack
- Frontend: React 18 + Vite 5 (JS/JSX, tanpa TypeScript), satu komponen utama `src/App.jsx`
- Desktop: Tauri v2 (Rust, `src-tauri/`), WebView2 di Windows
- Citra dimuat lewat command Rust `load_image_as_png_b64` (crate `image`)
- Export/project: JSZip
- Test: `node:test` bawaan Node 22 (tanpa dependency)

## Commands
```
Install:        npm install
Dev (desktop):  npm run tauri dev
Unit test:      npm test
Build web:      npx vite build
Build desktop:  npm run tauri build
```
Lint belum dikonfigurasi di proyek; pemeriksaan `no-undef` dijalankan ad-hoc dari luar proyek
(tidak menambah dependency).

## Project Structure
```
src/App.jsx              → Aplikasi utama (setup, labeling, QC)
src/IndexMap.jsx         → Index View (peta lokasi tile)
src/*Utils.js            → Logika murni yang bisa dites (indexMapUtils, maskUtils)
src/*.test.js            → Test node:test, berdampingan dengan modulnya
src-tauri/src/main.rs    → Command Tauri (load citra, baca/tulis file)
tasks/plan.md, todo.md   → Rencana & daftar task
SPEC.md                  → Dokumen ini
```
Komponen UI baru yang cukup besar diekstrak ke file sendiri di `src/` (contoh: `IndexMap.jsx`)
alih-alih menambah `App.jsx` (sudah >1.900 baris).

## Code Style
Ikuti gaya yang sudah ada: inline style object bertema (`th.*`), `useCallback` + ref `W` untuk
state terbaru di handler non-reaktif, komentar & teks UI dalam Bahasa Indonesia.

```jsx
// Satu-satunya jalur menyimpan hasil edit mask. Status dihitung dari ISI mask.
const commitMask = useCallback((idx, mc) => {
  const tile = W.current.tiles[idx];
  if (!tile) return;
  const has = canvasHasContent(mc);
  const updated = [...W.current.tiles];
  updated[idx] = { ...tile, maskCanvas: has ? mc : null, status: statusAfterEdit(tile.status, has) };
  W.current.tiles = updated;
  setTiles(updated);
}, []);
```
- Logika yang bisa diuji (perhitungan, transisi status) dipisah ke modul murni `src/*Utils.js`.
- Warna dipakai lewat konstanta bernama, bukan literal hex tersebar.
- Shortcut tercantum di label tombol/tooltip, format `[K]`.

## Testing Strategy
- **Unit (otomatis):** logika murni di `src/*Utils.js` dites dengan `node:test` (`npm test`).
  Setiap task yang menambah logika non-UI wajib menambah test terlebih dahulu (RED → GREEN).
- **Build:** `npx vite build` harus lolos di setiap task.
- **Statis:** cek `no-undef` (ESLint ad-hoc) pada file yang diubah — build Vite tidak menangkap
  variabel tak terdefinisi.
- **Manual (wajib untuk task UI):** `npm run tauri dev` dengan dua citra nyata; checklist per task
  di `tasks/plan.md`. UI tidak bisa dites otomatis karena pemuatan citra butuh backend Tauri.

## Boundaries
- **Always:**
  - Satu commit per task; jalankan `npm test` + build sebelum commit.
  - Pertahankan format export (`before/`, `after/`, `masks/` putih=berubah/hitam=tidak, `manifest.json`)
    — dipakai pipeline training.
  - Pertahankan shortcut yang ada, kecuali `[3]` (Blend) yang dihapus; shortcut baru tidak boleh
    bentrok dengan yang lama.
  - Dukung tema gelap dan terang untuk setiap elemen UI baru.
- **Ask first:**
  - Menambah dependency npm/Cargo.
  - Mengubah backend Rust (`src-tauri/`) atau format file project `.lcproject`/export.
  - Menghapus fitur selain Blend, atau dead code yang tidak terkait task.
- **Never:**
  - Mengubah perilaku export sehingga mask/label yang sudah ada berubah makna.
  - Menghapus atau melemahkan test yang gagal untuk meloloskan build.
  - Menyentuh `dist/` di repo saat verifikasi build (build ke folder sementara).

## Success Criteria
| # | Kriteria | Task |
|---|----------|------|
| S1 | Eraser/hapus-habis tidak pernah menghasilkan tile "Berubah" tanpa mask; undo memulihkan status | T1 ✅ |
| S2 | Enter/Space tidak memicu tombol yang sedang fokus selain aksi shortcut-nya | T2 |
| S3 | Tinggi area di atas canvas konstan saat ganti tool, menambah titik polygon, atau ganti mode | T3 |
| S4 | Kontrol mode (slider swipe, kecepatan flicker) berada di seksi VIEW panel kanan; swipe juga via `[,]`/`[.]` | T3 |
| S5 | Tidak ada teks/handle di atas citra selama kursor tool berada di canvas; `[H]` toggle overlay | T4 |
| S6 | Lingkaran handle ⇔ dihapus | T4 |
| S7 | Kursor terlihat di atas mask merah opacity 100% dan citra terang/gelap | T5 |
| S8 | Piksel citra di Flicker identik dengan Swipe (tanpa tint) | T6 |
| S9 | Tidak ada tombol/shortcut/kode Blend tersisa | T7 |
| S10 | Peringatan muncul bila dimensi T1 ≠ T2 saat generate tiles | T8 |
| S11 | (opsional) Proyek ±5.000 tile: daftar tile responsif, hanya baris terlihat yang di-render | T9 |

## Assumptions
1. Aplikasi dipakai di Windows (WebView2), satu pengguna, lokal.
2. Tidak ada dependency runtime baru; seluruh perubahan di frontend (`src/`).
3. Format export & project tidak berubah (T1 hanya memperbaiki status tile lama saat dimuat).
4. Shortcut baru: `[H]` overlay, `[,]`/`[.]` geser swipe ±5%.

## Out of Scope
- Koordinat geografis di Index View (butuh pembacaan tag GeoTIFF di Rust).
- Konversi citra 16-bit, pembatasan path command Tauri, bundling font lokal.

## Open Questions
- (tidak ada — keputusan Blend, letak kontrol, dan auto-hide overlay sudah dijawab)
