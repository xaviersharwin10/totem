# Testing TOTEM

How to check everything by hand, from the contract to the wallet flow in the browser.
For what is done and what is left, see [STATUS.md](STATUS.md).

| What | Where | Time |
|---|---|---|
| [1. Contract unit tests](#1-contract-unit-tests) | terminal | 1 min |
| [2. Economic simulation](#2-economic-simulation) | terminal | 1 min |
| [3. Web app, Practice mode](#3-web-app-practice-mode-no-wallet) | browser | 5 min |
| [4. Web app, live testnet with a wallet](#4-web-app-live-testnet-with-a-wallet) | browser + terminal | 10 min |
| [5. DAO and Keepers](#5-dao-and-keepers-cli) | terminal | 5 min |
| [6. Read the chain directly](#6-read-the-chain-directly) | terminal | 1 min |
| [Troubleshooting](#troubleshooting) | | |

---

## 1. Contract unit tests

```bash
cd contract
cargo test            # expect: 26 passed
```

Needs Rust 1.95+ (`contract/rust-toolchain.toml` pins stable + wasm32; run `rustup update stable` if it complains).
What each test proves is listed in the README under "What the tests prove".

## 2. Economic simulation

```bash
cd sim
python3 -m venv .venv && .venv/bin/pip install matplotlib   # first time only
.venv/bin/python simulate.py                                # expect: 14/14 checks pass
```

Charts land in `sim/out/`. Scenarios: healthy, weekend-gaps, apathetic, whale-carried, abandoned-reborn.

## 3. Web app, Practice mode (no wallet)

```bash
cd web
npm install            # first time only
npm run dev            # open the URL it prints (http://127.0.0.1:5173 or the next free port)
```

Switch the top-right toggle to **🧪 Practice**. The same rules run in the browser (`web/src/engine.ts`) on a 2-minute day.

- [ ] **Feed:** pick 10 / 50 / 🍱 and press **FEED** (or space). Bamboo flies to the panda, the belly fills, Hoard and Burned go up.
- [ ] **Play:** ✋ pet, 🎋 drop bamboo, ⚽ throw the ball, click a tree to shake apples. The panda reacts.
- [ ] **Level up:** keep the belly above 50% for a while. A block is added to the totem pole and the level badge rises.
- [ ] **Bite:** stop feeding for about 2 minutes. The sky goes red (Rampage), then every ¼ day a bite burns 15% of the Hoard and a block falls off the pole.
- [ ] **Rescue:** feed during a Rampage. The "Someone rescued" event shows.
- [ ] **Death:** let it reach Level 0. The death card appears and a gravestone shows in the graveyard. **✕** shrinks the card to a pill, tapping the pill reopens it.
- [ ] **Hatch:** press **🥚 Hatch the next generation**. A new panda in new colours, Generation +1.

## 4. Web app, live testnet with a wallet

The default mode (**Live testnet**) reads `totem-grumbo.testnet` (demo mode: 1 Totem-day = 120 s).

### Before you start

1. **The Totem must be alive.** If the app shows the 🪦 death card, hatch it through the DAO (only the tribe can):
   ```bash
   scripts/dao-propose.sh hatch          # needs .env and the council key in ~/.near-credentials
   ```
   A newborn starves in about **2.5 minutes** unless fed, so hatch right before testing.
2. **Your account needs a little testnet NEAR for gas** (0.1 is plenty).
   - NEAR wallets (Meteor, Intear, …): get some at https://near-faucet.io
   - Ethereum wallets (MetaMask): your address `0x…` *is* a NEAR testnet account, but it starts with 0 NEAR.
     Send it some from any funded account:
     ```bash
     near tokens totem-grumbo-tribe.testnet send-near 0xyouraddress… '1 NEAR' network-config testnet sign-with-legacy-keychain send
     ```

### Steps

- [ ] Open the app and hard-refresh (Ctrl+Shift+R). The farm shows the real Totem (name, level, Hoard, Burned).
- [ ] **Connect wallet.** Pick your wallet. **See:** your account id in the wallet panel.
- [ ] **🚰 Get test $TOTEM.** Approve the transaction. **See:** balance becomes 1,000 (it can take up to 10 s to refresh).
- [ ] **Feed.** Approve. **See:** belly, Hoard and Burned update from chain; "you fed …" in the event feed.
- [ ] **Explorer.** "contract on explorer ↗" shows your `feed` transaction on testnet.nearblocks.io.
- [ ] **Bite on chain:** stop feeding ~2 minutes and watch a block fall and the Hoard shrink.

### Things to know

- **$TOTEM does not show in MetaMask.** It is a NEAR token (NEP-141), not an ERC-20, so there is no "import token" for it.
  See your balance in the app's wallet panel or at `https://testnet.nearblocks.io/address/<your account>` (token holdings).
- **MetaMask asks to confirm every action.** NEAR wallets add a limited key for this contract at sign-in so feeding
  doesn't pop up each time; Ethereum wallets don't support that, so the app falls back to a normal signature.
- **Browser RPC goes through the dev server** (`/rpc`, see `web/rpc-proxy.ts`). Public testnet RPCs rate-limit per IP,
  and a throttled reply has no CORS header, so the browser would report it as a "CORS" error. The proxy rotates
  upstreams and shares identical view calls. A static build (`npm run build`) talks to FastNEAR directly unless
  `VITE_RPC_URL` is set.

## 5. DAO and Keepers (CLI)

Needs `.env` (copy `.env.example`) and the council key in `~/.near-credentials`.

```bash
scripts/dao-propose.sh hatch                                        # after a death
scripts/dao-propose.sh rename Mochi                                 # takes effect for the next generation's name
VOTERS=totem-grumbo-keeper.testnet scripts/dao-propose.sh rename X   # a Keeper passes it alone
scripts/keepers-sync.sh some-staker.testnet another.testnet         # add/remove Keepers from on-chain reputation
```

- [ ] After `hatch`, the app shows the new generation within a few seconds and the death card disappears.
- [ ] Proposals are visible on the DAO account in the explorer: `totem-tribe.sputnik-v2.testnet`.

## 6. Read the chain directly

```bash
near contract call-function as-read-only totem-grumbo.testnet get_totem   json-args '{}' network-config testnet now
near contract call-function as-read-only totem-grumbo.testnet get_lineage json-args '{}' network-config testnet now
near contract call-function as-read-only totem-grumbo.testnet ft_balance_of json-args '{"account_id":"you.testnet"}' network-config testnet now
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `blocked by CORS policy` / `net::ERR_FAILED` on an RPC URL | The public RPC rate-limited you (429) | Use `npm run dev` (it proxies `/rpc`) and hard-refresh |
| `AccessKeyDoesNotExistError … Exceeded N providers` | Old build; wallet didn't add the function-call key | Pull latest, sign out, connect again |
| `NotEnoughBalance` / "no NEAR for gas" | Account has 0 testnet NEAR | Fund it (see "Before you start") |
| Death card won't go away | The Totem is dead on-chain | `scripts/dao-propose.sh hatch`, or press ✕ to hide it |
| Gravestone says "Grumbo II" but the header says "Mochi II" | It died as Grumbo; the rename applies to the next generation | Expected |
| App switched itself to Practice | Testnet RPC unreachable 3 times in a row | Check the network, switch back to Live |
