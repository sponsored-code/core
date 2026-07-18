import { tmpdir } from "node:os";
import { join } from "node:path";

// Isolate from the real machine and force a short rotation window BEFORE the modules read them at load.
process.env.SCODE_HOME = join(tmpdir(), "scode-sl-test-" + Date.now());
process.env.SCODE_AD_ROTATE_MS = "10"; // tiny hold so each render() rotates a slot

import { saveCredential } from "../src/store";
import { renderStatusLine } from "../src/statusline";
import type { ClientInfo } from "../src/api";

// The statusline serves an ad every rotation, EXCEPT: once every 4 ads, when a MAJOR update is out, that
// slot shows the upgrade nudge instead. Proves the 1-in-4 cadence, the reset, and that no nudge ever shows
// when there's no update. requestAd/reportView go over fetch, so we stub fetch to a canned served ad.

const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
globalThis.fetch = (async (url: string | URL | Request) => {
  const u = String(url);
  if (u.includes("/v1/ad")) return jsonResponse({ ad: { id: "ad1", headline: "Buy Widgets", body: "", url: "https://example.com", color: 45 }, token: "adtok", earnedMicros: 12345 });
  if (u.includes("/v1/view")) return jsonResponse({ ok: true });
  return jsonResponse({});
}) as typeof fetch;

saveCredential("scode_test_token");

let fails = 0;
const assert = (c: boolean, m: string) => { console.log(`  ${c ? "✓" : "✗"} ${m}`); if (!c) fails++; };
const client: ClientInfo = { surface: "cli", version: "2.5.0" };
const isAd = (s: string) => s.includes("#ad") && !s.includes("↑ update");
const isNudge = (s: string) => s.includes("↑ update") && !s.includes("#ad");

// Each call advances `now` well past the (tiny) rotation window, so every call rotates a fresh slot.
let t = 1_000_000;
const render = (updateLatest?: string) => { t += 100_000; return renderStatusLine({}, t, client, updateLatest); };

console.log("\n[statusline] randomized 4–20 upgrade nudge on a major version bump");

// A major update is out → render many slots; the nudge lands every 4–20 ads, randomized per cycle.
const seq: ("ad" | "nudge" | "other")[] = [];
for (let i = 0; i < 200; i++) {
  const s = await render("3.0.0");
  seq.push(isNudge(s) ? "nudge" : isAd(s) ? "ad" : "other");
}
assert(!seq.includes("other"), "every slot is either an ad or the nudge (no malformed render)");

const nudgeAt = seq.flatMap((v, i) => (v === "nudge" ? [i] : []));
assert(nudgeAt.length >= 2, `the nudge fired repeatedly over 200 slots (${nudgeAt.length}×)`);

// Ads before the first nudge = the first target; ads between two nudges = each subsequent target. All ∈ [4,20].
const gaps = [nudgeAt[0]!, ...nudgeAt.slice(1).map((idx, k) => idx - nudgeAt[k]! - 1)];
assert(gaps.every((g) => g >= 4 && g <= 20), `every gap between nudges is in [4,20] (gaps: ${gaps.join(",")})`);
assert(new Set(gaps).size >= 2, "the gap is randomized per cycle, not a fixed cadence");

// Content on the nudge slot (find one).
const nudge = seq.indexOf("nudge") >= 0 ? await (async () => { let s = ""; for (let i = 0; i < 21 && !isNudge(s); i++) s = await render("3.0.0"); return s; })() : "";
assert(isNudge(nudge) && nudge.includes("2.5.0 → 3.0.0") && nudge.includes("npm i -g @sponsored-code/cli"), "the nudge shows current → latest + the upgrade command");
assert(!nudge.includes("Buy Widgets"), "the nudge replaces the ad in its slot (no ad creative)");

// No update available → the slot is NEVER given to a nudge, no matter how many rotations. (The CLI only
// passes a value on a MAJOR bump, so `undefined` also covers minor/patch — same as no update.)
let anyNudge = false;
for (let i = 0; i < 40; i++) if (isNudge(await render(undefined))) anyNudge = true;
assert(!anyNudge, "with no major update, every slot stays an ad — the nudge never fires");

console.log(`\n${fails ? "FAILED" : "PASSED"} — ${fails} failure(s)`);
process.exit(fails ? 1 : 0);
