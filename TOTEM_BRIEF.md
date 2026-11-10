# TOTEM: Project Brief

> **A creature the whole community shares, which dies if they ignore it.**
> Feed it and it grows and pays its caretakers. Neglect it and it starts eating the community's treasury.

This file is the single starting point for the project. It is written for teammates **and** for an AI coding agent. If you are an agent, read it in full, then read [`HACKATHON.md`](HACKATHON.md) in full, before writing any code. Section 14 has your operating rules.

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
| `nfts` | "NFTs as accounts: assets that own money, earn royalties, hold inventory, carry credentials, memberships or access rights. Ownership with behavior." Hints: dynamic NFTs, NEP-171 | The Totem is a **living NFT that owns the treasury (the Hoard)**. Its state, art and level change over time. Caretaker Badges are credential NFTs |
| `social` | "Shared budgets, programmable rewards, collective ownership and reputation-based access on top of Sputnik DAO and Trezu. Don't rebuild the multisig — build what communities do with it." | The Totem is **owned by the tribe's Sputnik DAO**, which votes on its name, evolution and rebirth. Blessings are programmable rewards for caretaking. Badges are reputation that can gate access |

**We do not enter `games`.** That track is judged on a fast gameplay loop and wants NPCs and NEP-245 items. TOTEM's loop is measured in hours, so we'd score poorly there.

---

## 3. The idea in plain words

- **There is exactly one Totem**, a pixel creature that lives on NEAR. It belongs to the whole community (the "tribe"), not to any one person.
- **It is always getting hungrier.** Its hunger bar drains around the clock.
- **The only food is $TOTEM coins.** Feeding it means giving it $TOTEM.
  - Half of every meal is **burned**, so supply shrinks the more the Totem is loved.
  - The other half goes into the **Hoard**, the tribe treasury the Totem owns.
- **If the bar hits zero, the Totem goes into Rampage.** It **eats the Hoard**, burning 10% every hour until someone feeds it. After 3 days of Rampage it **dies**: it becomes a gravestone NFT and whatever is left of the Hoard burns.
- **A well-fed Totem grows.** It levels up, evolves, mints badges for its caretakers and, from Level 3, pays weekly **Blessings** from the Hoard to the people who fed it.
- **The tribe's Sputnik DAO owns the Totem.** The DAO can name it, choose its evolution and hatch a new egg after a death. It **cannot** touch the Hoard or change any rule.

The core tension is the tragedy of the commons (everyone hopes someone else pays for the shared thing): *"Someone needs to feed it… but will it be me?"* Caretakers earn rewards, freeloaders earn nothing, and total neglect hurts everyone.

---

## 4. A story of how it plays out

- **Day 1.** The Totem hatches at Level 1 and 100% full.
- **Day 1, evening.** It's at 70%. Priya feeds it and earns Caretaker Points.
- **Day 2, 3 a.m.** It's at 25%, which is Starving. The bot posts: "⚠️ TOTEM IS STARVING (25%). In 6h it starts eating the Hoard."
- **Day 2, 4 a.m.** Arjun does a **rescue feed** and gets **2× points**.
- **Days 3–5.** It stays Happy and reaches **Level 3**, which unlocks weekly Blessings.
- **Day 6.** The weekend: nobody pays attention, the bar hits 0% and **Rampage** begins. 10% of the Hoard burns every hour.
- **Day 6, later.** Three people feed it back and the Rampage stops. The tribe has learned its lesson.
- **Day 9.** It reaches **Level 4**, and the DAO votes: **Dragon** (eats much more, blesses much more) or **Golem** (eats less, blesses less).
- **If it is ever abandoned for 3 days at 0%,** it dies. It becomes a gravestone NFT reading "Lived 23 days, reached Level 4," and the DAO can vote to hatch a new egg.

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
| 🔥 Rampage | 0% | It bites the Hoard, and the death clock runs |
| 💀 Dead | 3 Totem days in Rampage | Final for this Totem |

