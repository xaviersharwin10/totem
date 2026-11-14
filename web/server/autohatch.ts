// Development auto-hatch. On the demo clock an unfed Totem dies ~2.5 minutes
// after hatching, so the hosted app would almost always show a gravestone.
// While the team is building, this loop brings it back the way the tribe
// would: AUTO_HATCH_DELAY_S after a death it opens a hatch vote on the DAO (the
// relayer proposes and pays the refundable bond) and the Keepers whose keys
// this server holds vote yes. The deciding vote runs `hatch`. Nothing here
// bypasses governance: it is the same proposal + votes as scripts/dao-propose.sh.
//
//   KEEPER_KEYS="totem-grumbo-keeper.testnet=ed25519:…,totem-grumbo-keeper2.testnet=ed25519:…"
//   AUTO_HATCH=0            turn it off (e.g. for judging)
//   AUTO_HATCH_DELAY_S=90   how long the gravestone stays before the vote opens
//
// Status for the app: GET /api/autohatch -> { enabled, delayS, hatchAt, busy, last }
import type { IncomingMessage, ServerResponse } from "node:http";
import { Account, KeyPairString, actions } from "near-api-js";
import { getRelayer, relayerConfigured, rpcProvider } from "./relay";
import { recordTx } from "./txcache";

const CONTRACT_ID = process.env.VITE_CONTRACT_ID ?? "totem-panda.testnet";
const DAO_ID = process.env.VITE_DAO_ID ?? "totem-tribe.sputnik-v2.testnet";
const DELAY_MS = Number(process.env.AUTO_HATCH_DELAY_S ?? 90) * 1000;
const POLL_MS = 15_000;

const provider = rpcProvider();

function keepers(): Account[] {
  return (process.env.KEEPER_KEYS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf("=");
      return new Account(pair.slice(0, i), provider, pair.slice(i + 1) as KeyPairString);
    });
}

const KEEPERS = keepers();
const ENABLED = process.env.AUTO_HATCH !== "0" && KEEPERS.length > 0 && relayerConfigured();

let running = false;
const state = {
  deadSince: null as number | null,
  generation: 0,
  busy: false,
  retryAt: 0,
  last: "" as string,
};

const view = <T>(contractId: string, method: string, args: Record<string, unknown> = {}) =>
  provider.callFunction({ contractId, method, args }) as Promise<T>;

interface Proposal {
  id: number;
  status: string;
  submission_time: string;
  votes: Record<string, string>;
  kind: { FunctionCall?: { receiver_id: string; actions: { method_name: string }[] } } & Record<string, unknown>;
}

async function openHatchVote(): Promise<Proposal | null> {
  const policy = await view<{ proposal_period: string }>(DAO_ID, "get_policy");
  const last = await view<number>(DAO_ID, "get_last_proposal_id");
  const list = await view<Proposal[]>(DAO_ID, "get_proposals", { from_index: Math.max(0, last - 30), limit: 30 });
  const now = BigInt(Date.now()) * 1_000_000n;
  return (
    list
      .reverse()
      .find(
        (p) =>
          p.status === "InProgress" &&
          BigInt(p.submission_time) + BigInt(policy.proposal_period) > now &&
          p.kind.FunctionCall?.receiver_id === CONTRACT_ID &&
          p.kind.FunctionCall.actions.some((a) => a.method_name === "hatch")
      ) ?? null
  );
}

