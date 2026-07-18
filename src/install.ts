// Classify the install: durable global vs ephemeral npx download vs project-local.

import { realpathSync, existsSync } from "node:fs";
import { join, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type InstallKind = "global" | "npx" | "local" | "unknown";

export interface InstallInfo {
  kind: InstallKind;
  /** Whether that location is durable enough to bake into Claude Code's settings. */
  global: boolean;
  /** The resolved (symlinks followed) path that was classified. */
  path: string;
}

function realpathSafe(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Classify the install backing `entry` (typically `process.argv[1]`). */
export function classifyInstall(entry: string): InstallInfo {
  const path = realpathSafe(entry);
  // Tokenize on both separators so detection is identical on every platform.
  const parts = path.split(/[/\\]/);

  if (parts.includes("_npx")) return { kind: "npx", global: false, path };

  const nmIdx = parts.lastIndexOf("node_modules");
  if (nmIdx === -1) return { kind: "unknown", global: true, path };

  // Rejoin with the platform separator so the package.json probe hits a real, native path.
  const enclosingParent = parts.slice(0, nmIdx).join(sep) || sep;
  if (existsSync(join(enclosingParent, "package.json"))) return { kind: "local", global: false, path };
  return { kind: "global", global: true, path };
}

/** True when `entry` resolves to a durable global install (or a dev/source run). */
export function isGlobalInstall(entry: string): boolean {
  return classifyInstall(entry).global;
}

/** True when `moduleUrl` (pass `import.meta.url`) is the program Node launched (`argv1`). Resolves both
 *  sides to their real on-disk path so a bin symlink or path-case difference doesn't compare unequal. */
export function isEntrypoint(argv1: string | undefined, moduleUrl: string): boolean {
  if (!argv1) return false;
  const canon = (p: string): string => {
    const real = realpathSync.native(p);
    return process.platform === "win32" ? real.toLowerCase() : real;
  };
  try {
    return canon(argv1) === canon(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
