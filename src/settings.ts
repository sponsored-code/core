// Merge/remove keys in Claude Code's settings.json, keeping other keys, with a one-time backup.

import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

export type SpinnerMode = "append" | "replace";

export function configDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
}
export function settingsPath(): string {
  return join(configDir(), "settings.json");
}
function backupPath(): string {
  return settingsPath() + ".scode.bak";
}

export function readSettings(): Record<string, any> {
  const p = settingsPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf8")) as Record<string, any>;
  } catch {
    return {};
  }
}

/** Snapshot settings.json exactly once, so a revert is always possible. */
function backupOnce(): void {
  const p = settingsPath();
  if (existsSync(p) && !existsSync(backupPath())) copyFileSync(p, backupPath());
}

function writeSettings(s: Record<string, any>): void {
  const p = settingsPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(s, null, 2) + "\n");
}

export function setSpinnerVerbs(verbs: string[], mode: SpinnerMode = "replace"): void {
  if (!verbs.length) throw new Error("need at least one verb");
  backupOnce();
  const s = readSettings();
  s.spinnerVerbs = { mode, verbs };
  writeSettings(s);
}

/** Remove the spinnerVerbs key — leaves any other settings untouched. */
export function clearSpinnerVerbs(): void {
  const s = readSettings();
  delete s.spinnerVerbs;
  writeSettings(s);
}

/** Wire a `statusLine` command into settings.json, merged + backed up. `refreshInterval` (seconds) re-runs it on a timer. */
export function setStatusLine(command: string, refreshInterval = 1): void {
  backupOnce();
  const s = readSettings();
  s.statusLine = { type: "command", command, refreshInterval };
  writeSettings(s);
}
export function clearStatusLine(): void {
  const s = readSettings();
  delete s.statusLine;
  writeSettings(s);
}

export function settingsStatus() {
  const s = readSettings();
  return {
    settingsPath: settingsPath(),
    spinnerVerbs: s.spinnerVerbs ?? null,
    statusLine: s.statusLine ?? null,
    backupExists: existsSync(backupPath()),
  };
}