### 5.3 Feeding
- `feed(amount)` takes `amount` $TOTEM from the caller.
- **Meal size** is the number of tokens needed to go from 0% to 100%: `meal_size(level, form) = BASE_MEAL × 1.5^(level-1) × form_appetite`.
- Fullness gained is `amount / meal_size × 10,000`, capped at 10,000. **Any excess is not taken.** The contract only debits what fits.
- The accepted amount is split **50% burned** (total supply goes down) and **50% added to the Hoard**.
- **Caretaker Points:** 1 point per whole token accepted, and **×2 if fullness was below 30% at the moment of feeding** (rescue bonus).
- Feeding during Rampage ends the Rampage immediately and resets the death clock.
- Feeding a dead Totem is rejected.

### 5.4 XP and levels
- XP is **seconds spent Happy**, measured in Totem days. `settle` computes exactly how long fullness stayed at or above 70% during the elapsed interval.
- Level thresholds, in cumulative Happy days: **L2 at 1, L3 at 3, L4 at 6, L5 at 10**, then **+5 per level** after that.
- Level-up effects:
  - **L2:** Caretaker Badges become claimable (see 5.7).
  - **L3:** Blessings start (see 5.6).
  - **L4:** Evolution choice (see 5.5).
  - **L5 and up:** new art, and the Blessing rate rises by +1 percentage point per level, capped at +5.

