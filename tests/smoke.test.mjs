import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Manifest defines Firefox popup and background", async () => {
  const data = JSON.parse(await readFile("manifest.json", "utf8"));
  assert.equal(data.manifest_version, 2);
  assert.equal(data.background.scripts[0], "background.js");
  assert.equal(data.browser_action.default_popup, "popup.html");
  for (const name of ["background.js", "content.js", "popup.html", "popup.css", "popup.js"]) {
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
