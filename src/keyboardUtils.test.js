import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldHandleShortcut } from "./keyboardUtils.js";

const el = (tagName, extra = {}) => ({ tagName, isContentEditable: false, ...extra });

test("body/canvas: shortcut diproses", () => {
  assert.equal(shouldHandleShortcut(el("BODY"), "b"), true);
  assert.equal(shouldHandleShortcut(el("DIV"), "Enter"), true);
});

test("input teks/angka, textarea, select, contentEditable: shortcut diabaikan", () => {
  assert.equal(shouldHandleShortcut(el("INPUT", { type: "text" }), "b"), false);
  assert.equal(shouldHandleShortcut(el("INPUT", { type: "number" }), "1"), false);
  assert.equal(shouldHandleShortcut(el("TEXTAREA"), "a"), false);
  assert.equal(shouldHandleShortcut(el("SELECT"), "d"), false);
  assert.equal(shouldHandleShortcut(el("DIV", { isContentEditable: true }), "e"), false);
});

test("tombol fokus: Enter/Space milik tombol (jangan dobel), huruf tetap jalan", () => {
  assert.equal(shouldHandleShortcut(el("BUTTON"), "Enter"), false);
  assert.equal(shouldHandleShortcut(el("BUTTON"), " "), false);
  assert.equal(shouldHandleShortcut(el("BUTTON"), "b"), true);
});

test("slider fokus: panah milik slider, shortcut lain tetap jalan", () => {
  assert.equal(shouldHandleShortcut(el("INPUT", { type: "range" }), "ArrowLeft"), false);
  assert.equal(shouldHandleShortcut(el("INPUT", { type: "range" }), "b"), true);
  assert.equal(shouldHandleShortcut(el("INPUT", { type: "range" }), "Enter"), true);
});

test("target null aman", () => {
  assert.equal(shouldHandleShortcut(null, "b"), true);
});
