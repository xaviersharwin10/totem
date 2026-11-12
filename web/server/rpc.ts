// NEAR RPC proxy at /rpc (dev / preview server, and reused by /api/voice).
// Public testnet RPCs rate-limit per IP, and a throttled reply (429) carries no
// CORS header, so the browser shows it as a "CORS" failure. Proxying from the
// dev server keeps requests same-origin, rotates upstreams past 429s/5xx, and
// shares identical view calls for a moment (many tabs / StrictMode doubles).
import type { IncomingMessage, ServerResponse } from "node:http";

// Several providers, used round-robin: one server IP calling one provider gets
// rate-limited quickly (every browser, the bot and the auto-hatcher go through here).
const UPSTREAMS = ["https://test.rpc.fastnear.com", "https://rpc.testnet.fastnear.com", "https://testnet-rpc.intea.rs", "https://near-testnet.drpc.org", "https://rpc.testnet.near.org"];
const CACHE_MS = 2500; // the app polls every 3 s: open tabs share one upstream call
const cache = new Map<string, { at: number; p: Promise<{ status: number; body: string }> }>();
let next = 0;

export async function rpcForward(body: string) {
  let last = { status: 502, body: JSON.stringify({ jsonrpc: "2.0", id: 0, error: { message: "all RPC upstreams failed" } }) };
  const start = next;
  next = (next + 1) % UPSTREAMS.length; // round-robin: spread the load
  for (let i = 0; i < UPSTREAMS.length; i++) {
    const url = UPSTREAMS[(start + i) % UPSTREAMS.length];
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body });
      const text = await r.text();
      if (r.status === 429 || r.status >= 500) {
        last = { status: r.status, body: text };
        continue;
      }
      return { status: r.status, body: text };
    } catch {
      continue;
    }
  }
  return last;
}

function cacheKey(body: string): string | null {
  try {
    const j = JSON.parse(body);
    if (j.method === "query" && j.params?.request_type === "call_function" && j.params?.finality) {
      const { request_type, account_id, method_name, args_base64, finality } = j.params;
      return [request_type, account_id, method_name, args_base64, finality].join("|");
    }
  } catch {}
  return null;
}

export function rpcHandler(req: IncomingMessage, res: ServerResponse) {
  // Wallets sign in a sandboxed iframe (origin "null") and call this proxy too.
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-methods", "POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== "POST") {
    res.statusCode = 405;
    return res.end();
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    const key = cacheKey(body);
    let p: Promise<{ status: number; body: string }>;
    const hit = key ? cache.get(key) : undefined;
    if (hit && Date.now() - hit.at < CACHE_MS) p = hit.p;
    else {
      p = rpcForward(body);
      if (key) cache.set(key, { at: Date.now(), p });
    }
    const out = await p;
    // reuse the upstream reply but keep this request's JSON-RPC id
    let text = out.body;
    try {
      const id = JSON.parse(body).id;
      const j = JSON.parse(text);
      j.id = id;
      text = JSON.stringify(j);
    } catch {}
    res.statusCode = out.status;
    res.setHeader("content-type", "application/json");
    res.end(text);
  });
}
