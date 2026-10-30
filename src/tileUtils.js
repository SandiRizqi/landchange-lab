// Logika murni grid tile.

/** Jumlah kolom & baris tile sliding-window untuk area w×h. */
export function gridDims(w, h, tileSize, stride) {
  return {
    cols: Math.max(1, Math.floor((w - tileSize) / stride) + 1),
    rows: Math.max(1, Math.floor((h - tileSize) / stride) + 1),
  };
}

/**
 * Pesan peringatan bila ukuran T1 dan T2 berbeda (null bila sama).
 * Aplikasi menganggap kedua citra sejajar per piksel dari pojok kiri-atas, jadi beda
 * ukuran adalah tanda citra mungkin tidak sejajar (beda CRS/extent/resolusi).
 */
export function sizeMismatchMessage(a, b) {
  if (a.width === b.width && a.height === b.height) return null;
  const w = Math.min(a.width, b.width);
  const h = Math.min(a.height, b.height);
  return (
    `Ukuran citra berbeda:\n• T1: ${a.width}×${a.height}\n• T2: ${b.width}×${b.height}\n\n` +
    `Tile hanya dibuat untuk area ${w}×${h} dari pojok kiri-atas, dan kedua citra dianggap ` +
    `sejajar per piksel. Bila citra berbeda CRS/extent/resolusi, posisi T1 dan T2 tidak akan ` +
    `cocok dan label bisa salah.\n\nLanjutkan?`
  );
}
