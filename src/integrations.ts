// How scode integrates with each host, persisted in ~/.scode/integrations.json. Each target names the
// method used to show the ad: Claude Code via its native statusLine or a terminal wrapper; Codex and Cursor
// via the terminal wrapper; plus any extra commands the user wants wrapped. `off` means don't install that
// target. `refreshMs` is the wrapper's repaint interval. `offered` records the CLIs we've already asked the
// user about, so a newly-installed one is offered exactly once and their answer is respected.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { scodeDir } from "./store";

export type ClaudeMethod = "off" | "statusline" | "wrapper";
export type CodexMethod = "off" | "wrapper";
export type CursorMethod = "off" | "wrapper";
export type Integrations = {
  claude: ClaudeMethod;
  codex: CodexMethod;
  cursor: CursorMethod;
  refreshMs: number;
  extra: string[];
  offered: string[];
};

// How each host shows the ad.
export const ON_METHOD: { claude: ClaudeMethod; codex: CodexMethod; cursor: CursorMethod } = {
  claude: "wrapper",
  codex: "wrapper",
  cursor: "wrapper",
};

// Defaults for a new install.
export const DEFAULT_INTEGRATIONS: Integrations = { claude: "off", codex: "off", cursor: "off", refreshMs: 8, extra: [], offered: [] };
export const REFRESH_MIN = 8;
export const REFRESH_MAX = 1000;

function file(): string {
  return join(scodeDir(), "integrations.json");
}

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s) => typeof s === "string") : []);

export function readIntegrations(): Integrations {
  try {
    const i = JSON.parse(readFileSync(file(), "utf8")) as Partial<Integrations>;
    return {
      claude: i.claude ?? DEFAULT_INTEGRATIONS.claude,
      codex: i.codex ?? DEFAULT_INTEGRATIONS.codex,
      cursor: i.cursor ?? DEFAULT_INTEGRATIONS.cursor,
      refreshMs: clampRefresh(i.refreshMs),
      extra: strList(i.extra),
      offered: strList(i.offered),
    };
  } catch {
    return { ...DEFAULT_INTEGRATIONS, extra: [], offered: [] };
  }
}

export function writeIntegrations(next: Partial<Integrations>): Integrations {
  const merged = { ...readIntegrations(), ...next };
  merged.refreshMs = clampRefresh(merged.refreshMs);
  mkdirSync(scodeDir(), { recursive: true });
  writeFileSync(file(), JSON.stringify(merged, null, 2) + "\n");
  return merged;
}

export function clampRefresh(ms: unknown): number {
  const n = Math.round(Number(ms));
  if (!Number.isFinite(n)) return DEFAULT_INTEGRATIONS.refreshMs;
  return Math.min(REFRESH_MAX, Math.max(REFRESH_MIN, n));
}
