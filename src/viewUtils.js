// Logika murni kontrol tampilan (mode swipe/flicker).

/** Besar langkah geser swipe per tekan [,] / [.] dalam persen. */
export const SWIPE_STEP = 5;

/** Posisi swipe baru setelah digeser satu langkah ke arah `dir` (+1 / -1), dijepit 0..100. */
export function stepSwipe(x, dir) {
  return Math.max(0, Math.min(100, x + dir * SWIPE_STEP));
}
