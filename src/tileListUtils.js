// Logika murni windowing daftar tile (baris bertinggi tetap).

/** Rentang index baris yang perlu di-render [start, end) untuk posisi scroll tertentu. */
export function visibleRange(scrollTop, viewportH, rowH, count, overscan = 5) {
  if (!count) return { start: 0, end: 0 };
  const start = Math.max(0, Math.floor(scrollTop / rowH) - overscan);
  const end = Math.min(count, Math.ceil((scrollTop + viewportH) / rowH) + overscan);
  return { start, end };
}

/**
 * scrollTop baru agar baris `idx` terlihat penuh, atau null bila sudah terlihat.
 * Menggulir seminimal mungkin (baris ditaruh di tepi atas/bawah viewport).
 */
export function scrollToReveal(idx, scrollTop, viewportH, rowH) {
  const top = idx * rowH;
  const bottom = top + rowH;
  if (top < scrollTop) return top;
  if (bottom > scrollTop + viewportH) return bottom - viewportH;
  return null;
}
