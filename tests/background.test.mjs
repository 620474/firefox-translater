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
