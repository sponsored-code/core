import { join } from "node:path";
import { readFileSync, writeFileSync, openSync, closeSync } from "node:fs";
import { WriteStream } from "node:tty";
import { readCredential, scodeDir, installHmac } from "./store";
import { requestAd, reportView, type SessionContext, type ClientInfo } from "./api";

// Reduce Claude Code's statusLine stdin to a minimal, non-reversible form.
export function redactSession(raw: unknown): SessionContext {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as { session_id?: unknown; cost?: { total_cost_usd?: unknown } };
  const sessionId = typeof r.session_id === "string" && r.session_id ? installHmac(r.session_id) : undefined;
  const usd = r.cost?.total_cost_usd;
  const costMicros = typeof usd === "number" && usd >= 0 ? Math.round(usd * 1e6) : undefined;
  return { sessionId, costMicros };
}

// Reduce the Codex hook stdin the same way. Codex sends no session cost, so only the (hashed) id carries over.
export function redactCodexSession(raw: unknown): SessionContext {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as { session_id?: unknown };
  const sessionId = typeof r.session_id === "string" && r.session_id ? installHmac(r.session_id) : undefined;
  return { sessionId };
}

// Flatten a rendered line to plain text for surfaces that can't show our colors/links (e.g. a Codex notice):
// drop the OSC-8 hyperlink wrappers and SGR color escapes, then collapse whitespace to one line.
export function toPlainLine(s: string): string {
  return s
    .replace(/\x1b\]8;;[^\x1b\x07]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Hold each creative on screen this long before rotating.
const AD_ROTATE_MS = Math.max(2000, Number(process.env.SCODE_AD_ROTATE_MS) || 15000);
const ESC = "\x1b";
const BEL = "\x07";
const color = (c: number, s: string) => `${ESC}[38;5;${c}m${s}${ESC}[0m`;
// An OSC-8 hyperlink (BEL-terminated — some xterm.js builds mishandle ST). The native status line uses it to
// make the shown link clickable — it wraps the ad's URL as a real terminal hyperlink.
const osc8 = (url: string, text: string) => `${ESC}]8;;${url}${BEL}${text}${ESC}]8;;${BEL}`;

function statePath(): string {
  return join(scodeDir(), "statusline.json");
}
function readState(): { creative?: Renderable; adId?: string; adToken?: string; shownAt?: number; reported?: boolean; earnedMicros?: number; adsShown?: number; nudgeAfter?: number; signedOut?: boolean } {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8"));
  } catch {
    return {};
  }
}
function writeState(s: object): void {
  try {
    writeFileSync(statePath(), JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

type Renderable = { headline: string; url?: string; color?: number; kind?: "ad" | "update"; site?: string };

function earnedBadge(earnedMicros?: number): string {
  return color(240, `⌁ $${((earnedMicros ?? 0) / 1e6).toFixed(4)} earned`); // always shown, even at $0.0000
}

// Printing width, ignoring the OSC-8 + SGR escapes we emit.
const visibleLen = (s: string): number =>
  s.replace(/\x1b\]8;;[^\x1b\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;]*m/g, "").length;

// Terminal column count: try stdout/stderr, then /dev/tty, then $COLUMNS. null when unknown.
function terminalWidth(): number | null {
  for (const s of [process.stdout, process.stderr] as const) {
    if (s.columns && s.columns > 0) return s.columns;
  }
  // /dev/tty is POSIX-only; skip it on Windows and fall back to $COLUMNS.
  if (process.platform !== "win32") {
    try {
      const fd = openSync("/dev/tty", "r+");
      try {
        const cols = new WriteStream(fd).columns;
        if (cols && cols > 0) return cols;
      } finally {
        closeSync(fd);
      }
    } catch {
      /* no controlling tty */
    }
  }
  const env = Number(process.env.COLUMNS);
  return Number.isFinite(env) && env > 0 ? env : null;
}

// Right-align `right` on the same row as `left`; degrades to a 3-space trail when width is unknown.
function rightAlign(left: string, right: string, forWrapper = false): string {
  const w = terminalWidth();
  const reserve = Math.max(0, Number(process.env.SCODE_SL_PAD ?? (forWrapper ? 1 : 3)));
  if (w) {
    const pad = w - reserve - visibleLen(left) - visibleLen(right);
    if (pad >= 2) return left + " ".repeat(pad) + right;
  }
  return `${left}   ${right}`;
}

// The tidy domain shown for a link. The wrapper opens the URL itself, so the visible text can be just the
// domain instead of the full URL. Falls back to the raw string if it doesn't parse.
function displayDomain(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}

// The clean label shown for a link: the advertiser's site when provided, else the URL's host.
const linkLabel = (a: Renderable): string => a.site ?? (a.url ? displayDomain(a.url) : "");

// The link currently shown: the URL to open on click, plus its label. The wrapper reads this to open the
// destination when the shown label is clicked.
export function currentLink(): { url: string; label: string } | null {
  const c = readState().creative;
  return c?.url ? { url: c.url, label: linkLabel(c) } : null;
}

function renderCreative(a: Renderable, earnedMicros?: number, forWrapper = false): string {
  const head = color(a.color ?? 45, a.headline);
  const isUpdate = a.kind === "update";
  const tag = isUpdate ? color(214, "↑ update") : color(240, "#ad");
  const earned = earnedBadge(earnedMicros);
  // Show the site domain. In wrapper mode it's painted plain (the wrapper opens the URL on click, so no OSC-8
  // markers — the host terminal warns/blocks them); the native status line wraps the site in a real OSC-8 link.
  const shown = a.url ? (forWrapper ? color(a.color ?? 45, linkLabel(a)) : osc8(a.url, color(a.color ?? 45, linkLabel(a)))) : "";
  const action = isUpdate
    ? `${color(240, "run:")} ${color(a.color ?? 45, "npm i -g @sponsored-code/cli")}`
    : shown ? `${color(240, "Visit:")} ${shown}` : "";
  if (!action) return earned ? `${head}  ${tag}   ${earned}` : `${head}  ${tag}`;
  return `${head}  ${tag}\n${earned ? rightAlign(action, earned, forWrapper) : action}`;
}

const HOUSE_ADS: Renderable[] = [
  { headline: "Sponsored Code — Want devs seeing your brand?", url: "https://sponsoredcode.com", color: 75 },
  { headline: "Sponsored Code — An ad rides your terminal. You get paid.", url: "https://sponsoredcode.com", color: 75 },
];
const houseAd = (now: number): Renderable => HOUSE_ADS[Math.floor(now / 4000) % HOUSE_ADS.length]!;

// Amber signed-out nudge; prompts the user to re-run `scode login`.
const signedOutLine = (): string => color(214, "Sponsored Code · signed out — run `scode login` to keep earning");

// Upgrade-nudge creative. `current` is this install's version (undefined when run unbundled), `latest` the newer one.
function updateCreative(current: string | undefined, latest: string): Renderable {
  const ver = current && current !== "dev" ? `${current} → ${latest}` : `v${latest}`;
  return { headline: `Sponsored Code · a new version is out (${ver})`, url: "https://www.npmjs.com/package/@sponsored-code/cli", color: 75, kind: "update" };
}

// Creatives to show before the next upgrade nudge, randomized in [4, 20] per cycle.
function randAdsPerNudge(): number {
  return 4 + Math.floor(Math.random() * 17); // 4..20 inclusive
}

// `updateLatest` is the newer version when a major update is out; undefined = never nudge.
export async function renderStatusLine(ctx: SessionContext = {}, now = Date.now(), client?: ClientInfo, updateLatest?: string, reRenderOnly = false, forWrapper = false): Promise<string> {
  const token = readCredential();
  if (!token) return color(244, "Sponsored Code · run `scode start` to earn");
  try {
    const prev = readState();
    // Re-layout only: redraw whatever is currently shown for the current terminal width, no request or report.
    if (reRenderOnly) return prev.creative ? renderCreative(prev.creative, prev.earnedMicros, forWrapper) : prev.signedOut ? signedOutLine() : "";
    if (prev.adId && prev.adToken && prev.shownAt && !prev.reported) {
      void reportView({
        accountToken: token,
        adToken: prev.adToken,
        adId: prev.adId,
        viewedMs: now - prev.shownAt,
        sessionId: ctx.sessionId,
        costMicros: ctx.costMicros,
      }).catch(() => {});
      writeState({ ...prev, reported: true });
    }
    if (prev.creative && prev.shownAt && now - prev.shownAt < AD_ROTATE_MS) {
      return renderCreative(prev.creative, prev.earnedMicros, forWrapper);
    }
    // Hold the signed-out line for the same window rather than re-requesting each tick.
    if (prev.signedOut && prev.shownAt && now - prev.shownAt < AD_ROTATE_MS) return signedOutLine();
    const adsShown = prev.adsShown ?? 0;
    // Persisted per-cycle target (each render is a fresh process); re-rolled only after the nudge fires.
    const nudgeAfter = prev.nudgeAfter ?? randAdsPerNudge();
    if (updateLatest && adsShown >= nudgeAfter) {
      const nudge = updateCreative(client?.version, updateLatest);
      writeState({ creative: nudge, shownAt: now, reported: true, earnedMicros: prev.earnedMicros, adsShown: 0, nudgeAfter: randAdsPerNudge() });
      return renderCreative(nudge, prev.earnedMicros, forWrapper);
    }
    const served = await requestAd(token, ctx, client);
    if (served.unauthorized) {
      writeState({ signedOut: true, shownAt: now, reported: true, earnedMicros: prev.earnedMicros });
      return signedOutLine();
    }
    if (served.ad && served.token) {
      writeState({ creative: served.ad, adId: served.ad.id, adToken: served.token, shownAt: now, reported: false, earnedMicros: served.earnedMicros, adsShown: adsShown + 1, nudgeAfter });
      return renderCreative(served.ad, served.earnedMicros, forWrapper);
    }
    const ad = houseAd(now);
    writeState({ creative: ad, shownAt: now, reported: true, earnedMicros: served.earnedMicros, adsShown: adsShown + 1, nudgeAfter });
    return renderCreative(ad, served.earnedMicros, forWrapper);
  } catch {
    return color(244, "Sponsored Code");
  }
}

// `scode statusline --demo` — render the line with no wallet; rotates house ads.
export function renderDemoStatusLine(now = Date.now()): string {
  return renderCreative(houseAd(now));
}
