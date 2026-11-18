import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const source = await readFile("background.js", "utf8");
const sender = { url: "https://medium.com/article", frameId: 0,
  tab: { id: 17, url: "https://medium.com/article" } };
const notesPage = { url: "moz-extension://test/notes.html", tab: { id: 9 } };
const popup = { url: "moz-extension://test/popup.html", tab: { id: 8 } };

function makeFixture(seed = {}) {
  let listener;
  const values = { ...seed };
  const reads = [], writes = [], removes = [];
  const browser = {
    runtime: {
      getURL: path => "moz-extension://test/" + path,
      onMessage: { addListener(cb) { listener = cb; } }
    },
    tabs: { create: async () => ({}), sendMessage: async () => ({ ok: true }) },
    storage: {
      local: {
        async get(key) {
          reads.push(key);
          if (key === null) return { ...values };
          if (typeof key === "string") return { [key]: values[key] };
          return {};
        },
        async set(obj) {
          writes.push(Object.keys(obj));
          Object.assign(values, obj);
        },
        async remove(keys) {
          removes.push(keys);
          for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
        }
      }
    }
  };
  runInNewContext(source, {
    browser, URL, AbortController, setTimeout, clearTimeout, Promise, console
  });
  return {
    send: (type, key, text) => listener({ type, key, text }, sender),
    settings: () => listener({ type: "CACHE_CLEAR" }, popup),
    reads, writes, removes, values
  };
}

test("GET miss is read-only and GET hit causes no additional disk writes", async () => {
  const f = makeFixture();
  const miss = await f.send("CACHE_GET", "abc-1");
  assert.equal(miss.ok, true);
  assert.equal(miss.text, null);
  assert.equal(f.writes.length, 0);

  const set = await f.send("CACHE_SET", "abc-1", "Перевод");
  assert.equal(set.ok, true);
  assert.equal(f.writes.length, 1);
  assert.deepEqual(f.writes[0].sort(),
    ["aiar-cache-v3:abc-1", "aiar-cache-index-v3"].sort());
  assert.equal(f.values["aiar-cache-v3:abc-1"].text, "Перевод");

  for (let i = 0; i < 12; i++) {
    const hit = await f.send("CACHE_GET", "abc-1");
    assert.equal(hit.ok, true);
    assert.equal(hit.text, "Перевод");
  }
  assert.equal(f.writes.length, 1);
  assert.equal(f.values.translationCacheV2, undefined);
});

test("legacy v2 entries remain readable without being re-written", async () => {
  const date = Date.now();
  const f = makeFixture({
    translationCacheV2: {
      "legacy-1": { text: "Старый перевод", timestamp: date - 5000, access: date - 3000 }
    }
  });
  assert.equal((await f.send("CACHE_GET", "missing-2")).text, null);
  assert.equal((await f.send("CACHE_GET", "legacy-1")).text, "Старый перевод");
  assert.equal(f.writes.length, 0);
  assert.equal(f.reads.filter(key => key === "translationCacheV2").length, 1);
});

test("new entry writes only itself and a small index, clear removes all formats", async () => {
  const f = makeFixture({
    settings: { provider: "gemini", keys: {}, models: {}, useBackend: false }
  });
  for (let i = 0; i < 3; i++) {
    assert.equal((await f.send("CACHE_SET", "item-" + i, "hello".repeat(100))).ok, true);
  }
  assert.equal(f.writes.length, 3);
  assert.ok(f.writes.every(keys => keys.length === 2 && keys.includes("aiar-cache-index-v3")));
  assert.equal(Object.keys(f.values["aiar-cache-index-v3"]).length, 3);
  assert.equal((await f.settings()).ok, true);
  assert.equal(f.values["aiar-cache-index-v3"], undefined);
  assert.equal(Object.keys(f.values).filter(key => key.startsWith("aiar-cache-v3:")).length, 0);
});

test("expired v3 entries are not returned and index respects entry count", async () => {
  const now = Date.now();
  const f = makeFixture({
    "aiar-cache-v3:stale-1": { text: "expired", timestamp: now - 40 * 86400000 },
    "aiar-cache-index-v3": { "stale-1": { timestamp: now - 40 * 86400000, access: now, bytes: 20 } }
  });
  assert.equal((await f.send("CACHE_GET", "stale-1")).text, null);
  assert.equal(f.writes.length, 0);
  for (let i = 0; i < 252; i++) {
    assert.equal((await f.send("CACHE_SET", "new-" + i, "t")).ok, true);
  }
  assert.equal(Object.keys(f.values["aiar-cache-index-v3"]).length, 250);
  assert.equal(f.values["aiar-cache-v3:stale-1"], undefined);
});
