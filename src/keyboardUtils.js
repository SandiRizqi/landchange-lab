// Aturan kapan shortcut keyboard global boleh diproses, berdasarkan elemen fokus.

const NON_TEXT_INPUTS = new Set(["range", "checkbox", "radio", "button", "submit", "color"]);

/** Elemen tempat user mengetik: shortcut tidak boleh mencuri ketikannya. */
function isTextEntry(t) {
  if (t.isContentEditable) return true;
  if (t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
  return t.tagName === "INPUT" && !NON_TEXT_INPUTS.has((t.type || "text").toLowerCase());
}

/**
 * True bila shortcut global boleh menangani `key` saat fokus di `target`.
 * - Kolom teks: selalu milik kolom.
 * - Tombol fokus: Enter/Space milik tombol (mencegah aksi dobel), huruf lain tetap shortcut.
 * - Slider fokus: tombol panah milik slider.
 */
export function shouldHandleShortcut(target, key) {
  if (!target) return true;
  if (isTextEntry(target)) return false;
  if (target.tagName === "BUTTON" && (key === "Enter" || key === " ")) return false;
  if (target.tagName === "INPUT" && target.type === "range" && key.startsWith("Arrow")) return false;
  return true;
}
