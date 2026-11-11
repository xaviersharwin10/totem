# TOTEM: Project Brief

> **A creature the whole community shares, which dies if they ignore it.**
> Feed it and it grows and pays its caretakers. Neglect it and it starts eating the community's treasury.

This file is the single starting point for the project. It is written for teammates **and** for an AI coding agent. If you are an agent, read it in full, then read [`HACKATHON.md`](HACKATHON.md) in full, before writing any code. Section 14 has your operating rules.

**What is built and what is left:** see [`STATUS.md`](STATUS.md). Read it before picking up work, and keep it current.

---

## Contents

1. [The hackathon in brief](#1-the-hackathon-in-brief)
2. [Why TOTEM, and which tracks](#2-why-totem-and-which-tracks)
3. [The idea in plain words](#3-the-idea-in-plain-words)
4. [A story of how it plays out](#4-a-story-of-how-it-plays-out)
5. [Game rules (exact mechanics)](#5-game-rules-exact-mechanics)
6. [Starting parameters](#6-starting-parameters)
7. [Architecture](#7-architecture)
8. [Smart contract specification](#8-smart-contract-specification)
9. [Sputnik DAO integration](#9-sputnik-dao-integration)
10. [Web app](#10-web-app)
11. [Telegram bot](#11-telegram-bot)
12. [Demo mode, tests and simulation](#12-demo-mode-tests-and-simulation)
13. [The README that judges will read](#13-the-readme-that-judges-will-read)
14. [Rules for the coding agent](#14-rules-for-the-coding-agent)
15. [Repository layout](#15-repository-layout)
16. [Timeline to the deadline](#16-timeline-to-the-deadline)
17. [Stretch goals](#17-stretch-goals)
18. [Prior art and how we differ](#18-prior-art-and-how-we-differ)
19. [Risks and open questions](#19-risks-and-open-questions)
20. [Demo video and X post](#20-demo-video-and-x-post)
21. [Submission checklist](#21-submission-checklist)

---

## 1. The hackathon in brief

| Item | Value |
|---|---|
| Event | NEAR HACKATHON, online. Site: https://nearhackathon.com. Rules: [`HACKATHON.md`](HACKATHON.md) (live copy at https://nearhackathon.com/HACKATHON.md) |
| Deadline | **2026-11-14 23:59 UTC.** The repo must be public by then, and the demo post and submission must be done |
| Judging | Nov 16–18. Results by Nov 18, 23:59 UTC |
| Prizes | $250K paid in NEAR. One $55K grand prize, plus **$10K / $3K / $2K for the top 3 in each of 13 tracks** |
| Multiple tracks | One project may enter every track it fits. We enter **3** |
| Judges | **Claude Code and Codex screen first:** they check reproducibility, verify that features work and give a preliminary score. Then humans decide: Illia Polosukhin (NEAR), Eddy Lazzarin (a16z), Mert Mumtaz (Helius), Avichal Garg (Electric Capital), Kain Warwick (Synthetix), Haseeb Qureshi (Dragonfly), Stepan Gershuni (cyber.Fund) |
| Past criteria | Technical implementation, design, impact, originality, sustainability |
| Testnet OK? | **Yes.** "Testnet-only projects eligible? Yes, all tracks" (Q-010). "Own contract on NEAR that fits the track is enough" (Q-011) |
| Submission needs | A public GitHub repo with a LICENSE, a public X post with a **video**, and the form or API submission. One attempt only |
| Prize payout | To a **mainnet** NEAR account that the team creates itself |

Useful links:
- NEAR docs: https://docs.near.org/ (index for agents: https://docs.near.org/llms.txt)
- NEAR agent skills: `npx skills add near/agent-skills` (near-smart-contracts, near-api-js, near-dapp, near-kit, near-intents, near-ai-cloud)
- Sputnik DAO: https://github.com/near-daos/sputnik-dao-contract
- Trezu: https://github.com/NEAR-DevHub/trezu-docs
- NEP-141 (fungible token): https://github.com/near/NEPs/blob/master/neps/nep-0141.md
- NEP-171 (NFT): https://github.com/near/NEPs/blob/master/neps/nep-0171.md
- NEP-297 (event logs): https://github.com/near/NEPs/blob/master/neps/nep-0297.md
- meme.cooking (the hackathon's memecoin launchpad partner): https://docs.meme.cooking/
- Testnet faucet: near-cli or https://near-faucet.io
- Help: NEAR Discord https://discord.gg/nearprotocol and the Telegram builders chat https://t.me/nearbuilderschat

---

## 2. Why TOTEM, and which tracks

### Competition snapshot (public project directory, Nov 10: 414 projects)

| Track | Entries | Note |
|---|---|---|
| **memecoins** | **23** | The fewest of any track. Our main target |
| games | 30 | |
| **nfts** | **31** | Second target |
| thesis | 34 | |
| swarms | 36 | |
| **social** | **37** | Third target. Growing fast |
| defi, business, privacy, open, realworld | 69–89 | |
| agents / security | 194 / 201 | Saturated with agent "spending firewall" projects. Avoid |

The counts come from `GET https://nearhackathon.com/api/projects?page=N&track=ID`. Re-check before submitting.

### Target tracks

| Track id | What the track asks for (organizers' words) | How TOTEM delivers |
|---|---|---|
| `memecoins` | "Memecoins where the meme does something: supply that reacts to the community, treasuries with rules, onchain rituals and challenges. Judged on the mechanic, not the chart." The sample prompt also wants the mechanic in the contract, no admin key that can change the parameters, and fake-account (sybil) resistance | Feeding is a daily ritual, feeding burns supply, the treasury has hard rules, and every parameter is fixed at launch with no admin key. Fake accounts gain nothing, because points come only from tokens actually spent |
| `nfts` | "NFTs as accounts: assets that own money, earn royalties, hold inventory, carry credentials, memberships or access rights. Ownership with behavior." Hints: dynamic NFTs, NEP-171 | The Totem is a **living NFT that owns the treasury (the Reserve)**. Its state, art and level change over time. When it dies it becomes a **gravestone in an onchain lineage**, and the next egg inherits traits. Caretaker and Founder Badges are credential NFTs |
| `social` | "Shared budgets, programmable rewards, collective ownership and reputation-based access on top of Sputnik DAO and Trezu. Don't rebuild the multisig — build what communities do with it." | The Totem is **owned by the tribe's Sputnik DAO**, where **Keepers** (big stakers and proven caretakers) vote on its name, evolution and rebirth. Blessings are programmable rewards for caretaking. Stakers who freeload get slashed, which makes collective responsibility enforceable. Badges are reputation that gates access |

**We do not enter `games`.** That track is judged on a fast gameplay loop and wants NPCs and NEP-245 items. TOTEM's loop is measured in hours, so we'd score poorly there.

---

## 3. The idea in plain words

- **There is exactly one Totem**, a chubby panda that lives on a little farm (and on NEAR). It belongs to the whole community (the "tribe"), not to any one person.
- **It is always getting hungrier.** Its hunger bar drains around the clock.
- **The only food is $TOTEM coins.** Feeding it means giving it $TOTEM.
  - Half of every meal is **burned**, so supply shrinks the more the Totem is loved.
  - The other half goes into the **Hoard**, the tribe treasury. Its Totem-owned part is the **Reserve**, and stakers can add their own stakes on top (5.12).
- **If the bar hits zero, the Totem goes into Rampage.** Every 6 hours it takes a **bite**:
  - It burns 15% of the Hoard.
  - It **slashes the stake of every staker who hasn't fed it recently.**
  - It **drops one level.**
  - **At Level 0 it dies.** A big, well-raised Totem survives several bites, while a newborn dies at the first one.
- **A well-fed Totem grows.** It levels up, evolves, mints badges for its caretakers and, from Level 3, pays weekly **Blessings** from the Hoard to the people who fed it.
- **Holders can stake $TOTEM into the Totem's belly.** Stakers earn more from Blessings and become the tribe's voting Keepers. Their stake is at risk if the Totem starves while they weren't feeding it, so **freeloaders take the hit and recent feeders are shielded.**
- **Death is a story beat, not a game over.** A dead Totem becomes a **gravestone NFT** in a growing **lineage**. The next egg inherits cosmetic traits from the previous generation's top feeders: "Grumbo III, child of Grumbo II, who starved on day 23."
- **The tribe's Sputnik DAO owns the Totem.** The DAO can name it, choose its evolution and hatch the next generation. It **cannot** touch the Hoard or change any rule.

The core tension is the tragedy of the commons (everyone hopes someone else pays for the shared thing): *"Someone needs to feed it… but will it be me?"* Caretakers earn rewards, freeloaders earn nothing (and staked freeloaders lose), and total neglect hurts everyone.

---

## 4. A story of how it plays out

- **Day 1.** The Totem hatches at Level 1 and 100% full.
- **Day 1, evening.** It's at 70%. Priya feeds it and earns Caretaker Points.
- **Day 2, 3 a.m.** It's at 25%, which is Starving. The bot posts: "⚠️ TOTEM IS STARVING (25%). In 6h it starts eating the Hoard."
- **Day 2, 4 a.m.** Arjun does a **rescue feed** and gets **2× points**.
- **Days 3–5.** It stays Happy and reaches **Level 3**, which unlocks weekly Blessings.
- **Day 6.** The weekend: nobody pays attention, the bar hits 0% and **Rampage** begins. Six hours later comes the first **bite**:
  - 15% of the Hoard burns.
  - The Totem drops to **Level 2**.
  - Kiran, a big staker who hadn't fed it all week, loses 15% of his stake. Priya fed it yesterday, so her stake is shielded.
- **Day 6, later.** Kiran and two others rush to feed it, and the Rampage stops. The tribe has learned its lesson.
- **Day 9.** It's back to **Level 4**, and the tribe's Keepers vote in the DAO: **Dragon** (eats much more, blesses much more) or **Golem** (eats less, blesses less).
- **If it's abandoned,** each bite drops another level, and at **Level 0 it dies.**
  - It becomes a gravestone NFT: "Grumbo I, Generation 1, lived 23 days, reached Level 4, starved."
  - Stakers withdraw what's left of their stake.
  - The DAO hatches **Grumbo II**, whose colours and markings are inherited from Grumbo I's top three feeders.

---

## 5. Game rules (exact mechanics)

Every rule below is enforced **in the contract**. No backend is needed for correctness. The web app and bot only read state and help users sign.

### 5.1 Time model (lazy evaluation)
- NEAR contracts can't run on a timer. The state is **settled lazily**: every mutating call first calls an internal `settle(now)`, which advances hunger, XP, Rampage bites and death from `last_settled_at` up to `now` (using `env::block_timestamp()`).
- View methods compute the *projected* state at the current time without writing, so the UI is always accurate.
- `day_length_sec` is fixed at init: 86,400 in production, 120 for the demo deployment. Every duration below is expressed in **Totem days**.

### 5.2 Fullness and mood
- `fullness` runs from 0 to 10,000 (basis points; 10,000 = 100%).
- It drains linearly from 100% to 0% over **1 Totem day**, at every level. (Higher levels make meals more expensive instead; see 5.3.)
- Moods are derived from fullness:

| Mood | Fullness | Effect |
|---|---|---|
| 😊 Happy | ≥ 70% | Earns XP |
| 😐 Hungry | 30% to < 70% | Nothing |
| 😰 Starving | > 0% to < 30% | Feeds earn the 2× rescue bonus. The bot warns everyone |
| 🔥 Rampage | 0% | It bites every 6 hours (5.8) |
| 💀 Dead | A bite takes it to Level 0 | Final for this generation. It becomes a gravestone and the next egg can hatch (5.13) |

### 5.3 Feeding
- `feed(amount)` takes `amount` $TOTEM from the caller.
- **Meal size** is the number of tokens needed to go from 0% to 100%: `meal_size(level, form) = BASE_MEAL × 1.5^(level-1) × form_appetite`.
- Fullness gained is `amount / meal_size × 10,000`, capped at 10,000. **Any excess is not taken.** The contract only debits what fits.
- The accepted amount is split **50% burned** (total supply goes down) and **50% added to the Reserve** (the Totem-owned part of the Hoard).
- **Caretaker Points:** 1 point per whole token accepted, **×2 if fullness was below 30% at the moment of feeding** (rescue bonus), and **×1.5 if the feeder currently has at least `min_stake` staked** (staker bonus). The two multipliers stack.
- A feed of at least `shield_min_feed` also **shields the feeder's stake** from bites for `shield_window` (5.12).
- Feeding during Rampage ends the Rampage immediately. Bites already taken (levels lost, stake slashed) are not undone.
- Feeding a dead Totem is rejected.

### 5.4 XP and levels
- XP is **seconds spent Happy**, measured in Totem days. `settle` computes exactly how long fullness stayed at or above 70% during the elapsed interval.
- Level thresholds, in cumulative Happy days: **L2 at 1, L3 at 3, L4 at 6, L5 at 10**, then **+5 per level** after that.
- Level-up effects:
  - **L2:** Caretaker Badges become claimable (see 5.7).
  - **L3:** Blessings start (see 5.6).
  - **L4:** Evolution choice (see 5.5).
  - **L5 and up:** new art, and the Blessing rate rises by +1 percentage point per level, capped at +5.
- **Levels can go down.** Each Rampage bite removes one level, and XP is set to the floor of the new level (progress toward the next level is lost). Perks follow the current level: below L3, no new Blessing period closes with a payout, though already-reserved Blessings stay claimable. The evolved form is kept if the Totem drops below L4.
- A hatched egg starts at **Level 1**, so a newborn dies at its first bite. Raising it is what makes it resilient.

### 5.5 Evolution (at Level 4)
- The **owner of the Totem NFT** (the tribe's Sputnik DAO) calls `choose_evolution("dragon" | "golem")` within **1 Totem day** of reaching L4. If it doesn't, the form defaults to **Golem**.

| Form | Appetite multiplier | Base Blessing rate |
|---|---|---|
| Egg-creature (L1–L3, before evolution) | ×1.0 | 5% |
| 🐉 Dragon | ×1.5 | 8% |
| 🗿 Golem | ×0.8 | 3% |

### 5.6 Blessings (Level 3 and up)
- Time is split into **Blessing periods of 7 Totem days**, starting from the moment the Totem reached L3.
- When a period ends (the next `settle` after its end), the contract reserves **rate × Reserve** (the Totem-owned part of the Hoard; stakes are never paid out as Blessings) for that period and records the period's total points.
- Each account claims its share with `claim_blessing(period_id)`: `reserved × your_points_in_period / total_points_in_period`. Claims are **pull-based**, so the contract never loops over users.
- Points used for Blessings are the points earned **within that period**. Lifetime points are tracked separately for badges.
- **Unclaimed Blessings return to the Hoard 2 periods later.**
- A period with zero points reserves nothing.

### 5.7 Caretaker Badges (credential NFTs, soulbound)
- **Bronze / Silver / Gold** at 100 / 1,000 / 10,000 lifetime points, claimable with `claim_badge()` once the Totem has reached L2.
- **Hero Badge:** automatically minted to the account whose feed ended a Rampage.
- **Founder Badge:** minted at `hatch()` to the previous generation's top 3 feeders (5.13).
- Badges are **non-transferable**: `nft_transfer` on a badge panics. They are reputation, usable for gated access (see 9.3).

### 5.8 Rampage, bites and death
- While fullness is 0, the Totem takes a **bite** every `bite_interval` (**1/4 Totem day**, so 6 hours in production), counted from the moment fullness reached 0. Each bite applies these steps in order:
  1. **Burns `bite_burn` (15%) of the Reserve** (the Totem-owned part of the Hoard; see 5.12).
  2. **Slashes `stake_slash` (15%) of every *unshielded* stake.** The slashed tokens go **into the Reserve**, so freeloading stakers refill the treasury they let shrink.
  3. **Drops the Totem one level** and sets XP to the new level's floor.
  4. **If the level is now 0, the Totem dies** (see below).
- `settle` applies all bites that fell due since the last settle, in time order, interleaved with stake-shield expiries (5.12). The number of bites per generation is bounded by the maximum level reached, so this is bounded gas.
- **Poke tip:** `poke()` is a public method that just runs `settle`. If it applies at least one bite, the caller receives **`poke_tip` (1%) of the Reserve burned by those bites** instead of that 1% being burned. This gives anyone an incentive to keep the state current. All other methods also settle, with no tip.
- **Death** (a bite takes the level to 0):
  - The remaining Reserve is burned.
  - **Stakes are released.** Every staker can withdraw their remaining (post-slash) stake immediately, with no unbonding delay.
  - The Totem token is converted to a **gravestone** NFT (see 5.13).
  - Unclaimed Blessing reservations remain claimable.
- After a death, the owner of the gravestone (the DAO) can call `hatch()` to mint the next generation's egg (5.13).

### 5.9 What no one can do
- There is **no admin key and no owner override.** All parameters are fixed at `new()` and exposed through `get_config()`.
- No one can withdraw the Reserve except through Blessings and the poke tip. Stakers can withdraw only their own stake, after unbonding (or immediately after a death).
- The DAO's powers are limited to: `rename`, `choose_evolution`, `hatch`, and transferring the Totem NFT (the Reserve moves with it, because it's attributed to the token; stakes stay owned by their stakers).

### 5.10 Getting $TOTEM
- **Fixed supply** of 1,000,000,000 $TOTEM is minted at `new()` to a `genesis_account` set at init.
- **Demo deployments only** (`demo_mode = true`, fixed at init): `faucet()` gives 1,000 $TOTEM per account per Totem day, minted from a pre-allocated faucet pool.
- **Mainnet path:** described in the README as a future fair launch, for example via meme.cooking. **Do not deploy to mainnet for this hackathon.**

### 5.11 Why fake accounts don't help
Points, badges and Blessings are proportional to tokens spent, and half of those are burned. Splitting 100 tokens across 100 accounts earns exactly what one account would earn with 100 tokens. The staker bonus and shield need a minimum stake and a minimum feed per account, so splitting across accounts only adds requirements. The README must say this plainly.

### 5.12 Staking into the belly
The **Hoard** shown in the UI is two parts:

| Part | Owned by | Filled by | Lost by |
|---|---|---|---|
| **Reserve** | The Totem NFT (and through it, the tribe's DAO) | 50% of every feed, plus slashed stake | Bites (burn), Blessings (paid out), the poke tip, death (burn) |
| **Stakes** | Each staker individually | `stake()` | Slashes during bites, unless the staker is shielded |

- **Why stake:**
  1. **The staker bonus:** feed points ×1.5 while staked ≥ `min_stake`, so a bigger share of Blessings.
  2. **Keeper status:** stakers with ≥ `keeper_stake` can be added to the DAO's **Keepers** role and vote on name, evolution and hatching (9.3).
  3. **Bragging rights:** a bigger visible "belly."
- **The risk:** when the Totem bites, every *unshielded* stake loses `stake_slash`. Being a staker means having skin in the game. You can't hold a stake and ignore the Totem.
- **Shield:** a feed of at least `shield_min_feed` (10 $TOTEM) shields **all of that feeder's stake** from every bite during the next `shield_window` (1 Totem day). Each new qualifying feed extends the shield to `now + shield_window`.
- **Unstaking:** `unstake(amount)` starts an `unbond_delay` (1.5 Totem days, longer than one full hunger cycle). The unbonding amount **can still be slashed** if unshielded, so nobody can dodge a bite by exiting at the last moment. After the delay, `withdraw()` returns it. After a death, all stakes (including unbonding) are withdrawable at once.
- **Staking is optional.** Feeding alone still earns points, badges and Blessings.

**Accounting (bounded gas, no loops over stakers).** This is the trickiest part of the contract:
- A global **unshielded index** `U` starts at 1.0 each generation and is multiplied by `(1 - stake_slash)` at every bite.
- Each bite is recorded in a per-generation list `bites: Vec<{at, u_after}>`. Its length is at most the max level reached.
- **Aggregates:**
  - `unshielded_scaled` is the sum of `stake / U` over unshielded stakes.
  - `shield_expiry_buckets: TreeMap<expiry_bucket, amount>` holds shielded stake keyed by expiry time, rounded up to `bucket_len` (1/24 day).
- `settle` processes events in time order:
  - When a bucket's expiry passes, its amount moves into `unshielded_scaled` (divided by the current `U`).
  - When a bite falls due, the slash equals `unshielded_scaled × U × stake_slash`. That amount moves to the Reserve, then `U` is updated.
- **Per staker:** store `principal`, `u_checkpoint` and `shield_until`.
  - **Current value:** `principal × U_now / U_at(max(checkpoint_time, shield_until))`, where `U_at(t)` is read from the `bites` list (the index after the last bite at or before `t`).
  - **Checkpointing:** a staker is checkpointed (principal rewritten to the current value) on every stake, unstake, withdraw or feed. Their bucket entry is moved when the shield is extended.

**Fallback (in the cut order, section 16):** if the shield accounting isn't fully tested by end of Nov 12, ship the simpler version and list per-staker shields as future work. In the simpler version, bites slash *all* stakes pro rata with a single index and no shields.

### 5.13 Generations and lineage
- Every Totem has a `generation` (1, 2, 3…) and a **lineage name**, for example "Grumbo II". The DAO sets the base name with `rename`, and the numeral is the generation.
- **Gravestone NFT (on death):** the living Totem token is converted in place to a gravestone with frozen metadata:
  - Name, generation, born, died, lifespan, max level, form and cause of death ("starved at Level 0").
  - Total fed, total burned and Blessings paid.
  - The **top 3 feeders** of that generation and the **traits** it carried.
- **Inherited traits (cosmetic only):** at `hatch()`, the new egg's traits are derived deterministically from `sha256(top-3 feeder account ids of the previous generation ‖ generation number)`:
  - `palette` (8 options), `pattern` (6), `marking` (6) and `crest` (4).
  - Generation 1 derives them from the genesis account and the DAO account.
  - The web app renders the panda's colours from these traits (patch colour, scarf colour).
- **Founders:** the new egg's metadata lists the previous generation's top 3 feeders as its **Founders**, and they each receive a soulbound **Founder Badge** for that generation.
- **No gameplay inheritance.** Traits and founders never change meal size, drain, Blessings or anything economic. If death gave advantages to the next generation, players would have a reason to let the Totem die.
- `get_lineage()` returns the full family tree: every gravestone plus the living Totem, with parent links.

---

## 6. Starting parameters

These are **starting values**. Tune them with the 60-day simulation (12.3) before the final deploy. All values are immutable after `new()`.

| Parameter | Start value | Note |
|---|---|---|
| `day_length_sec` | 86,400 (prod), **120 (demo)** | |
| `base_meal` | 100 $TOTEM | Tokens to fill an L1 Totem from 0 to 100% |
| `appetite_growth` | 1.5× per level | |
| `burn_share` | 50% | The rest goes to the Hoard |
| `happy_threshold` / `starving_threshold` | 70% / 30% | |
| `rescue_multiplier` | 2× | |
| `level_thresholds` | 1, 3, 6, 10, then +5 (Happy days) | |
| `bite_interval` | 1/4 day (6h in prod, 30s in demo) | |
| `bite_burn` | 15% of the Reserve per bite | |
| `stake_slash` | 15% of each unshielded stake per bite, into the Reserve | |
| `level_loss_per_bite` | 1 | Death at Level 0. A newborn (L1) dies at its first bite |
| `poke_tip` | 1% of the Reserve burned by the bites applied | |
| `min_stake` | 100 $TOTEM | For the ×1.5 staker point bonus |
| `staker_points_multiplier` | 1.5× | Stacks with the rescue 2× |
| `keeper_stake` | 1,000 $TOTEM | Eligibility for the DAO Keepers role |
| `shield_min_feed` | 10 $TOTEM | |
| `shield_window` | 1 day | |
| `unbond_delay` | 1.5 days | Longer than one full hunger cycle |
| `bucket_len` | 1/24 day | Granularity of shield expiries |
| `traits` | palette 8, pattern 6, marking 6, crest 4 | Cosmetic only |
| `blessing_period` | 7 days | |
| `blessing_rate` | 5% (egg), 8% (Dragon), 3% (Golem), +1 pt per level from L5, max +5 | |
| `unclaimed_return_after` | 2 periods | |
| `evolution_deadline` | 1 day after L4, else Golem | |
| `badge_thresholds` | 100 / 1,000 / 10,000 lifetime points | |
| `total_supply` | 1,000,000,000 | |
| `faucet_amount` | 1,000 per account per day (demo only) | |

---

## 7. Architecture

```
                 ┌────────────────────────────────────────────┐
  Players ──▶   │  Web app (Vite + React, NEAR wallet selector)│ ◀── reads views, signs feed/claim
                 └──────────────┬─────────────────────────────┘
                                │ near-api-js / near-kit (testnet RPC)
  Telegram ──▶  Bot (Node)  ────┤ reads views + NEP-297 events, posts alerts,
                                │ buttons deep-link into the web app
                                ▼
                 ┌────────────────────────────────────────────┐
                 │  totem.<dev>.testnet  (one Rust contract)    │
                 │  • NEP-141 $TOTEM (+ NEP-145 storage)        │
                 │  • NEP-171 NFTs: Totem, gravestones, badges  │
                 │  • game state: fullness, XP, Hoard, points,  │
                 │    Blessings, Rampage, death                 │
                 └──────────────▲─────────────────────────────┘
                                │ FunctionCall proposals (rename,
                                │ choose_evolution, hatch)
                 ┌──────────────┴─────────────────────────────┐
                 │  tribe.<sputnik-factory>.testnet (Sputnik DAO)│  owns the Totem NFT
                 └────────────────────────────────────────────┘
```

**Decision: one contract.** The token, the NFTs and the game live in one contract:
- Feeding is an internal debit plus a real burn, with no cross-contract calls and no `ft_transfer_call` callbacks.
- That means one deploy and fewer failure modes.
- `ft_*` and `nft_*` method names don't collide.
- Use `near-contract-standards` for both standards.

The README should note that a mainnet version launched through a third-party launchpad would split into token and game contracts, with feeding through `ft_transfer_call`. Burning on someone else's token contract depends on that token's API, so it would need checking first.

**Network:** testnet only. **Language:** Rust, `near-sdk` (latest stable 5.x; check the docs for the current version), built with `cargo-near`. **Tests:** `near-workspaces` sandbox, which supports fast-forwarding blocks.

---

## 8. Smart contract specification

### 8.1 State (sketch)
```rust
pub struct Contract {
    // standards
    token: FungibleToken,                 // $TOTEM
    nfts: NonFungibleToken,               // Totem, gravestones, badges
    // config (immutable after new)
    cfg: Config,
    // current totem
    totem_id: TokenId,                    // e.g. "totem-1"
    generation: u32,
    name: String,
    born_at: u64,
    fullness_bp: u32,                     // 0..=10000 as of last_settled_at
    last_settled_at: u64,                 // ns
    happy_days_xp: u64,                   // seconds Happy, scaled
    level: u32,
    form: Form,                           // Egg | Dragon | Golem
    l4_reached_at: Option<u64>,
    rampage_started_at: Option<u64>,
    bites: Vector<Bite>,                  // this generation: {at, u_after}; len <= max level
    alive: bool,
    traits: Traits,                       // palette, pattern, marking, crest (cosmetic)
    founders: Vec<AccountId>,             // previous generation's top 3
    reserve: Balance,                     // Totem-owned part of the Hoard
    total_burned: Balance,
    // staking (5.12)
    stakes: LookupMap<AccountId, Stake>,  // {principal, u_checkpoint, shield_until, unbonding, unbond_at}
    u_index: u128,                        // fixed-point unshielded index, resets per generation
    unshielded_scaled: u128,
    shield_expiry_buckets: TreeMap<u64, Balance>,
    total_staked: Balance,
    // lineage (5.13)
    gravestones: Vector<TokenId>,
    gen_top_feeders: Vec<(AccountId, u128)>, // top-3 cache for the current generation
    // points & rewards
    lifetime_points: LookupMap<AccountId, u128>,
    period_points: LookupMap<(u64, AccountId), u128>,
    periods: Vector<Period>,              // {start, end, total_points, reserved, claimed, closed}
    blessing_epoch_start: Option<u64>,
    badges_claimed: LookupMap<AccountId, BadgeTier>,
    // demo
    faucet_last: LookupMap<AccountId, u64>,
}
```

### 8.2 Change methods

| Method | Who | Does |
|---|---|---|
| `new(cfg, genesis_account, dao_account, demo_mode)` | deployer, once | Mints supply and the faucet pool, mints the Totem NFT to `dao_account` and fixes all config |
| `feed(amount: U128)` | any holder | Settles, takes what fits, burns 50%, adds 50% to the Reserve, awards points (rescue and staker bonuses), extends the caller's stake shield if ≥ `shield_min_feed`, ends any Rampage, emits `feed` |
| `stake(amount: U128)` | any holder | Settles, checkpoints the caller, moves tokens into their stake |
| `unstake(amount: U128)` | stakers | Settles, starts `unbond_delay`. The amount stays slashable until withdrawn |
| `withdraw()` | stakers | Settles, pays out matured unbonding (or the whole stake if the Totem is dead) |
| `poke()` | anyone | Settles, and pays the poke tip if bites were applied |
| `claim_blessing(period_id: u64)` | any account with points in that period | Transfers its share from the reserved amount |
| `claim_badge()` | any account | Mints the highest Bronze/Silver/Gold tier earned and not yet claimed (requires level ≥ 2 reached) |
| `rename(name: String)` | **Totem NFT owner only** (the DAO) | Sets the name (≤ 32 chars) |
| `choose_evolution(form: String)` | **Totem NFT owner only** | Only between L4 and the evolution deadline |
| `hatch()` | **Gravestone owner only**, Totem dead | Mints the next generation's egg to the caller, with inherited traits and Founder Badges (5.13) |
| `faucet()` | anyone, **demo_mode only** | Registers storage if needed and sends `faucet_amount` once per day |
| NEP-141 / NEP-145 / NEP-171 standard methods | — | `nft_transfer` on badges panics (soulbound). The Totem NFT is transferable, and the Hoard follows `totem_id` |

### 8.3 View methods

| Method | Returns |
|---|---|
| `get_totem()` | Projected live state at `now`: name, generation, fullness %, mood, level, XP, next level, form, traits, Reserve, total staked, time until Starving / Rampage / next bite, bites left before death (= current level), alive, owner |
| `get_stake(account_id)` | Current (post-slash) stake value, shielded until, unbonding amount and maturity |
| `get_lineage()` | Every gravestone and the living Totem, with generation, parent, founders, traits and life record |
| `get_config()` | All parameters (proves there's no admin key and nothing hidden) |
| `get_caretaker(account_id)` | Lifetime points, current-period points, claimable Blessings, badge tier |
| `get_leaderboard(period_id?, limit)` | Top caretakers. Maintain a small top-N cache on write to avoid unbounded iteration |
| `get_periods(from, limit)` | Blessing periods and their status |
| `get_graveyard()` | Gravestone NFTs with their frozen life records (a flat list; `get_lineage()` gives the tree) |
| `get_stats()` | Total supply, total burned, total fed, total blessed |

### 8.4 Events (NEP-297 JSON logs, `standard: "totem"`)
`feed`, `rescue`, `level_up`, `level_down`, `evolve`, `bite` (with Reserve burned and total stake slashed), `rampage_start`, `rampage_end`, `death`, `hatch` (with traits and founders), `stake`, `unstake`, `withdraw`, `blessing_reserved`, `blessing_claimed`, `badge_minted`, `rename`. Also emit the standard `ft_burn` / `nft_mint` events. The bot and the UI history page are built from these.

### 8.5 Edge cases the tests must cover
1. A feed exactly at the moment fullness hits 0. Rampage-start ordering within `settle`.
2. A long idle gap (for example 10 days). `settle` must apply the drain, then each bite in order (burn, slash, level down), then death at Level 0, in bounded gas.
3. An overfeed: only the fitting amount is debited.
4. A rescue feed during Rampage: Hero Badge, 2× points, the Rampage ends, and levels already lost stay lost.
4a. **Staking and shields:**
   - A shielded staker loses nothing in a bite, and an unshielded one loses exactly `stake_slash`.
   - A shield expiring *between* two bites: the staker is slashed by the second bite only.
   - Many stakers with different shield expiries across a long gap: the sum of individual stake values always equals the aggregate.
4b. **Unbonding:** an unbonding stake is still slashed if unshielded, `withdraw` before maturity panics, and after a death everything is withdrawable at once.
4c. **Level loss:** a bite at L1 kills a newborn, a bite at L5 leaves L4, XP is reset to the level floor, and Blessings stop below L3 while already-reserved ones stay claimable.
4d. **Generations:** traits are deterministic from the top 3 feeders plus the generation, Founder Badges go to exactly the previous top 3, the new egg has no economic carry-over, and `get_lineage` links parent to child.
5. A Blessing period with zero points.
6. A sale or transfer of the Totem NFT mid-period. The Reserve follows the token, stakes stay with their owners, and pending Blessings are unaffected.
7. A badge transfer attempt panics.
8. Non-owner calls to `rename` / `choose_evolution` / `hatch` panic.
9. The evolution deadline passes, so the form defaults to Golem.
10. Death: the Reserve burns, stakes are released, a gravestone is created with the full life record, `hatch` works (owner only), and old unclaimed Blessings are still claimable.
11. Rounding: no dust is created or lost. At every point, burned + Reserve + Blessings paid or reserved + poke tips equals total fed + total slashed, and the sum of stakes equals total staked minus total slashed minus total withdrawn.
12. Storage deposits (NEP-145) for new accounts receiving tokens, Blessings or badges.

---

## 9. Sputnik DAO integration

### 9.1 Setup (testnet)
- Create the tribe DAO with the **Sputnik DAO v2 factory on testnet**. Look up the factory account and the current `create` arguments in the sputnik-dao-contract repo and docs. **Do not guess the address.**
- Policy for the demo: a council of the team's testnet accounts, with a 1-of-N or 2-of-N threshold for FunctionCall proposals.
- The Totem NFT is minted to the DAO account at `new()`.

### 9.2 What the DAO does (all via FunctionCall proposals to the Totem contract)
- `rename(name)`: naming the creature.
- `choose_evolution("dragon"|"golem")`: the tribe's big vote.
- `hatch()`: rebirth after a death.

Provide a script, `scripts/dao-propose.ts`, that creates each proposal and votes on it, so judges can reproduce the flow without the Sputnik UI.

### 9.3 Keepers: stake- and reputation-based access (strengthens the social track)
- The DAO policy has a **Keepers** role with vote rights on FunctionCall proposals to the Totem contract.
- **Who can join:** accounts with ≥ `keeper_stake` staked **or** a Silver-or-better Caretaker Badge. `scripts/keepers-sync.ts` reads `get_stake` and the badges and creates `AddMemberToRole` / `RemoveMemberFromRole` proposals.
- **Core vs stretch:** for the hackathon, the core is the role plus the sync script run manually in the demo. Automating it from the bot is a stretch.
- This makes staking and caretaking literally into governance power: the people with skin in the game choose the Totem's evolution and hatch the next generation.
- Trezu can be mentioned as an alternative treasury UI, but it isn't needed.

---

## 10. Web app

**Stack:** Vite + React + TypeScript, NEAR Wallet Selector (testnet) and near-api-js or near-kit. Static hosting such as Vercel or GitHub Pages. Keep it up until at least 2026-11-18, ideally 2026-11-25.

**Pages and sections:**
1. **Home: the Totem.**
   - A 3D farm island where the Totem, a chubby panda, lives and plays: it wanders, chases a ball, eats the bamboo you drop, sulks when hungry, lies down when starving, stomps around red when it rampages, and lies still with a ghost when it dies. Its look varies by mood and form (Egg wears its shell as a cap, Dragon has horns and wings, Golem a moss crown).
   - The game state lives in the world: a **totem pole** with one carved block per level (a bite knocks the top one off), a **treasure chest** whose coin pile is the Hoard, and a **graveyard** with one gravestone per past generation. Day and night follow the Totem-day.
   - A big live hunger bar with countdowns ("Starving in 3h 12m", "First bite in…", "Next bite in…"), and **"Bites until death: N"** (equal to the current level) shown as hearts.
   - Level, XP bar, Hoard (Reserve + total staked) and total burned.
   - **Feed buttons** (10, 50, or "fill it up", which computes the exact amount needed).
   - A **Poke** button, shown during Rampage, displaying the tip you'd earn.
   - The panda's colours come from the Totem's **traits**; its pose and face from mood/form.
2. **Belly (staking):** stake, unstake, withdraw. Shows your current stake value, a **shield status** ("🛡 Shielded for 14h" or "⚠️ Unshielded: feed 10 to protect your stake") and unbonding countdown.
3. **Caretakers:** the leaderboard (this period and lifetime), your points, claimable Blessings with claim buttons, and badge status with a claim button.
4. **History:** a feed of events (feeds, rescues, bites with amounts burned and slashed, level changes, evolutions, Blessings, deaths, hatches), each linking to the testnet explorer.
5. **Lineage:** the family tree. Each generation is a card with its gravestone (or the living Totem), traits, founders, lifespan, max level and cause of death.
6. **Rules:** live output of `get_config()`, rendered in plain language. It shows anyone that the rules are fixed.
7. **Faucet** (demo only): "Get 1,000 test $TOTEM."

**Art:** an original 3D panda and farm built in code with React Three Fiber (three.js) from simple primitives: no external models, textures or third-party characters. The **traits** pick the panda's patch and scarf colours, so every generation looks different. The HUD (dock, counters, toasts, rampage card) is a glassy overlay on top of the 3D scene.

**Low friction:** first-time users get a one-click faucet that also handles the storage deposit. All state is visible without connecting a wallet.

---

## 11. Telegram bot

**Stack:** Node + grammY. It polls `get_totem()` every 30–60 seconds and reads new NEP-297 events from recent blocks (via RPC or an indexer API; check the docs for the best option).

**It posts on state changes:**
- `⚠️ TOTEM IS STARVING (25%) — Level 3 Golem. Starts eating the Hoard (8,400 $TOTEM) in 5h 12m. [🍖 Feed] [📊 Status]`
- `🔥 BITE! Grumbo ate 1,260 $TOTEM from the Reserve and slashed 3,400 from 6 unshielded stakers. Down to Level 2: 2 bites until death. Next bite in 6h.`
- `🛡 Stakers: feed at least 10 $TOTEM to shield your stake from the next bite.`
- `🦸 arjun.testnet saved the Totem! +2× points, Hero Badge minted.`
- `⬆️ Level 4! The Keepers must choose: 🐉 Dragon or 🗿 Golem. Vote in the DAO.`
- `✨ Blessing #2: 1,250 $TOTEM ready for 14 caretakers. [Claim]`
- `💀 Grumbo I has died after 23 days (max Level 4). Rest in peace. Stakers can withdraw now. The Keepers may hatch Grumbo II.`
- `🥚 Grumbo II has hatched! Founders: priya.testnet, arjun.testnet, kiran.testnet. Teal, striped, with a moon crest.`

**Commands:** `/status`, `/top`, `/rules`.

**Signing:** the buttons **deep-link to the web app** with the action pre-filled, for example `?action=feed&amount=50`. The bot **never holds user keys.** A Telegram Mini App is an optional stretch.

---

## 12. Demo mode, tests and simulation

### 12.1 Contract tests (near-workspaces sandbox, with fast-forward)
Unit tests plus integration tests covering every edge case in 8.5. Use the sandbox's block fast-forward to simulate days in seconds. **These tests are the main evidence for the AI judges.** Command: `npm test` or `cargo test`, documented in the README.

### 12.2 Live testnet demo (`demo_mode = true`, `day_length_sec = 120`)
`scripts/demo.ts` runs one Totem life end to end on testnet:
1. Create 5 sub-accounts of a dev account and claim the faucet for each.
2. Feed from account 1 and print the burn/Hoard split.
3. Keep it Happy with scripted feeds until L3, about 6 minutes. Print the level-ups.
4. Accounts 3 and 5 **stake** 500 each. Account 3 feeds 10 (shielded); account 5 doesn't.
5. Stop feeding, so it goes Starving, then Rampage. Account 4 calls `poke` and gets the tip. Print the bite: Reserve burned, **account 5 slashed 15%, account 3 untouched**, level −1.
6. Account 2 rescue-feeds: print the 2× points and the Hero Badge.
7. Let a Blessing period close, then claim Blessings. Print the per-account payouts, showing the staker bonus.
8. Through the DAO scripts: sync Keepers, rename, and `choose_evolution` at L4.
9. `--death` flag (on by default in the full run): abandon the Totem and watch the bites take it to Level 0. Print the gravestone, stakers withdrawing, `hatch` of Generation 2 with inherited traits and Founder Badges, and `get_lineage`.

It must print a clear log, with every step labelled and linked to its explorer transaction. Target run time is about 15 minutes with the 120-second day (bites every 30 seconds). Also provide `--fast` for a shorter path that skips evolution and goes straight from staking to death and rebirth.

### 12.3 Balance simulation (do this first, on Day 1)
`sim/simulate.py` is an offline agent-based model of 60 days. Simulated players: loyal caretakers, opportunists who feed only on rescue, freeloaders, **stakers who feed** and **stakers who don't**, and "weekend gaps." It outputs charts of fullness, level, Reserve, total stake, total supply, Blessings and generations (deaths and rebirths) over time, under 3–4 scenarios (healthy, apathetic, whale-carried, abandoned).

**Goals:**
- The Totem should survive with modest effort and die under real neglect. A grown Totem should survive a weekend gap with some level loss.
- Blessings should return a meaningful share to active caretakers.
- **Staking and feeding should beat staking alone, which should lose money over time.** Commit the charts to `sim/out/` and reference them in the README. That's evidence the mechanic was designed, not guessed.

---

## 13. The README that judges will read

Write it from day one. Claude Code and Codex read it first, so: **no marketing, short sentences, "do X, see Y" steps.** Required sections:

1. **What it is:** two sentences.
2. **The problem:** memecoins usually have no mechanic, and community treasuries have no reason to exist. TOTEM makes caring for a shared treasury a daily ritual with real stakes.
3. **Tracks:** memecoins, nfts, social, with a one-line justification each, quoting the track wording.
4. **How NEAR is used, concretely:**
   - The NEP-141 token and NEP-171 NFTs in one contract.
   - The NFT that owns the Hoard.
   - The lazy time model.
   - Sputnik DAO ownership.
   - No admin key.
   - Testnet contract address and DAO address.
5. **Rules:** the parameter table, and a link to the `get_config()` output.
6. **Try it in 5 minutes:** numbered steps, for example:
   1. Open `<hosted url>`. You'll see the Totem and its live hunger bar.
   2. Click Faucet. You'll see 1,000 $TOTEM in your balance.
   3. Click Feed 50. You'll see fullness rise, the Hoard grow by 25 and "25 burned" in History.
   4. …
7. **Reproduce locally:** prerequisites, `npm install`, `npm test` (expected output), `npm run demo` (expected log excerpt).
8. **Why fake accounts don't help.**
9. **Limitations and honest notes:** lazy settlement, poke incentives, the testnet-only deployment, and the mainnet path.
10. **Prior art:** WAGMIGOTCHI, Tamadoge, NFTZen, and what's different (see section 18).
11. **Libraries and templates used** (Q-005).
12. **Other project disclosure,** if a teammate submits a second project (Q-015).
13. **License:** MIT, with a `LICENSE` file at the repo root.

---

## 14. Rules for the coding agent

1. **Read [`HACKATHON.md`](HACKATHON.md) in full first.** Follow its "Never without the human's explicit confirmation" list exactly:
   - Never submit the application, post on X, push, make the repo public, sign mainnet transactions or commit secrets without an explicit yes from a human.
   - For the submission, print the full JSON payload and wait.
   - Never fill the `website` field (it's a spam trap).
2. Install the NEAR agent skills: `npx skills add near/agent-skills`. Use `near-smart-contracts`, `near-api-js` / `near-kit` and `near-dapp`.
3. **Look up every contract address, endpoint and SDK version in the official docs** (https://docs.near.org/llms.txt). Never guess them, especially the Sputnik factory, RPC URLs, near-sdk and wallet-selector versions.
4. **Testnet only.** Keys go in `.env` (git-ignored). Commit a `.env.example`.
5. Build in this order and **stop for human review at each checkpoint (🛑):**
   1. `sim/simulate.py` and its charts. 🛑 The human approves the final parameters.
   2. The contract and full tests (8.5). 🛑 Review.
   3. Testnet deploy, DAO creation and `scripts/demo.ts` passing. 🛑 Review.
   4. The web app.
   5. The bot.
   6. README polish.
   7. Stretch goals, only if everything above is done.
6. Keep the README current at every step. If a feature in the README doesn't work, either fix it or remove the claim. The AI judges check this.
7. Prefer simple and correct over clever. Bounded gas everywhere: no loops over users or over elapsed time.
8. Don't add features not listed here without asking. The deadline is tight.

---

## 15. Repository layout

```
totem/
├── README.md                 # judge-facing (section 13)
├── LICENSE                   # MIT
├── RULES.md                  # final parameters + mechanics (from sections 5–6)
├── .env.example
├── contract/                 # Rust, near-sdk, cargo-near
│   ├── src/lib.rs            # entry, init, standards wiring
│   ├── src/game.rs           # settle(), feed, rampage, levels, evolution
│   ├── src/rewards.rs        # points, blessings, badges
│   ├── src/views.rs
│   ├── src/events.rs         # NEP-297
│   └── tests/                # near-workspaces integration tests
├── sim/
│   ├── simulate.py
│   └── out/                  # charts committed
├── scripts/
│   ├── deploy.ts             # deploy + init (testnet)
│   ├── create-dao.ts         # Sputnik DAO via factory
│   ├── dao-propose.ts        # rename / evolve / hatch proposals + votes
│   └── demo.ts               # full-life demo (12.2)
├── web/                      # Vite + React app
└── bot/                      # grammY Telegram bot
```

---

## 16. Timeline to the deadline

| Day (UTC) | Goal | Done when |
|---|---|---|
| **Nov 11** | Simulation, final parameters. Contract core: `settle`, feed, bites with level loss, death, generations | Charts committed, parameters approved, core tests pass |
| **Nov 12** | Staking and shields, Blessings, badges. Testnet deploy. DAO created | All tests in 8.5 pass (or the staking fallback is taken; see below), and the contract and DAO are live on testnet |
| **Nov 13** | `demo.ts` working, the web app (Totem, Feed, Belly, Lineage, History, Faucet), hosting | A judge can feed, stake and watch a bite from the browser |
| **Nov 14, morning** | The bot, README polish, video | The "Try it in 5 minutes" steps work end to end |
| **Nov 14, by ~18:00 UTC** | X post, repo public, submission (leave buffer) | Submission returns 201 |

If something slips, cut scope in this order:
1. The bot (show the alerts in the web app instead).
2. **Per-staker shields** (fall back to pro-rata slashing of all stakes; see 5.12).
3. Evolution.
4. Badges (keep the Founder list in the metadata).
5. Keepers sync (keep the DAO with a fixed council).

**Never cut:** feeding, bites with level loss, death, gravestone and lineage, Blessings, or the tests.

---

## 17. Stretch goals (only after the core is done)

1. **Feed from any chain via NEAR Intents:** someone holding USDC on Ethereum or Solana can feed the Totem through a 1Click swap. Intents has **no testnet**, so implement it with `dry: true` quotes, plus at most one tiny mainnet demo **with explicit human approval.** This adds a "chain abstraction" angle and broader appeal.
2. **Automatic Keepers sync** from the bot (9.3).
3. **Telegram Mini App** for in-chat feeding.
4. **Multiple tribes:** a factory that lets any community hatch its own Totem, each in a sub-account (`<tribe>.totem.testnet`). This strengthens the nfts track's sub-account hint.
5. **Doom Clock display:** "Hours survived this generation" against the all-time record. Display only, with no betting.

---

## 18. Prior art and how we differ

| Project | What it was | Difference from TOTEM |
|---|---|---|
| WAGMIGOTCHI (2021, Ethereum) | A community-cared-for onchain pet that could die | No treasury, no token mechanic and no stakes beyond the pet itself. TOTEM's pet **owns and eats a real treasury**, burns supply and pays caretakers |
| Tamadoge (TAMA) | Memecoin used to buy food for individual NFT pets | Pets are individually owned, and critics said the token was disconnected from the gameplay. TOTEM has **one collectively owned pet** whose survival *is* the token's supply and treasury mechanic |
| NFTZen (ETHGlobal 2022) | NFT with a feeding timer | Single-owner and no economics |

**Our original combination:**
- A collectively owned NFT that is itself the treasury.
- Neglect that destroys the shared treasury and **costs the Totem its levels, and eventually its life.**
- **Staking with skin in the game:** stakers who don't feed get slashed, while recent feeders are shielded.
- Burn-on-feed supply mechanics.
- Pull-based Blessings for caretakers.
- **Generational lineage:** gravestone NFTs form a family tree, and each egg inherits cosmetic traits from its predecessor's top feeders.
- Sputnik DAO governance of the creature by the Keepers.
- No admin key.

### Design decisions log (ideas considered and not adopted)

| Idea | Decision | Why |
|---|---|---|
| Per-token **hunger debt** with a global accumulator, surplus credit and debt-weighted slashing (suggested by another model) | **Partly adopted**: we took "a bite drops a level, death at Level 0", the unbonding delay and "freeloaders take the hit" (as shields) | The full debt and surplus system needs three interacting accumulators, which is too risky in the time left. It also turns a shared creature into individual bookkeeping, weakening the "shared commons" pitch. Listed in the README as future work: debt-weighted bites |
| **Survival betting market** (bet on whether it lives 24h) | Not adopted | It rewards people for wanting it to starve, needs no agent (the contract knows if it's alive), and would be a second product. The Doom Clock (stretch 5) keeps the tension without betting |
| **AI personality** posting begging messages on X | Not adopted | It adds no mechanism (judged on the mechanic), similar projects exist, and auto-posting to X needs human approval under the hackathon rules. The Telegram bot is the Totem's voice |
| Inheritance with **gameplay advantages** | Not adopted (cosmetic only) | Economic inheritance would reward letting the Totem die |

Name these projects openly in the README.

---

## 19. Risks and open questions

**Risks:**
- **Balance:** the Totem either never dies (boring) or always dies (frustrating). Mitigation: the simulation first (12.3).
- **Lazy settlement correctness** over long gaps. Mitigation: closed-form maths and the edge-case tests (8.5).
- **Shield accounting (5.12)** is the hardest code. Mitigation: build it after the core, test the invariant "sum of stakes = aggregate" heavily, and use the pro-rata fallback if it isn't solid by end of Nov 12.
- **A newborn dies at its first bite.** This is intended (it creates urgency right after a hatch) but must be explained clearly in the UI and README, and checked in the simulation so new generations don't die constantly.
- **Competitor overlap:** check the entries "Petri" (privacy, security, games, nfts, memecoins) and "$YAP | Proof of yap" (memecoins, social) on X, and the memecoin partner **BRRRAIN** (https://brrrain.fun/docs/), for similarity. Adjust the pitch if needed.
- **Time:** about 4 days. Stick to the cut order in section 16.

**Open questions for the humans (an agent must ask, never assume):**
1. Team members, team size and the team lead's name for the submission.
2. **The mainnet NEAR payout account.** The team creates it; agents never do.
3. The GitHub org or repo name, and who publishes the X post.
4. The Totem's name and art style: any preferences?
5. Whether to attempt the NEAR Intents stretch, which needs a tiny mainnet spend with approval.
6. Whether anyone on the team is submitting a second project (it must be disclosed in both READMEs).

---

## 20. Demo video and X post

**Video (about 90 seconds, show one complete moment, no architecture slides):**
1. The egg hatches.
2. The tribe feeds it and stakes into its belly, and the bar fills and the Hoard grows.
3. A time-lapse: "STARVING" alerts.
4. The first bite: the Hoard burns, the lazy staker gets slashed while the feeder's 🛡 holds, and a heart is lost.
5. A last-second rescue and the Hero Badge.
6. A level-up and the Keepers' vote (Dragon or Golem).
7. A Blessing payout.
8. Abandonment: the bites take it to Level 0, and it becomes a gravestone.
9. Generation 2 hatches with new colours inherited from the top feeders, shown in the lineage tree.
10. End card: "Keep it alive. Together."

**X post draft (the human edits and posts it):**
> Most memecoins do nothing. Ours dies if you ignore it.
>
> TOTEM is one creature a whole community shares. Feed it $TOTEM and it grows and pays its caretakers. Starve it and it eats the treasury, bites the stakers who ignored it, and eventually dies, leaving a gravestone and an egg that inherits its feeders' colours.
>
> On NEAR: the creature is an NFT that owns the treasury, the tribe's Sputnik DAO owns the creature, and no admin key can change the rules.
>
> Built at NEAR HACKATHON. Demo + repo: <links>
> Would you feed it, or wait for someone else to? 👀
>
> @NEARProtocol #NEARHackathon @NearBuilders @NearLegion

---

## 21. Submission checklist

- [ ] The repo is **public**, with a LICENSE, and the README has working "do X, see Y" steps
- [ ] No secrets anywhere in the git history
- [ ] `npm test` and `npm run demo` work from a fresh clone
- [ ] The hosted web app is up (and stays up until at least Nov 18)
- [ ] The X post is live, with the **video**, @NEARProtocol and #NEARHackathon, and says "built at NEAR HACKATHON"
- [ ] The mainnet payout account is ready, created by the team
- [ ] Tracks selected: `memecoins`, `nfts`, `social`
- [ ] "What did you build?" text written (20–2,000 chars): the problem, the product and how NEAR fits in
- [ ] Submit via https://nearhackathon.com/#apply or the API. Agents print the payload and wait for a human's yes. Leave `website` empty
- [ ] Submitted **before Nov 14, 23:59 UTC**, aiming for about 18:00 UTC
- [ ] Mistakes after submitting are fixed through https://nearhackathon.com/request-changes, never by resubmitting
