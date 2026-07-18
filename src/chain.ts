import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { scodeDir } from "./store";
import { getRpcConfig, type RpcConfig } from "./api";

// On-chain reads over public Polygon RPCs via eth_call, rotated across the RPCs until one answers.

const BALANCE_OF = "0x70a08231"; // balanceOf(address) — ERC-20 USDC
const CLAIMED = "0xc884ef83"; // keccak256("claimed(address)")[:4]

const CACHE_TTL_MS = 60 * 60 * 1000; // refetched lazily after an hour
const cacheFile = (): string => join(scodeDir(), "rpcs.json");
type Cached = { at: number; cfg: RpcConfig };

/** The RPC config (public RPCs + addresses), cached in ~/.scode. On fetch failure falls back to the
 *  cached copy even if stale. */
export async function rpcConfig(): Promise<RpcConfig | null> {
  let cached: Cached | null = null;
  try { cached = JSON.parse(readFileSync(cacheFile(), "utf8")) as Cached; } catch { /* no cache yet */ }
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.cfg;
  try {
    const cfg = await getRpcConfig();
    if (cfg && Array.isArray(cfg.rpcs) && cfg.rpcs.length) {
      try { mkdirSync(scodeDir(), { recursive: true }); writeFileSync(cacheFile(), JSON.stringify({ at: Date.now(), cfg })); } catch { /* cache is best-effort */ }
      return cfg;
    }
  } catch { /* fall through to the (possibly stale) cache */ }
  return cached?.cfg ?? null;
}

const pad32 = (addr: string): string => addr.toLowerCase().replace(/^0x/, "").padStart(64, "0");

/** One eth_call, tried across the RPC list in order — first valid uint256, or null if all fail. Each
 *  attempt is timeout-bounded so a hung RPC can't stall the rotation. */
async function ethCallUint(rpcs: string[], to: string, data: string): Promise<bigint | null> {
  for (const rpc of rpcs) {
    try {
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) continue;
      const j = (await r.json()) as { result?: unknown; error?: unknown };
      if (typeof j.result === "string" && /^0x[0-9a-fA-F]+$/.test(j.result)) return BigInt(j.result);
    } catch { /* dead/slow/rate-limited RPC — try the next one */ }
  }
  return null;
}

export type OnchainWallet = {
  balanceMicros: bigint | null; // USDC held by the wallet (6 decimals)
  claimedMicros: bigint | null; // USDC already claimed from the distributor (6 decimals)
  explorer: string; // block-explorer origin for an address link ("" when unknown)
};

/** Read a wallet's on-chain USDC balance + amount claimed from the distributor via the public RPCs.
 *  Returns null with no RPC config; a field is null when its address isn't configured or every RPC failed. */
export async function readOnchain(wallet: string): Promise<OnchainWallet | null> {
  const cfg = await rpcConfig();
  if (!cfg || !cfg.rpcs.length) return null;
  const arg = pad32(wallet);
  const [balanceMicros, claimedMicros] = await Promise.all([
    cfg.usdc ? ethCallUint(cfg.rpcs, cfg.usdc, BALANCE_OF + arg) : Promise.resolve(null),
    cfg.distributor ? ethCallUint(cfg.rpcs, cfg.distributor, CLAIMED + arg) : Promise.resolve(null),
  ]);
  return { balanceMicros, claimedMicros, explorer: (cfg.explorer || "").replace(/\/+$/, "") };
}
