// Helper murni untuk Index View (peta lokasi tile pada citra penuh).

/** Skala agar citra imgW×imgH muat di dalam kotak maxW×maxH. */
export function fitScale(imgW, imgH, maxW, maxH) {
  if (!imgW || !imgH) return 0;
  return Math.min(maxW / imgW, maxH / imgH);
}

/**
 * Index tile yang "memiliki" titik (ix, iy) dalam koordinat piksel citra.
 * Tiap tile memiliki sel stride×stride di pojok kiri-atasnya (grid tanpa tumpang
 * tindih); titik di luar grid dijepit ke tile tepi terdekat.
 */
export function tileIndexAt(tiles, ix, iy, stride) {
  if (!tiles.length) return -1;
  let maxRow = 0, maxCol = 0;
  for (const t of tiles) {
    if (t.row > maxRow) maxRow = t.row;
    if (t.col > maxCol) maxCol = t.col;
  }
  const col = Math.max(0, Math.min(maxCol, Math.floor(ix / stride)));
  const row = Math.max(0, Math.min(maxRow, Math.floor(iy / stride)));
  return tiles.findIndex(t => t.row === row && t.col === col);
}
