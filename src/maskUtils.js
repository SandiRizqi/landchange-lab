// Logika murni status mask. Dipakai App.jsx dan dites dengan node:test.

// Ambang alpha yang sama dengan export (makeMaskCanvas): piksel dianggap
// "berubah" (putih di mask export) hanya bila alpha > ambang ini.
export const MASK_ALPHA_THRESHOLD = 100;

/** True bila buffer RGBA berisi minimal satu piksel yang akan jadi putih saat export. */
export function maskHasContent(data, alphaThreshold = MASK_ALPHA_THRESHOLD) {
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] > alphaThreshold) return true;
  }
  return false;
}

/**
 * Status tile setelah mask diedit.
 * - Mask berisi            -> "labeled".
 * - Mask kosong dari labeled -> "pending" (tile tak boleh tercatat Berubah tanpa mask).
 * - Mask kosong lainnya    -> status sebelumnya (mis. eraser di tile "no_change" tak mengubah apa pun).
 */
export function statusAfterEdit(prevStatus, hasContent) {
  if (hasContent) return "labeled";
  return prevStatus === "labeled" ? "pending" : prevStatus;
}
