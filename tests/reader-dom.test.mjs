import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const coreCode = await readFile("reader-core.js", "utf8");
const contentCode = await readFile("content.js", "utf8");

function browserFixture(html) {
  const dom = new JSDOM(html, {
    url: "https://medium.com/@test/story",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.HTMLElement.prototype.getBoundingClientRect = () => ({
    width: 350, height: 55, left: 8, right: 358, top: 20, bottom: 75
  });
  let handle;
  const calls = [];
  window.browser = {
    storage: { local: { get: async () => ({}) } },
    runtime: {
      onMessage: { addListener(listener) { handle = listener; } },
      async sendMessage(message) {
        calls.push(message);
        if (message.type === "SIGNATURE") return { ok: true, value: "gemini/test" };
        if (message.type === "CACHE_GET") return { ok: true, text: null };
        if (message.type === "CACHE_SET" || message.type === "PROGRESS") return { ok: true };
        if (message.type === "GENERATE") {
          const paragraphJson = message.prompt.split("The texts to translate are: \n")[1];
          const payload = JSON.parse(paragraphJson);
          return { ok: true, text: JSON.stringify({
            translations: payload.paragraphs.map(item => ({
              id: item.id,
              text: item.text.includes("powerful")
                ? "Это ⟦AIAR:0⟧мощная⟦/AIAR:0⟧ модель."
                : "Смотри ⟦AIAR:0⟧документацию⟦/AIAR:0⟧ для подробностей."
            }))
          }) };
        }
        throw Error("Unexpected request " + message.type);
      }
    }
  };
  window.eval(coreCode);
  window.eval(contentCode);
  return { document: window.document, calls, getHandler: () => handle, dom };
}

test("translates the complete paragraph and preserves original DOM and links", async () => {
  const { document, calls, getHandler, dom } = browserFixture(
    '<main><article><p id="first">This is a <strong>powerful</strong> model.</p>' +
    '<p id="second">See <a href="/guide">the documentation</a> for details.</p></article></main>'
  );
  const first = document.getElementById("first");
  const originalStrong = first.querySelector("strong");
  assert.equal((await getHandler()({ type: "TRANSLATE" })).ok, true);
  const translated = document.querySelectorAll("[data-aiar-translation]");
  assert.equal(translated.length, 2);
  assert.equal(translated[0].textContent, "Это мощная модель.");
  assert.equal(translated[0].querySelector("strong").textContent, "мощная");
  assert.equal(translated[1].querySelector("a").getAttribute("href"), "/guide");
  assert.equal(translated[1].querySelector("a").textContent, "документацию");
  assert.equal(first.querySelector("strong"), originalStrong);
  assert.equal(first.textContent, "This is a powerful model.");
  assert.equal(first.style.display, "none");
  assert.ok(calls.some(call => call.type === "GENERATE" && call.mode === "json"));
  const response = await getHandler()({ type: "ORIGINAL" });
  assert.equal(response.ok, true);
  assert.equal(document.querySelectorAll("[data-aiar-translation]").length, 0);
  assert.equal(first.style.display, "");
  dom.window.close();
});

test("nested quote paragraphs are translated separately and not merged", async () => {
  const { document, getHandler, dom } = browserFixture(
    '<main><article><blockquote><p>This is a <strong>powerful</strong> model.</p>' +
    '<p>See <a href="/guide">the documentation</a> for details.</p>' +
    '</blockquote></article></main>'
  );
  assert.equal((await getHandler()({ type: "TRANSLATE" })).ok, true);
  assert.equal(document.querySelectorAll("[data-aiar-translation]").length, 2);
  dom.window.close();
});
