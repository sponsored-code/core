import { randomBytes, createHash } from "node:crypto";
import { readConfig } from "./store";

// HTTP client for the backend API.
declare const __SCODE_API__: string | undefined; // baked at build time; absent when unbundled
declare const __WEB_URL__: string | undefined; // baked the same way

function apiBase(): string {
  const baked = (typeof __SCODE_API__ === "string" ? __SCODE_API__ : "").trim().replace(/\/+$/, "");
  if (baked) return baked;
  return process.env.SCODE_API ?? readConfig().apiBase ?? "http://127.0.0.1:8800";
}

/** Public website origin. Baked at build time; dev fallback to WEB_URL/localhost. */
export function webBase(): string {
  const baked = (typeof __WEB_URL__ === "string" ? __WEB_URL__ : "").trim().replace(/\/+$/, "");
  if (baked) return baked;
  return (process.env.WEB_URL ?? "http://localhost:3000").replace(/\/+$/, "");
}

export type AdCreative = { id: string; headline: string; body: string; url: string; color?: number; site?: string };
export type ServedAd = { ad: AdCreative | null; token?: string; earnedMicros?: number; unauthorized?: boolean };
export type Receipt =
  | { ok: true; receiptId?: string; held?: boolean; reason?: string; payoutMicros: number }
  | { ok: false; reason: string };

export type SessionContext = { sessionId?: string; costMicros?: number };

