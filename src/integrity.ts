import { join } from "node:path";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { settingsStatus } from "./settings";
import { installHmac, scodeDir } from "./store";

// Record an HMAC of the verbs we write and re-check it so an out-of-band edit is flagged.

function sigPath(): string {
  return join(scodeDir(), "managed.sig");
}

export function recordManaged(verbs: string[]): void {
  writeFileSync(sigPath(), installHmac(JSON.stringify(verbs)));
}
export function clearManaged(): void {
  rmSync(sigPath(), { force: true });
}

export type IntegrityResult = { ok: true } | { ok: false; reason: string };

export function checkIntegrity(): IntegrityResult {
  if (!existsSync(sigPath())) return { ok: true }; // nothing under management yet
  let expected: string;
  try {
    expected = readFileSync(sigPath(), "utf8");
  } catch {
    return { ok: true };
  }
  const verbs = settingsStatus().spinnerVerbs?.verbs as string[] | undefined;
  if (!verbs) return { ok: false, reason: "managed_verbs_removed" };
  return installHmac(JSON.stringify(verbs)) === expected
    ? { ok: true }
    : { ok: false, reason: "modified_outside_cli" };
}
