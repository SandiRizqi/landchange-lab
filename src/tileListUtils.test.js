import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleRange, scrollToReveal } from "./tileListUtils.js";

const ROW = 40;

test("visibleRange: hanya baris yang terlihat + overscan", () => {
  // viewport 400px = 10 baris, scroll di baris 100
  assert.deepEqual(visibleRange(100 * ROW, 400, ROW, 5000, 5), { start: 95, end: 115 });
});

test("visibleRange: dijepit di awal & akhir daftar", () => {
  assert.deepEqual(visibleRange(0, 400, ROW, 5000, 5), { start: 0, end: 15 });
  assert.deepEqual(visibleRange(4995 * ROW, 400, ROW, 5000, 5), { start: 4990, end: 5000 });
});

test("visibleRange: daftar kosong", () => {
  assert.deepEqual(visibleRange(0, 400, ROW, 0, 5), { start: 0, end: 0 });
});

test("scrollToReveal: baris sudah terlihat -> null (tidak menggulir)", () => {
  assert.equal(scrollToReveal(3, 0, 400, ROW), null);
});

test("scrollToReveal: baris di bawah viewport -> gulir secukupnya agar baris di tepi bawah", () => {
  assert.equal(scrollToReveal(20, 0, 400, ROW), 21 * ROW - 400);
});

test("scrollToReveal: baris di atas viewport -> gulir ke atas baris", () => {
  assert.equal(scrollToReveal(5, 30 * ROW, 400, ROW), 5 * ROW);
});
