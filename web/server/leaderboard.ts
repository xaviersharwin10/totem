// /api/leaderboard: ranks wallets by soulbound badge count.
// Paginates nft_tokens directly — no external indexer, no API key needed.
// Soulbound token prefixes: badge- hero- founder- moonlit- returned-
// Caretaker tiers come from badge-{tier}-{account} token IDs.
// Refreshes every 60 s; concurrent requests share one build.
import type { IncomingMessage, ServerResponse } from "node:http";
import { rpcForward } from "./rpc";

const CONTRACT_ID = process.env.VITE_CONTRACT_ID ?? "totem-panda.testnet";
const REFRESH_MS = 60_000;
const SKIP_SUFFIX = ["sputnik-v2.testnet", CONTRACT_ID];
const SOULBOUND = ["badge-", "hero-", "founder-", "moonlit-", "returned-"];
const PAGE = 100;

export interface LeaderEntry {
  rank: number;
  account: string;
  total: number;
  gold: number;
  silver: number;
  bronze: number;
}

let cache: { at: number; data: LeaderEntry[] } | null = null;
let building: Promise<LeaderEntry[]> | null = null;

async function callView<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const args_base64 = Buffer.from(JSON.stringify(args)).toString("base64");
  const body = JSON.stringify({
    jsonrpc: "2.0", id: "lb",
    method: "query",
    params: { request_type: "call_function", finality: "optimistic", account_id: CONTRACT_ID, method_name: method, args_base64 },
  });
  const out = await rpcForward(body);
  const j = JSON.parse(out.body);
  if (j.error || !j.result?.result) throw new Error(j.error?.message ?? "rpc error");
  return JSON.parse(Buffer.from(j.result.result).toString()) as T;
}

interface NftToken { token_id: string; owner_id: string }

async function build(): Promise<LeaderEntry[]> {
  const totalStr = await callView<string>("nft_total_supply");
  const total = parseInt(totalStr, 10) || 0;

  // Paginate all tokens and collect soulbound ones
  const totals = new Map<string, number>();
  const gold = new Map<string, number>();
  const silver = new Map<string, number>();
  const bronze = new Map<string, number>();

  for (let from = 0; from < total; from += PAGE) {
    const tokens = await callView<NftToken[]>("nft_tokens", { from_index: String(from), limit: PAGE });
    for (const t of tokens) {
      if (!SOULBOUND.some((p) => t.token_id.startsWith(p))) continue;
      if (SKIP_SUFFIX.some((s) => t.owner_id.endsWith(s))) continue;

      totals.set(t.owner_id, (totals.get(t.owner_id) ?? 0) + 1);

      // badge-{tier}-{account} → extract tier
      if (t.token_id.startsWith("badge-")) {
        const tier = t.token_id.split("-")[1]?.toLowerCase();
        if (tier === "gold") gold.set(t.owner_id, (gold.get(t.owner_id) ?? 0) + 1);
        else if (tier === "silver") silver.set(t.owner_id, (silver.get(t.owner_id) ?? 0) + 1);
        else if (tier === "bronze") bronze.set(t.owner_id, (bronze.get(t.owner_id) ?? 0) + 1);
      }
    }
  }

  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([account, tot], i) => ({
      rank: i + 1,
      account,
      total: tot,
      gold: gold.get(account) ?? 0,
      silver: silver.get(account) ?? 0,
      bronze: bronze.get(account) ?? 0,
    }));
}

async function getLeaderboard(): Promise<LeaderEntry[]> {
  if (cache && Date.now() - cache.at < REFRESH_MS) return cache.data;
  if (!building) {
    building = build()
      .then((data) => { cache = { at: Date.now(), data }; building = null; return data; })
      .catch((err) => { building = null; throw err; });
  }
  return building;
}

export async function leaderboardHandler(_req: IncomingMessage, res: ServerResponse) {
  try {
    const entries = await getLeaderboard();
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify({ entries }));
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  }
}
