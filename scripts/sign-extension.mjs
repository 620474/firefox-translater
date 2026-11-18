import { spawnSync } from "node:child_process";
if (!process.env.AMO_JWT_ISSUER || !process.env.AMO_JWT_SECRET) {
  console.log("No AMO credentials: skip Mozilla signing (ZIP source release only).");
  process.exit(0);
}
const result = spawnSync("npx", [
  "--no-install", "web-ext", "sign",
  "--source-dir", "dist/extension", "--artifacts-dir", "dist",
  "--channel", "unlisted",
  "--api-key", process.env.AMO_JWT_ISSUER,
  "--api-secret", process.env.AMO_JWT_SECRET
], { stdio: "inherit", shell: false });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
