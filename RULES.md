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
| Burn share | 50% (the remainder goes to the Hoard) |
| Points | 1 per whole token accepted |
| Rescue multiplier | ×2 when fullness < 30% at the moment of feeding |
| Overfeed | only the amount that fits is debited |

## Moods

| Mood | Fullness | Effect |
|---|---|---|
| Happy | ≥ 70% | earns XP |
| Hungry | 30% – 70% | nothing |
| Starving | 0% – 30% | feeds earn the 2× rescue bonus |
| Rampage | 0% | bites the Hoard; death clock runs |
| Dead | 3 Totem-days in rampage | final for this Totem |

## Levels (cumulative Happy-days)

| Level | Threshold | Unlocks |
|---|---|---|
| L2 | 1 | Caretaker Badges claimable |
| L3 | 3 | Blessings begin |
| L4 | 6 | Evolution choice (Dragon or Golem) |
| L5 | 10 | +1pp Blessing rate per level (capped +5pp) |
| L6+ | +5 each | — |

## Rampage & death

| Parameter | Value |
|---|---|
| Bite interval | 1/24 Totem-day (one bite per Totem-hour) |
| Bite size | 10% of the Hoard (compounding) |
| Poke tip | 1% of each bite, paid to the account that settles it |
| Death | after 3 continuous Totem-days in rampage; remaining Hoard burns |

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
| Period length | 7 Totem-days (from the moment L3 is reached) |
| Reserved per period | `rate × Hoard`, pro-rata by points earned that period |
| Claim | pull-based (`claim_blessing(period_id)`) |
| Unclaimed | returns to the Hoard 2 periods later |

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
