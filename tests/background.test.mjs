import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const source = await readFile("background.js", "utf8");
const PAGE = "moz-extension://test-extension/popup.html";

function fixture() {
  let listener;
  const calls = [];
  let values = {
    settings: {
      provider: "gemini",
      keys: { gemini: "test-provider-token", openai: "", deepseek: "" },
      models: { gemini: "gemini-2.5-flash", openai: "gpt-4.1-mini", deepseek: "deepseek-chat" },
      useBackend: false,
      backendUrl: ""
    }
  };
  const browser = {
    runtime: {
      getURL: path => "moz-extension://test-extension/" + path,
      onMessage: { addListener(cb) { listener = cb; } }
    },
    tabs: {
      create: async () => ({}),
      sendMessage: async () => ({ ok: true })
    },
    storage: {
      local: {
        async get(key) {
          if (key === null) return { ...values };
          if (typeof key === "string") return { [key]: values[key] };
          return {};
        },
        async set(change) { Object.assign(values, change); },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) delete values[key];
        }
      }
    }
  };
  const fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async json() {
        return { candidates: [{ content: { parts: [{ text: '{"translations":[]}' }] } }] };
      },
      headers: { get: () => null }
    };
  };
  runInNewContext(source, {
    browser, fetch, AbortController, setTimeout, clearTimeout, URL,
    console, Promise
  });
  return { call: (message, sender) => listener(message, sender), calls };
}

test("settings are accepted from extension tab but rejected from web content", async () => {
  const { call } = fixture();
  const extension = { url: PAGE, tab: { id: 1 } };
  const website = { url: "https://medium.com/story", frameId: 0, tab: { id: 2 } };
  const allowed = await call({ type: "SETTINGS_GET" }, extension);
  assert.equal(allowed.ok, true);
  assert.equal(allowed.settings.keys.gemini, "test-provider-token");
  const denied = await call({ type: "SETTINGS_GET" }, website);
  assert.equal(denied.ok, false);
  assert.equal(denied.settings, undefined);
  assert.equal((await call({ type: "CACHE_CLEAR" }, extension)).ok, true);
});

test("Gemini JSON-mode request uses structured MIME and systemInstruction", async () => {
  const { call, calls } = fixture();
  const content = { url: "https://medium.com/story", frameId: 0, tab: { id: 5 } };
  const answer = await call({
    type: "GENERATE",
    prompt: "Respond with a JSON object of translations",
    mode: "json"
  }, content);
  assert.equal(answer.ok, true);
  const request = calls.at(-1);
  const body = JSON.parse(request.options.body);
  assert.equal(body.generationConfig.responseMimeType, "application/json");
  assert.ok(body.systemInstruction.parts[0].text.includes("untrusted data"));
  assert.equal(request.options.headers["x-goog-api-key"], "test-provider-token");
  assert.equal(request.url.includes(":generateContent"), true);
});

test("notes are locally saved from article content and manageable only by the notes page", async () => {
  const { call } = fixture();
  const site = {
    url: "https://medium.com/story", frameId: 0,
    tab: { id: 2, url: "https://medium.com/story" }
  };
  const notesPage = { url: "moz-extension://test-extension/notes.html", tab: { id: 3 } };
  const popup = { url: PAGE, tab: { id: 4 } };
  const note = {
    kind: "explain",
    title: "TypeScript article",
    selection: "discriminated union",
    answer: "Это способ различать варианты объединения типов."
  };
  assert.equal((await call({ type: "NOTES_LIST" }, site)).ok, false);
  const saved = await call({ type: "NOTES_ADD", note }, site);
  assert.equal(saved.ok, true);
  const listed = await call({ type: "NOTES_LIST" }, notesPage);
  assert.equal(listed.ok, true);
  assert.equal(listed.notes.length, 1);
  assert.equal(listed.notes[0].answer, note.answer);
  assert.equal(listed.notes[0].url, "https://medium.com/story");
  assert.equal((await call({ type: "NOTES_DELETE", id: saved.id }, popup)).ok, false);
  assert.equal((await call({ type: "NOTES_DELETE", id: saved.id }, notesPage)).ok, true);
  assert.equal((await call({ type: "NOTES_LIST" }, notesPage)).notes.length, 0);
});

