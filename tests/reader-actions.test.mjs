import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const actions = require("../reader-actions.js");
const sample = {
  selection: "TypeScript discriminated union",
  context: "The TypeScript discriminated union uses a common field to narrow a type.",
  title: "TypeScript patterns",
  url: "https://medium.com/example"
};

test("selection actions exist and build bounded requests with explicit user data", () => {
  assert.deepEqual(Object.keys(actions.PRESETS), ["translate","explain","glossary","keypoints"]);
  const built = actions.buildPrompt("explain", sample);
  assert.match(built, /reply in Russian/);
  assert.match(built, /discriminated union/);
  assert.match(built, /untrusted DATA/);
  assert.match(built, /TypeScript patterns/);
});

test("custom prompt replaces placeholders with safe field references", () => {
  const prompt = actions.buildPrompt("custom", sample,
    "Explain {selection}, taking account of {context} and {title}.");
  assert.match(prompt, /the selection field below/);
  assert.match(prompt, /the context field below/);
  assert.match(prompt, /the title field below/);
  assert.match(prompt, /"selection":"TypeScript discriminated union"/);
});

test("invalid actions and accidental empty highlights do not trigger models", () => {
  assert.throws(() => actions.buildPrompt("unknown", sample), /Неизвестное действие/);
  assert.throws(() => actions.buildPrompt("translate", { selection: "x" }), /Выделите фрагмент/);
  assert.throws(() => actions.buildPrompt("translate", { selection: "x".repeat(8001) }), /Выделите фрагмент/);
  assert.equal(actions.normalizeCustom(" ").length > 0, true);
  assert.equal(actions.normalizeCustom("x".repeat(2000)).length, 1600);
});
