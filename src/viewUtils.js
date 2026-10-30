// Logika murni kontrol tampilan (mode swipe/flicker).

/** Besar langkah geser swipe per tekan [,] / [.] dalam persen. */
export const SWIPE_STEP = 5;

/** Posisi swipe baru setelah digeser satu langkah ke arah `dir` (+1 / -1), dijepit 0..100. */
export function stepSwipe(x, dir) {
  return Math.max(0, Math.min(100, x + dir * SWIPE_STEP));
}

/**
 * Apakah overlay indikator (label T1/T2, garis swipe, info tile) ditampilkan.
 * Disembunyikan selama digitasi — kursor tool di atas canvas atau polygon belum
 * selesai — agar tidak menutupi citra. Pan (Space) bukan digitasi, jadi tetap tampil.
 */
export function isOverlayVisible({ enabled, cursorOnCanvas, panning, polygonActive }) {
  if (!enabled || polygonActive) return false;
  return !(cursorOnCanvas && !panning);
}
