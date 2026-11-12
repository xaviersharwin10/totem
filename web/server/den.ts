// The Den: a page only badge holders can open (NFT-gated, enforced here, not in
// the browser).
//
// To enter, a player signs a NEP-413 message with their account's key (any
// NEAR wallet's signMessage, or a guest's own key). The server checks:
//   1. the signature matches the message (NEP-413 hash, ed25519),
//   2. the public key is a full-access key of that account, on chain right now,
//   3. the message is fresh (timestamp in the nonce, each nonce used once),
//   4. the account currently holds a TOTEM badge NFT (hero-, founder-, moonlit-
//      or badge-), read from the contract's nft_tokens_for_owner.
// Then it hands out a short-lived session token. Every Den request re-checks
// the holdings, so a badge holder who loses the badge loses the Den.
//
//   POST /api/den/enter   { accountId, publicKey, signature, nonce, message } -> { token, ... }
//   GET  /api/den         ?token=…  -> { account, keys, wall, diary }
//   POST /api/den/wall    { token, text } -> { wall }
import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { serialize } from "borsh";
import { PublicKey, baseDecode } from "near-api-js";
import { rpcForward } from "./rpc";
import { diaryEntry } from "./voice";

const CONTRACT_ID = process.env.VITE_CONTRACT_ID ?? "totem-grumbo.testnet";
export const DEN_RECIPIENT = "totem-den";
const SECRET = process.env.DEN_SECRET ? Buffer.from(process.env.DEN_SECRET) : randomBytes(32);
const SESSION_MS = 12 * 60 * 60 * 1000;
const FRESH_MS = 5 * 60 * 1000;
const WALL_FILE = process.env.DEN_WALL_FILE ?? new URL("../bot/den-wall.json", import.meta.url).pathname;
const KEY_PREFIXES = ["hero-", "founder-", "moonlit-", "badge-"];

// ---------------------------------------------------------------- chain

async function rpc<T>(params: Record<string, unknown>): Promise<T> {
  const out = await rpcForward(JSON.stringify({ jsonrpc: "2.0", id: "den", method: "query", params: { finality: "final", ...params } }));
  const j = JSON.parse(out.body) as { result?: T & { error?: string }; error?: { message?: string } };
  if (!j.result) throw new Error(j.error?.message ?? "RPC failed");
  if ((j.result as { error?: string }).error) throw new Error((j.result as { error?: string }).error);
  return j.result;
}

async function isFullAccessKey(accountId: string, publicKey: string): Promise<boolean> {
  try {
    const k = await rpc<{ permission: unknown }>({ request_type: "view_access_key", account_id: accountId, public_key: publicKey });
    return k.permission === "FullAccess";
  } catch {
    return false;
  }
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

// ---------------------------------------------------------------- NEP-413

const Nep413Schema = {
  struct: { message: "string", nonce: { array: { type: "u8", len: 32 } }, recipient: "string", callbackUrl: { option: "string" } },
} as const;

function nep413Hash(message: string, nonce: Uint8Array, recipient: string): Uint8Array {
  const prefix = serialize("u32", 2147484061); // 2^31 + 413
  const body = serialize(Nep413Schema, { message, nonce: Array.from(nonce), recipient, callbackUrl: null });
  return new Uint8Array(createHash("sha256").update(Buffer.concat([Buffer.from(prefix), Buffer.from(body)])).digest());
}

export const denMessage = (accountId: string) => `Enter the TOTEM Den as ${accountId}`;

const usedNonces = new Map<string, number>();

function decodeSig(s: string): Uint8Array {
  // NEP-413 wallets return base64; some return "ed25519:<base58>"
  if (s.startsWith("ed25519:")) return new Uint8Array(baseDecode(s.slice(8)));
  return new Uint8Array(Buffer.from(s, "base64"));
}

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
  "The Den is for badge holders. Rescue BaoBao from a Rampage (Hero), feed it under a full moon (Moonlit), reach 100 points (Bronze), or be a top-3 feeder of a life (Founder).";

export async function denHandler(req: IncomingMessage, res: ServerResponse) {
  const path = (req.url ?? "/").split("?")[0];
  try {
    if (req.method === "POST" && path === "/enter") {
      const b = await readJson(req);
      const accountId = String(b.accountId ?? "");
      const publicKey = String(b.publicKey ?? "");
      const signature = String(b.signature ?? "");
      const nonce = new Uint8Array(Buffer.from(String(b.nonce ?? ""), "base64"));
      if (!/^[a-z0-9._-]{2,64}$/.test(accountId)) return send(res, 400, { error: "bad account id" });
      if (nonce.length !== 32) return send(res, 400, { error: "bad nonce" });
      // freshness: the nonce starts with the time it was made (ms, big-endian u64)
      const madeAt = Number(Buffer.from(nonce.slice(0, 8)).readBigUInt64BE());
      if (Math.abs(Date.now() - madeAt) > FRESH_MS) return send(res, 400, { error: "That signature is stale. Try again." });
      const nk = Buffer.from(nonce).toString("hex");
      if (usedNonces.has(nk)) return send(res, 400, { error: "That signature was already used." });
      // 1. the signature over exactly our message
      const hash = nep413Hash(denMessage(accountId), nonce, DEN_RECIPIENT);
      let ok = false;
      try {
        ok = PublicKey.fromString(publicKey).verify(hash, decodeSig(signature));
      } catch {}
      if (!ok) return send(res, 401, { error: "The signature doesn't match. Try again." });
      // 2. the key belongs to the account (full access, as NEP-413 requires)
      if (!(await isFullAccessKey(accountId, publicKey))) return send(res, 401, { error: "That key isn't a full-access key of this account." });
      usedNonces.set(nk, Date.now());
      for (const [k, t] of usedNonces) if (Date.now() - t > FRESH_MS * 2) usedNonces.delete(k);
      // 3. holds a badge right now
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