async function hatchNow(generation: number) {
  let p = await openHatchVote();
  if (!p) {
    const r = getRelayer();
    const { proposal_bond } = await view<{ proposal_bond: string }>(DAO_ID, "get_policy");
    const proposal = {
      description: `Hatch generation ${generation + 1} (dev auto-hatch: the Keepers bring the Totem back while the team builds)`,
      kind: {
        FunctionCall: {
          receiver_id: CONTRACT_ID,
          actions: [{ method_name: "hatch", args: Buffer.from("{}").toString("base64"), deposit: "0", gas: "150000000000000" }],
        },
      },
    };
    const propResult = await r.signAndSendTransaction({
      receiverId: DAO_ID,
      actions: [actions.functionCall("add_proposal", { proposal }, 50_000_000_000_000n, BigInt(proposal_bond))],
    });
    recordTx((propResult as { transaction: { hash: string } }).transaction.hash, r.accountId, "add_proposal");
    p = await openHatchVote();
    if (!p) throw new Error("opened a hatch vote but can't find it");
    console.log(`auto-hatch: opened vote #${p.id}`);
  }
  for (const k of KEEPERS) {
    const cur = await view<Proposal>(DAO_ID, "get_proposal", { id: p.id });
    if (cur.status !== "InProgress") break;
    if (cur.votes[k.accountId]) continue;
    const voteResult = await k.signAndSendTransaction({
      receiverId: DAO_ID,
      actions: [actions.functionCall("act_proposal", { id: p.id, action: "VoteApprove" }, 300_000_000_000_000n, 0n)],
    });
    recordTx((voteResult as { transaction: { hash: string } }).transaction.hash, k.accountId, "act_proposal");
    console.log(`auto-hatch: ${k.accountId} voted yes on #${p.id}`);
  }
  }
  const done = await view<Proposal>(DAO_ID, "get_proposal", { id: p.id });
  const t = await view<{ alive: boolean; generation: number; lineage_name: string }>(CONTRACT_ID, "get_totem");
  state.last = `vote #${p.id} ${done.status}; ${t.alive ? `${t.lineage_name} hatched` : "still dead"}`;
  console.log(`auto-hatch: ${state.last}`);
  if (!t.alive) throw new Error(state.last);
}

// Sputnik keeps every proposal forever, so each hatch vote locks ~0.02 NEAR of
// the DAO's storage. When it runs dry the next vote can't be stored and the
// Totem stays dead: a Keeper tops the DAO up (testnet NEAR), at most every 10 min.
//
// Each hatch also mints an NFT and registers a treasury account, growing the
// contract's own storage. CONTRACT_MIN_NEAR is the floor: when the contract dips
// below it a Keeper sends CONTRACT_TOP_UP_NEAR. Default floor 20 NEAR; top-up 20 NEAR.
const TOP_UP = BigInt(process.env.DAO_TOP_UP_NEAR ?? 2) * 10n ** 24n;
const CONTRACT_TOP_UP = BigInt(process.env.CONTRACT_TOP_UP_NEAR ?? 20) * 10n ** 24n;
const CONTRACT_MIN = BigInt(process.env.CONTRACT_MIN_NEAR ?? 20) * 10n ** 24n;
let lastTopUp = 0;
let lastContractTopUp = 0;

async function topUpDao() {
  if (Date.now() - lastTopUp < 600_000) return;
  lastTopUp = Date.now();
  for (const k of KEEPERS) {
    try {
      const { amount } = await provider.viewAccount({ accountId: k.accountId });
      if (BigInt(amount) < TOP_UP + 10n ** 24n) continue; // keep 1 NEAR for its own votes
      await k.signAndSendTransaction({ receiverId: DAO_ID, actions: [actions.transfer(TOP_UP)] });
      console.log(`auto-hatch: ${k.accountId} topped up the DAO's storage with ${TOP_UP / 10n ** 24n} NEAR`);
      return;
    } catch (e) {
      console.error("auto-hatch: top-up dao:", e instanceof Error ? e.message : e);
    }
  }
  console.error("auto-hatch: no Keeper can top up the DAO; send it testnet NEAR");
}

async function topUpContract() {
  if (Date.now() - lastContractTopUp < 600_000) return;
  lastContractTopUp = Date.now();
  const { amount: contractBal } = await provider.viewAccount({ accountId: CONTRACT_ID });
  if (BigInt(contractBal) >= CONTRACT_MIN) return;
  for (const k of KEEPERS) {
    try {
      const { amount } = await provider.viewAccount({ accountId: k.accountId });
      if (BigInt(amount) < CONTRACT_TOP_UP + 10n ** 24n) continue; // keep 1 NEAR for its own votes
      await k.signAndSendTransaction({ receiverId: CONTRACT_ID, actions: [actions.transfer(CONTRACT_TOP_UP)] });
      console.log(`auto-hatch: ${k.accountId} topped up the contract with ${CONTRACT_TOP_UP / 10n ** 24n} NEAR (was ${(Number(contractBal) / 1e24).toFixed(1)} NEAR)`);
      return;
    } catch (e) {
      console.error("auto-hatch: top-up contract:", e instanceof Error ? e.message : e);
    }
  }
  console.error("auto-hatch: no Keeper can top up the contract; send testnet NEAR to", CONTRACT_ID);
}