async function post(path: string, body: unknown): Promise<any> {
  const r = await fetch(apiBase() + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function postAuth(path: string, body: unknown, token: string): Promise<any> {
  const r = await fetch(apiBase() + path, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return r.json();
}

async function get(path: string): Promise<any> {
  const r = await fetch(apiBase() + path);
  return r.json();
}

/** In wrapper mode the CLI opens ad links itself: given a link's URL, ask the API for the destination to open
 *  and return it (with a descriptive user-agent). Returns null when it can't be resolved, so the caller falls
 *  back to opening the link's URL directly. */
export async function resolveClick(trackUrl: string): Promise<string | null> {
  const m = trackUrl.match(/\/c\/([^/?#]+)/);
  if (!m) return null;
  try {
    const r = await fetch(`${apiBase()}/v1/click/${m[1]}`, { headers: { "user-agent": "sponsored-code-cli" } });
    const j = await r.json();
    return j?.ok && typeof j.dest === "string" ? j.dest : null;
  } catch {
    return null;
  }
}

// Public Polygon RPCs + contract addresses for client-side on-chain reads (consumed by chain.ts).
export type RpcConfig = { rpcs: string[]; chainId: number; distributor: string; usdc: string; explorer: string };
export const getRpcConfig = (): Promise<RpcConfig> => get("/v1/rpcs");

export const getNetworkStats = () => get("/v1/stats");
export const getMarketOverview = () => get("/v1/market");
export const getRecentImpressions = (limit = 8) => get(`/v1/impressions?limit=${Math.max(1, Math.min(50, limit))}`);

export async function register(wallet: string, handle?: string): Promise<{ token: string; accountId: string; wallet: string }> {
  return post("/v1/register", { wallet, ...(handle ? { handle } : {}) });
}

// Earner snapshot for the account token. Used by `scode earnings`, `scode status`, and `scode account`.
export type Level = "anonymous" | "authenticated" | "verified-dev";
export type Me = {
  wallet: string;
  accruedMicros: number;
  claimedMicros: number;
  claimableMicros: number;
  accruedUsdc: number;
  claimableUsdc: number;
  verified: boolean;
  level: Level;
  badges: string[];
  email: string | null; // the signed-in address, if any
  githubLogin: string | null; // the GitHub @handle, once connected
  providers: { google: boolean; github: boolean };
  githubs: number;
};
export async function getMe(accountToken: string): Promise<Me | { error: string }> {
  return post("/v1/me", { accountToken });
}

// Snapshot for `scode account`: the account's wallets and connected GitHubs.
export type EarnerAccountSnapshot = {
  level: Level;
  email: string | null;
  avatar: string | null;
  handle: string | null;
  wallets: { wallet: string }[];
  githubs: { login: string | null; connectedAt: string }[];
  providers?: { google: boolean; github: boolean };
};
export const earnerAccount = (accountToken: string): Promise<EarnerAccountSnapshot | { error: string }> =>
  post("/v1/earner/account", { accountToken });

// Set this terminal's payout wallet (token-authed, no signature).
export const changeWallet = (input: { token: string; newWallet: string }): Promise<
  { ok: true; wallet: string } | { ok: false; reason: string }
> => post("/v1/account/wallet", input);

// Mint a one-time web ticket so the long-lived account token never rides in a URL. Throws on failure.
export async function mintWebTicket(accountToken: string): Promise<{ ticket: string; verifier: string }> {
  // PKCE: keep the verifier locally, send only its sha256 challenge; verifier rides only the URL fragment.
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const r = await post("/v1/earner/web-ticket", { accountToken, challenge });
  if (!r || typeof r.ticket !== "string") throw new Error(r?.error ? String(r.error) : "could not start sign-in");
  return { ticket: r.ticket, verifier };
}


// Which surface + version is making the request, sent alongside the existing ad request (no separate call).
export type ClientInfo = { surface: string; version: string };

export async function requestAd(accountToken: string, ctx: SessionContext = {}, client?: ClientInfo): Promise<ServedAd> {
  const r = await fetch(apiBase() + "/v1/ad", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountToken, ...ctx, ...(client ? { client } : {}) }),
  });
  // 401 means the credential is dead/expired; flag it so the caller can prompt sign-in. A 200 with
  // `ad: null` is a normal empty result, not an auth failure.
  if (r.status === 401) return { ad: null, unauthorized: true };
  try {
    return (await r.json()) as ServedAd;
  } catch {
    return { ad: null };
  }
}

export async function reportView(input: {
  accountToken: string;
  adToken: string;
  adId: string;
  viewedMs?: number;
  sessionId?: string;
  costMicros?: number;
}): Promise<Receipt> {
  return post("/v1/view", input);
}

// Unions declared literally — core is a standalone public package and never imports server types.
export type DeveloperTier = "junior" | "mid" | "senior" | "unicorn";
export type Campaign = {
  id: string; teamId: string; brand: string; tagline: string; url: string; color: string;
  bidUsdCpm: number; budgetUsd: number; spentUsd: number; status: "active" | "paused";
  targetCountries: string[]; minLevel: Level; developerTiers: DeveloperTier[]; createdAt: string;
};
export type Member = { userId: string; wallet: string; role: "admin" | "member" };
export type Team = {
  id: string; name: string; slug: string; type: "personal" | "shared"; role: "admin" | "member";
  createdAt: string; campaigns: Campaign[]; members: Member[];
};
export type Bootstrap = { user: { id: string; wallet: string } | null; teams: Team[] };
export type Analytics = {
  totals: { impressions: number; spendUsd: number; reach: number; clicks: number; ctr: number; avgCpm: number; activeCampaigns: number };
  series: { t: string; impressions: number; spendUsd: number }[];
  geo: { country: string; countryCode: string; impressions: number; spendUsd: number }[];
  campaigns: { id: string; brand: string; status: string; impressions: number; spendUsd: number; clicks: number; ctr: number }[];
};

export const loginNonce = (wallet: string): Promise<{ nonce: string; message: string } | { error: string }> =>
  post("/v1/account/nonce", { wallet });

export const login = (input: { wallet: string; nonce: string; signature: string }): Promise<
  { ok: true; token: string; user: { id: string; wallet: string }; teams: Team[] } | { ok: false; reason: string }
> => post("/v1/account/login", input);

export const accountBootstrap = (token: string): Promise<Bootstrap> => postAuth("/v1/account/bootstrap", {}, token);

// The signed-in person behind a brand session — `handle` is their public username (blank until they pick one).
export type AccountUser = { id: string; wallet: string; handle?: string; name?: string; email?: string };
export const accountMe = (token: string): Promise<{ user: AccountUser | null; teams: Team[] }> => postAuth("/v1/account/me", {}, token);

// Set the signed-in person's editable profile (public username = `handle`). Returns the updated user.
export const updateAccountProfile = (token: string, input: { name?: string; handle?: string }): Promise<{ ok: boolean; user?: AccountUser }> =>
  postAuth("/v1/account/profile", input, token);

// Link this machine's earning terminal to the signed-in account.
export const linkTerminal = (token: string, terminalToken: string): Promise<{ ok: boolean }> =>
  postAuth("/v1/account/link-terminal", { terminalToken }, token);

// The signed-in person's saved payout wallets, so the CLI can offer them when setting up a new machine.
export const accountWallets = (token: string): Promise<{ wallets: { wallet: string }[] }> =>
  postAuth("/v1/account/wallets", {}, token);

// Add a payout wallet to your account's list. Token-authed.
export const addWallet = (accountToken: string, wallet: string): Promise<{ ok: boolean; reason?: string }> =>
  post("/v1/earner/add-wallet", { accountToken, wallet });

// Remove a wallet from your account's list. Token-authed.
export const unlinkWallet = (accountToken: string, wallet: string): Promise<{ ok: boolean; removed?: number }> =>
  post("/v1/earner/unlink-wallet", { accountToken, wallet });

// CLI "Sign out": unlink the signed-in person from THIS machine. Token-authed.
export const signOut = (accountToken: string): Promise<{ ok: boolean }> =>
  post("/v1/earner/sign-out", { accountToken });

// Where + how to fund a team: distributor + USDC addresses, the chain, and the team's `teamRef`. `ok:false`
// when chain funding isn't configured. The CLI hands off to the browser wallet flow to send the deposit.
export type DepositInfo =
  | { ok: true; distributor: string; usdc: string; chainId: number; network: string; teamRef: string; decimals: number }
  | { ok: false; reason: string };
export const depositInfo = (token: string, teamId: string): Promise<DepositInfo> => postAuth("/v1/account/deposit-info", { teamId }, token);

// A no-wallet funding link: an address to send USDC to that funds the team. `ok:false` when unconfigured.
export type FundingLink = {
  linkId: string; address: string; usdc: string; chainId: number; network: string;
  depositUsd: number; gasUsd: number; totalUsd: number; status: string; expiresAt: string;
};
export const createFundingLink = (token: string, teamId: string, amountUsd: number): Promise<{ ok: boolean; link?: FundingLink; reason?: string }> =>
  postAuth("/v1/account/funding-links", { teamId, amountUsd }, token);
