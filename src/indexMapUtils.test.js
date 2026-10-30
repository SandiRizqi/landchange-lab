// Jalankan: npm test   (node --test, tanpa dependency tambahan)
import { test } from "node:test";
import assert from "node:assert/strict";
import { fitScale, tileIndexAt } from "./indexMapUtils.js";

// Grid 3 kolom × 2 baris, tile 256, stride 128 (urutan baris-mayor seperti generateTiles).
const STRIDE = 128;
const tiles = [];
for (let r = 0; r < 2; r++)
  for (let c = 0; c < 3; c++)
    tiles.push({ id: `${r}_${c}`, row: r, col: c, x: c * STRIDE, y: r * STRIDE });

test("fitScale: lebar membatasi untuk citra melebar", () => {
  assert.equal(fitScale(1000, 500, 100, 200), 0.1);
});

test("fitScale: tinggi membatasi untuk citra memanjang", () => {
  assert.equal(fitScale(500, 1000, 200, 100), 0.1);
});

test("fitScale: dimensi nol -> 0", () => {
  assert.equal(fitScale(0, 100, 100, 100), 0);
});

test("tileIndexAt: titik di sel stride memilih tile pemiliknya", () => {
  // x=200 -> kolom 1, y=10 -> baris 0
  assert.equal(tileIndexAt(tiles, 200, 10, STRIDE), 1);
  // x=300 -> kolom 2, y=150 -> baris 1 -> index 1*3+2 = 5
  assert.equal(tileIndexAt(tiles, 300, 150, STRIDE), 5);
});

test("tileIndexAt: di luar grid dijepit ke tile tepi", () => {
  // tile terakhir menutupi sampai x = 2*128+256 = 512; klik x=500 harus kolom 2
  assert.equal(tileIndexAt(tiles, 500, 300, STRIDE), 5);
  assert.equal(tileIndexAt(tiles, -20, -20, STRIDE), 0);
});

test("tileIndexAt: daftar tile kosong -> -1", () => {
  assert.equal(tileIndexAt([], 10, 10, STRIDE), -1);
});

test("tileIndexAt: tidak bergantung urutan array (mis. hasil load project)", () => {
  const shuffled = [...tiles].reverse();
  const idx = tileIndexAt(shuffled, 300, 150, STRIDE);
  assert.equal(shuffled[idx].id, "1_2");
});
