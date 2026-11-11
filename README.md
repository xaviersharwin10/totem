# TOTEM

A community creature on NEAR that dies if the tribe ignores it. Feed it $TOTEM and it grows and pays its caretakers; neglect it and it eats the community treasury.

> Status: Day 2 of a 4-day hackathon build. The contract core and balance model
> are done and tested; the NFT standard wiring, testnet deploy, and bot are in
> progress. This README marks what works today honestly — see **Status** below.

## What it is

TOTEM is one shared creature — a single NFT the whole community keeps alive by feeding it a memecoin. Every meal burns half the tokens (supply shrinks the more it is loved) and puts the other half into a treasury the creature itself owns. Holders can stake into its belly. If the tribe stops feeding it, it goes on a rampage: every 6 hours it bites, burning 15% of the treasury, slashing 15% of every staker who hasn't fed it recently, and dropping a level. At Level 0 it dies and becomes a gravestone; the next egg inherits cosmetic traits from its top feeders.

## The problem it answers

Most memecoins have no mechanic and most community treasuries have no reason to exist. TOTEM fuses the two: caring for a shared treasury becomes a daily ritual with real stakes, where caretakers are rewarded and free-riders are not.

## Tracks

- **memecoins** — "supply that reacts to the community, treasuries with rules, onchain rituals." Feeding is the ritual, it burns supply, the treasury has hard rules, every parameter is fixed at launch with no admin key.
- **nfts** — "NFTs as accounts: assets that own money ... ownership with behavior." The Totem is a living NFT that owns the treasury; its level and art change over time; Caretaker Badges are credential NFTs.
- **social** — "shared budgets, programmable rewards, reputation-based access on Sputnik DAO." The tribe's Sputnik DAO owns the Totem and votes on its name, evolution and rebirth; Blessings are programmable rewards; Badges are reputation.

## How NEAR is used

- **One Rust contract** holds the NEP-141 token, the game state, and (in progress) the NEP-171 NFTs. Feeding is an internal debit plus a real burn — no cross-contract calls.
- **The NFT owns the treasury.** The Reserve (the Totem-owned part of the Hoard) is attributed to the Totem token, not to any person. No one can withdraw it except through Blessings and the poke tip. Stakes stay owned by their stakers.
- **Lazy time model.** NEAR contracts can't run on a timer, so state is settled lazily: every mutating call first advances hunger, XP, rampage bites and death from the last-settled timestamp to now. View methods project the live state without writing.
- **Sputnik DAO ownership** (in progress) governs rename / evolution / rebirth only — it cannot touch the Hoard or change a rule.
- **No admin key.** Every parameter is fixed at `new()` and exposed via `get_config()`.

## The rules (all fixed at launch)

| Parameter | Value |
|---|---|
| Fullness drain | 100% → 0% over one Totem-day |
| Meal size | `base_meal × 1.5^(level−1) × form_appetite` |
| Burn share | 50% of every meal (the rest goes to the Reserve) |
| Points | 1 per whole token fed, ×2 when rescuing (fullness < 30%), ×1.5 when staked |
| Rampage bite | every ¼ Totem-day at 0%: burn 15% of the Reserve, slash 15% of unshielded stakes into it, −1 level |
| Death | when a bite takes it to Level 0 (a newborn L1 dies at its first bite) |
| Poke tip | 1% of the Reserve burned by the bites a `poke()` settles |
| Staking | ×1.5 points while ≥ 100 staked; a feed ≥ 5 shields your stake for 2 days; 1.5-day unbonding, still slashable |
| Lineage | gravestone life record on death; next egg's cosmetic traits from the top 3 feeders, who become its Founders |
| Levels | L2/L3/L4/L5 at 1/3/6/10 Happy-days, then +5 each |
| Blessings | 3.5-day periods from L3; `rate × Reserve` split pro-rata by points |
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
├── web/        Vite + React + three.js: the 3D farm where the Totem lives
├── bot/        Telegram alerts (wip)
├── scripts/    deploy / DAO / demo (wip)
└── RULES.md    final parameters
```

## Reproduce locally

Prerequisites: Rust (`rustup`, stable) with the `wasm32-unknown-unknown` target, `cargo-near`, Python 3.9+, Node 18+.

```bash
# Contract: run the unit tests (settle, feed, rampage, death, sybil-neutrality)
cd contract
cargo +stable test                      # expect: 17 passed (needs Rust >= 1.95)

# Contract: build the deployable wasm + ABI
cargo near build non-reproducible-wasm  # writes target/near/totem.wasm

# Simulation: 60-day balance model, five scenarios, charts to sim/out/
cd ../sim
python3 -m venv .venv && .venv/bin/pip install matplotlib
.venv/bin/python simulate.py            # prints a summary + validation checks

