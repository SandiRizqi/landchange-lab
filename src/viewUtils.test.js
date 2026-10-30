import { test } from "node:test";
import assert from "node:assert/strict";
import { stepSwipe, SWIPE_STEP, isOverlayVisible } from "./viewUtils.js";

const base = { enabled: true, cursorOnCanvas: false, panning: false, polygonActive: false };

test("overlay: tampil saat kursor di luar canvas", () => {
  assert.equal(isOverlayVisible(base), true);
});

test("overlay: tersembunyi saat kursor tool di atas canvas (digitasi)", () => {
  assert.equal(isOverlayVisible({ ...base, cursorOnCanvas: true }), false);
});

test("overlay: tampil lagi saat pan (Space) walau kursor di canvas", () => {
  assert.equal(isOverlayVisible({ ...base, cursorOnCanvas: true, panning: true }), true);
});

test("overlay: tersembunyi selama polygon belum selesai, walau kursor keluar canvas", () => {
  assert.equal(isOverlayVisible({ ...base, polygonActive: true }), false);
});

test("overlay: [H] mematikan total", () => {
  assert.equal(isOverlayVisible({ ...base, enabled: false }), false);
});

test("stepSwipe: geser sebesar langkah", () => {
  assert.equal(stepSwipe(50, +1), 50 + SWIPE_STEP);
  assert.equal(stepSwipe(50, -1), 50 - SWIPE_STEP);
});

test("stepSwipe: dijepit 0..100", () => {
  assert.equal(stepSwipe(98, +1), 100);
  assert.equal(stepSwipe(2, -1), 0);
});
