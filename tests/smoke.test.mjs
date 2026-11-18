import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Manifest defines Firefox popup and background", async () => {
  const data = JSON.parse(await readFile("manifest.json", "utf8"));
  assert.equal(data.manifest_version, 2);
  assert.equal(data.background.scripts[0], "background.js");
  assert.equal(data.browser_action.default_popup, "popup.html");
  assert.ok(data.content_scripts[0].js.includes("floating.js"));
  for (const name of ["background.js", "content.js", "floating.js", "popup.html", "popup.css", "popup.js"]) {
    assert.ok((await readFile(name, "utf8")).length > 0);
  }
});

test("Semantic release prepares GitHub assets", async () => {
  const config = JSON.parse(await readFile(".releaserc.json", "utf8"));
  assert.deepEqual(config.branches, ["main"]);
  assert.ok(config.plugins.some(p => Array.isArray(p) && p[0] === "@semantic-release/github"));
  const workflow = await readFile(".github/workflows/release.yml", "utf8");
  assert.match(workflow, /npm run build:api/);
  assert.match(workflow, /npm run release/);
});

test("Floating controls are included in signed package and use the background gateway", async () => {
  const bundler = await readFile("scripts/package-extension.mjs", "utf8");
  const background = await readFile("background.js", "utf8");
  const overlay = await readFile("floating.js", "utf8");
  assert.match(bundler, /floating\.js/);
  assert.match(background, /case "TAB_ACTION":/);
  assert.match(background, /case "OPEN_SETTINGS":/);
  assert.match(overlay, /pointerdown/);
  assert.match(overlay, /pointerup/);
  assert.match(overlay, /pointermove/);
  assert.match(overlay, /HOLD_MS = 520/);
  assert.match(overlay, /aiarFloatingPrefs/);
  assert.match(overlay, /mode|eink/i);
});
