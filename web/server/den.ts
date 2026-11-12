// The Den: a page only badge holders can open (NFT-gated, enforced here, not in
// the browser).
//
// To enter, a player signs a free message proving the account is theirs
// (server/auth.ts: NEP-413 for NEAR wallets and guests, personal_sign for
// MetaMask-style 0x accounts; fresh, used once). Then the server checks that
// the account holds a TOTEM badge NFT right now (hero-, founder-, moonlit-,
// returned- or badge-), read from the contract's nft_tokens_for_owner.
// Then it hands out a short-lived session token. Every Den request re-checks
// the holdings, so a badge holder who loses the badge loses the Den.
//
//   POST /api/den/enter   { accountId, publicKey?, signature, nonce, scheme? } -> { token, ... }
//   GET  /api/den         ?token=…  -> { account, keys, wall, diary }
//   POST /api/den/wall    { token, text } -> { wall }
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { rpcForward } from "./rpc";
import { diaryEntry } from "./voice";
import { verifyOwnership, type SignedProof } from "./auth";

const CONTRACT_ID = process.env.VITE_CONTRACT_ID ?? "totem-grumbo.testnet";
export const DEN_RECIPIENT = "totem-den";
const SECRET = process.env.DEN_SECRET ? Buffer.from(process.env.DEN_SECRET) : randomBytes(32);
const SESSION_MS = 12 * 60 * 60 * 1000;
const WALL_FILE = process.env.DEN_WALL_FILE ?? new URL("../bot/den-wall.json", import.meta.url).pathname;
const KEY_PREFIXES = ["hero-", "founder-", "moonlit-", "returned-", "badge-"];

// ---------------------------------------------------------------- chain

async function rpc<T>(params: Record<string, unknown>): Promise<T> {
  const out = await rpcForward(JSON.stringify({ jsonrpc: "2.0", id: "den", method: "query", params: { finality: "final", ...params } }));
  const j = JSON.parse(out.body) as { result?: T & { error?: string }; error?: { message?: string } };
  if (!j.result) throw new Error(j.error?.message ?? "RPC failed");
  if ((j.result as { error?: string }).error) throw new Error((j.result as { error?: string }).error);
  return j.result;
}

interface Token {
  token_id: string;
  metadata?: { title?: string };
}

const holdingsCache = new Map<string, { at: number; keys: { id: string; title: string }[] }>();
/** The account's Den keys: TOTEM badge NFTs it holds right now (cached 20 s). */
async function denKeys(accountId: string): Promise<{ id: string; title: string }[]> {
  const hit = holdingsCache.get(accountId);
  if (hit && Date.now() - hit.at < 20_000) return hit.keys;
  const r = await rpc<{ result: number[] }>({
    request_type: "call_function",
    account_id: CONTRACT_ID,
    method_name: "nft_tokens_for_owner",
    args_base64: Buffer.from(JSON.stringify({ account_id: accountId, limit: 100 })).toString("base64"),
  });
  const tokens = JSON.parse(Buffer.from(r.result).toString()) as Token[];
  const keys = tokens
    .filter((t) => KEY_PREFIXES.some((p) => t.token_id.startsWith(p)))
    .map((t) => ({ id: t.token_id, title: t.metadata?.title ?? t.token_id }));
  holdingsCache.set(accountId, { at: Date.now(), keys });
  if (holdingsCache.size > 5000) holdingsCache.clear();
  return keys;
}

export const denMessage = (accountId: string) => `Enter the TOTEM Den as ${accountId}`;

// ---------------------------------------------------------------- sessions

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}
function makeToken(accountId: string): string {
  const exp = Date.now() + SESSION_MS;
  const body = `${accountId}|${exp}`;
  return Buffer.from(`${body}|${sign(body)}`).toString("base64url");
}
function readToken(token: string): string | null {
  try {
    const [accountId, exp, mac] = Buffer.from(token, "base64url").toString().split("|");
    const want = sign(`${accountId}|${exp}`);
    if (!mac || mac.length !== want.length || !timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
    if (Number(exp) < Date.now()) return null;
    return accountId;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- wall + diary

interface Post {
  who: string;
  text: string;
  at: number;
}
let wall: Post[] = [];
try {
  if (existsSync(WALL_FILE)) wall = JSON.parse(readFileSync(WALL_FILE, "utf8"));
} catch {}
const lastPost = new Map<string, number>();

let diary: { text: string; at: number; gen: number } | null = null;
async function getDiary(accountId: string): Promise<{ text: string; at: number }> {
  if (diary && Date.now() - diary.at < 10 * 60_000) return diary;
  const d = await diaryEntry(accountId);
  diary = { text: d, at: Date.now(), gen: 0 };
  return diary;
}

// ---------------------------------------------------------------- http

function send(res: ServerResponse, status: number, obj: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(obj));
}
function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((ok, bad) => {
    let b = "";
    req.on("data", (c) => {
      b += c;
      if (b.length > 20_000) req.destroy();
    });
    req.on("end", () => {
      try {
        ok(b ? JSON.parse(b) : {});
      } catch (e) {
        bad(e);
      }
    });
  });
}

const NOT_HOLDER =
  "The Den is for badge holders. Rescue BaoBao from a Rampage (Hero), feed it under a full moon (Moonlit), reach 100 points (Bronze), come back after a break (Welcome Back), or be a top-3 feeder of a life (Founder).";

export async function denHandler(req: IncomingMessage, res: ServerResponse) {
  const path = (req.url ?? "/").split("?")[0];
  try {
    if (req.method === "POST" && path === "/enter") {
      const b = await readJson(req);
      const proof = await verifyOwnership(b as unknown as SignedProof, denMessage(String(b.accountId ?? "")), DEN_RECIPIENT);
      if (proof.ok === false) return send(res, proof.status, { error: proof.error });
      const accountId = proof.accountId;
      // holds a badge right now
      const keys = await denKeys(accountId);
      if (!keys.length) return send(res, 403, { error: NOT_HOLDER, keys });
      return send(res, 200, { token: makeToken(accountId), account: accountId, keys });
    }

    // everything else needs a session
    const url = new URL(req.url ?? "/", "http://x");
    const body = req.method === "POST" ? await readJson(req) : {};
    const token = String(url.searchParams.get("token") ?? body.token ?? "");
    const who = readToken(token);
    if (!who) return send(res, 401, { error: "Please enter the Den again.", expired: true });
    const keys = await denKeys(who);
    if (!keys.length) return send(res, 403, { error: NOT_HOLDER, keys });

    if (req.method === "GET" && (path === "/" || path === "")) {
      const d = await getDiary(who).catch(() => null);
      return send(res, 200, { account: who, keys, wall: wall.slice(-50).reverse(), diary: d });
    }
    if (req.method === "POST" && path === "/wall") {
      const text = String(body.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (!text) return send(res, 400, { error: "Write something first." });
      if (Date.now() - (lastPost.get(who) ?? 0) < 20_000) return send(res, 429, { error: "One message every 20 seconds." });
      lastPost.set(who, Date.now());
      wall.push({ who, text, at: Date.now() });
      wall = wall.slice(-200);
      try {
        writeFileSync(WALL_FILE, JSON.stringify(wall));
      } catch {}
      return send(res, 200, { wall: wall.slice(-50).reverse() });
    }
    return send(res, 404, { error: "not found" });
  } catch (e) {
    return send(res, 500, { error: e instanceof Error ? e.message : String(e) });
  }
}
