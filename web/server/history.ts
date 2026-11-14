// /api/history: the contract's own event log (NEP-297 EVENT_JSON lines), newest first.
//
// Instead of NearBlocks (rate-limited on shared IPs), we consume the server's own
// tx-cache: every transaction the relay and autohatch submit is recorded in txcache.ts.
// For each tx we call the NEAR RPC `tx` method, scan all receipts_outcome for ones
// executed by our contract, and parse their EVENT_JSON logs.
//
// Coverage: any action that goes through this server's relay or autohatch —
// bites, stakes, rewards, hatch, death, faucet, poke, DAO proposals and votes.
// Totals still come from `get_stats`, lives from `get_lineage`.
import type { IncomingMessage, ServerResponse } from "node:http";
import { rpcForward } from "./rpc";
import { getTxCache, type TxRecord } from "./txcache";

const CONTRACT_ID = process.env.VITE_CONTRACT_ID ?? "totem-panda.testnet";
const ARCHIVAL = process.env.ARCHIVAL_RPC ?? "https://archival-rpc.testnet.fastnear.com";
const REFRESH_MS = 6_000;
const KEEP = 600;

export interface HistoryEvent {
  id: string; // receipt id + index
  tx: string;
  ts: number; // ms
  method: string | null;
  standard: string;
  kind: string;
  data: Record<string, unknown>;
  generation?: number;
}

interface Row {
  receipt: string;
  tx: string;
  ts: number;
  height: number; // we use ts (ms) here — only used for ordering, not display
  method: string | null;
  sender: string;
  events: Omit<HistoryEvent, "generation">[] | null;
}

const rows = new Map<string, Row>();
const seenTxs = new Set<string>();
let lastRefresh = 0;
let refreshing: Promise<void> | null = null;
let generationNow = 0;
let faucetAmount = "";

async function rpc(url: string | null, body: unknown): Promise<any> {
  const text = JSON.stringify(body);
  if (!url) {
    const out = await rpcForward(text);
    return JSON.parse(out.body);
  }
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: text });
  return r.json();
}

function parse(row: Row, logs: string[]): Omit<HistoryEvent, "generation">[] {
  const out: Omit<HistoryEvent, "generation">[] = [];
  logs.forEach((l, i) => {
    if (!l.startsWith("EVENT_JSON:")) return;
    try {
      const e = JSON.parse(l.slice(11));
      const keep = e.standard === "totem" || (e.standard === "nep141" && (e.event === "ft_burn" || e.event === "ft_mint"));
      if (!keep) return;
      out.push({ id: `${row.receipt}:${i}`, tx: row.tx, ts: row.ts, method: row.method, standard: e.standard, kind: e.event, data: e.data?.[0] ?? {} });
    } catch {
      /* not ours */
    }
  });
  // The demo faucet mints; before ft_mint was logged (contract update of
  // 2026-11-12) its receipts carry no event, so record the configured amount.
  if (row.method?.split("+").includes("faucet") && !out.some((e) => e.kind === "ft_mint") && faucetAmount) {
    out.unshift({ id: `${row.receipt}:mint`, tx: row.tx, ts: row.ts, method: row.method, standard: "nep141", kind: "ft_mint", data: { owner_id: row.sender, amount: faucetAmount, memo: "demo faucet" } });
  }
  return out;
}

async function pool<T>(items: T[], n: number, f: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await f(items[i++]).catch(() => undefined);
  }));
}

/** Fetch all contract-executed receipt outcomes from a tx and add them to rows. */
async function processTx(t: TxRecord) {
  const body = { jsonrpc: "2.0", id: "h", method: "tx", params: { tx_hash: t.hash, sender_account_id: t.sender, wait_until: "NONE" } };
  for (const url of [null, ARCHIVAL]) {
    try {
      const j = await rpc(url, body);
      const outs = j.result?.receipts_outcome as { id: string; outcome: { logs: string[]; executor_id: string } }[] | undefined;
      if (!outs) continue;
      for (const o of outs) {
        if (o.outcome.executor_id !== CONTRACT_ID) continue;
        if (rows.has(o.id)) continue;
        const row: Row = { receipt: o.id, tx: t.hash, ts: t.ts, height: t.ts, method: t.method, sender: t.sender, events: null };
        row.events = parse(row, o.outcome.logs ?? []);
        rows.set(o.id, row);
      }
      return;
    } catch {
      /* try archival */
    }
  }
}

async function refresh() {
  try {
    const args = Buffer.from("{}").toString("base64");
    const j = await rpc(null, { jsonrpc: "2.0", id: "g", method: "query", params: { request_type: "call_function", finality: "optimistic", account_id: CONTRACT_ID, method_name: "get_totem", args_base64: args } });
    generationNow = JSON.parse(Buffer.from(j.result.result).toString()).generation;
  } catch {
    /* keep the last */
  }

  if (!faucetAmount) {
    try {
      const args = Buffer.from("{}").toString("base64");
      const j = await rpc(null, { jsonrpc: "2.0", id: "c", method: "query", params: { request_type: "call_function", finality: "optimistic", account_id: CONTRACT_ID, method_name: "get_config", args_base64: args } });
      faucetAmount = String(JSON.parse(Buffer.from(j.result.result).toString()).faucet_amount ?? "");
    } catch {
      /* next time */
    }
  }

  const newTxs = getTxCache().filter((t) => !seenTxs.has(t.hash));
  for (const t of newTxs) seenTxs.add(t.hash);
  await pool(newTxs, 4, processTx);

  // bound memory
  const sorted = [...rows.values()].sort((a, b) => b.height - a.height);
  for (const r of sorted.slice(KEEP)) rows.delete(r.receipt);
}

function ensureFresh(): Promise<void> {
  if (refreshing) return refreshing;
  if (Date.now() - lastRefresh < REFRESH_MS) return Promise.resolve();
  refreshing = refresh()
    .finally(() => { lastRefresh = Date.now(); refreshing = null; });
  return refreshing;
}

/** Every known event, newest first, each tagged with its generation. */
export async function history(): Promise<{ events: HistoryEvent[]; generation: number; complete: boolean }> {
  await ensureFresh();
  const sorted = [...rows.values()].sort((a, b) => b.height - a.height);
  const events: HistoryEvent[] = [];
  let gen = generationNow;
  for (const r of sorted) {
    if (!r.events) continue;
    for (const e of [...r.events].reverse()) {
      if (e.kind === "hatch") {
        events.push({ ...e, generation: Number(e.data.generation ?? gen) });
        gen = Number(e.data.generation ?? gen) - 1;
        continue;
      }
      events.push({ ...e, generation: e.kind === "death" ? Number(e.data.generation ?? gen) : gen });
    }
  }
  return { events, generation: generationNow, complete: true };
}

export async function historyHandler(_req: IncomingMessage, res: ServerResponse) {
  try {
    const h = await history();
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    res.end(JSON.stringify(h));
  } catch (e) {
    res.statusCode = 502;
    res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  }
}
