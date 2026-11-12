// End-to-end checks for the Telegram link button and the MetaMask (0x) signing path,
// against a running server:   npx tsx server/link.e2e.mts http://127.0.0.1:5174
// Needs totem-grumbo-keeper's testnet key in ~/.near-credentials and the bot token on the server.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { KeyPair, KeyPairSigner, type KeyPairString } from "near-api-js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { ethText } from "./auth";
import { redeemLinkCode } from "./link";

const BASE = process.argv[2] ?? "http://127.0.0.1:5174";
const key = (a: string) => JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${a}.json`, "utf8")).private_key as KeyPairString;
const nonce = () => { const n = new Uint8Array(32); new DataView(n.buffer).setBigUint64(0, BigInt(Date.now())); crypto.getRandomValues(n.subarray(8)); return n; };
const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");

async function nearProof(account: string, message: string, recipient: string) {
  const n = nonce();
  const s = await new KeyPairSigner(KeyPair.fromString(key(account))).signNep413Message(account, { message, recipient, nonce: n });
  const sig = s.signature as unknown as Uint8Array | { data: Uint8Array };
  return { accountId: account, publicKey: s.publicKey.toString(), signature: b64(sig instanceof Uint8Array ? sig : sig.data), nonce: b64(n) };
}
// a throwaway Ethereum key: its 0x account needs nothing on chain to prove ownership
const priv = secp256k1.utils.randomSecretKey();
const ethAccount = "0x" + Buffer.from(keccak_256(secp256k1.getPublicKey(priv, false).subarray(1)).subarray(12)).toString("hex");
function ethProof(account: string, message: string, recipient: string) {
  const n = nonce();
  const msg = Buffer.from(ethText(message, recipient, n));
  const hash = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`), msg]));
  const rec = secp256k1.sign(hash, priv, { prehash: false, format: "recovered" });
  const signature = "0x" + Buffer.concat([Buffer.from(rec.subarray(1)), Buffer.from([rec[0] + 27])]).toString("hex");
  return { accountId: account, signature, scheme: "eth", nonce: b64(n) };
}
const post = async (path: string, b: unknown) => { const r = await fetch(`${BASE}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, j: (await r.json()) as any }; };
const codeOf = (url: string) => url?.split("start=link_")[1] ?? "";
let pass = 0, fail = 0; const check = (name: string, ok: boolean, info = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`); ok ? pass++ : fail++; };

const H = "totem-grumbo-keeper.testnet";
const linkMsg = (a: string) => `Send BaoBao's Telegram alerts about ${a}`;

let r = await post("/api/link", await nearProof(H, linkMsg(H), "totem-telegram"));
check("a NEAR account gets a one-time t.me link", r.status === 200 && /^https:\/\/t\.me\/\w+\?start=link_[\w-]{16}$/.test(r.j.url), r.j.url ?? r.j.error);
const code = codeOf(r.j.url);
check("the bot swaps the code for that account", redeemLinkCode(code) === H);
check("the code works only once", redeemLinkCode(code) === null);
r = await post("/api/link", await nearProof(H, linkMsg("someone-else.testnet"), "totem-telegram"));
check("a signature over another account's message is refused", r.status === 401, r.j.error);
r = await post("/api/link", await nearProof(H, `Enter the TOTEM Den as ${H}`, "totem-den"));
check("a Den signature can't be reused for Telegram", r.status === 401, r.j.error);

r = await post("/api/link", ethProof(ethAccount, linkMsg(ethAccount), "totem-telegram"));
check("a MetaMask (0x) account links with personal_sign", r.status === 200 && redeemLinkCode(codeOf(r.j.url)) === ethAccount, `${ethAccount.slice(0, 10)}… ${r.j.error ?? "ok"}`);
const other = "0x" + "ab".repeat(20);
r = await post("/api/link", ethProof(other, linkMsg(other), "totem-telegram"));
check("an Ethereum key can't claim someone else's 0x account", r.status === 401, r.j.error);
r = await post("/api/den/enter", ethProof(ethAccount, `Enter the TOTEM Den as ${ethAccount}`, "totem-den"));
check("MetaMask accounts reach the Den's badge check (no badge here, so 403)", r.status === 403, r.j.error?.slice(0, 40));
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
