import { test } from "node:test";
import assert from "node:assert/strict";
import { stepSwipe, SWIPE_STEP } from "./viewUtils.js";

test("stepSwipe: geser sebesar langkah", () => {
  assert.equal(stepSwipe(50, +1), 50 + SWIPE_STEP);
  assert.equal(stepSwipe(50, -1), 50 - SWIPE_STEP);
});

test("stepSwipe: dijepit 0..100", () => {
  assert.equal(stepSwipe(98, +1), 100);
  assert.equal(stepSwipe(2, -1), 0);
});
