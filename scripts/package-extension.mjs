import { mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { writeZip } from "./archive.mjs";
import { resolve } from "node:path";

const version = process.argv[2] || "0.1.0";
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw Error("Invalid semantic version");
}
const names = ["manifest.json", "background.js", "reader-core.js", "reader-actions.js", "content.js", "floating.js", "popup.html", "popup.css", "popup.js", "notes.html", "notes.css", "notes.js"];
const output = resolve("dist"), source = resolve("dist/extension");
await rm(source, { recursive: true, force: true });
await mkdir(source, { recursive: true });
const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
manifest.version = version;
await writeFile(resolve(source, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
for (const name of names.filter(name => name !== "manifest.json")) {
  await copyFile(resolve(name), resolve(source, name));
}
const archive = resolve(output, "firefox-translator-v" + version + ".zip");
await rm(archive, { force: true });
await writeZip(archive, await Promise.all(names.map(async name => [name, await readFile(resolve(source, name))])));
console.log("Built extension source archive: " + archive);
