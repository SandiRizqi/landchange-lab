import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MASK_RGB, maskRgba, POLY_ACCENT_RGB } from "./colors.js";

test("App.jsx tidak memakai literal merah mask (harus lewat colors.js)", () => {
  const src = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(src, /#ff3232/i);
  assert.doesNotMatch(src, /255\s*,\s*50\s*,\s*50/);
});

test("maskRgba memakai MASK_RGB dengan alpha", () => {
  assert.equal(maskRgba(1), `rgba(${MASK_RGB.join(",")},1)`);
  assert.equal(maskRgba(0.3), `rgba(${MASK_RGB.join(",")},0.3)`);
});

test("aksen polygon berbeda dari warna mask (agar terlihat di atas mask)", () => {
  assert.notDeepEqual(POLY_ACCENT_RGB, MASK_RGB);
});
