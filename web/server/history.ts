// /api/history: the contract's own event log (NEP-297 EVENT_JSON lines), newest first.
//
// A NEAR contract can't list its past events, so:
//   1. NearBlocks (v3, no key) lists the receipts the contract executed: one call per refresh.
//   2. Each new receipt's logs come from NEAR RPC `tx` (archival as a fallback for old ones).
//      The receipt's predecessor works as the routing account, also for relayed guests
//      and DAO calls. Results are cached forever: a finished receipt never changes.
// Generations are assigned by walking back from the living one across `hatch` events.
import type { IncomingMessage, ServerResponse } from "node:http";
import { rpcForward } from "./rpc";

const CONTRACT_ID = process.env.VITE_CONTRACT_ID ?? "totem-panda.testnet";
const NEARBLOCKS = process.env.NEARBLOCKS_API ?? "https://api-testnet.nearblocks.io";
const ARCHIVAL = process.env.ARCHIVAL_RPC ?? "https://archival-rpc.testnet.fastnear.com";
const REFRESH_MS = 12_000;
const KEEP = 600; // receipts kept in memory

interface NbReceipt {
  receipt_id: string;
  transaction_hash: string;
  predecessor_account_id: string;
  actions: { action: string; method: string | null }[];
  block: { block_timestamp: string; block_height: string };
  outcome: { status: boolean };
}

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
  height: number;
  method: string | null;
  sender: string; // the receipt's predecessor: enough for RPC to find the tx
  events: Omit<HistoryEvent, "generation">[] | null; // null = not fetched yet
}

const rows = new Map<string, Row>();
let lastRefresh = 0;
let refreshing: Promise<void> | null = null;
let generationNow = 0;
let pages = 0; // how many NearBlocks pages we have walked back
let faucetAmount = "";

async function nb(path: string): Promise<{ data: NbReceipt[]; meta?: { next_page?: string } }> {
  const r = await fetch(`${NEARBLOCKS}${path}`, { headers: { accept: "application/json" } });
  if (!r.ok) throw new Error(`NearBlocks ${r.status}`);
  return (await r.json()) as { data: NbReceipt[]; meta?: { next_page?: string } };
}

async function rpc(url: string | null, body: unknown): Promise<any> {
  const text = JSON.stringify(body);
  if (!url) {
    const out = await rpcForward(text);
    return JSON.parse(out.body);
  }
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: text });
  return r.json();
}

async function logsOf(row: Row, sender: string): Promise<string[]> {
  const body = { jsonrpc: "2.0", id: "h", method: "tx", params: { tx_hash: row.tx, sender_account_id: sender, wait_until: "NONE" } };
  for (const url of [null, ARCHIVAL]) {
    try {
      const j = await rpc(url, body);
      const outs = j.result?.receipts_outcome as { id: string; outcome: { logs: string[] } }[] | undefined;
      if (!outs) continue;
      return outs.find((o) => o.id === row.receipt)?.outcome.logs ?? [];
    } catch {
      /* try the next */
    }
  }
  throw new Error("tx not found");
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

async function refresh() {
  // the living generation, to number the lives
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

  // newest receipts; on the first runs also walk back a few pages for older lives
  const add = (list: NbReceipt[]) => {
    for (const r of list) {
      if (rows.has(r.receipt_id) || !r.outcome?.status) continue;
      const calls = r.actions.filter((a) => a.action === "FUNCTION_CALL");
      if (!calls.length) continue;
      rows.set(r.receipt_id, {
        receipt: r.receipt_id,
        tx: r.transaction_hash,
        ts: Math.floor(Number(r.block.block_timestamp) / 1e6),
        height: Number(r.block.block_height),
        method: calls.map((a) => a.method).filter(Boolean).join("+") || null,
        sender: r.predecessor_account_id,
        events: null,
      });
    }
  };
  let first = await nb(`/v3/accounts/${CONTRACT_ID}/receipts?limit=100`);
  add(first.data ?? []);
  let next = first.meta?.next_page;
  while (pages < 3 && next) {
    pages++;
    first = await nb(`/v3/accounts/${CONTRACT_ID}/receipts?limit=100&next=${encodeURIComponent(next)}`);
    add(first.data ?? []);
    next = first.meta?.next_page;
  }

  // logs for receipts we haven't read yet (newest first)
  const todo = [...rows.values()].filter((r) => r.events === null).sort((a, b) => b.height - a.height).slice(0, 120);
  await pool(todo, 4, async (r) => {
    const logs = await logsOf(r, r.sender);
    r.events = parse(r, logs);
  });

  // bound memory
  const sorted = [...rows.values()].sort((a, b) => b.height - a.height);
  for (const r of sorted.slice(KEEP)) rows.delete(r.receipt);
}

function ensureFresh(): Promise<void> {
  if (refreshing) return refreshing;
  if (Date.now() - lastRefresh < REFRESH_MS) return Promise.resolve();
  refreshing = refresh()
    .catch(() => undefined)
    .finally(() => {
      lastRefresh = Date.now();
      refreshing = null;
    });
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
    // within a receipt the logs run oldest -> newest; walk them backwards
    for (const e of [...r.events].reverse()) {
      if (e.kind === "hatch") {
        events.push({ ...e, generation: Number(e.data.generation ?? gen) });
        gen = Number(e.data.generation ?? gen) - 1;
        continue;
      }
      events.push({ ...e, generation: e.kind === "death" ? Number(e.data.generation ?? gen) : gen });
    }
  }
  return { events, generation: generationNow, complete: sorted.every((r) => r.events !== null) };
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
