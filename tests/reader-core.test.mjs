import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const core = require("../reader-core.js");

test("inline markers preserve nested structure when Russian moves tags", () => {
  const value = "Это " + core.start(0) + "действительно " +
    core.start(1) + "мощная" + core.end(1) + " модель" + core.end(0) + ".";
  const tree = core.parseTagged(value, ["0", "1"]);
  assert.equal(tree[0].value, "Это ");
  assert.equal(tree[1].type, "slot");
  assert.equal(tree[1].children[1].id, "1");
  assert.equal(tree[2].value, ".");
});

test("markers reject omission, duplicate, misnesting and unexpected IDs", () => {
  assert.throws(() => core.parseTagged("Просто текст", ["0"]), /Missing/);
  assert.throws(() => core.parseTagged(core.start(0) + "x" + core.end(1), ["0", "1"]), /Misnested/);
  assert.throws(() => core.parseTagged(core.start(0) + "x" + core.end(0) +
    core.start(0) + "x" + core.end(0), ["0"]), /Duplicate/);
  assert.throws(() => core.parseTagged(core.start(7) + core.end(7), ["0"]), /Unexpected/);
});

test("JSON reply validation rejects extra, repeated and missing paragraphs", () => {
  const valid = JSON.stringify({ translations: [
    { id: "0", text: "Привет" }, { id: "1", text: "Мир" }
  ] });
  assert.equal(core.parseTranslations(valid, ["0", "1"]).get("1"), "Мир");
  assert.throws(() => core.parseTranslations('{"translations":[{"id":"0","text":"да"}]}',
    ["0", "1"]), /omitted/);
  assert.throws(() => core.parseTranslations('{"translations":[{"id":"2","text":"да"}]}',
    ["0"]), /Invalid/);
  assert.throws(() => core.parseTranslations('{"translations":[{"id":"0","text":"a"},{"id":"0","text":"b"}]}',
    ["0"]), /Invalid/);
});

test("batching respects cap and viewport order as supplied", () => {
  const items = Array.from({ length: 9 }, (_, i) => ({ id: String(i), source: "x".repeat(450) }));
  const groups = core.batches(items, 1500, 4);
  assert.deepEqual(groups.map(group => group.length), [2, 2, 2, 2, 1]);
  assert.equal(groups.flat()[0].id, "0");
});

test("cache drops expired values and obeys LRU count and byte limits", () => {
  const now = Date.now();
  const entries = {};
  for (let i = 0; i < 260; i++) {
    entries["cache-" + i] = { text: "x".repeat(100), timestamp: now - 1000, access: now - i };
  }
  entries.old = { text: "stale", timestamp: now - 45 * 86400000, access: now };
  const result = core.pruneCache(entries, now, 250, 2500000);
  assert.equal(Object.keys(result).length, 250);
  assert.ok(result["cache-0"]);
  assert.equal(result.old, undefined);
  assert.equal(core.pruneCache(entries, now, 250, 250).constructor, Object);
});
