// End-to-end Den security checks against a running server and real testnet keys:
//   RUN_BOT=0 AUTO_HATCH=0 PORT=8096 npx tsx server/prod.ts &
//   npx tsx server/den.e2e.mts http://localhost:8096
// Needs the testnet keys of totem-grumbo-keeper (holds a Founder badge) and keeper2 (holds none) in ~/.near-credentials.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { KeyPair, KeyPairSigner, type KeyPairString } from "near-api-js";
const BASE = process.argv[2] ?? "http://localhost:8096";
const key = (a: string) => JSON.parse(readFileSync(`${homedir()}/.near-credentials/testnet/${a}.json`, "utf8")).private_key as KeyPairString;
const nonce = () => { const n = new Uint8Array(32); new DataView(n.buffer).setBigUint64(0, BigInt(Date.now())); crypto.getRandomValues(n.subarray(8)); return n; };
async function signed(account: string, signerKey: KeyPairString, msgFor = account) {
  const n = nonce();
  const s = await new KeyPairSigner(KeyPair.fromString(signerKey)).signNep413Message(account, { message: `Enter the TOTEM Den as ${msgFor}`, recipient: "totem-den", nonce: n });
  const sig = s.signature as unknown as Uint8Array | { data: Uint8Array };
  const bytes = sig instanceof Uint8Array ? sig : (sig as { data: Uint8Array }).data;
  return { accountId: account, publicKey: s.publicKey.toString(), signature: Buffer.from(bytes).toString("base64"), nonce: Buffer.from(n).toString("base64") };
}
const enter = async (b: unknown) => { const r = await fetch(`${BASE}/api/den/enter`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b) }); return { status: r.status, j: await r.json() as any }; };
const H = "totem-grumbo-keeper.testnet", N = "totem-grumbo-keeper2.testnet";
let pass = 0, fail = 0; const check = (name: string, ok: boolean, info = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`); ok ? pass++ : fail++; };

const good = await signed(H, key(H));
let r = await enter(good); check("badge holder with own key gets in", r.status === 200 && !!r.j.token, `${r.status} keys=${(r.j.keys ?? []).map((k: any) => k.id).join(",")}`);
const token = r.j.token;
r = await enter(good); check("replaying the same signature is refused", r.status === 400, r.j.error);
r = await enter(await signed(N, key(N))); check("non-holder (valid signature) is refused", r.status === 403, r.j.error?.slice(0, 40));
r = await enter({ ...(await signed(H, key(N))), accountId: H }); check("someone else's key for the holder's account is refused", r.status === 401, r.j.error);
const t = await signed(H, key(H)); r = await enter({ ...t, signature: Buffer.from(Buffer.from(t.signature, "base64").map((b, i) => (i === 3 ? b ^ 1 : b))).toString("base64") }); check("tampered signature is refused", r.status === 401, r.j.error);
r = await enter({ ...(await signed(H, key(H), N)) }); check("signature for a different message is refused", r.status === 401, r.j.error);
let g = await fetch(`${BASE}/api/den?token=${token}`); let gj: any = await g.json(); check("session opens the Den (diary + wall)", g.status === 200 && !!gj.diary?.text, gj.diary?.text?.slice(0, 80));
g = await fetch(`${BASE}/api/den?token=${token.slice(0, -2)}xx`); check("forged session token is refused", g.status === 401);
const w = await fetch(`${BASE}/api/den/wall`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, text: "first post from the Den test" }) }); const wj: any = await w.json(); check("holder can post on the wall", w.status === 200 && wj.wall?.[0]?.text === "first post from the Den test");
console.log(`\n${pass} passed, ${fail} failed`);
