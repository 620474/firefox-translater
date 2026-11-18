import { execFileSync } from 'node:child_process';
const version=process.argv[2] || '0.1.0';
for (const script of ['scripts/package-extension.mjs','scripts/package-platforms.mjs']) {
  execFileSync(process.execPath,[script,version],{stdio:'inherit'});
}
