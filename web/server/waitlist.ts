// The mainnet waitlist: "🚀 Join the waitlist" in the app's mainnet popup.
// Visitors never see the count; the team reads the list with a key.
//
//   POST /api/waitlist  { id, account? }   -> { ok: true }   (one entry per browser id)
//   GET  /api/waitlist?key=WAITLIST_KEY    -> { count, entries }
//
// Stored in bot/waitlist.json (git-ignored) and logged as "[waitlist] joined …",
// so the list also lives in the host's logs. The file is reset by a redeploy on
// hosts without a persistent disk (Render free).
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const FILE = process.env.WAITLIST_FILE ?? new URL("../bot/waitlist.json", import.meta.url).pathname;
type Entry = { id: string; account: string | null; at: string };

const read = (): Entry[] => {
  try {
    return existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : [];
  } catch {
    return [];
  }
};

// a light rate limit: 30 joins per IP per hour (a room on one Wi-Fi shares an IP)
const hits = new Map<string, number[]>();
const limited = (ip: string) => {
  const now = Date.now();
  const h = (hits.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  h.push(now);
  hits.set(ip, h);
  return h.length > 30;
};

function send(res: ServerResponse, status: number, obj: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(obj));
}

async function body(req: IncomingMessage): Promise<any> {
  let s = "";
  for await (const c of req) {
    s += c;
    if (s.length > 2000) throw new Error("too big");
  }
  return JSON.parse(s || "{}");
}

export async function waitlistHandler(req: IncomingMessage, res: ServerResponse) {
  try {
    if (req.method === "GET") {
      const key = new URL(req.url ?? "", "http://x").searchParams.get("key");
      if (!process.env.WAITLIST_KEY || key !== process.env.WAITLIST_KEY) return send(res, 403, { error: "forbidden" });
      const list = read();
      return send(res, 200, { count: list.length, entries: list });
    }
    if (req.method !== "POST") return send(res, 405, { error: "POST or GET" });
    const ip = String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "").split(",")[0].trim();
    if (limited(ip)) return send(res, 429, { error: "Too many tries, try again later." });
    const b = await body(req);
    const id = String(b.id ?? "");
    if (!/^[a-z0-9]{8,40}$/i.test(id)) return send(res, 400, { error: "bad id" });
    const account = typeof b.account === "string" && /^[a-z0-9._-]{2,64}$/i.test(b.account) ? b.account.toLowerCase() : null;
    const list = read();
    const had = list.find((e) => e.id === id);
    if (had) {
      if (account && !had.account) {
        had.account = account;
        writeFileSync(FILE, JSON.stringify(list));
      }
      return send(res, 200, { ok: true });
    }
    list.push({ id, account, at: new Date().toISOString() });
    writeFileSync(FILE, JSON.stringify(list));
    console.log(`[waitlist] joined #${list.length} ${id}${account ? " " + account : ""}`);
    send(res, 200, { ok: true });
  } catch (e) {
    send(res, 400, { error: e instanceof Error ? e.message : "bad request" });
  }
}
