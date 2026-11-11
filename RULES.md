# TOTEM — Rules & Parameters

Every value here is fixed at `new()` and can never change. The live values are
readable on-chain via `get_config()`. There is no admin key and no owner override.

## Token

| Parameter | Value |
|---|---|
| Name / symbol | Totem / $TOTEM |
| Decimals | 18 |
| Total supply | 1,000,000,000 $TOTEM (minted once at init to the genesis account) |
| Standard | NEP-141 (+ NEP-145 storage management) |

## Time

| Parameter | Value |
|---|---|
| Totem-day | 86,400 s in production, **120 s in demo mode** |
| Fullness | 0–10,000 basis points (10,000 = 100%) |
| Drain | 100% → 0% over exactly one Totem-day, at every level |

## Feeding

| Parameter | Value |
|---|---|
| Base meal (L1 egg, 0→100%) | 100 $TOTEM |
| Appetite growth | ×1.5 per level |
| Form appetite | egg ×1.0, dragon ×1.5, golem ×0.8 |
| Burn share | 50% (the remainder goes to the Reserve, the Totem-owned part of the Hoard) |
| Points | 1 per whole token accepted |
| Rescue multiplier | ×2 when fullness < 30% at the moment of feeding |
| Staker multiplier | ×1.5 while you have ≥ 100 $TOTEM staked (stacks with rescue) |
| Shield | a feed of ≥ 5 $TOTEM shields your stake from bites for 2 Totem-days |
| Overfeed | only the amount that fits is debited |

## Moods

| Mood | Fullness | Effect |
|---|---|---|
| Happy | ≥ 70% | earns XP |
| Hungry | 30% – 70% | nothing |
| Starving | 0% – 30% | feeds earn the 2× rescue bonus |
| Rampage | 0% | bites every ¼ Totem-day |
| Dead | a bite takes it to Level 0 | final for this generation; it becomes a gravestone |

## Levels (cumulative Happy-days)

| Level | Threshold | Unlocks |
|---|---|---|
| L2 | 1 | Caretaker Badges claimable |
| L3 | 3 | Blessings begin |
| L4 | 6 | Evolution choice (Dragon or Golem) |
| L5 | 10 | +1pp Blessing rate per level (capped +5pp) |
| L6+ | +5 each | — |

Levels can go down: each bite removes one level and resets XP to that level's floor. Perks follow the current level (no new Blessing payouts below L3); the evolved form is kept.

## Rampage, bites & death

While fullness is 0, the Totem bites every ¼ Totem-day (6 h in production, 30 s in demo). Each bite, in order:

1. Burns **15% of the Reserve**.
2. Slashes **15% of every unshielded stake**, into the Reserve.
3. Drops the Totem **one level** (XP reset to the new level's floor).
4. At **Level 0 the Totem dies**: the remaining Reserve burns, stakes are released, and it becomes a gravestone.

So a Totem survives as many bites as its level: a newborn (L1) dies at its first bite. Feeding ends the Rampage; levels already lost stay lost.

| Parameter | Value |
|---|---|
| Bite interval | ¼ Totem-day |
| Reserve burn per bite | 15% |
| Stake slash per bite | 15% of each unshielded stake, into the Reserve |
| Poke tip | 1% of the Reserve burned by the bites a `poke()` applies, paid to the poker |

## Staking into the belly

| Parameter | Value |
|---|---|
| Staker bonus | feed points ×1.5 while staked ≥ 100 $TOTEM |
| Keeper eligibility | ≥ 1,000 $TOTEM staked (for the DAO Keepers role) |
| Shield | a feed of ≥ 5 $TOTEM protects **all** your stake from bites for 2 Totem-days (rounded up to the hour) |
| Unbonding | `unstake` → 1.5 Totem-days → `withdraw`. Unbonding stake **can still be slashed** |
| After a death | every stake is released and withdrawable at once |

Staking is optional. Stakers who don't feed lose 15% per bite; stakers who feed are shielded.

## Generations & lineage

- A dead Totem becomes a **gravestone**: name, generation, born/died, lifespan, max level, form, cause of death, totals fed/burned/blessed/slashed, top 3 feeders, traits.
- The DAO calls `hatch()` to start the next generation ("Grumbo II"). The egg's cosmetic **traits** (palette 8, pattern 6, marking 6, crest 4) come from `sha256(top-3 feeders ‖ generation)`; those 3 become its **Founders**.
- **Cosmetic only.** Nothing economic carries over, so no one profits from letting it die.
- `get_lineage()` returns the family tree.

## Evolution (at L4)

| Form | Appetite | Base Blessing rate |
|---|---|---|
| Egg (L1–L3) | ×1.0 | 5% |
| Dragon | ×1.5 | 8% |
| Golem | ×0.8 | 3% |

The Totem NFT owner (the DAO) chooses within 1 Totem-day of reaching L4; otherwise it defaults to Golem.

## Blessings

| Parameter | Value |
|---|---|
| Period length | 3.5 Totem-days (from the moment L3 is reached) |
| Reserved per period | `rate × Reserve`, pro-rata by points earned that period (only while L3+) |
| Claim | pull-based (`claim_blessing(period_id)`) |
| Unclaimed | returns to the Reserve 2 periods later |

## Caretaker Badges (soulbound NFTs)

| Tier | Lifetime points |
|---|---|
| Bronze | 100 |
| Silver | 1,000 |
| Gold | 10,000 |
| Hero | auto-minted to whoever ends a rampage |

## Demo mode only

| Parameter | Value |
|---|---|
| Faucet | 1,000 $TOTEM per account per Totem-day |
