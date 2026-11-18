import { mkdir, readFile, writeFile, copyFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const version = process.argv[2] || "0.1.0";
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw Error("Invalid semantic version");
}
const names = ["manifest.json", "background.js", "content.js", "popup.html", "popup.css", "popup.js"];
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
execFileSync("zip", ["-q", "-r", archive, ...names], { cwd: source, stdio: "inherit" });
console.log("Built extension source archive: " + archive);
