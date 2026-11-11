// Play without a wallet or NEAR: a guest account whose key lives in this browser.
//
// 1. The browser makes an ed25519 key and asks /api/guest for an account. The
//    relayer creates `g<8 hex>.totem-grumbo-relay.testnet` with 0 NEAR (a NEP-448
//    zero-balance account) and this key as its only key.
// 2. Each action is a NEP-366 meta-transaction: the browser signs a
//    DelegateAction, /api/relay wraps it in a transaction and pays the gas.

import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, KeyPairString, actions, encodeSignedDelegate } from "near-api-js";
import { CONTRACT_ID, RPC_URLS } from "./config";

const STORE = "totem.guest.v1";

export interface Guest {
  accountId: string;
  secretKey: string;
}

export function loadGuest(): Guest | null {
  try {
    const g = JSON.parse(localStorage.getItem(STORE) ?? "null");
    return g?.accountId && g?.secretKey ? g : null;
  } catch {
    return null;
  }
}

export async function createGuest(): Promise<Guest> {
  const existing = loadGuest();
  if (existing) return existing;
  const kp = KeyPair.fromRandom("ed25519");
  const r = await fetch("/api/guest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ publicKey: kp.getPublicKey().toString() }),
  });
  const j = (await r.json()) as { accountId?: string; error?: string };
  if (!j.accountId) throw new Error(j.error ?? "Could not create a guest account");
  const g = { accountId: j.accountId, secretKey: kp.toString() };
  try {
    localStorage.setItem(STORE, JSON.stringify(g));
  } catch {
    /* private mode: the guest lasts for this tab only */
  }
  return g;
}

export function forgetGuest() {
  try {
    localStorage.removeItem(STORE);
  } catch {
    /* ignore */
  }
}

export interface Call {
  method: string;
  args?: Record<string, unknown>;
  gas?: bigint;
}

/** Sign the calls as one meta-transaction and have the relayer pay the gas. */
export async function guestCall(g: Guest, calls: Call[]): Promise<{ hash: string }> {
  const provider = new JsonRpcProvider({ url: RPC_URLS[0] });
  const kp = KeyPair.fromString(g.secretKey as KeyPairString);
  const acct = new Account(g.accountId, provider, new KeyPairSigner(kp));
  const { signedDelegate } = await acct.createSignedMetaTransaction({
    receiverId: CONTRACT_ID,
    actions: calls.map((c) => actions.functionCall(c.method, c.args ?? {}, c.gas ?? 50_000_000_000_000n, 0n)),
    blockHeightTtl: 120,
  });
  const bytes = encodeSignedDelegate(signedDelegate);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  const r = await fetch("/api/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ signedDelegate: btoa(bin) }),
  });
  const j = (await r.json()) as { hash?: string; error?: string };
  if (j.error) throw new Error(j.error);
  if (!j.hash) throw new Error("relay failed");
  return { hash: j.hash };
}

export const shortGuest = (id: string) => (id.includes(".totem-grumbo-relay.") ? `guest ${id.split(".")[0]}` : id);
