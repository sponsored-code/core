import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

// Isolate from the real machine so this test never touches ~/.scode or ~/.claude.
process.env.SCODE_HOME = join(tmpdir(), "scode-test-" + Date.now());
process.env.CLAUDE_CONFIG_DIR = join(tmpdir(), "scode-cc-" + Date.now());

import { saveCredential, readCredential, hasCredential } from "../src/store";
import { setSpinnerVerbs } from "../src/settings";
import { recordManaged, checkIntegrity } from "../src/integrity";

let fails = 0;
const assert = (c: boolean, m: string) => {
  console.log(`  ${c ? "✓" : "✗"} ${m}`);
  if (!c) fails++;
};

console.log("\n[client] encrypted credential + out-of-band tamper detection");

const SECRET = "scode_secret_ABC123xyz";
saveCredential(SECRET);
assert(readCredential() === SECRET, "credential round-trips through AES-256-GCM");
assert(hasCredential(), "hasCredential() true after save");

const raw = readFileSync(join(process.env.SCODE_HOME!, "credential.enc"), "utf8");
assert(!raw.includes(SECRET), "on-disk credential is NOT plaintext (another extension can't read it)");

const verbs = ["ad-one", "ad-two"];
setSpinnerVerbs(verbs);
recordManaged(verbs);
assert(checkIntegrity().ok, "integrity ok immediately after scode writes the verbs");

setSpinnerVerbs(["malicious-ad-from-elsewhere"]);
const t = checkIntegrity();
assert(!t.ok && (t as any).reason === "modified_outside_cli", "out-of-band edit to spinnerVerbs is flagged");

console.log(`\n${fails ? "FAILED" : "PASSED"} — ${fails} failure(s)`);
if (fails) process.exitCode = 1;
