import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { classifyInstall, isGlobalInstall, isEntrypoint } from "../src/install";

let fails = 0;
const assert = (cond: boolean, m: string) => {
  console.log(`  ${cond ? "✓" : "✗"} ${m}`);
  if (!cond) fails++;
};

console.log("\n[client] global-install detection (the statusLine path must be durable)");

const root = mkdtempSync(join(tmpdir(), "scode-install-"));

const globalCli = join(root, "prefix", "lib", "node_modules", "sponsored-code", "dist", "cli.js");
mkdirSync(join(root, "prefix", "lib", "node_modules", "sponsored-code", "dist"), { recursive: true });
writeFileSync(globalCli, "");
const g = classifyInstall(globalCli);
assert(g.kind === "global" && g.global, "a <prefix>/lib/node_modules install is global");

const projectRoot = join(root, "my-app");
const localCli = join(projectRoot, "node_modules", "sponsored-code", "dist", "cli.js");
mkdirSync(join(projectRoot, "node_modules", "sponsored-code", "dist"), { recursive: true });
writeFileSync(join(projectRoot, "package.json"), "{}");
writeFileSync(localCli, "");
const l = classifyInstall(localCli);
assert(l.kind === "local" && !l.global, "a project-local node_modules install is NOT global");

const npxCli = join(root, ".npm", "_npx", "abc123", "node_modules", "sponsored-code", "dist", "cli.js");
mkdirSync(join(root, ".npm", "_npx", "abc123", "node_modules", "sponsored-code", "dist"), { recursive: true });
writeFileSync(join(root, ".npm", "_npx", "abc123", "package.json"), "{}");
writeFileSync(npxCli, "");
const n = classifyInstall(npxCli);
assert(n.kind === "npx" && !n.global, "an npx (_npx cache) install is NOT global");

assert(isGlobalInstall(join(root, "checkout", "client", "packages", "cli", "src", "cli.ts")), "a source/dev run is allowed");

// A Windows-style backslash npx path must still classify as npx (pure string logic).
const winNpx = "C:\\Users\\dev\\AppData\\Local\\npm-cache\\_npx\\abc123\\node_modules\\sponsored-code\\dist\\cli.js";
assert(classifyInstall(winNpx).kind === "npx", "a Windows-style \\_npx\\ path is detected as npx");

// The Windows global layout (no `lib` segment) must still classify as global.
const winGlobal = join(root, "AppData", "Roaming", "npm", "node_modules", "@sponsored-code", "cli", "dist", "cli.js");
mkdirSync(join(root, "AppData", "Roaming", "npm", "node_modules", "@sponsored-code", "cli", "dist"), { recursive: true });
writeFileSync(winGlobal, "");
assert(classifyInstall(winGlobal).global, "a Windows %AppData%\\npm\\node_modules global install is global");

console.log("\n[client] isEntrypoint — the bin must actually run main() (the silent-`npx start` bug)");

const realCli = join(root, "g", "node_modules", "@sponsored-code", "cli", "dist", "cli.js");
mkdirSync(join(root, "g", "node_modules", "@sponsored-code", "cli", "dist"), { recursive: true });
writeFileSync(realCli, "");
assert(isEntrypoint(realCli, pathToFileURL(realCli).href), "the real cli.js path is its own entrypoint");

// A bin symlink must still count as the entrypoint — argv1 is the symlink, import.meta.url the realpath.
let symlinkOk = true;
const binLink = join(root, "g", "node_modules", ".bin", "scode");
mkdirSync(join(root, "g", "node_modules", ".bin"), { recursive: true });
try { symlinkSync(realCli, binLink); } catch { symlinkOk = false; }
if (symlinkOk) assert(isEntrypoint(binLink, pathToFileURL(realCli).href), "a bin symlink to cli.js is the entrypoint");
else console.log("  · skipped symlink case (no symlink privilege on this host)");

const other = join(root, "g", "node_modules", "@sponsored-code", "cli", "dist", "mcp.js");
writeFileSync(other, "");
assert(!isEntrypoint(other, pathToFileURL(realCli).href), "a different file is not the entrypoint");
assert(!isEntrypoint(undefined, pathToFileURL(realCli).href), "no argv1 → not the entrypoint");

console.log(`\n${fails ? "FAILED" : "PASSED"} — ${fails} failure(s)`);
if (fails) process.exitCode = 1;
