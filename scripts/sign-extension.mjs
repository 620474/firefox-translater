import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const hasIssuer = Boolean(process.env.AMO_JWT_ISSUER);
const hasSecret = Boolean(process.env.AMO_JWT_SECRET);

if (hasIssuer !== hasSecret) {
  throw Error("Both AMO_JWT_ISSUER and AMO_JWT_SECRET must be configured.");
}
if (!hasIssuer) {
  console.log("Mozilla credentials are not configured: publishing a source ZIP only.");
  process.exit(0);
}

const args = [
  "--no-install", "web-ext", "sign",
  "--source-dir", "dist/extension",
  "--artifacts-dir", "dist",
  "--channel", "unlisted",
  "--api-key", process.env.AMO_JWT_ISSUER,
  "--api-secret", process.env.AMO_JWT_SECRET
];
const result = spawnSync("npx", args, { stdio: "inherit", shell: false });
if (result.error) throw result.error;
if (result.status !== 0) {
  throw Error("Mozilla signing failed with exit code " + String(result.status));
}

const files = await readdir("dist");
const xpis = files.filter(name => name.endsWith(".xpi"));
if (!xpis.length) {
  throw Error("Mozilla signing finished but no .xpi was created.");
}
console.log("Signed Mozilla extension:", xpis.join(", "));
