import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const scripts = await Promise.all(["reader-core.js", "reader-actions.js", "content.js"].map(path => readFile(path, "utf8")));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(html, generate) {
  const dom = new JSDOM(html, { url: "https://example.com/article", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({ width: 350, height: 55, top: 20, bottom: 75 });
  const calls = [], cache = new Map();
  let handle;
  window.browser = {
    storage: { local: { get: async () => ({}) } },
    runtime: {
      onMessage: { addListener(listener) { handle = listener; } },
      async sendMessage(message) {
        calls.push(message);
        if (message.type === "SIGNATURE") return { ok: true, value: "test/model" };
        if (message.type === "PROGRESS") return { ok: true };
        if (message.type === "CACHE_GET") return { ok: true, text: cache.get(message.key) || null };
        if (message.type === "CACHE_SET") { cache.set(message.key, message.text); return { ok: true }; }
        if (message.type === "GENERATE") {
          if (generate) await generate(message);
          if (message.mode === "text") return { ok: true, text: "Верное краткое саммари статьи." };
          const payload = JSON.parse(message.prompt.split("The texts to translate are: \n")[1]);
          return { ok: true, text: JSON.stringify({ translations: payload.paragraphs.map(item => ({ id: item.id, text: "Перевод: " + item.text })) }) };
        }
        throw Error("Unexpected request " + message.type);
      }
    }
  };
  scripts.forEach(script => window.eval(script));
  return { dom, document: window.document, calls, send: message => handle(message) };
}

test("summary never transmits inline code, keyboard samples or code blocks", async t => {
  const prose = "This article explains reliable application design and practical engineering tradeoffs with clear examples. ".repeat(3);
  const f = fixture('<article><p>' + prose + '<code>SECRET_INLINE_123</code><kbd>SECRET_KEY_123</kbd><samp>SECRET_SAMPLE_123</samp></p><pre>SECRET_BLOCK_123</pre></article>');
  t.after(() => f.dom.window.close());
  assert.equal((await f.send({ type: "SUMMARY", length: "short" })).ok, true);
  const prompts = f.calls.filter(x => x.type === "GENERATE").map(x => x.prompt).join("\n");
  for (const secret of ["SECRET_INLINE_123", "SECRET_KEY_123", "SECRET_SAMPLE_123", "SECRET_BLOCK_123"]) assert.equal(prompts.includes(secret), false);
  assert.ok(prompts.includes("reliable application design"));
});

test("restore invalidates pending translation and stops queued batches", async t => {
  const gate = deferred(), entered = deferred();
  const f = fixture('<article>' + Array.from({ length: 15 }, (_, i) => '<p>Original paragraph number ' + i + ' with useful prose.</p>').join('') + '</article>', async () => { entered.resolve(); await gate.promise; });
  t.after(() => { gate.resolve(); f.dom.window.close(); });
  const pending = f.send({ type: "TRANSLATE" });
  await entered.promise;
  assert.equal((await f.send({ type: "ORIGINAL" })).ok, true);
  gate.resolve();
  assert.equal((await pending).ok, true);
  assert.equal(f.document.querySelectorAll("[data-aiar-translation]").length, 0);
  assert.ok([...f.document.querySelectorAll("p")].every(p => p.style.display === ""));
  assert.ok(f.calls.filter(x => x.type === "GENERATE").length <= 2);
});

test("removing an original paragraph removes its orphan translation", async t => {
  const f = fixture('<article><p id=original>This original paragraph contains useful prose.</p></article>');
  t.after(() => f.dom.window.close());
  assert.equal((await f.send({ type: "TRANSLATE" })).ok, true);
  assert.equal(f.document.querySelectorAll("[data-aiar-translation]").length, 1);
  f.document.getElementById("original").remove();
  await tick();
  assert.equal(f.document.querySelectorAll("[data-aiar-translation]").length, 0);
});

test("mutations during a busy summary are reconciled on completion", async t => {
  const gate = deferred(), entered = deferred();
  const f = fixture('<article><p id=original>' + 'This paragraph contains enough original prose for a useful summary. '.repeat(4) + '</p></article>', async message => {
    if (message.mode === "text") { entered.resolve(); await gate.promise; }
  });
  t.after(() => { gate.resolve(); f.dom.window.close(); });
  assert.equal((await f.send({ type: "TRANSLATE" })).ok, true);
  const pending = f.send({ type: "SUMMARY", length: "short" });
  await entered.promise;
  f.document.getElementById("original").remove();
  await tick();
  gate.resolve();
  assert.equal((await pending).ok, true);
  assert.equal(f.document.querySelectorAll("[data-aiar-translation]").length, 0);
});

test("cached batch survives changed article-global paragraph IDs", async t => {
  const leading = Array.from({ length: 5 }, (_, i) => '<p class=leading>Leading original paragraph ' + i + ' with enough prose.</p>').join('');
  const f = fixture('<article>' + leading + '<p id=target>The final paragraph should be reusable from cache.</p></article>');
  t.after(() => f.dom.window.close());
  assert.equal((await f.send({ type: "TRANSLATE" })).ok, true);
  await f.send({ type: "ORIGINAL" });
  f.document.querySelectorAll(".leading").forEach(el => el.remove());
  const before = f.calls.filter(x => x.type === "GENERATE").length;
  assert.equal((await f.send({ type: "TRANSLATE" })).ok, true);
  assert.equal(f.calls.filter(x => x.type === "GENERATE").length, before);
  assert.ok(f.document.querySelector("#target + [data-aiar-translation]"));
});
