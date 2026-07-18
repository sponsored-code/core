// Codex CLI detection. The ad shows via the terminal wrapper (`scode run codex`), so all we need here is
// whether Codex looks present on this machine.

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function codexDir(): string {
  return process.env.CODEX_HOME || join(homedir(), ".codex");
}

/** Whether the Codex CLI looks present on this machine (its home dir exists). */
export function codexInstalled(): boolean {
  return existsSync(codexDir());
}
