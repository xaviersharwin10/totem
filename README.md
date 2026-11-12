# TOTEM

A community creature on NEAR that dies if the tribe ignores it. Feed it $TOTEM and it grows and pays its caretakers; neglect it and it eats the community treasury.

> Built for the NEAR Hackathon (Nov 2026). Live on testnet, playable in the browser with no wallet:
> **https://totem-x2kg.onrender.com**. What works and what doesn't is marked honestly under **Status** below.

## What it is


TOTEM is one shared creature — a single NFT the whole community keeps alive by feeding it a memecoin. Every meal burns half the tokens (supply shrinks the more it is loved) and puts the other half into a treasury the creature itself owns. Holders can stake into its belly. If the tribe stops feeding it, it goes on a rampage: every 6 hours it bites, burning 15% of the treasury, slashing 15% of every staker who hasn't fed it recently, and dropping a level. At Level 0 it dies and becomes a gravestone; the next egg inherits cosmetic traits from its top feeders.

The panda is called **BaoBao**. The tribe chose the name by DAO vote ([proposal 16](https://testnet.nearblocks.io/address/totem-tribe.sputnik-v2.testnet)), and the tribe can rename it again, so the code never hard-codes it: the app, the bot and the AI voice all read the name from the chain. Each life adds a numeral (BaoBao IX is the 9th generation); gravestones keep the name each life died with (Grumbo I–II, Mochi III–VIII).

## The problem it answers

Most memecoins have no mechanic and most community treasuries have no reason to exist. TOTEM fuses the two: caring for a shared treasury becomes a daily ritual with real stakes, where caretakers are rewarded and free-riders are not.

## Try it in 5 minutes (no wallet needed)

1. Open **https://totem-x2kg.onrender.com** — the 3D island loads in a few seconds.
2. Click **⚡ Play free, no wallet** — a zero-balance guest account is created in your browser.
3. Click **FEED** (or press `Space`) and pick an amount → watch 🔥 Burned go up and the treasury fill.
4. If the screen is red (**RAMPAGE**), tap **RESCUE** to save BaoBao and earn a Hero badge.
5. Tap the panda or press 💬 to talk to BaoBao — it answers in character, grounded in live chain state.
6. Press 🏛 (Tribe) → see open DAO proposals, Keeper standings, and the governance board.
7. Press 🧾 (History) → see the live supply reconciliation: launch + faucet − burned = `ft_total_supply`.
8. Tap any gravestone on the island → see that generation's full life record.

To use a real wallet: click **Connect wallet** (top right) and choose Meteor, Intear or MetaMask (0x accounts work via EIP-191).  
To get testnet $TOTEM: press the faucet button (🪣 in the right rail) — 1,000 tokens per Totem-day, no gas.

## Tracks

- **memecoins** — "supply that reacts to the community, treasuries with rules, onchain rituals." Feeding is the ritual, it burns supply, the treasury has hard rules, every parameter is fixed at launch with no admin key. $TOTEM's burn mechanic is purpose-built for platforms like [meme.cooking](https://meme.cooking) — each feed is an onchain ritual that visibly shrinks supply.
- **nfts** — "NFTs as accounts: assets that own money ... ownership with behavior." The Totem is a living NFT that owns a treasury **sub-account** (`totem-<gen>.<contract>`, keyless); its level and art change over time; Caretaker Badges are credential NFTs.
- **social** — "shared budgets, programmable rewards, reputation-based access on Sputnik DAO." The tribe's Sputnik DAO owns the Totem and votes on its name, evolution and rebirth; Blessings are programmable rewards; Badges are reputation.
- **games** — "game loop with real economy, agent NPC, players never notice the chain." BaoBao is an AI character whose personality is derived from on-chain traits. The treasury IS the economy. Gasless guest accounts hide every chain interaction. Practice mode is the fast-forward simulator.

## Track checklist (the official prompts, point by point)

The judges' [track prompts](https://github.com/nearai/near-hackathon-prompt-examples/tree/main/tracks) list what each track asks for. Here is each requirement, where it lives, and how to check it yourself.

**Memecoins With Mechanics** ([11-memecoins](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/11-memecoins.md))

| The prompt asks for | TOTEM | Check it |
|---|---|---|
| A NEP-141 token with the mechanic in the contract, not a backend someone could switch off | Feeding, burning, bites, death, Blessings and the moon are all in [`contract/src/game.rs`](contract/src/game.rs) / [`moon.rs`](contract/src/moon.rs). The server only relays and reads | `cargo test` (53 unit + 2 sandbox) |
| All parameters set at launch, readable by anyone, no admin key | `Config` is fixed at `new()`; there is no setter and no owner method touches the token | `get_config` on [`totem-baobao.testnet`](https://testnet.nearblocks.io/address/totem-baobao.testnet) |
| Supply that reacts to the community; treasuries with rules; onchain rituals | Every meal burns 50–70%; neglect makes it bite the treasury; **BaoBao follows the real moon** (full-moon rally nights) | App: feed and watch 🔥 Burned; tap the 🌙 chip |
| Sybil resistance good enough for a demo, limits written plainly | [Below](#why-fake-accounts-dont-help) | `sybil_split_earns_identical_total` |
| A page with the live state and a log of every mint and burn | 🧾 history: supply reconciliation (launch + faucet − burned = `ft_total_supply`) and every `ft_mint` / `ft_burn` with tx links | App → 🧾 |
| Simulate 60 days before picking parameters | [`sim/simulate.py`](sim/simulate.py), 5 scenarios, 14 checks, charts committed | `python3 sim/simulate.py` |

**NFTs That Do Something** ([10-nfts](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/10-nfts.md))

| The prompt asks for | TOTEM | Check it |
|---|---|---|
| An NFT that owns money through its own account | Each Totem NFT `totem-<gen>` has a keyless treasury sub-account `totem-<gen>.totem-baobao.testnet` holding its Reserve | Explorer: the account has no access keys |
| How control passes on transfer, and what stops the old owner keeping access | [Selling the Totem](#selling-the-totem-what-moves-and-what-the-seller-cant-keep): every seller trick and what stops it | `transferring_the_totem_moves_governance_with_it` |
| Tests for the transfer path, including a sale in the middle of a payout | `selling_the_totem_mid_payout_moves_no_money_to_the_seller`: sold while a Blessing is reserved and the next period runs; seller gets nothing, caretaker paid in full, buyer gets governance only | `cargo test selling` |
| A gated page only current holders can open | **🗝 The Den**: badge NFT holders only, enforced by the server (a signed proof of ownership, NEP-413 or MetaMask's personal_sign, + on-chain holdings on every request) | App → 🗝; `npx tsx web/server/den.e2e.mts` (9 checks) |
| A history view per NFT | 🧾 → Lives: each life's stats, top feeders, NFT id and events; tap a gravestone | App → tap a gravestone |
| NFTs as credentials / memberships | Soulbound Hero, Founder, Moonlit, Welcome Back and Caretaker badges; they are the Den's keys and count toward Keeper eligibility | `badges_are_soulbound_nfts` |

**Social Money** ([12-social](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/12-social.md))

| The prompt asks for | TOTEM | Check it |
|---|---|---|
| Use Sputnik DAO / Trezu for custody and approvals, don't write a new multisig | The tribe is a plain Sputnik DAO ([`totem-tribe.sputnik-v2.testnet`](https://testnet.nearblocks.io/address/totem-tribe.sputnik-v2.testnet)) that owns the Totem NFT; Trezu-ready on mainnet | `get_policy` |
| Reputation tied to named accounts, every point traceable | Points come only from feeds (each a logged event); Keeper eligibility is `get_keeper` (stake or Silver/Gold badge) | 🏛 Tribe → Keepers |
| Tiered approvals | Majority of Keepers for Totem calls and membership; two thirds for the constitution; no council, no founder vote | 🏛 Tribe; proposal 13 |
| A public board | 🏛 Tribe: open votes with tallies, decided proposals, Keepers and why they qualify; Telegram bot posts every vote | App → 🏛, [@Babao_panda_bot](https://t.me/Babao_panda_bot) |

**Games With Real Economies** ([09-games](https://github.com/nearai/near-hackathon-prompt-examples/blob/main/tracks/09-games.md))

| The prompt asks for | TOTEM | Check it |
|---|---|---|
| A game loop with a real economy that evolves without a dev patch | The treasury fills and drains by player actions alone; bite rules, Blessing rates and burn share are all fixed at launch — no dev can patch the economy | `get_config` on-chain |
| An agent NPC with its own wallet / personality | BaoBao is an AI character on NEAR AI Cloud; its personality is derived from the top-3 feeders' account hashes (on-chain traits); it knows its feeders, ancestors and live chain state by name | App → tap panda or press 💬 |
| Players never notice the chain | Guest accounts (`g<hex>.totem-grumbo-relay.testnet`) are created silently; NEP-366 meta-transactions relay every action; no seed phrase, no gas prompt, no wallet popup in the normal loop | App → ⚡ Play free |
| Fast-forward / simulate mode | **Practice mode** (top-right toggle): a full client-side simulation of the game rules, moon phases and Blessings; play at any hunger level without touching the chain | App → toggle Practice |

## How NEAR is used

- **One Rust contract** holds the NEP-141 token, the game state, and the NEP-171 NFTs: the Totem itself (a dynamic NFT whose metadata shows its live level, mood and Reserve), its gravestones, and soulbound badges. Feeding is an internal debit plus a real burn — no cross-contract calls.
- **The NFT owns the treasury, in its own account.** Each Totem NFT `totem-<gen>` has a treasury sub-account, `totem-<gen>.totem-baobao.testnet`, created by the contract with **no access keys and 0 NEAR** (a NEP-448 zero-balance account): nobody can ever sign for it. Its $TOTEM balance *is* the Reserve. Every meal pays into it, and bites, death, poke tips and Blessings take from it, as ordinary NEP-141 transfers and burns anyone can follow on the explorer. Direct transfers into it (or into the contract) are refused, so its balance always equals the Reserve. No one can withdraw it except through Blessings and the poke tip. Stakes stay owned by their stakers. The Treasury shown in the app is the Reserve plus the **living** Totem's stakes: stakes from a dead generation are reported separately (`released_stakes`, "stakes to withdraw"), so a dead Totem's Treasury is 0.
- **Lazy time model.** NEAR contracts can't run on a timer, so state is settled lazily: every mutating call first advances hunger, XP, rampage bites and death from the last-settled timestamp to now. View methods project the live state without writing.
- **The tribe governs through a Sputnik DAO, with real separation of powers.** The DAO owns the Totem NFT, so hatch / rename / evolve happen only by DAO proposal (a `FunctionCall` to the contract); the DAO cannot touch the Treasury or change a game rule. Its policy (set by [`scripts/bootstrap-governance.sh`](scripts/bootstrap-governance.sh)):
  - **Everyone** may propose (0.1 NEAR bond, refunded when it passes; players without NEAR propose through the game, which pays the bond).
  - **Keepers** decide by majority (2 of 3, 3 of 4…): hatching, the name, evolution, and who becomes a Keeper. A Keeper is whoever the contract's `get_keeper` view says qualifies: ≥ 1,000 $TOTEM staked in the living Totem (or in the one that just died, until withdrawn), or the Silver/Gold Caretaker tier.
  - **No council, no founder powers.** Changing the constitution itself (policy, config, upgrades) takes **two thirds** of the Keepers. The founding council's last vote was to delete itself ([`scripts/adopt-constitution.sh`](scripts/adopt-constitution.sh), proposal 13); the founders' account now has no vote on anything.
  - **Trezu-ready.** It is a plain Sputnik DAO, the same contract NEAR's Trezu treasury app is built on. Trezu runs on mainnet only, so on testnet the 🏛 Tribe panel is the client; deployed as a mainnet `*.sputnik-dao.near` DAO, the panel links straight to it in Trezu.
  - On testnet: a guest with no wallet staked, nominated itself in the app, was admitted by two Keepers, then proposed and voted the hatch of Mochi VI from the death card; it passed 3 of 3 and the hatch ran in the deciding vote ([proposal 10](https://testnet.nearblocks.io/address/totem-tribe.sputnik-v2.testnet)).
- **No admin key.** Every parameter is fixed at `new()` and exposed via `get_config()`.
- **BaoBao follows the real moon.** The contract computes tonight's moon from the block time ([`moon.rs`](contract/src/moon.rs): a known new moon, the 29.53-day synodic month, an integer sine approximation within ~0.2%). No oracle, no admin. The fuller the moon, the hungrier BaoBao gets (the belly empties up to 1.5× faster at full moon) and the more each meal burns (50% at new moon, up to 70% at full). Feeding while the moon is at least 90% lit mints a soulbound **Moonlit** badge, once per lunar cycle. Full-moon nights are the tribe's rally nights. The moon shows in the farm's sky with its real phase; the 🌙 chip explains the current effect, and Practice mode can preview any phase.
- **🗝 The Den: a page only badge holders can open.** A player signs a free message (any NEAR wallet's NEP-413 `signMessage`, a guest's own key, or MetaMask's `personal_sign` for 0x accounts; nothing goes on chain). The server ([`web/server/auth.ts`](web/server/auth.ts), [`den.ts`](web/server/den.ts)) checks the signature (for NEAR keys: a full-access key of that account on chain right now; for 0x accounts: the recovered Ethereum address *is* the account), that the message is fresh and unused, and that the account holds a Hero, Founder, Moonlit, Welcome Back or Caretaker badge NFT, then re-checks the holdings on every request. Inside: BaoBao's secret diary (written by its AI voice for holders only) and a holders-only wall.
- **Gasless play for anyone: zero-balance accounts + meta-transactions.** A rescuer with no wallet and no NEAR taps "Rescue": the game creates `g<hex>.totem-grumbo-relay.testnet` holding **0 NEAR** (a NEP-448 zero-balance account) with a key generated in their browser. Each action is a NEP-366 `DelegateAction` signed in the browser; our relayer wraps it in a transaction and pays the gas. The relayer only sponsors zero-deposit calls to this contract's game methods, rate-limited. On testnet a fresh guest rescued the Totem from a Rampage and received the Hero NFT with 0 NEAR in its account. The guest key lives in the browser; **🔑 back up** gives a code that restores the same account in another browser (checked on-chain before it is accepted).
- **The tribe's alarm bell (Telegram).** The Totem starves on a clock while nobody is looking, so a bot watches the chain and posts to the tribe's group when it matters: starving, Rampage (with the next bite's burn), every bite, the rescue and who did it, death, hatch votes, the new egg. Each alert carries the one-tap gasless rescue link. Anyone can `/watch` an account (public data, no login) to hear when its shield is about to end, when a bite is coming for an unshielded stake, when a Blessing is about to expire, or when a vote needs it as a Keeper. `/ask` puts the question to the Totem's AI voice.
- **Bringing the quiet holders in, kindly.** Holding without feeding loses nothing, so the game pulls instead of punishing. The bot **thanks feeders by name** (a first feed ever, a comeback, a rescue from starving, and a digest of everyone else), and while BaoBao is hungry it reminds **the quiet holders as a crowd, never by name** ("12 wallets hold $TOTEM but have never fed me…", at most every 6 hours). The app's **🔔 button** links your account to the bot in one tap (sign a free message, open the t.me link): no typing `/watch`, and only linked accounts get personal "I miss you" nudges. The contract adds a **Welcome Back** bonus: a caretaker who fed before and then stayed away 3 Totem-days gets +50% points on the feed that brings them back (capped at 100 points) and a soulbound Welcome Back badge, once per life.
- **The Totem talks (NEAR AI Cloud).** The panda is an AI character whose facts all come from the chain: a small server endpoint reads `get_totem`, `get_lineage`, `get_caretaker` and `get_stake`, then asks a model on NEAR AI Cloud to answer in character. Its personality is derived from its on-chain traits, which are a hash of the previous generation's top 3 feeders, so the tribe's best feeders shape how the next panda talks. It knows who fed it, by account name, and remembers its ancestors from their gravestones.

## The rules (all fixed at launch)

| Parameter | Value |
|---|---|
| Fullness drain | 100% → 0% over one Totem-day at new moon; faster under a brighter moon (two thirds of a day at full moon) |
| Meal size | `base_meal × 1.5^(level−1) × form_appetite` |
| Burn share | 50% of every meal at new moon, up to 70% at full moon (scaled by how lit the moon is); the rest goes to the Reserve |
| The moon | Hunger up to ×1.5 at full moon; Moonlit badge for a feed while ≥ 90% lit (once per lunar cycle). Phase from block time, no oracle |
| Points | 1 per whole token fed, ×2 when rescuing (fullness < 30%), ×1.5 when staked, +50% (max +100) on a feed after 3+ Totem-days away |
| Rampage bite | every ¼ Totem-day at 0%: burn 15% of the Reserve, slash 15% of unshielded stakes into it, −1 level |
| Death | when a bite takes it to Level 0 (a newborn L1 dies at its first bite) |
| Poke tip | 1% of the Reserve burned by the bites a `poke()` settles |
| Staking | ×1.5 points while ≥ 100 staked; a feed ≥ 5 shields your stake for 2 days; 1.5-day unbonding, still slashable |
| Lineage | gravestone life record on death; next egg's cosmetic traits from the top 3 feeders, who become its Founders |
| Levels | L2/L3/L4/L5 at 1/3/6/10 Happy-days, then +5 each |
| Blessings | 3.5-day periods from L3; `rate × Reserve` split pro-rata by points |
| Badges | Bronze/Silver/Gold at 100/1,000/10,000 lifetime points (soulbound) |
| Supply | 1,000,000,000 $TOTEM, 18 decimals, minted once at init. The only later mint is the **demo-mode faucet** (testnet, 1,000 per account per Totem-day), logged as a NEP-141 `ft_mint`; with `demo_mode = false` it does not exist |

Full parameter list: [`RULES.md`](RULES.md). The live values are always readable on-chain via `get_config()`.

## Why fake accounts don't help

Points, Badges and Blessings are all proportional to tokens actually spent, and half of every meal is burned. Splitting 100 tokens across 100 accounts earns exactly what one account earns with 100 tokens. There is nothing to farm — only to spend. (Proven by the `sybil_split_earns_identical_total` unit test.)

**The limits, plainly:**
- **Badges are per account.** One person with many accounts can hold more Hero or Moonlit badges, but each one still cost a real feed (Hero: ending a Rampage; Moonlit: a feed under a full moon), and badges are soulbound, so they can't be sold.
- **Keeper seats** need 1,000 $TOTEM staked in the living Totem or a Silver/Gold badge. Splitting a stake across accounts makes it too small to qualify, so a seat costs real capital, which is slashed if left unshielded. A rich attacker can still buy several seats; the DAO's two-thirds rule for constitution changes limits what they can do with them.
- **Free play** (gasless guests) is rate-limited per IP: 5 new guest accounts and 40 sponsored actions per hour, and 30 per guest account. Rotating IPs gets around this; on testnet that only costs our relayer gas.
- **The demo faucet** (1,000 test $TOTEM per account per Totem-day) is testnet-only. Mainnet has no faucet (`demo_mode = false`).

## Selling the Totem: what moves, and what the seller can't keep

The Totem NFT (`totem-<gen>`) is transferable, normally by DAO vote. Here is everything the token controls and what happens to each on a transfer. Every way a seller might try to keep value is listed with what stops it.

| The token controls | On transfer |
|---|---|
| Naming, evolving, hatching (`rename`, `choose_evolution`, `hatch`) | Move to the new owner at once. Each call checks `predecessor == nft owner` at call time, so there is no cached owner to go stale |
| The Reserve (the Totem-owned part of the Treasury) | Stays where it is: in the Totem's keyless treasury sub-account `totem-<gen>.<contract>`, which no one (seller, buyer, DAO or developer) can sign for. It can only leave by a bite or death burn, a poke tip, or a Blessing paid to feeders by points. **No method pays the owner** |
| Its metadata (live state, later the gravestone) | Computed from chain state on every read, so the buyer sees exactly what the seller saw |

| The seller tries to… | Why it fails |
|---|---|
| Rename, evolve or hatch after the sale | `assert_owner` panics: "only the Totem owner (DAO) may call this" (test `transferring_the_totem_moves_governance_with_it`) |
| Empty the Reserve before the sale | No owner method moves Reserve tokens. Its only exits are listed above, and none goes to the owner |
| Keep an approval and take the token back | NFT approvals (NEP-178) are not enabled (`NonFungibleToken::new(…, None)`), so there are no approvals to keep |
| Sell during a payout and claim the buyer's share | Blessings are paid to feeders by points earned in the period, never to the owner. Sold while a Blessing is reserved and the next period is running: no balance moves, neither seller nor buyer can claim, the caretaker is paid in full, and the running period still pays its caretakers (`selling_the_totem_mid_payout_moves_no_money_to_the_seller`) |
| Take the stakes along | Stakes belong to their stakers. Only the staker can `unstake` or `withdraw` their own stake |
| Sell a reputation badge | Caretaker, Hero and Founder badges are soulbound. `nft_transfer` and `nft_transfer_call` panic for them (`badges_are_soulbound_nfts`) |
| Hatch the next egg for themselves after selling the gravestone | `hatch` mints the new Totem to the gravestone's current owner, so it goes to the buyer |

What a buyer gets is the right to steer the Totem, not an income stream. That's deliberate: the treasury belongs to the creature and its feeders.

## Repository layout

```
.
├── contract/   Rust contract (near-sdk 5.30): token + game + staking + lineage + NFTs
├── sim/        Python agent-based balance model + committed charts
├── web/        Vite + React + three.js: the 3D farm where the Totem lives
│   └── server/ /rpc proxy, /api/voice (AI voice), /api/guest + /api/relay (gasless guests, NEP-366 relayer)
├── bot/        Telegram alerts (wip)
├── scripts/    deploy / DAO / demo (wip)
└── RULES.md    final parameters
```

## Reproduce locally

Prerequisites: Rust via `rustup` (the contract's `rust-toolchain.toml` selects stable + the wasm target automatically), Python 3.9+, Node 18+. To deploy: `cargo install --locked cargo-near near-cli-rs` (needs `libudev-dev` on Linux, or add `--no-default-features`).

```bash
# Contract: build the deployable wasm + ABI
cd contract
cargo near build non-reproducible-wasm  # writes target/near/totem.wasm

# Contract: unit tests (settle, feed, rampage, death, sybil-neutrality…) and
# sandbox integration tests (the wasm on a local NEAR node, real block time)
cargo test                              # expect: 53 passed (unit) + 2 passed (sandbox)

# Simulation: 60-day balance model, five scenarios, charts to sim/out/
cd ../sim
python3 -m venv .venv && .venv/bin/pip install matplotlib
.venv/bin/python simulate.py            # prints a summary + validation checks

# Web app: the 3D farm (opens at http://localhost:5173)
cd ../web
npm install && npm run dev

# Production (what's hosted): app + /api + Telegram bot on one port
npm run build && npm start              # PORT=8080 by default
```

**Live:** https://totem-x2kg.onrender.com (testnet, demo clock) · Telegram: [@Babao_panda_bot](https://t.me/Babao_panda_bot)

## The web app

The Totem is a chubby panda living on a small 3D farm island (React Three Fiber, no external models or art assets: everything is built from primitives in code).

- **Do:** tap the panda. **See:** it jumps, hearts float up, and it says hi in a speech bubble, mentioning how it really feels (belly, level, bites left).
- **Do:** when it gets hungry, press **🆘 Call for help** (or 📣 any time). **See:** a share card with a snapshot of the farm and the real numbers ("1 bite from death · next bite burns 128 $TOTEM"), with Share / Post on X / Telegram / Copy buttons. Nothing is posted for you.
- **Do:** open the link from the card (`/?rescue=1`) in a fresh browser with no wallet and tap **Rescue**. **See:** a free guest account is made, the faucet + feed go through as one gasless meta-transaction, the Rampage ends, a soulbound Hero NFT is minted to the guest, and BaoBao thanks them by name.
- **Do:** when the Totem dies, look at the gravestone card. **See:** the live hatch vote ("1 of 3 Keeper votes"), **Propose hatching BaoBao X** if none is open, **Vote yes / no** if you are a Keeper, and **Rally the Keepers** to share.
- **Do:** open **🏛 Tribe**. **See:** open votes with tallies, the Keepers and why each qualifies (stake or badge, read from `get_keeper`), past decisions, and your own path: *Nominate me* when you qualify, *Re-stake* after a hatch releases your stake.
- **Do:** open **🧾 On-chain history**. **See:** the supply ledger at the top (1,000,000,000 minted at launch, + demo faucet, − burned forever = supply now, all from `get_stats`), then every feed, burn, bite, death, hatch, stake, Blessing and badge as a row with its generation and a **tx ↗** link to the explorer. Filter by *Mints & burns*, *Life & death*, *Stakes* or *Rewards*. The rows come from the contract's own NEP-297 event logs (`web/server/history.ts`: NearBlocks lists the receipts, NEAR RPC returns their logs), and add up to the on-chain totals.
- **Do:** tap a **gravestone** in the graveyard (or **🧾 → Lives**). **See:** that life's story: how long it lived, its best level, fed / burned / slashed / blessed, its top feeders (they seeded the next egg), its NFT id, and every event of that life.
- **Do:** press 💬 (or T) and ask "Who feeds you the most?" or "Tell me about your ancestors". **See:** it answers in character with real account names and amounts from the chain. Each generation has its own personality, derived from its on-chain traits. Needs `NEAR_AI_API_KEY` in `web/.env` (see `web/.env.example`); without it, it answers from canned lines that still use the real numbers.
- **Do:** pick 🎋 in the dock, tap the grass (or press Space). **See:** bamboo falls, the panda runs over and eats it, the belly bar rises, and the Treasury and Burned counters go up.
- **Do:** stop feeding for about 2 minutes. **See:** the sky turns red, the panda rampages, and a bite knocks the top block off the **totem pole** (one block per level). At Level 0 it dies, a **gravestone** appears in the graveyard, and you can hatch the next generation in new colours.
- Also: ⚽ throw a ball it chases, shake trees for apples, tap the **treasure chest** (the Treasury) or the totem pole for an explanation, drag to orbit, 🎥 to follow the panda. One Totem-day = 2 minutes, with a matching day/night cycle.

**Live on testnet by default.** The farm reads the deployed contract (`get_totem`, `get_stats`, `get_lineage`) every 3 s (through the dev server's `/rpc` proxy), so the panda, totem pole, Treasury chest and graveyard show the real Totem on `totem-baobao.testnet`.

Full manual test checklist (practice, live wallet flow, DAO, troubleshooting): **[TESTING.md](TESTING.md)**.

- **Do:** click **Connect wallet** (NEAR Connect: Meteor, Intear, Nightly, Ledger, NEAR CLI, or an Ethereum wallet). **See:** your account and $TOTEM balance in the wallet panel.
- **Or:** click **⚡ Play free, no wallet**. **See:** a guest account (`guest g1a2b3c4d`) with 0 NEAR; faucet, feed and poke work without gas or popups (the game relays them).
- **Do:** click **🚰 Get test $TOTEM**. **See:** +1,000 $TOTEM (the demo-mode faucet).
- **Do:** tap **🛡 Stake in the belly** under your balance, stake 1,000. **See:** "1,000 staked · ⚠️ not shielded: the next bite takes 15%" with a **Feed 5 to shield it** button; press it. **See:** "🛡 Shielded for 4m", the staker bonus and "You qualify as a Keeper". **Unstake** 100. **See:** an unbonding countdown (3 min on the demo clock), then **Withdraw**. If the Totem dies, the panel offers **Withdraw** for the released stake.
- **Do:** after feeding through a Blessing period at Level 3+, open the same panel. **See:** 🎁 on the wallet line, each Blessing with its deadline, **Claim all**; and **Mint your Bronze badge** once you pass 100 lifetime points (from Level 2).
- **Do:** feed. **See:** a real `feed` transaction; the belly, Treasury and Burned numbers update from chain. Sign-in adds a limited key for this contract, so feeding / poking / faucet don't pop the wallet every time.
- If the Totem is dead on-chain, only the tribe's DAO can hatch it (`scripts/dao-propose.sh hatch`); the app says so.
- **🧪 Practice** mode (top-right switch) runs the same rules locally in the browser (`web/src/engine.ts`) with no wallet; the app also falls back to it if testnet RPC is unreachable.

Wallet connection uses NEAR Connect (`@hot-labs/near-connect`) because the NEAR docs mark NEAR Wallet Selector as deprecated.

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
- `the_totem_is_a_live_nft_owned_by_the_dao`, `death_turns_the_totem_into_a_gravestone_and_hatch_mints_the_next` — the Totem is a NEP-171 token owned by the DAO; at death the same token becomes a gravestone with the life record; hatch mints the next Totem and Founder Badges.
- `badges_are_soulbound_nfts`, `rescuing_a_rampage_mints_a_hero_badge` — badges are real NFTs and `nft_transfer` on one panics.
- `transferring_the_totem_moves_governance_with_it`, `non_owners_cannot_govern` — whoever owns the Totem NFT governs it; the Reserve follows the token.
- `evolution_defaults_to_golem_after_the_deadline`, `blessings_pay_at_l3_and_stay_claimable_after_death`, `no_blessing_when_a_period_closes_below_l3`.
- `an_expired_blessing_cannot_be_claimed_and_claimable_lists_the_rest` — once an unclaimed Blessing returns to the Reserve, claiming it fails; `get_claimable` lists exactly what pays.
- `the_reserve_lives_in_a_keyless_treasury_sub_account`, `a_reserve_held_by_the_contract_migrates_into_the_treasury_on_first_touch` — treasury balance = Reserve through feed, bite, death and hatch; transfers into the treasury or the contract are refused. Every test that checks supply also checks: treasury = Reserve, contract = Blessings + stakes.
- `the_hoard_counts_only_the_living_totem_never_released_stakes`, `the_demo_faucet_logs_a_standard_mint`.
- `selling_the_totem_mid_payout_moves_no_money_to_the_seller` — the NFT sold with a Blessing reserved and the next period running: every pot is untouched, seller and buyer can't claim, the caretaker is paid in full, and the running period pays its caretakers.
- The moon: `the_reference_new_moon_is_dark_and_half_a_month_later_is_full`, `november_2026_new_moon_on_the_10th_full_moon_on_the_24th`, `bhaskara_stays_close_to_the_true_curve` (moon maths); `a_new_moon_leaves_the_rules_as_they_are`, `a_full_moon_burns_more_and_empties_the_belly_faster` (70% burn, ×1.5 hunger), `the_settled_belly_drains_by_the_same_moon_the_view_predicts`, `feeding_under_a_full_moon_mints_one_soulbound_moonlit_badge_per_cycle`, `a_new_moon_feed_earns_no_moonlit_badge`.
- Raksha's prediction market: `predict_*` (6 tests).

The sandbox tests (`contract/tests/sandbox.rs`, near-workspaces) run the compiled wasm on a local node:

- `a_whole_life_on_a_real_node` — init creates the treasury as a real account with **no access keys and 0 NEAR**; the faucet logs `ft_mint`; a feed lands half in the treasury; transfers into the treasury or the contract fail; a non-owner can't rename; real block time starves it to death (the unshielded staker is slashed, the treasury is burned, the NFT becomes a gravestone); only the DAO can hatch, and generation 2 gets a new keyless treasury; the staker withdraws exactly the released stake.
- `the_ledger_always_adds_up` — total supply = every holder + contract + treasury; treasury = Reserve; contract = Blessings + stakes; supply = 1B + faucet − burned.

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
| NEP-171 NFTs: dynamic Totem → gravestone, soulbound Bronze/Silver/Gold, Hero, Founder badges | done, tested |
| near-workspaces integration tests (sandbox: a whole life, keyless treasury account, ledger reconciliation) | done, 2 tests |
| Treasury sub-account per Totem (keyless, zero-balance) | done, tested; live: [`totem-7.totem-baobao.testnet`](https://testnet.nearblocks.io/address/totem-7.totem-baobao.testnet) |
| Testnet deploy (demo mode, 2-minute day) | done: [`totem-baobao.testnet`](https://testnet.nearblocks.io/address/totem-baobao.testnet), with the moon, welcome-back and prediction markets (the first 77 lives ran on the earlier [`totem-grumbo.testnet`](https://testnet.nearblocks.io/address/totem-grumbo.testnet), kept as an archive) |
| Sputnik DAO owns the Totem; rename / evolve / hatch via proposals | done: hatch of Generation 2 executed by a DAO vote ([tx](https://testnet.nearblocks.io/txns/BWnntErjehHtN6yF9x5cZJkQ8H8a94v43YnMGQxnX2YC)) |
| Keepers: a DAO role for accounts with ≥ 1,000 staked or a Silver/Gold badge; they govern the Totem on their own | done: a Keeper alone voted the rename to "Mochi" (proposal 2); later the Keepers named it **BaoBao** (proposal 16) |
| Demo script | pending |
| Web app: 3D farm, panda, feeding, bites/levels on the totem pole, death, lineage graveyard | done (local rule mirror) |
| Web app: live testnet state, NEAR Connect wallet, feed / poke / faucet transactions, practice-mode fallback | done (wallet signing needs a manual test) |
| Web app: staking (stake / unstake / withdraw, shield status + one-tap shield, unbonding countdown), claim Blessings and badges | done |
| Web app: 🧾 on-chain history (every mint/burn/bite/life, tx links) and gravestone life stories | done |
| Telegram bot: tribe alarms, personal watches, `/status`, `/ask` | done ([`web/bot/bot.ts`](web/bot/bot.ts)) |

## On testnet

| What | Account |
|---|---|
| TOTEM contract (token + game + NFTs), demo mode: 1 Totem-day = 120 s | [`totem-baobao.testnet`](https://testnet.nearblocks.io/address/totem-baobao.testnet) |
| Tribe DAO (Sputnik v2, owns the Totem NFT and gravestones) | [`totem-tribe.sputnik-v2.testnet`](https://testnet.nearblocks.io/address/totem-tribe.sputnik-v2.testnet) |
| Genesis holder (founder; no DAO vote since the constitution) | [`totem-grumbo-tribe.testnet`](https://testnet.nearblocks.io/address/totem-grumbo-tribe.testnet) |
| The living Totem's treasury (keyless; its balance is the Reserve) | [`totem-7.totem-baobao.testnet`](https://testnet.nearblocks.io/address/totem-7.totem-baobao.testnet) |
| A Keeper (1,000 $TOTEM staked) | [`totem-grumbo-keeper.testnet`](https://testnet.nearblocks.io/address/totem-grumbo-keeper.testnet) |
| Gas relayer for free guests (NEP-366); guests are its zero-balance sub-accounts `g<hex>.totem-grumbo-relay.testnet` | [`totem-grumbo-relay.testnet`](https://testnet.nearblocks.io/address/totem-grumbo-relay.testnet) |

Read the live state (no wallet needed):

```bash
near contract call-function as-read-only totem-baobao.testnet get_totem json-args '{}' network-config testnet now
near contract call-function as-read-only totem-baobao.testnet get_config json-args '{}' network-config testnet now
```

Govern it through the DAO (creates a proposal, then the Keepers whose keys are on this machine vote it through):

```bash
scripts/dao-propose.sh rename BaoBao
scripts/dao-propose.sh evolve dragon   # only between Level 4 and the deadline
scripts/dao-propose.sh hatch           # after a death

# Sync the Keepers role with on-chain reputation (>= 1,000 staked or a Silver/Gold badge)
scripts/keepers-sync.sh some-staker.testnet another.testnet
```

Redeploy or deploy your own copy: `cp .env.example .env`, set the accounts, run [`scripts/deploy.sh`](scripts/deploy.sh). On the 2-minute demo clock an unfed newborn starves in about 2.5 minutes; the Totem owner can then `hatch`.

Nothing is deployed to mainnet; the prize payout account is created by the team, not by any tool.

## License

MIT — see [`LICENSE`](LICENSE).
