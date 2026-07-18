// Transparent command shims. For the "wrapper" method we drop a tiny launcher into ~/.scode/bin that runs
// `scode run <name>` instead of the real command, and put that dir first so it's found ahead of the original.
// Running `codex` (or any wrapped command) then transparently gets the Sponsored Code footer. The wrapper
// resolves the real command while skipping this dir, so there's no loop. Works on macOS, Linux, and Windows.

import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, chmodSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, delimiter } from "node:path";
import { scodeDir } from "./store";

// Real platform, overridable in tests via SCODE_PLATFORM.
const platform = (): string => process.env.SCODE_PLATFORM || process.platform;
const isWindows = (): boolean => platform() === "win32";
const samePath = (a: string, b: string): boolean => (isWindows() ? a.toLowerCase() === b.toLowerCase() : a === b);

export function shimDir(): string {
  return join(scodeDir(), "bin");
}

// The files backing one wrapped command: a POSIX script always (for sh/bash/zsh + Git Bash), plus a .cmd on Windows.
function shimFiles(name: string): string[] {
  const posix = join(shimDir(), name);
  return isWindows() ? [posix, join(shimDir(), `${name}.cmd`)] : [posix];
}

export function shimInstalled(name: string): boolean {
  return shimFiles(name).some((f) => existsSync(f));
}

export function installShim(name: string): void {
  mkdirSync(shimDir(), { recursive: true });
  const posix = join(shimDir(), name);
  writeFileSync(posix, `#!/bin/sh\nexec scode run ${name} "$@"\n`);
  try {
    chmodSync(posix, 0o755);
  } catch {
    /* not supported on windows */
  }
  if (isWindows()) writeFileSync(join(shimDir(), `${name}.cmd`), `@echo off\r\nscode run ${name} %*\r\n`);
}

export function removeShim(name: string): void {
  for (const f of shimFiles(name)) rmSync(f, { force: true });
}

// Windows executables carry an extension; try the known executable extensions when one isn't given.
function pathExts(name: string): string[] {
  if (!isWindows() || /\.[^\\/]+$/.test(name)) return [""];
  const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
  return ["", ...exts];
}

/** Resolve the real executable for `name`, skipping our shim dir (so the wrapper never re-invokes itself). */
export function resolveReal(name: string): string {
  const dir0 = shimDir();
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    if (!dir || samePath(dir, dir0)) continue;
    for (const ext of pathExts(name)) {
      const p = join(dir, name + ext);
      if (existsSync(p)) return p;
    }
  }
  return name;
}

const MARK = "# sponsored-code shim";

function rcFile(): string | null {
  const shell = process.env.SHELL ?? "";
  const home = homedir();
  if (shell.includes("zsh")) return join(home, ".zshrc");
  if (shell.includes("bash")) return join(home, ".bashrc");
  return null;
}

// Persist the shim dir into the Windows user environment (idempotent). New terminals pick it up.
function setWindowsUserPath(add: boolean): void {
  const dir = shimDir();
  const ps = add
    ? `$d='${dir}'; $p=[Environment]::GetEnvironmentVariable('Path','User'); if(-not $p){$p=''}; if(($p -split ';') -notcontains $d){[Environment]::SetEnvironmentVariable('Path', ($d + ';' + $p), 'User')}`
    : `$d='${dir}'; $p=[Environment]::GetEnvironmentVariable('Path','User'); if($p){[Environment]::SetEnvironmentVariable('Path', (($p -split ';' | Where-Object {$_ -ne $d}) -join ';'), 'User')}`;
  spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", ps], { stdio: "ignore" });
}

/** Put our shim dir ahead of the real commands (idempotent). Returns a label for the location it changed, or null if nothing to do. */
export function ensureShimPath(): string | null {
  if (isWindows()) {
    const dir = shimDir();
    if ((process.env.PATH ?? "").split(delimiter).some((d) => samePath(d, dir))) return null;
    setWindowsUserPath(true);
    process.env.PATH = `${dir}${delimiter}${process.env.PATH ?? ""}`;
    return "your Windows environment";
  }
  const rc = rcFile();
  if (!rc) return null;
  let cur = "";
  try {
    cur = readFileSync(rc, "utf8");
  } catch {
    /* new file */
  }
  if (cur.includes(MARK)) return null;
  const line = `export PATH="${shimDir()}:$PATH" ${MARK}`;
  writeFileSync(rc, cur + (cur === "" || cur.endsWith("\n") ? "" : "\n") + line + "\n");
  return rc;
}

/** Remove the shim dir we added (undo ensureShimPath). */
export function removeShimPath(): void {
  if (isWindows()) {
    setWindowsUserPath(false);
    return;
  }
  const rc = rcFile();
  if (!rc) return;
  try {
    const cur = readFileSync(rc, "utf8");
    const next = cur
      .split("\n")
      .filter((l) => !l.includes(MARK))
      .join("\n");
    if (next !== cur) writeFileSync(rc, next);
  } catch {
    /* nothing to clean */
  }
}
