// Proving you own a NEAR account, for free, without a transaction.
//
// Used by the Den (badge-gated page) and the Telegram link button. Two kinds of
// signature are accepted:
//
//   - NEP-413 (any NEAR wallet's signMessage, or a guest's own key): the
//     signature must match the message, and the public key must be a
//     full-access key of the account on chain right now.
//   - Ethereum personal_sign, for MetaMask-style NEAR accounts (0x + 40 hex,
//     NEP-518). Those accounts are controlled by the Ethereum address they are
//     named after, so recovering the signer's address and comparing it with the
//     account id is the proof. Their wallets can't do NEP-413.
//
// Either way the nonce starts with the time it was made (ms, big-endian u64):
// stale signatures are refused, and each nonce works once.
import { createHash } from "node:crypto";
import { serialize } from "borsh";
import { PublicKey, baseDecode } from "near-api-js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { rpcForward } from "./rpc";

const FRESH_MS = 5 * 60 * 1000;
export const ETH_ACCOUNT = /^0x[0-9a-f]{40}$/;

export interface SignedProof {
  accountId: string;
  publicKey?: string;
  signature: string;
  nonce: string; // base64, 32 bytes
  scheme?: "nep413" | "eth";
}
export type ProofResult = { ok: true; accountId: string } | { ok: false; status: number; error: string };

/** The exact text an Ethereum wallet signs (the browser builds the same). */
export const ethText = (message: string, recipient: string, nonce: Uint8Array) =>
  `${message}\n\nFor: ${recipient}\nNonce: ${Buffer.from(nonce).toString("hex")}`;

// ---------------------------------------------------------------- NEP-413

const Nep413Schema = {
  struct: { message: "string", nonce: { array: { type: "u8", len: 32 } }, recipient: "string", callbackUrl: { option: "string" } },
} as const;

export function nep413Hash(message: string, nonce: Uint8Array, recipient: string): Uint8Array {
  const prefix = serialize("u32", 2147484061); // 2^31 + 413
  const body = serialize(Nep413Schema, { message, nonce: Array.from(nonce), recipient, callbackUrl: null });
  return new Uint8Array(createHash("sha256").update(Buffer.concat([Buffer.from(prefix), Buffer.from(body)])).digest());
}

function decodeSig(s: string): Uint8Array {
  // NEP-413 wallets return base64; some return "ed25519:<base58>"
  if (s.startsWith("ed25519:")) return new Uint8Array(baseDecode(s.slice(8)));
  return new Uint8Array(Buffer.from(s, "base64"));
}

async function isFullAccessKey(accountId: string, publicKey: string): Promise<boolean> {
  try {
    const out = await rpcForward(
      JSON.stringify({ jsonrpc: "2.0", id: "auth", method: "query", params: { finality: "final", request_type: "view_access_key", account_id: accountId, public_key: publicKey } })
    );
    const j = JSON.parse(out.body) as { result?: { permission?: unknown; error?: string } };
    return j.result?.permission === "FullAccess";
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- Ethereum

/** The Ethereum address (0x…, lowercase) that made an EIP-191 personal_sign signature. */
export function ethSigner(text: string, sigHex: string): string | null {
  try {
    const sig = Buffer.from(sigHex.replace(/^0x/, ""), "hex");
    if (sig.length !== 65) return null;
    const msg = Buffer.from(text, "utf8");
    const hash = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`), msg]));
    const v = sig[64] >= 27 ? sig[64] - 27 : sig[64];
    if (v > 1) return null;
    // noble's "recovered" format puts the recovery byte first
    const rec = new Uint8Array(65);
    rec[0] = v;
    rec.set(sig.subarray(0, 64), 1);
    const point = secp256k1.Signature.fromBytes(rec, "recovered").recoverPublicKey(hash);
    const pub = point.toBytes(false); // 0x04 || x || y
    return "0x" + Buffer.from(keccak_256(pub.subarray(1)).subarray(12)).toString("hex");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- both

const usedNonces = new Map<string, number>();

export async function verifyOwnership(p: SignedProof, message: string, recipient: string): Promise<ProofResult> {
  const accountId = String(p.accountId ?? "");
  const nonce = new Uint8Array(Buffer.from(String(p.nonce ?? ""), "base64"));
  if (!/^[a-z0-9._-]{2,64}$/.test(accountId)) return { ok: false, status: 400, error: "bad account id" };
  if (nonce.length !== 32) return { ok: false, status: 400, error: "bad nonce" };
  const madeAt = Number(Buffer.from(nonce.slice(0, 8)).readBigUInt64BE());
  if (Math.abs(Date.now() - madeAt) > FRESH_MS) return { ok: false, status: 400, error: "That signature is stale. Try again." };
  const nk = Buffer.from(nonce).toString("hex");
  if (usedNonces.has(nk)) return { ok: false, status: 400, error: "That signature was already used." };

  if (p.scheme === "eth") {
    if (!ETH_ACCOUNT.test(accountId)) return { ok: false, status: 400, error: "Only 0x accounts sign with an Ethereum wallet." };
    const signer = ethSigner(ethText(message, recipient, nonce), String(p.signature ?? ""));
    if (signer !== accountId) return { ok: false, status: 401, error: "The signature doesn't match. Try again." };
  } else {
    const publicKey = String(p.publicKey ?? "");
    let ok = false;
    try {
      ok = PublicKey.fromString(publicKey).verify(nep413Hash(message, nonce, recipient), decodeSig(String(p.signature ?? "")));
    } catch {}
    if (!ok) return { ok: false, status: 401, error: "The signature doesn't match. Try again." };
    if (!(await isFullAccessKey(accountId, publicKey))) return { ok: false, status: 401, error: "That key isn't a full-access key of this account." };
  }

  usedNonces.set(nk, Date.now());
  for (const [k, t] of usedNonces) if (Date.now() - t > FRESH_MS * 2) usedNonces.delete(k);
  return { ok: true, accountId };
}