### 5.5 Evolution (at Level 4)
- The **owner of the Totem NFT** (the tribe's Sputnik DAO) calls `choose_evolution("dragon" | "golem")` within **1 Totem day** of reaching L4. If it doesn't, the form defaults to **Golem**.

| Form | Appetite multiplier | Base Blessing rate |
|---|---|---|
| Egg-creature (L1–L3, before evolution) | ×1.0 | 5% |
| 🐉 Dragon | ×1.5 | 8% |
| 🗿 Golem | ×0.8 | 3% |

### 5.6 Blessings (Level 3 and up)
- Time is split into **Blessing periods of 7 Totem days**, starting from the moment the Totem reached L3.
- When a period ends (the next `settle` after its end), the contract reserves **rate × Hoard** for that period and records the period's total points.
- Each account claims its share with `claim_blessing(period_id)`: `reserved × your_points_in_period / total_points_in_period`. Claims are **pull-based**, so the contract never loops over users.
- Points used for Blessings are the points earned **within that period**. Lifetime points are tracked separately for badges.
- **Unclaimed Blessings return to the Hoard 2 periods later.**
- A period with zero points reserves nothing.

### 5.7 Caretaker Badges (credential NFTs, soulbound)
- **Bronze / Silver / Gold** at 100 / 1,000 / 10,000 lifetime points, claimable with `claim_badge()` once the Totem has reached L2.
- **Hero Badge:** automatically minted to the account whose feed ended a Rampage.
- Badges are **non-transferable**: `nft_transfer` on a badge panics. They are reputation, usable for gated access (see 9.3).

### 5.8 Rampage and death
- While fullness is 0, every **1/24 Totem day** (one "bite") burns **10% of the Hoard**. That's compounding: after n bites the Hoard is `Hoard × 0.9^n`, computed in `settle`.
- **Poke tip:** `poke()` is a public method that just runs `settle`. If it applies at least one bite, the caller receives **1% of the bitten amount** instead of that 1% being burned. This gives anyone an incentive to keep the state current. All other methods also settle, with no tip.
- After **3 Totem days in continuous Rampage** the Totem **dies**:
  - The remaining Hoard is burned.
  - The Totem token is converted to a **gravestone** NFT with frozen metadata: name, birth, death, max level, form, total fed and the top 3 caretakers.
  - Unclaimed Blessing reservations remain claimable.
- After a death, the owner of the gravestone (the DAO) can call `hatch()` to mint a new egg: Level 1, 100% full, empty Hoard, new Totem token id.

### 5.9 What no one can do
- There is **no admin key and no owner override.** All parameters are fixed at `new()` and exposed through `get_config()`.
- No one can withdraw the Hoard except through Blessings and the poke tip.
- The DAO's powers are limited to: `rename`, `choose_evolution`, `hatch`, and transferring the Totem NFT (the Hoard moves with it, because the Hoard is attributed to the token).

### 5.10 Getting $TOTEM
- **Fixed supply** of 1,000,000,000 $TOTEM is minted at `new()` to a `genesis_account` set at init.
- **Demo deployments only** (`demo_mode = true`, fixed at init): `faucet()` gives 1,000 $TOTEM per account per Totem day, minted from a pre-allocated faucet pool.
- **Mainnet path:** described in the README as a future fair launch, for example via meme.cooking. **Do not deploy to mainnet for this hackathon.**

### 5.11 Why fake accounts don't help
Points, badges and Blessings are proportional to tokens spent, and half of those are burned. Splitting 100 tokens across 100 accounts earns exactly what one account would earn with 100 tokens. The README must say this plainly.

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
| `bite_interval` | 1/24 day | |
| `bite_size` | 10% of the Hoard | |
| `poke_tip` | 1% of each bite | |
| `death_after` | 3 days of continuous Rampage | |
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
    bites_applied: u64,
    alive: bool,
    hoard: Balance,                       // $TOTEM held by the contract for this totem
    total_burned: Balance,
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
| `feed(amount: U128)` | any holder | Settles, takes what fits, burns 50%, adds 50% to the Hoard, awards points (with rescue bonus), ends any Rampage, emits `feed` |
| `poke()` | anyone | Settles, and pays the poke tip if bites were applied |
| `claim_blessing(period_id: u64)` | any account with points in that period | Transfers its share from the reserved amount |
| `claim_badge()` | any account | Mints the highest Bronze/Silver/Gold tier earned and not yet claimed (requires level ≥ 2 reached) |
| `rename(name: String)` | **Totem NFT owner only** (the DAO) | Sets the name (≤ 32 chars) |
| `choose_evolution(form: String)` | **Totem NFT owner only** | Only between L4 and the evolution deadline |
| `hatch()` | **Gravestone owner only**, Totem dead | Mints a new egg Totem to the caller |
| `faucet()` | anyone, **demo_mode only** | Registers storage if needed and sends `faucet_amount` once per day |
| NEP-141 / NEP-145 / NEP-171 standard methods | — | `nft_transfer` on badges panics (soulbound). The Totem NFT is transferable, and the Hoard follows `totem_id` |

### 8.3 View methods

| Method | Returns |
|---|---|
| `get_totem()` | Projected live state at `now`: name, generation, fullness %, mood, level, XP, next level, form, Hoard, time until Starving / Rampage / death, alive, owner |
| `get_config()` | All parameters (proves there's no admin key and nothing hidden) |
| `get_caretaker(account_id)` | Lifetime points, current-period points, claimable Blessings, badge tier |
| `get_leaderboard(period_id?, limit)` | Top caretakers. Maintain a small top-N cache on write to avoid unbounded iteration |
| `get_periods(from, limit)` | Blessing periods and their status |
| `get_graveyard()` | Gravestone NFTs with their frozen life records |
| `get_stats()` | Total supply, total burned, total fed, total blessed |

### 8.4 Events (NEP-297 JSON logs, `standard: "totem"`)
`feed`, `rescue`, `level_up`, `evolve`, `bite`, `rampage_start`, `rampage_end`, `death`, `hatch`, `blessing_reserved`, `blessing_claimed`, `badge_minted`, `rename`. Also emit the standard `ft_burn` / `nft_mint` events. The bot and the UI history page are built from these.

### 8.5 Edge cases the tests must cover
1. A feed exactly at the moment fullness hits 0. Rampage-start ordering within `settle`.
2. A long idle gap (for example 10 days). `settle` must apply the drain, then the bites, then death in the correct order, in bounded gas. Compute bites with an exponent, not a loop.
3. An overfeed: only the fitting amount is debited.
4. A rescue feed during Rampage: Hero Badge, 2× points, death clock reset.
5. A Blessing period with zero points.
6. A sale or transfer of the Totem NFT mid-period. The Hoard follows the token, and pending Blessings are unaffected.
7. A badge transfer attempt panics.
8. Non-owner calls to `rename` / `choose_evolution` / `hatch` panic.
9. The evolution deadline passes, so the form defaults to Golem.
10. Death: the Hoard burns, a gravestone is created, `hatch` works, and old unclaimed Blessings are still claimable.
11. Rounding: no dust is created or lost. Burned + Hoard + paid out always equals the total fed.
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

### 9.3 Reputation-based access (stretch, strengthens the social track)
Caretaker Badge holders (Silver and up) can be added to a "Caretakers" role in the DAO via `AddMemberToRole` proposals created by the bot or a script. This gives caretakers a vote on evolution, so caretaking literally becomes governance power. Trezu can be mentioned as an alternative treasury UI, but it isn't needed.

---

## 10. Web app

**Stack:** Vite + React + TypeScript, NEAR Wallet Selector (testnet) and near-api-js or near-kit. Static hosting such as Vercel or GitHub Pages. Keep it up until at least 2026-11-18, ideally 2026-11-25.

**Pages and sections:**
1. **Home: the Totem.**
   - The animated pixel creature, with art that varies by mood (Happy, Hungry, Starving, Rampage) and form (Egg, Dragon, Golem, Gravestone).
   - A big live hunger bar with countdowns ("Starving in 3h 12m", "Eats the Hoard in…", "Dies in…").
   - Level, XP bar, Hoard balance and total burned.
   - **Feed buttons** (10, 50, or "fill it up", which computes the exact amount needed).
   - A **Poke** button, shown during Rampage, displaying the tip you'd earn.
2. **Caretakers:** the leaderboard (this period and lifetime), your points, claimable Blessings with claim buttons, and badge status with a claim button.
3. **History:** a feed of events (feeds, rescues, bites, level-ups, evolutions, Blessings, deaths), each linking to the testnet explorer.
4. **Graveyard:** past Totems and their life records.
5. **Rules:** live output of `get_config()`, rendered in plain language. It shows anyone that the rules are fixed.
6. **Faucet** (demo only): "Get 1,000 test $TOTEM."

**Art:** original pixel art made for this project: simple SVG or sprite sheets, two to three frames per mood, with a different palette per form. No copied or third-party characters.

**Low friction:** first-time users get a one-click faucet that also handles the storage deposit. All state is visible without connecting a wallet.

---

## 11. Telegram bot

**Stack:** Node + grammY. It polls `get_totem()` every 30–60 seconds and reads new NEP-297 events from recent blocks (via RPC or an indexer API; check the docs for the best option).

**It posts on state changes:**
- `⚠️ TOTEM IS STARVING (25%) — Level 3 Golem. Starts eating the Hoard (8,400 $TOTEM) in 5h 12m. [🍖 Feed] [📊 Status]`
- `🔥 RAMPAGE! The Totem ate 840 $TOTEM from the Hoard. It dies in 2d 23h unless someone feeds it.`
- `🦸 arjun.testnet saved the Totem! +2× points, Hero Badge minted.`
- `⬆️ Level 4! The tribe must choose: 🐉 Dragon or 🗿 Golem. Vote in the DAO.`
- `✨ Blessing #2: 1,250 $TOTEM ready for 14 caretakers. [Claim]`
- `💀 The Totem has died after 23 days. Rest in peace, Grumbo. The DAO may hatch a new egg.`

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
4. Stop feeding, so it goes Starving, then Rampage. Account 4 calls `poke` and gets the tip. Print the bites.
5. Account 2 rescue-feeds: print the 2× points and the Hero Badge.
6. Let a Blessing period close, then claim Blessings. Print the per-account payouts.
7. Through the DAO script: rename, and `choose_evolution` at L4.
8. Optional `--death` flag: abandon the Totem, then watch it die and hatch a new one.

It must print a clear log, with every step labelled and linked to its explorer transaction. Target run time is about 15 minutes with the 120-second day. Also provide `--fast` for a shorter path that skips the evolution steps.

### 12.3 Balance simulation (do this first, on Day 1)
`sim/simulate.py` is an offline agent-based model of 60 days. Simulated players: loyal caretakers, opportunists who feed only on rescue, freeloaders, and "weekend gaps." It outputs charts of fullness, Hoard, total supply, level and Blessings over time, under 3–4 scenarios (healthy, apathetic, whale-carried, abandoned).

**Goal:** the Totem should survive with modest effort, die under real neglect, and Blessings should return a meaningful share to active caretakers. Commit the charts to `sim/out/` and reference them in the README. That's evidence the mechanic was designed, not guessed.

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
| **Nov 10** | Simulation, final parameters, contract skeleton | Charts committed, parameters approved, `settle` + `feed` tested |
| **Nov 11** | The full contract and tests. Testnet deploy. DAO created | All tests in 8.5 pass, and the contract and DAO are live on testnet |
| **Nov 12** | `demo.ts` working, the web app's core (Totem, Feed, Faucet, History) | A judge can feed from the browser |
| **Nov 13** | The rest of the web app, the bot, the README, hosting | The "Try it in 5 minutes" steps work end to end |
| **Nov 14** | Video, X post, repo public, submission **by ~18:00 UTC** (leave buffer) | Submission returns 201 |

If something slips, cut scope in this order: the bot (then show the alerts in the web app instead), then evolution, then badges. **Never cut** feeding, Rampage, death, Blessings or the tests.

---

## 17. Stretch goals (only after the core is done)

1. **Feed from any chain via NEAR Intents:** someone holding USDC on Ethereum or Solana can feed the Totem through a 1Click swap. Intents has **no testnet**, so implement it with `dry: true` quotes, plus at most one tiny mainnet demo **with explicit human approval.** This adds a "chain abstraction" angle and broader appeal.
2. **Caretaker role in the DAO** for badge holders (9.3).
3. **Telegram Mini App** for in-chat feeding.
4. **Multiple tribes:** a factory that lets any community hatch its own Totem, each in a sub-account (`<tribe>.totem.testnet`). This strengthens the nfts track's sub-account hint.

---

## 18. Prior art and how we differ

| Project | What it was | Difference from TOTEM |
|---|---|---|
| WAGMIGOTCHI (2021, Ethereum) | A community-cared-for onchain pet that could die | No treasury, no token mechanic and no stakes beyond the pet itself. TOTEM's pet **owns and eats a real treasury**, burns supply and pays caretakers |
| Tamadoge (TAMA) | Memecoin used to buy food for individual NFT pets | Pets are individually owned, and critics said the token was disconnected from the gameplay. TOTEM has **one collectively owned pet** whose survival *is* the token's supply and treasury mechanic |
| NFTZen (ETHGlobal 2022) | NFT with a feeding timer | Single-owner and no economics |

**Our original combination:**
- A collectively owned NFT that is itself the treasury.
- Neglect that destroys the shared treasury.
- Burn-on-feed supply mechanics.
- Pull-based Blessings for caretakers.
- Sputnik DAO governance of the creature.
- No admin key.

Name these projects openly in the README.

---

## 19. Risks and open questions

**Risks:**
- **Balance:** the Totem either never dies (boring) or always dies (frustrating). Mitigation: the simulation first (12.3).
- **Lazy settlement correctness** over long gaps. Mitigation: closed-form maths and the edge-case tests (8.5).
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
2. The tribe feeds it, and the bar fills and the Hoard grows.
3. A time-lapse: "STARVING" alerts.
4. Rampage, with the Hoard burning on screen.
5. A last-second rescue and the Hero Badge.
6. A level-up and the DAO vote (Dragon or Golem).
7. A Blessing payout.
8. The graveyard.
9. End card: "Keep it alive. Together."

**X post draft (the human edits and posts it):**
> Most memecoins do nothing. Ours dies if you ignore it.
>
> TOTEM is one creature a whole community shares. Feed it $TOTEM and it grows and pays its caretakers. Starve it and it eats the treasury.
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
