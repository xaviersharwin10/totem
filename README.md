# TOTEM

A community creature on NEAR that dies if the tribe ignores it. Feed it $TOTEM and it grows and pays its caretakers; neglect it and it eats the community treasury.

> Status: Day 2 of a 4-day hackathon build. The contract core and balance model
> are done and tested; the NFT standard wiring, testnet deploy, and bot are in
> progress. This README marks what works today honestly — see **Status** below.

## What it is

TOTEM is one shared creature — a single NFT the whole community keeps alive by feeding it a memecoin. Every meal burns half the tokens (supply shrinks the more it is loved) and puts the other half into a treasury the creature itself owns. If the tribe stops feeding it, the creature goes on a rampage and eats that treasury; after three days of neglect it dies and becomes a gravestone.

## The problem it answers

Most memecoins have no mechanic and most community treasuries have no reason to exist. TOTEM fuses the two: caring for a shared treasury becomes a daily ritual with real stakes, where caretakers are rewarded and free-riders are not.

## Tracks

- **memecoins** — "supply that reacts to the community, treasuries with rules, onchain rituals." Feeding is the ritual, it burns supply, the treasury has hard rules, every parameter is fixed at launch with no admin key.
- **nfts** — "NFTs as accounts: assets that own money ... ownership with behavior." The Totem is a living NFT that owns the treasury; its level and art change over time; Caretaker Badges are credential NFTs.
- **social** — "shared budgets, programmable rewards, reputation-based access on Sputnik DAO." The tribe's Sputnik DAO owns the Totem and votes on its name, evolution and rebirth; Blessings are programmable rewards; Badges are reputation.

## How NEAR is used

- **One Rust contract** holds the NEP-141 token, the game state, and (in progress) the NEP-171 NFTs. Feeding is an internal debit plus a real burn — no cross-contract calls.
- **The NFT owns the treasury.** The Hoard is attributed to the Totem token, not to any person. No one can withdraw it except through Blessings and the poke tip.
- **Lazy time model.** NEAR contracts can't run on a timer, so state is settled lazily: every mutating call first advances hunger, XP, rampage bites and death from the last-settled timestamp to now. View methods project the live state without writing.
- **Sputnik DAO ownership** (in progress) governs rename / evolution / rebirth only — it cannot touch the Hoard or change a rule.
- **No admin key.** Every parameter is fixed at `new()` and exposed via `get_config()`.

## The rules (all fixed at launch)

| Parameter | Value |
|---|---|
| Fullness drain | 100% → 0% over one Totem-day |
| Meal size | `base_meal × 1.5^(level−1) × form_appetite` |
| Burn share | 50% of every meal (the rest goes to the Hoard) |
| Points | 1 per whole token fed, ×2 when rescuing (fullness < 30%) |
| Rampage bite | 10% of the Hoard per Totem-hour at 0% fullness |
| Poke tip | 1% of a bite, paid to whoever settles it |
| Death | after 3 continuous Totem-days in rampage |
| Levels | L2/L3/L4/L5 at 1/3/6/10 Happy-days, then +5 each |
| Blessings | 7-day periods from L3; `rate × Hoard` split pro-rata by points |
| Badges | Bronze/Silver/Gold at 100/1,000/10,000 lifetime points (soulbound) |
| Supply | 1,000,000,000 $TOTEM, 18 decimals, minted once at init |

Full parameter list: [`RULES.md`](RULES.md). The live values are always readable on-chain via `get_config()`.

## Why fake accounts don't help

Points, Badges and Blessings are all proportional to tokens actually spent, and half of every meal is burned. Splitting 100 tokens across 100 accounts earns exactly what one account earns with 100 tokens. There is nothing to farm — only to spend. (Proven by the `sybil_split_earns_identical_total` unit test.)

## Repository layout

```
.
├── contract/   Rust contract (near-sdk 5.30): token + game + (wip) NFTs
├── sim/        Python agent-based balance model + committed charts
├── web/        Vite + React UI (the living creature)
├── bot/        Telegram alerts (wip)
├── scripts/    deploy / DAO / demo (wip)
└── RULES.md    final parameters
```

## Reproduce locally

Prerequisites: Rust (`rustup`, stable) with the `wasm32-unknown-unknown` target, `cargo-near`, Python 3.9+, Node 18+.

```bash
# Contract: run the unit tests (settle, feed, rampage, death, sybil-neutrality)
cd contract
cargo test                              # expect: 9 passed

# Contract: build the deployable wasm + ABI
cargo near build non-reproducible-wasm  # writes target/near/totem.wasm

# Simulation: 60-day balance model, four scenarios, charts to sim/out/
cd ../sim
.venv/bin/python simulate.py            # or: python3 -m venv .venv && pip install numpy matplotlib

# Web app (see web/README for details)
cd ../web
npm install && npm run dev
```

### What the tests prove

The unit tests (`contract/src/tests.rs`) exercise the mechanic end to end:

- `feed_burns_half_and_hoards_half` — a 40-token feed burns 20, hoards 20, awards 40 points, raises fullness.
- `overfeed_only_debits_what_fits` — feeding 1000 into a half-full L1 debits only 50.
- `rescue_feed_earns_double_points` — feeding below 30% pays 2×.
- `rampage_bites_the_hoard` / `neglect_leads_to_death_and_burns_the_hoard` — neglect eats the Hoard, then kills the Totem and burns the remainder.
- `feeding_ends_rampage` — a rescue feed stops the rampage.
- `sybil_split_earns_identical_total` — splitting a spend across wallets earns nothing extra.

The simulation prints a summary table and writes one chart per scenario; the **abandoned** chart shows the Hoard climbing while fed, then being eaten to zero after neglect — the core drama, in one picture.

## Status (honest)

| Area | State |
|---|---|
| NEP-141 token, storage, feed/burn/hoard | done, tested |
| Lazy settle, rampage, death, levels, blessings, badges | done, tested |
| Contract → wasm + ABI | done |
| NEP-171 NFT tokens (Totem / gravestone / soulbound badges) | in progress |
| near-workspaces integration tests (§8.5 edge cases) | in progress |
| Testnet deploy + Sputnik DAO + demo script | pending |
| Web app | in progress |
| Telegram bot | pending |

Testnet contract address and DAO address will be filled in here once deployed. Nothing is deployed to mainnet; the prize payout account is created by the team, not by any tool.

## License

MIT — see [`LICENSE`](LICENSE).
