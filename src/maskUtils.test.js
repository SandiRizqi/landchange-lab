import { test } from "node:test";
import assert from "node:assert/strict";
import { maskHasContent, statusAfterEdit, MASK_ALPHA_THRESHOLD } from "./maskUtils.js";

// RGBA buffer 2×2 piksel, semua transparan.
const empty = () => new Uint8ClampedArray(2 * 2 * 4);

test("maskHasContent: mask transparan -> false", () => {
  assert.equal(maskHasContent(empty()), false);
});

test("maskHasContent: alpha tepat di ambang -> false (sama dgn export: alpha > ambang)", () => {
  const d = empty();
  d[3] = MASK_ALPHA_THRESHOLD;
  assert.equal(maskHasContent(d), false);
});

test("maskHasContent: satu piksel di atas ambang -> true", () => {
  const d = empty();
  d[4 * 3 + 3] = MASK_ALPHA_THRESHOLD + 1;
  assert.equal(maskHasContent(d), true);
});

test("statusAfterEdit: mask berisi -> labeled (dari status apa pun)", () => {
  for (const s of ["pending", "labeled", "no_change", "skipped"])
    assert.equal(statusAfterEdit(s, true), "labeled");
});

test("statusAfterEdit: mask jadi kosong dari labeled -> pending (bukan label palsu)", () => {
  assert.equal(statusAfterEdit("labeled", false), "pending");
});

test("statusAfterEdit: eraser tanpa isi tidak mengubah status non-labeled", () => {
  assert.equal(statusAfterEdit("pending", false), "pending");
  assert.equal(statusAfterEdit("no_change", false), "no_change");
  assert.equal(statusAfterEdit("skipped", false), "skipped");
});
