import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { JSDOM } from "jsdom";

const coreCode = await readFile("reader-core.js", "utf8");
const contentCode = await readFile("content.js", "utf8");
const actionsCode = await readFile("reader-actions.js", "utf8");
const exportCode = await readFile("article-export.js", "utf8");

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
        if (message.type === "GENERATE" && message.prompt.includes("Task (reply in Russian):")) {
          return { ok: true, text: "Краткое объяснение выделенного термина." };
        }
        if (message.type === "GENERATE") {
          const paragraphJson = message.prompt.split("The texts to translate are: \n")[1];
          const payload = JSON.parse(paragraphJson);
          return { ok: true, text: JSON.stringify({
            translations: payload.paragraphs.map(item => ({
              id: item.id,
              text: item.text.includes("powerful")
                ? "Это ⟦AIAR:0⟧мощная⟦/AIAR:0⟧ модель."
                : item.text.includes("Choose")
                  ? "Используйте ⟦AIAR:0⟧⟦/AIAR:0⟧ в приложении."
                  : "Смотри ⟦AIAR:0⟧документацию⟦/AIAR:0⟧ для подробностей."
            }))
          }) };
        }
        throw Error("Unexpected request " + message.type);
      }
    }
  };
  window.eval(coreCode);
  window.eval(actionsCode);
  window.eval(exportCode);
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

test("preserves code blocks and inline code exactly, and never sends their source to AI", async () => {
  const inline = 'const result = await fetch("https://api.example/");';
  const codeOnly = 'const token = "do not change";';
  const block = 'function greet() {\n  return "Hello!";\n}';
  const html =
    '<main><article>' +
    '<p id="inline">Choose <code class="language-js">' + inline + '</code> in your application today.</p>' +
    '<p id="only-code"><code>' + codeOnly + '</code></p>' +
    '<pre><code id="block-code">' + block + '</code></pre>' +
    '</article></main>';
  const { document, calls, getHandler, dom } = browserFixture(html);
  const inlineCode = document.querySelector("#inline code");
  const originalBlock = document.getElementById("block-code");
  assert.equal((await getHandler()({ type: "TRANSLATE" })).ok, true);
  const translation = document.querySelector("#inline + [data-aiar-translation]");
  assert.ok(translation);
  assert.equal(translation.querySelector("code").textContent, inline);
  assert.equal(translation.querySelector("code").className, "language-js");
  assert.equal(document.querySelector("#only-code").nextElementSibling?.dataset.aiarTranslation, undefined);
  assert.equal(originalBlock.textContent, block);
  assert.equal(document.querySelector("#inline code"), inlineCode);
  const translatedPrompts = calls.filter(call => call.type === "GENERATE").map(call => call.prompt).join("\n");
  assert.ok(translatedPrompts.includes("Choose"));
  assert.equal(translatedPrompts.includes(inline), false);
  assert.equal(translatedPrompts.includes(codeOnly), false);
  assert.equal(translatedPrompts.includes(block), false);
  assert.equal((await getHandler()({ type: "ORIGINAL" })).ok, true);
  assert.equal(document.querySelector("#inline code").textContent, inline);
  assert.equal(originalBlock.textContent, block);
  dom.window.close();
});

test("code-only and mixed code selections cannot be translated, but can be explained", async () => {
  const { document, calls, getHandler, dom } = browserFixture(
    '<main><article><p id="example">Run <code>npm install package</code> to prepare your project.</p></article></main>'
  );
  const code = document.querySelector("code");
  const selection = dom.window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(code);
  selection.removeAllRanges();
  selection.addRange(range);
  const rejected = await getHandler()({ type: "SELECTION_ACTION", actionId: "translate" });
  assert.equal(rejected.ok, false);
  assert.match(rejected.error, /Код не переводим/);
  assert.equal(calls.filter(call => call.type === "GENERATE").length, 0);
  const explain = await getHandler()({ type: "SELECTION_ACTION", actionId: "explain" });
  assert.equal(explain.ok, true);
  assert.equal(calls.filter(call => call.type === "GENERATE").length, 1);
  const mixed = document.createRange();
  mixed.selectNodeContents(document.getElementById("example"));
  selection.removeAllRanges();
  selection.addRange(mixed);
  const again = await getHandler()({ type: "SELECTION_ACTION", actionId: "translate" });
  assert.equal(again.ok, false);
  assert.match(again.error, /Код не переводим/);
  dom.window.close();
});


test("offline snapshot keeps Russian once, including after a stale translation map", async () => {
  const {document, getHandler, dom} = browserFixture(
    '<main><article><p id="original">This is a <strong>powerful</strong> model.</p>' +
    '<pre><code>const answer = 42;</code></pre></article></main>'
  );
  assert.equal((await getHandler()({type:"TRANSLATE"})).ok,true);
  const root=document.querySelector("article");
  const exporter=dom.window.AIARExport;
  for(const map of [new Map(), new Map([[document.getElementById("original"), {}]])]){
    const snap=exporter.snapshot(root,map,dom.window.location.href);
    assert.equal(snap.querySelectorAll("p").length,1);
    assert.equal(snap.querySelector("p").textContent,"Это мощная модель.");
    assert.ok(!snap.textContent.includes("This is a"));
    assert.match(snap.textContent,/const answer = 42;/);
  }
  dom.window.close();
});