async function tick() {
  const t = await view<{ alive: boolean; generation: number }>(CONTRACT_ID, "get_totem");
  if (t.alive) {
    state.deadSince = null;
    return;
  }
  if (state.deadSince === null || state.generation !== t.generation) {
    state.deadSince = Date.now();
    state.generation = t.generation;
  }
  if (state.busy || Date.now() < state.deadSince + DELAY_MS || Date.now() < state.retryAt) return;
  state.busy = true;
  try {
    await hatchNow(t.generation);
  } catch (e) {
    state.last = `failed: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
    console.error("auto-hatch:", state.last);
    state.retryAt = Date.now() + 60_000;
    if (/lacks balance .* for state/.test(state.last)) await topUpDao();
    await topUpContract(); // proactive: the hatch failure may be contract storage; LackBalanceForState surfaces in the receipt, not in state.last
  } finally {
    state.busy = false;
  }
}

// ---------------------------------------------------------------- market opener
//
// A Rampage (and the prediction market that opens with it) is written to the
// contract lazily, by the next transaction. With few visitors nobody may send
// one, so the app would show a Rampage while the 🔮 market doesn't exist yet.
// When the live view says Rampage and there's no open market for this life,
// the relayer sends a free `poke`, which settles the Rampage and opens it.
const OPENER = process.env.PREDICT_OPENER !== "0" && relayerConfigured();
let lastPoke = 0;
interface Market {
  gen: number;
  resolved: boolean;
}
/** Returns how long to wait before the next check: fast near a Rampage, slow otherwise (public RPCs rate-limit). */
async function openMarketIfNeeded(): Promise<number> {
  const t = await view<{ alive: boolean; generation: number; mood: string; seconds_until_rampage: string | null }>(CONTRACT_ID, "get_totem");
  const soon = t.alive && (t.mood === "rampage" || (t.seconds_until_rampage !== null && Number(t.seconds_until_rampage) < 45));
  const next = soon ? 3_000 : 20_000;
  if (!t.alive || t.mood !== "rampage" || Date.now() - lastPoke < 15_000) return next;
  const m = await view<Market | null>(CONTRACT_ID, "get_active_predict_market").catch(() => null);
  if (m && !m.resolved && m.gen === t.generation) return next; // already open
  lastPoke = Date.now();
  const pokeResult = await getRelayer().signAndSendTransaction({ receiverId: CONTRACT_ID, actions: [actions.functionCall("poke", {}, 100_000_000_000_000n, 0n)] });
  recordTx((pokeResult as { transaction: { hash: string } }).transaction.hash, getRelayer().accountId, "poke");
  const after = await view<Market | null>(CONTRACT_ID, "get_active_predict_market").catch(() => null);
  console.log(`market opener: poked; market ${after && !after.resolved ? `#${(after as Market & { market_id: number }).market_id} open` : "still closed"}`);
  return next;
}

export function startAutoHatch() {
  if (OPENER) {
    console.log("market opener: on (pokes when a Rampage has no open 🔮 market)");
    const loopM = () =>
      openMarketIfNeeded()
        .catch((e) => (console.error("market opener:", e instanceof Error ? e.message : e), 10_000))
        .then((ms) => setTimeout(loopM, ms));
    loopM();
  }
  if (!ENABLED) {
    console.log("auto-hatch: off" + (process.env.AUTO_HATCH === "0" ? "" : " (needs KEEPER_KEYS and the relayer key)"));
    return;
  }
  running = true;
  console.log(`auto-hatch: on, ${DELAY_MS / 1000}s after a death, Keepers ${KEEPERS.map((k) => k.accountId).join(", ")}`);
  const loop = () =>
    tick()
      .catch((e) => console.error("auto-hatch tick:", e instanceof Error ? e.message : e))
      .finally(() => setTimeout(loop, POLL_MS));
  loop();
}

export function autoHatchHandler(_req: IncomingMessage, res: ServerResponse) {
  res.setHeader("content-type", "application/json");
  res.end(
    JSON.stringify({
      enabled: running,
      delayS: DELAY_MS / 1000,
      hatchAt: running && state.deadSince !== null ? state.deadSince + DELAY_MS : null,
      retryAt: state.retryAt > Date.now() ? state.retryAt : null,
      busy: state.busy,
      last: state.last,
    })
  );
}
