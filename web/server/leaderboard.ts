// /api/leaderboard: ranks wallets by badge count.
// Uses nft_supply_for_owner (no SVG generation, just a count) for each unique
// account seen in history. Caretaker tier breakdown comes from badge_minted
// events in history. Refreshes every 30 s; concurrent requests share one build.
import type { IncomingMessage, ServerResponse } from "node:http";
import { history } from "./history";
import { rpcForward } from "./rpc";

const CONTRACT_ID = process.env.VITE_CONTRACT_ID ?? "totem-panda.testnet";
const REFRESH_MS = 30_000;
const SKIP_SUFFIX = ["sputnik-v2.testnet", CONTRACT_ID];

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

async function viewSupply(account: string): Promise<number> {
  const args = Buffer.from(JSON.stringify({ account_id: account })).toString("base64");
  const body = JSON.stringify({
    jsonrpc: "2.0", id: "lb",
    method: "query",
    params: { request_type: "call_function", finality: "optimistic", account_id: CONTRACT_ID, method_name: "nft_supply_for_owner", args_base64: args },
  });
  const out = await rpcForward(body);
  const j = JSON.parse(out.body);
  if (j.error || !j.result?.result) return 0;
  const s = Buffer.from(j.result.result).toString();
  return parseInt(JSON.parse(s), 10) || 0;
}

async function build(): Promise<LeaderEntry[]> {
  const { events } = await history();

  // Collect unique player accounts
  const accounts = new Set<string>();
  for (const e of events) {
    for (const field of ["account", "owner_id", "by", "poker"]) {
      const v = String(e.data[field] ?? "");
      if (!v) continue;
      if (SKIP_SUFFIX.some((s) => v.endsWith(s))) continue;
      if (v.length < 5) continue;
      accounts.add(v);
    }
  }

  // Collect Caretaker badge tiers from badge_minted events
  const gold = new Map<string, number>();
  const silver = new Map<string, number>();
  const bronze = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== "badge_minted") continue;
    const acc = String(e.data.account ?? "");
    const tier = String(e.data.tier ?? "").toLowerCase();
    if (tier === "gold") gold.set(acc, (gold.get(acc) ?? 0) + 1);
    else if (tier === "silver") silver.set(acc, (silver.get(acc) ?? 0) + 1);
    else if (tier === "bronze") bronze.set(acc, (bronze.get(acc) ?? 0) + 1);
  }

  // Query nft_supply_for_owner for each in parallel (batched, 8 at a time)
  const accs = [...accounts];
  const totals = new Map<string, number>();
  const BATCH = 8;
  for (let i = 0; i < accs.length; i += BATCH) {
    const chunk = accs.slice(i, i + BATCH);
    const results = await Promise.all(chunk.map((a) => viewSupply(a).catch(() => 0)));
    chunk.forEach((a, idx) => { if (results[idx] > 0) totals.set(a, results[idx]); });
  }

  const entries: LeaderEntry[] = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([account, total], i) => ({
      rank: i + 1,
      account,
      total,
      gold: gold.get(account) ?? 0,
      silver: silver.get(account) ?? 0,
      bronze: bronze.get(account) ?? 0,
    }));

  return entries;
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
