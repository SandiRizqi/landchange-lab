import { test } from "node:test";
import assert from "node:assert/strict";
import { gridDims, sizeMismatchMessage } from "./tileUtils.js";

test("gridDims: 1600×1100, tile 256, stride 128 -> 11×7 (77 tile)", () => {
  assert.deepEqual(gridDims(1600, 1100, 256, 128), { cols: 11, rows: 7 });
});

test("gridDims: citra lebih kecil dari tile tetap 1×1", () => {
  assert.deepEqual(gridDims(100, 80, 256, 128), { cols: 1, rows: 1 });
});

test("sizeMismatchMessage: ukuran sama -> null", () => {
  assert.equal(sizeMismatchMessage({ width: 800, height: 600 }, { width: 800, height: 600 }), null);
});

test("sizeMismatchMessage: ukuran beda -> pesan berisi kedua dimensi & area tumpang-tindih", () => {
  const msg = sizeMismatchMessage({ width: 7168, height: 5887 }, { width: 10067, height: 8159 });
  assert.match(msg, /7168×5887/);
  assert.match(msg, /10067×8159/);
  assert.match(msg, /area 7168×5887/);
});
