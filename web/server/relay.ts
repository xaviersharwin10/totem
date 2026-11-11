// Gasless play: zero-balance guest accounts + a NEP-366 meta-transaction relayer.
//
//   POST /api/guest  { publicKey }        -> { accountId }
//     Creates `g<8 hex>.<relayer>` holding 0 NEAR (a NEP-448 zero-balance
//     account) with the browser's key as its only key. The private key never
//     leaves the browser.
//
//   POST /api/propose { type: "hatch" } | { type: "keeper", accountId }  -> { id }
//     Opens a DAO proposal for players without NEAR (the relayer pays the
//     proposal bond, refunded when it passes), only when the chain says it is
//     valid: the Totem is dead and no hatch vote is open; or the account is
//     eligible (get_keeper), not a Keeper yet and not already nominated.
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
import { Account, JsonRpcProvider, KeyPairString, PublicKey, SCHEMA, actions, getTransactionLastResult } from "near-api-js";
import { deserialize } from "borsh";

const CONTRACT_ID = process.env.VITE_CONTRACT_ID ?? "totem-grumbo.testnet";
const RELAYER_ID = process.env.RELAYER_ACCOUNT_ID ?? "totem-grumbo-relay.testnet";
const RPC = process.env.RELAYER_RPC_URL ?? "https://test.rpc.fastnear.com";
// Zero-deposit game actions a guest may do for free.
const ALLOWED = new Set(["faucet", "feed", "poke", "stake", "unstake", "withdraw", "claim_badge", "claim_blessing"]);
const MAX_GAS_PER_ACTION = 100_000_000_000_000n; // 100 Tgas
const MAX_ACTIONS = 3;
// Keepers vote for free too: only act_proposal on the tribe's DAO. The vote
// that passes a hatch also runs it, hence the higher gas cap.
const DAO_ID = process.env.VITE_DAO_ID ?? "totem-tribe.sputnik-v2.testnet";
const DAO_METHODS = new Set(["act_proposal"]);
const MAX_GAS_DAO = 250_000_000_000_000n; // 250 Tgas

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
    const toDao = da.receiverId === DAO_ID;
    if (da.receiverId !== CONTRACT_ID && !toDao) throw new Error(`only ${CONTRACT_ID} and ${DAO_ID} are sponsored`);
    if (!da.actions.length || da.actions.length > (toDao ? 1 : MAX_ACTIONS)) throw new Error("too many actions");
    for (const a of da.actions) {
      const fc = a.functionCall;
      if (!fc) throw new Error("only function calls are sponsored");
      if (!(toDao ? DAO_METHODS : ALLOWED).has(fc.methodName)) throw new Error(`method ${fc.methodName} is not sponsored`);
      if (BigInt(fc.deposit) !== 0n) throw new Error("deposits are not sponsored");
      if (BigInt(fc.gas) > (toDao ? MAX_GAS_DAO : MAX_GAS_PER_ACTION)) throw new Error("too much gas");
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

// ---------------- /api/propose ----------------
async function viewJson<T>(r: Account, contractId: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  return (await r.provider.callFunction({ contractId, method, args })) as T;
}

interface DaoProposal {
  id: number;
  status: string;
  kind: Record<string, { receiver_id?: string; actions?: { method_name: string }[]; member_id?: string; role?: string }>;
}

async function openProposals(r: Account): Promise<DaoProposal[]> {
  const last = await viewJson<number>(r, DAO_ID, "get_last_proposal_id");
  const from = Math.max(0, last - 30);
  const list = await viewJson<DaoProposal[]>(r, DAO_ID, "get_proposals", { from_index: from, limit: 30 });
  return list.filter((p) => p.status === "InProgress");
}

export async function proposeHandler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== "POST") return send(res, 405, { error: "POST only" });
  if (over(`propose:${ipOf(req)}`, 6, 60 * 60_000)) return send(res, 429, { error: "Too many proposals from here this hour." });
  try {
    const body = await readJson(req);
    const r = getRelayer();
    const policy = await viewJson<{ proposal_bond: string; roles: { name: string; kind: unknown }[] }>(r, DAO_ID, "get_policy");
    const open = await openProposals(r);
    let proposal: { description: string; kind: unknown };

    if (body.type === "hatch") {
      const t = await viewJson<{ alive: boolean; generation: number; name: string }>(r, CONTRACT_ID, "get_totem");
      if (t.alive) throw new Error("The Totem is alive: nothing to hatch.");
      const already = open.find((p) => p.kind.FunctionCall?.receiver_id === CONTRACT_ID && p.kind.FunctionCall.actions?.some((a) => a.method_name === "hatch"));
      if (already) return send(res, 200, { id: already.id, existing: true });
      proposal = {
        description: `Hatch generation ${t.generation + 1} (requested from the app${body.accountId ? ` by ${String(body.accountId).slice(0, 64)}` : ""})`,
        kind: { FunctionCall: { receiver_id: CONTRACT_ID, actions: [{ method_name: "hatch", args: Buffer.from("{}").toString("base64"), deposit: "0", gas: "150000000000000" }] } },
      };
    } else if (body.type === "keeper") {
      const who = String(body.accountId ?? "");
      if (!/^[a-z0-9._-]{2,64}$/.test(who)) throw new Error("bad account id");
      const k = await viewJson<{ eligible: boolean; staked: string; badge_earned: string }>(r, CONTRACT_ID, "get_keeper", { account_id: who });
      if (!k.eligible) throw new Error("Not eligible yet: stake 1,000 $TOTEM in the living Totem, or earn the Silver badge.");
      const role = policy.roles.find((x) => x.name === "keepers");
      const members = (role?.kind as { Group?: string[] })?.Group ?? [];
      if (members.includes(who)) throw new Error("Already a Keeper.");
      const already = open.find((p) => p.kind.AddMemberToRole?.member_id === who && p.kind.AddMemberToRole.role === "keepers");
      if (already) return send(res, 200, { id: already.id, existing: true });
      const why = k.badge_earned === "silver" || k.badge_earned === "gold" ? `${k.badge_earned} badge` : `${Number(BigInt(k.staked) / 10n ** 18n).toLocaleString("en-US")} TOTEM staked`;
      proposal = { description: `Add Keeper ${who} (${why}, verified by get_keeper)`, kind: { AddMemberToRole: { member_id: who, role: "keepers" } } };
    } else {
      throw new Error("type must be hatch or keeper");
    }

    const outcome = await r.signAndSendTransaction({
      receiverId: DAO_ID,
      actions: [actions.functionCall("add_proposal", { proposal }, 50_000_000_000_000n, BigInt(policy.proposal_bond))],
    });
    const id = Number(getTransactionLastResult(outcome as Parameters<typeof getTransactionLastResult>[0]));
    send(res, 200, { id });
  } catch (e) {
    send(res, 400, { error: e instanceof Error ? e.message : String(e) });
  }
}
