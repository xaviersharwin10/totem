// Gasless play: zero-balance guest accounts + a NEP-366 meta-transaction relayer.
//
//   POST /api/guest  { publicKey }        -> { accountId }
//     Creates `g<8 hex>.<relayer>` holding 0 NEAR (a NEP-448 zero-balance
//     account) with the browser's key as its only key. The private key never
//     leaves the browser.
//
//   POST /api/relay  { signedDelegate }   -> { hash }  |  { error }
//     `signedDelegate` is a base64 borsh SignedDelegate (NEP-366) the player
//     signed in the browser. The relayer checks it only calls this game's
//     contract, only allow-listed zero-deposit methods, then wraps it in a
//     transaction it signs and pays the gas for.
//
// The relayer key comes from RELAYER_PRIVATE_KEY, or (on the dev machine) from
// ~/.near-credentials/testnet/<RELAYER_ACCOUNT_ID>.json. Never committed.

import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Account, JsonRpcProvider, KeyPairString, PublicKey, SCHEMA, actions } from "near-api-js";
import { deserialize } from "borsh";

const CONTRACT_ID = process.env.VITE_CONTRACT_ID ?? "totem-grumbo.testnet";
const RELAYER_ID = process.env.RELAYER_ACCOUNT_ID ?? "totem-grumbo-relay.testnet";
const RPC = process.env.RELAYER_RPC_URL ?? "https://test.rpc.fastnear.com";
// Zero-deposit game actions a guest may do for free.
const ALLOWED = new Set(["faucet", "feed", "poke", "stake", "unstake", "withdraw", "claim_badge", "claim_blessing"]);
const MAX_GAS_PER_ACTION = 100_000_000_000_000n; // 100 Tgas
const MAX_ACTIONS = 3;

let relayer: Account | null = null;
function getRelayer(): Account {
  if (relayer) return relayer;
  let key = process.env.RELAYER_PRIVATE_KEY;
  if (!key) {
    const f = `${homedir()}/.near-credentials/testnet/${RELAYER_ID}.json`;
    key = JSON.parse(readFileSync(f, "utf8")).private_key as string;
  }
  relayer = new Account(RELAYER_ID, new JsonRpcProvider({ url: RPC }), key as KeyPairString);
  return relayer;
}

// ---------------- rate limits ----------------
const buckets = new Map<string, number[]>();
function over(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const arr = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (arr.length >= max) {
    buckets.set(key, arr);
    return true;
  }
  arr.push(now);
  buckets.set(key, arr);
  if (buckets.size > 20_000) buckets.clear();
  return false;
}

// ---------------- helpers ----------------
function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 20_000) req.destroy();
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(raw || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
function send(res: ServerResponse, status: number, obj: unknown) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(obj));
}
const ipOf = (req: IncomingMessage) => String(req.headers["x-forwarded-for"] ?? req.socket.remoteAddress ?? "?").split(",")[0].trim();

/** First failure message anywhere in a transaction's receipts, if any. */
function failureOf(outcome: unknown): string | null {
  const o = outcome as { receipts_outcome?: { outcome: { status: Record<string, unknown> } }[]; status?: Record<string, unknown> };
  for (const r of o.receipts_outcome ?? []) {
    const f = r.outcome.status?.Failure;
    if (f) {
      const s = JSON.stringify(f);
      const m = s.match(/Smart contract panicked: ([^"\\]+)/) ?? s.match(/"ExecutionError":"([^"]+)"/);
      return m ? m[1] : s.slice(0, 200);
    }
  }
  if (o.status?.Failure) return JSON.stringify(o.status.Failure).slice(0, 200);
  return null;
}

// ---------------- /api/guest ----------------
export async function guestHandler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  if (over(`guest:${ipOf(req)}`, 5, 60 * 60_000)) return send(res, 429, { error: "Too many new guest accounts from here, try again later." });
  try {
    const body = await readJson(req);
    const pk = PublicKey.fromString(String(body.publicKey ?? ""));
    if (!String(body.publicKey).startsWith("ed25519:")) throw new Error("ed25519 key required");
    // Deterministic name from the key, so a retry returns the same account.
    const tag = createHash("sha256").update(pk.toString()).digest("hex").slice(0, 8);
    const accountId = `g${tag}.${RELAYER_ID}`;
    const r = getRelayer();
    const exists = await r.provider.viewAccount({ accountId, blockQuery: { finality: "optimistic" } }).then(() => true, () => false);
    if (!exists) {
      // Zero-balance account (NEP-448): no Transfer, the relayer pays only gas.
      await r.signAndSendTransaction({ receiverId: accountId, actions: [actions.createAccount(), actions.addFullAccessKey(pk)] });
    } else {
      const keys = await r.provider.viewAccessKeyList({ accountId, finalityQuery: { finality: "optimistic" } });
      if (!keys.keys.some((k) => k.public_key === pk.toString())) throw new Error("account exists with another key");
    }
    send(res, 200, { accountId });
  } catch (e) {
    send(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
}

// ---------------- /api/relay ----------------
interface DecodedDelegate {
  delegateAction: {
    senderId: string;
    receiverId: string;
    actions: { functionCall?: { methodName: string; gas: bigint; deposit: bigint } }[];
    maxBlockHeight: bigint;
  };
  signature: unknown;
}

export async function relayHandler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  const ip = ipOf(req);
  if (over(`relay-ip:${ip}`, 40, 60 * 60_000)) return send(res, 429, { error: "Too many free actions from here this hour." });
  try {
    const body = await readJson(req);
    const bytes = Buffer.from(String(body.signedDelegate ?? ""), "base64");
    const sd = deserialize(SCHEMA.SignedDelegate, bytes) as unknown as DecodedDelegate;
    const da = sd.delegateAction;

    // Only this game's contract, only allow-listed zero-deposit function calls.
    if (da.receiverId !== CONTRACT_ID) throw new Error(`only ${CONTRACT_ID} is sponsored`);
    if (!da.actions.length || da.actions.length > MAX_ACTIONS) throw new Error("1 to 3 actions");
    for (const a of da.actions) {
      const fc = a.functionCall;
      if (!fc) throw new Error("only function calls are sponsored");
      if (!ALLOWED.has(fc.methodName)) throw new Error(`method ${fc.methodName} is not sponsored`);
      if (BigInt(fc.deposit) !== 0n) throw new Error("deposits are not sponsored");
      if (BigInt(fc.gas) > MAX_GAS_PER_ACTION) throw new Error("too much gas");
    }
    if (over(`relay-sender:${da.senderId}`, 30, 60 * 60_000)) throw new Error("Too many free actions for this account this hour.");

    // The signature is checked by the protocol when the delegate executes.
    const r = getRelayer();
    const outcome = await r.signAndSendTransaction({
      receiverId: da.senderId,
      actions: [actions.signedDelegate(sd as unknown as Parameters<typeof actions.signedDelegate>[0])],
      throwOnFailure: false,
    });
    const hash = (outcome as { transaction: { hash: string } }).transaction.hash;
    const fail = failureOf(outcome);
    if (fail) return send(res, 200, { hash, error: fail });
    send(res, 200, { hash });
  } catch (e) {
    send(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
}
