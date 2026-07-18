import { tmpdir } from "node:os";
import { join, delimiter } from "node:path";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";

// Isolate from the real machine.
const HOME = join(tmpdir(), "scode-shim-" + Date.now());
process.env.SCODE_HOME = HOME;

import { shimDir, installShim, removeShim, shimInstalled, resolveReal, ensureShimPath, removeShimPath } from "../src/shim";

let fails = 0;
const assert = (c: boolean, m: string) => {
  console.log(`  ${c ? "✓" : "✗"} ${m}`);
  if (!c) fails++;
};

console.log("\n[shim] cross-platform command shims");

// --- POSIX shims ---
process.env.SCODE_PLATFORM = "linux";
installShim("codex");
assert(shimInstalled("codex"), "posix: shim reported installed");
assert(existsSync(join(shimDir(), "codex")), "posix: writes an extensionless script");
assert(!existsSync(join(shimDir(), "codex.cmd")), "posix: no .cmd on linux");
{
  const body = readFileSync(join(shimDir(), "codex"), "utf8");
  assert(body.startsWith("#!/bin/sh"), "posix: has a /bin/sh shebang");
  assert(body.includes("exec scode run codex"), "posix: delegates to `scode run codex`");
}
removeShim("codex");
assert(!shimInstalled("codex"), "posix: removeShim deletes it");

// --- Windows shims ---
process.env.SCODE_PLATFORM = "win32";
installShim("codex");
assert(existsSync(join(shimDir(), "codex.cmd")), "win: writes a .cmd launcher");
assert(existsSync(join(shimDir(), "codex")), "win: also writes the sh script (Git Bash)");
assert(shimInstalled("codex"), "win: shim reported installed");
{
  const cmd = readFileSync(join(shimDir(), "codex.cmd"), "utf8");
  assert(cmd.includes("scode run codex %*"), "win: .cmd forwards args with %*");
}
removeShim("codex");
assert(!existsSync(join(shimDir(), "codex.cmd")), "win: removeShim deletes the .cmd too");

// --- resolveReal skips our shim dir and honors PATHEXT on Windows ---
const fakeBin = join(tmpdir(), "scode-bin-" + Date.now());
mkdirSync(fakeBin, { recursive: true });
mkdirSync(shimDir(), { recursive: true });

process.env.SCODE_PLATFORM = "win32";
writeFileSync(join(fakeBin, "gemini.CMD"), "");
writeFileSync(join(shimDir(), "gemini.cmd"), ""); // our shim — must be skipped
process.env.PATH = [shimDir(), fakeBin].join(delimiter);
{
  const real = resolveReal("gemini");
  assert(real === join(fakeBin, "gemini.CMD"), "win: resolves via PATHEXT, skipping the shim dir");
}

process.env.SCODE_PLATFORM = "linux";
writeFileSync(join(fakeBin, "aider"), "");
process.env.PATH = [shimDir(), fakeBin].join(delimiter);
{
  const real = resolveReal("aider");
  assert(real === join(fakeBin, "aider"), "posix: resolves the bare name off PATH");
  assert(resolveReal("does-not-exist-xyz") === "does-not-exist-xyz", "posix: unknown name returns as-is");
}

// --- ensureShimPath / removeShimPath edit the shell rc on POSIX (idempotent) ---
process.env.SCODE_PLATFORM = "linux";
const rc = join(HOME, ".zshrc");
process.env.SHELL = "/bin/zsh";
process.env.HOME = HOME; // homedir() reads $HOME on POSIX…
process.env.USERPROFILE = HOME; // …and %USERPROFILE% on Windows runners
mkdirSync(HOME, { recursive: true });
writeFileSync(rc, "# existing\n");
ensureShimPath();
{
  const after = readFileSync(rc, "utf8");
  assert(after.includes(shimDir()), "posix: ensureShimPath adds the shim dir to the rc");
  const changed = ensureShimPath();
  assert(changed === null, "posix: ensureShimPath is idempotent");
}
removeShimPath();
assert(!readFileSync(rc, "utf8").includes(shimDir()), "posix: removeShimPath cleans the rc");

console.log(fails === 0 ? "\nPASSED — 0 failure(s)\n" : `\nFAILED — ${fails} failure(s)\n`);
if (fails) process.exitCode = 1;