# Web app: the 3D farm (opens at http://localhost:5173)
cd ../web
npm install && npm run dev
```

## The web app

The Totem is a chubby panda living on a small 3D farm island (React Three Fiber, no external models or art assets: everything is built from primitives in code).

- **Do:** tap the panda. **See:** it jumps, spins and hearts float up.
- **Do:** pick 🎋 in the dock, tap the grass (or press Space). **See:** bamboo falls, the panda runs over and eats it, the belly bar rises, and the Hoard and Burned counters go up.
- **Do:** stop feeding for about 2 minutes. **See:** the sky turns red, the panda rampages, and a bite knocks the top block off the **totem pole** (one block per level). At Level 0 it dies, a **gravestone** appears in the graveyard, and you can hatch the next generation in new colours.
- Also: ⚽ throw a ball it chases, shake trees for apples, tap the **treasure chest** (the Hoard) or the totem pole for an explanation, drag to orbit, 🎥 to follow the panda. One Totem-day = 2 minutes, with a matching day/night cycle.

**Honest note:** the web app currently runs a client-side mirror of the contract rules (`web/src/engine.ts`, new bite rules included; staking not yet shown). It is not yet wired to the testnet contract or a wallet.

### What the tests prove

The unit tests (`contract/src/tests.rs`) exercise the mechanic end to end:

- `feed_burns_half_and_reserves_half`, `overfeed_only_debits_what_fits`, `rescue_feed_earns_double_points`, `staker_bonus_stacks_with_rescue` — feeding math and points.
- `newborn_dies_at_its_first_bite` — an L1 egg dies at bite one; the poker gets 1% of the burn; a gravestone is recorded.
- `a_grown_totem_loses_one_level_per_bite` — an L3 Totem survives two bites (L2, L1, XP reset to the floor, cheaper meals) and dies at the third; the view projects bites before anyone settles them.
- `feeding_ends_rampage_but_lost_levels_stay_lost`.
- `shielded_staker_keeps_everything_unshielded_loses_slash` — the feeder's stake is untouched, the freeloader loses exactly 15%, which refills the Reserve.
- `shield_expiring_between_bites_is_slashed_by_the_second_only`.
- `many_stakers_sum_never_exceeds_aggregate` — staggered shields across every bite to death: individual stakes never sum above the aggregate, dust stays ≤ 16 yocto, supply is conserved.
- `unbonding_stays_slashable_and_matures`, `unstake_withdraw_after_delay_while_alive`, `released_stake_from_a_dead_generation_is_paid_out_on_restake`.
- `death_leaves_a_gravestone_and_hatch_inherits_traits` — owner-only hatch, traits from the top 3 feeders, Founders, no economic carry-over, `get_lineage` parent links.
- `sybil_split_earns_identical_total` — splitting a spend across wallets earns nothing extra.

### What the simulation shows

[`sim/simulate.py`](sim/simulate.py) is an agent-based model of 60 Totem-days using the contract's rules (bites drop levels, staking with shields, Blessings per period, generations). Players: loyal caretakers, rescue-only opportunists, a whale, freeloaders, stakers who keep their shield up with 5-token snacks, and stakers who never feed. One chart per scenario in [`sim/out/`](sim/out/):

| Scenario | Result |
|---|---|
| `healthy` | Survives 60 days, no bites, reaches L14 |
| `weekend-gaps` | The tribe forgets it at weekends: 7 bites over 60 days (its worst weekend takes it L7 → L3) and it survives. Stakers who fed keep ~450 of 500; stakers who didn't end at ~160 |
| `apathetic` | Barely kept alive; 6 bites, lazy stakers lose ~60% of their stake |
| `whale-carried` | One whale keeps it alive; lazy stakers still get slashed |
| `abandoned-reborn` | Fed 10 days, abandoned: it bites its way down from L4 and dies; the tribe returns, Generation 2 hatches and grows to L9 |

All 14 checks pass. Two parameters were tuned from this model: Blessing periods went from 7 to 3.5 days (caretakers now get ~12% of their spend back in the healthy scenario instead of ~8%), and the shield went from "feed 10, protected 1 day" to "feed 5, protected 2 days" (so a 500-token staker who feeds now ends ahead of one who doesn't).

## Status (honest)

| Area | State |
|---|---|
| NEP-141 token, storage, feed/burn/hoard | done, tested |
| Lazy settle, bites with level loss, death at L0, levels, blessings, badges | done, tested |
| Staking into the belly: shields, slashing, unbonding (bounded-gas accounting) | done, tested |
| Lineage: gravestone records, inherited traits, founders, `get_lineage` | done, tested |
| Contract → wasm + ABI | done |
| NEP-171 NFT tokens (Totem / gravestone / soulbound badges) | in progress |
| near-workspaces integration tests (§8.5 edge cases) | in progress |
| Testnet deploy + Sputnik DAO + demo script | pending |
| Web app: 3D farm, panda, feeding, bites/levels on the totem pole, death, lineage graveyard | done (local rule mirror) |
| Web app: wallet + testnet contract, staking UI | pending |
| Telegram bot | pending |

Testnet contract address and DAO address will be filled in here once deployed. Nothing is deployed to mainnet; the prize payout account is created by the team, not by any tool.

## License

MIT — see [`LICENSE`](LICENSE).
