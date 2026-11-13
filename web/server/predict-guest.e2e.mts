// A free-play guest bets on a Rampage through the relayer (no wallet, no gas):
//   RUN_BOT=0 AUTO_HATCH=0 PORT=8096 npx tsx server/prod.ts &
//   npx tsx server/predict-guest.e2e.mts http://localhost:8096
// Creates a guest, takes the faucet, waits for the next Rampage's 🔮 market
// (a few minutes on the testnet clock), bets 10 $TOTEM on "survive", and reads
// the bet back from the contract.
import { Account, JsonRpcProvider, KeyPair, KeyPairSigner, actions, encodeSignedDelegate } from "near-api-js";

const BASE = process.argv[2] ?? "http://localhost:8096";
const CONTRACT = process.env.VITE_CONTRACT_ID ?? "totem-baobao.testnet";
const provider = new JsonRpcProvider({ url: `${BASE}/rpc` });
const view = async <T,>(method: string, args: Record<string, unknown> = {}) => (await provider.callFunction({ contractId: CONTRACT, method, args })) as T;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name: string, ok: boolean, info = "") => (console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`), ok ? pass++ : fail++);

const kp = KeyPair.fromRandom("ed25519");
const g = (await (await fetch(`${BASE}/api/guest`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicKey: kp.getPublicKey().toString() }) })).json()) as { accountId?: string; error?: string };
check("a guest account is created", !!g.accountId, g.accountId ?? g.error);
const acct = new Account(g.accountId!, provider, new KeyPairSigner(kp));
await sleep(3000);

async function relay(method: string, args: Record<string, unknown>) {
  const { signedDelegate } = await acct.createSignedMetaTransaction({ receiverId: CONTRACT, actions: [actions.functionCall(method, args, 50_000_000_000_000n, 0n)], blockHeightTtl: 120 });
  const r = await fetch(`${BASE}/api/relay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ signedDelegate: Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64") }) });
  return (await r.json()) as { hash?: string; error?: string };
}

let r = await relay("faucet", {});
check("the guest takes the faucet, gasless", !!r.hash, r.error ?? "");
await sleep(3000);
check("it holds test $TOTEM", BigInt(await view<string>("ft_balance_of", { account_id: g.accountId })) > 0n);

console.log("waiting for a Rampage with an open 🔮 market…");
let m: { market_id: number; resolved: boolean; gen: number } | null = null;
for (let i = 0; i < 60; i++) {
  const t = await view<{ mood: string; generation: number; alive: boolean }>("get_totem");
  m = await view<typeof m>("get_active_predict_market").catch(() => null);
  if (t.alive && t.mood === "rampage" && m && !m.resolved && m.gen === t.generation) break;
  m = null;
  await sleep(8000);
}
check("a Rampage market is open", !!m, m ? `#${m.market_id}` : "timed out");
if (m) {
  r = await relay("predict", { side: "survive", amount: (10n * 10n ** 18n).toString() });
  check("the guest bets 10 on survive, gasless", !!r.hash, r.error ?? "");
  await sleep(3000);
  const bet = await view<{ survive: string; die: string }>("get_predict_bet", { market_id: m.market_id, account_id: g.accountId });
  check("the bet is on chain", BigInt(bet.survive) === 10n * 10n ** 18n, JSON.stringify(bet));
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