test("custom prompt is editable only from an extension settings page", async () => {
  const { call } = fixture();
  const popup = { url: PAGE, tab: { id: 7 } };
  const site = { url: "https://medium.com/story", frameId: 0, tab: { id: 5 } };
  const initial = (await call({ type: "SETTINGS_GET" }, popup)).settings;
  const saved = await call({ type: "SETTINGS_SAVE", settings: {
    ...initial, customPrompt: "Explain how this applies to TypeScript."
  } }, popup);
  assert.equal(saved.ok, true);
  assert.equal((await call({ type: "SETTINGS_GET" }, site)).ok, false);
  assert.equal((await call({ type: "CUSTOM_PROMPT" }, site)).prompt,
    "Explain how this applies to TypeScript.");
});

test("technical translation and explanation use distinct trusted system prompts", async () => {
  const { call, calls } = fixture();
  const site = { url: "https://medium.com/story", frameId: 0, tab: { id: 5 } };
  await call({ type: "GENERATE", prompt: "article content", mode: "json", task: "translation" }, site);
  const translation = JSON.parse(calls.at(-1).options.body).systemInstruction.parts[0].text;
  assert.match(translation, /Translate faithfully/);
  assert.match(translation, /untrusted data/);
  assert.match(translation, /code snippets/);
  await call({ type: "GENERATE", prompt: "selection", mode: "text", task: "explanation" }, site);
  const explanation = JSON.parse(calls.at(-1).options.body).systemInstruction.parts[0].text;
  assert.match(explanation, /Суть:/);
  assert.match(explanation, /six short lines/);
  assert.notEqual(translation, explanation);
});

test("editable prompts persist, are used by providers, and invalidate the translation cache", async () => {
  const { call, calls } = fixture();
  const popup = { url: PAGE, tab: { id: 7 } };
  const site = { url: "https://medium.com/story", frameId: 0, tab: { id: 5 } };
  const initial = (await call({ type: "SETTINGS_GET" }, popup)).settings;
  assert.match(initial.translationPrompt, /Translate faithfully/);
  const before = (await call({ type: "SIGNATURE" }, site)).value;
  const saved = await call({ type: "SETTINGS_SAVE", settings: {
    ...initial, translationPrompt: "Translate exactly with custom terminology.",
    explanationPrompt: "Explain React hooks briefly in Russian."
  } }, popup);
  assert.equal(saved.ok, true);
  const updated = (await call({ type: "SETTINGS_GET" }, popup)).settings;
  assert.equal(updated.translationPrompt, "Translate exactly with custom terminology.");
  assert.equal(updated.explanationPrompt, "Explain React hooks briefly in Russian.");
  const after = (await call({ type: "SIGNATURE" }, site)).value;
  assert.notEqual(before, after);
  await call({ type: "GENERATE", prompt: "article", mode: "json", task: "translation" }, site);
  const usedTranslation = JSON.parse(calls.at(-1).options.body).systemInstruction.parts[0].text;
  assert.match(usedTranslation, /custom terminology/);
  assert.match(usedTranslation, /untrusted data/);
  await call({ type: "GENERATE", prompt: "selected text", mode: "text", task: "explanation" }, site);
  assert.match(JSON.parse(calls.at(-1).options.body).systemInstruction.parts[0].text,
    /React hooks briefly/);
  const defaults = await call({ type: "PROMPTS_DEFAULTS" }, popup);
  assert.match(defaults.translation, /Translate faithfully/);
  assert.match(defaults.explanation, /narrow popup/);
  assert.equal((await call({ type: "PROMPTS_DEFAULTS" }, site)).ok, false);
});
