import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("mode Blend sudah dihapus seluruhnya (tombol, render, shortcut, tema)", () => {
  assert.doesNotMatch(src, /[Bb]lend/);
  assert.doesNotMatch(src, /setMode\("diff"\)/);
  assert.doesNotMatch(src, /\["diff"/);
});

test("hint shortcut mode hanya [1/2] (Swipe, Flicker)", () => {
  assert.match(src, /\[1\/2\] mode/);
});
