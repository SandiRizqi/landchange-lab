// Warna terpusat untuk canvas labeling.

/** Warna isi mask di layar. (Export tetap putih/hitam — lihat makeMaskCanvas di App.jsx.) */
export const MASK_RGB = [255, 50, 50];
export const maskRgba = (a = 1) => `rgba(${MASK_RGB.join(",")},${a})`;

/** Kursor & garis bantu digitasi: putih bertepi hitam — kontras di atas mask merah dan citra apa pun. */
export const CURSOR_LINE = "#ffffff";
export const CURSOR_EDGE = "rgba(0,0,0,0.85)";

/** Aksen pratinjau polygon (titik awal & isi area) — sengaja bukan merah mask. */
export const POLY_ACCENT_RGB = [34, 211, 238];
export const polyRgba = (a = 1) => `rgba(${POLY_ACCENT_RGB.join(",")},${a})`;
