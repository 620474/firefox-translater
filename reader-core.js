/* Pure translation helpers shared by the browser scripts and Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.AIARCore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const TOKEN_SOURCE = "⟦(\\/?)AIAR:(\\d+)⟧";
  const start = id => "⟦AIAR:" + id + "⟧";
  const end = id => "⟦/AIAR:" + id + "⟧";

  function parseTagged(text, slotIds) {
    if (typeof text !== "string" || text.length > 20000) throw Error("Invalid translated text");
    const expected = new Set(slotIds.map(String));
    const used = new Set();
    const rootNode = { type: "root", children: [] };
    const stack = [rootNode];
    const pattern = new RegExp(TOKEN_SOURCE, "g");
    let cursor = 0, match;
    while ((match = pattern.exec(text))) {
      if (match.index > cursor) stack.at(-1).children.push({
        type: "text", value: text.slice(cursor, match.index)
      });
      const id = match[2];
      if (!expected.has(id)) throw Error("Unexpected inline marker " + id);
      if (match[1]) {
        if (stack.length < 2 || stack.at(-1).id !== id) {
          throw Error("Misnested inline marker " + id);
        }
        stack.pop();
      } else {
        if (used.has(id)) throw Error("Duplicate inline marker " + id);
        used.add(id);
        const node = { type: "slot", id, children: [] };
        stack.at(-1).children.push(node);
        stack.push(node);
      }
      cursor = pattern.lastIndex;
    }
    if (cursor < text.length) stack.at(-1).children.push({
      type: "text", value: text.slice(cursor)
    });
    if (stack.length !== 1 || used.size !== expected.size) {
      throw Error("Missing or unclosed inline marker");
    }
    return rootNode.children;
  }

  function parseTranslations(raw, expectedIds) {
    if (typeof raw !== "string" || raw.length > 150000) throw Error("Invalid model output");
    const cleaned = raw.trim();
    const fence = String.fromCharCode(96).repeat(3);
    const jsonText = cleaned.startsWith(fence)
      ? cleaned.replace(new RegExp("^" + fence + "(?:json)?\\s*", "i"), "")
        .replace(new RegExp("\\s*" + fence + "$"), "")
      : cleaned;
    const object = JSON.parse(jsonText);
    if (!object || !Array.isArray(object.translations)) {
      throw Error("Model returned no translations array");
    }
    const expected = new Set(expectedIds.map(String));
    const result = new Map();
    for (const item of object.translations) {
      const id = String(item?.id);
      if (!expected.has(id) || result.has(id) || typeof item.text !== "string" ||
          !item.text.trim() || item.text.length > 20000) {
        throw Error("Invalid, repeated or missing translation");
      }
      result.set(id, item.text);
    }
    if (result.size !== expected.size) throw Error("Model omitted a paragraph");
    return result;
  }

  function batches(items, maxChars = 4300, maxItems = 5) {
    const result = [];
    let batch = [], count = 0;
    for (const item of items) {
      const length = item.source.length + 100;
      if (batch.length && (count + length > maxChars || batch.length >= maxItems)) {
        result.push(batch); batch = []; count = 0;
      }
      batch.push(item);
      count += length;
    }
    if (batch.length) result.push(batch);
    return result;
  }

  function pruneCache(entries, now = Date.now(), max = 250, bytes = 2500000) {
    const ttl = 30 * 24 * 60 * 60 * 1000;
    const candidates = Object.entries(entries || {}).filter(([, val]) =>
      val && typeof val.text === "string" && typeof val.timestamp === "number" &&
      now - val.timestamp >= 0 && now - val.timestamp < ttl
    ).sort((a, b) => (b[1].access || b[1].timestamp) - (a[1].access || a[1].timestamp));
    const result = {};
    let used = 0, count = 0;
    for (const [key, value] of candidates) {
      const size = value.text.length * 2 + key.length * 2;
      if (count >= max || used + size > bytes) continue;
      result[key] = value;
      used += size;
      count++;
    }
    return result;
  }

  return { start, end, parseTagged, parseTranslations, batches, pruneCache };
});
