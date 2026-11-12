// Quick self-check for the MetaMask path: npx tsx server/auth.test.mts
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { ethSigner, ethText } from "./auth";

// EIP-155's example key; its address is well known
const priv = Buffer.from("4646464646464646464646464646464646464646464646464646464646464646", "hex");
const want = "0x9d8a62f656a8d1615c1294fd71e9cfb3e4855a4f";
const nonce = new Uint8Array(32).fill(7);
const text = ethText("Enter the TOTEM Den as " + want, "totem-den", nonce);
const msg = Buffer.from(text);
const hash = keccak_256(Buffer.concat([Buffer.from(`\x19Ethereum Signed Message:\n${msg.length}`), msg]));
const rec = secp256k1.sign(hash, priv, { prehash: false, format: "recovered" }); // [v, r, s]
const eth = "0x" + Buffer.concat([Buffer.from(rec.subarray(1)), Buffer.from([rec[0] + 27])]).toString("hex"); // r, s, v
let fail = 0;
const check = (name: string, ok: boolean) => (console.log(`${ok ? "ok  " : "FAIL"} ${name}`), ok || fail++);
check("recovers the signer's address", ethSigner(text, eth) === want);
check("another message recovers someone else", ethSigner(text + "x", eth) !== want);
check("garbage is refused", ethSigner(text, "0x1234") === null);
process.exit(fail ? 1 : 0);
