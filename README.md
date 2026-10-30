# LandChange Lab 🛰️

Desktop app untuk labeling **Land Change Detection** dari citra multitemporal (T1/T2).  
Dibangun dengan **Tauri v2 + React + Vite**. Backend Rust menangani TIFF natively.

---

## Fitur

- ✅ Buka GeoTIFF / TIFF / PNG / JPG langsung dari disk (via Rust `image` crate)
- ✅ Sliding window tile generator
- ✅ 2 mode perbandingan: **Swipe** · **Flicker** (kontrol di seksi VIEW panel kanan)
- ✅ Brush, eraser & polygon untuk menggambar change mask
- ✅ **Index View**: peta citra penuh dengan posisi tile aktif & status tiap tile (klik untuk lompat)
- ✅ Label & garis bantu otomatis tersembunyi saat digitasi (toggle `H`)
- ✅ Export **1 file ZIP** berisi `before/` · `after/` · `masks/` (disimpan ke path pilihan user)
- ✅ Keyboard shortcuts untuk labeling cepat

---

## Prasyarat (Windows)

### 1. Microsoft C++ Build Tools
Download dan install dari:
https://visualstudio.microsoft.com/visual-cpp-build-tools/

Saat install, centang: **"Desktop development with C++"**

### 2. WebView2 Runtime
Biasanya sudah ada di Windows 10/11. Kalau belum:
https://developer.microsoft.com/en-us/microsoft-edge/webview2/

### 3. Rust (Windows)
Download `rustup-init.exe` dari:
https://rustup.rs/

Jalankan installer, pilih default installation.  
Setelah selesai, **restart terminal**.

Verifikasi:
```powershell
rustc --version
cargo --version
```

### 4. Node.js ≥ 18
Download installer dari https://nodejs.org (pilih LTS)

Verifikasi:
```powershell
node --version
npm --version
```

---

## Cara Menjalankan

Buka **PowerShell** atau **Command Prompt**, lalu:

```powershell
# 1. Masuk ke folder project
cd landchange-lab

# 2. Install dependencies frontend
npm install

# 3. Jalankan dalam mode development
npm run tauri dev
# (Pertama kali akan compile Rust ~2-5 menit, selanjutnya cepat)

# 4. Build .exe installer untuk distribusi
npm run tauri build
# Output: src-tauri/target/release/bundle/
```

### Hasil build
```
src-tauri/target/release/bundle/
├── msi/
│   └── LandChange Lab_1.0.0_x64_en-US.msi   ← installer
└── nsis/
    └── LandChange Lab_1.0.0_x64-setup.exe   ← portable installer
```

---

## Struktur Output ZIP

```
landchange_Ntiles.zip
├── before/
│   ├── tile_r0_c0.png
│   └── ...
├── after/
│   ├── tile_r0_c0.png
│   └── ...
└── masks/
    ├── tile_r0_c0.png   ← putih = CHANGED, hitam = UNCHANGED
    └── ...
```

---

## Keyboard Shortcuts

| Key | Aksi |
|-----|------|
| `A` / `←` | Tile sebelumnya |
| `D` / `→` | Tile berikutnya |
| `J` | Lompat ke tile berikutnya yang belum dilabeli |
| `Enter` | Konfirmasi & next (saat polygon: selesaikan polygon) |
| `N` | Tandai "Tidak Berubah" & next |
| `S` | Skip |
| `B` / `E` / `P` | Brush / Eraser / Polygon |
| `Esc` | Batalkan polygon |
| `F` | Isi seluruh tile |
| `C` | Clear mask |
| `Ctrl+Z` | Undo |
| `[` / `]` | Perkecil / perbesar brush |
| `+` / `-` | Zoom in / out |
| `R` | Reset zoom (fit) |
| `Space` + drag | Pan |
| `1` / `2` | Mode Swipe / Flicker |
| `,` / `.` | Geser garis swipe ke kiri / kanan |
| `H` | Tampilkan / sembunyikan label & garis bantu |

---

## Troubleshooting Windows

**Error: `MSVC not found`**
→ Install Microsoft C++ Build Tools, pastikan centang "Desktop development with C++"

**Error: `linking with link.exe failed`**
→ Buka "x64 Native Tools Command Prompt for VS" lalu jalankan `npm run tauri dev` dari sana

**Error: `WebView2 not found`**
→ Download dan install WebView2 Runtime dari link di atas

**Compile sangat lama pertama kali**
→ Normal, Rust compile semua dependency dari scratch. Selanjutnya incremental (cepat).

---

## Catatan TIFF

Rust `image` crate mendukung:
- TIFF 8-bit dan **16-bit** (GeoTIFF)
- RGB dan grayscale
- Multi-strip TIFF

Band tambahan (NIR, SWIR, dsb) saat ini di-drop saat konversi ke RGBA tampilan. Jika perlu false color composite, bisa dikembangkan di `src-tauri/src/main.rs`.
