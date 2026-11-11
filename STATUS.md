# TOTEM: Build status (as of 2026-11-11)

Where the build stands and what is left. Read this after [`TOTEM_BRIEF.md`](TOTEM_BRIEF.md) (the spec) and before picking up work. Keep it current: tick items off and add new ones as you go.

## Done

| Area | What exists | Where |
|---|---|---|
| Contract core | NEP-141 $TOTEM + NEP-145 storage, feed (50% burn / 50% Reserve), lazy `settle`, moods, levels, evolution, Blessings, badge tiers (records + events), demo faucet | [`contract/src/`](contract/src/) |
| New bite rules | Bite every ¼ Totem-day: burn 15% of the Reserve, slash 15% of unshielded stakes into it, −1 level; death at Level 0; poke tip = 1% of the burn | [`game.rs`](contract/src/game.rs) |
| Staking with shields | `stake` / `unstake` (1.5-day unbonding, still slashable) / `withdraw`; feed ≥ 5 shields for 2 days; ×1.5 staker points; bounded-gas aggregate with shield buckets | [`staking.rs`](contract/src/staking.rs) |
| Lineage | Gravestone life record on death, traits from `sha256(top-3 feeders ‖ generation)`, Founders, `get_lineage` / `get_graveyard` | [`lineage.rs`](contract/src/lineage.rs) |
| Views | `get_totem` projects unsettled bites; `get_stake`, `get_config`, `get_stats`, `get_caretaker`, `get_period`, `get_blessing_share` | [`views.rs`](contract/src/views.rs) |
| NFTs (NEP-171) | `totem-{gen}` minted to the DAO (dynamic metadata while alive, converted to a gravestone at death, transferable: governance follows the owner); soulbound `badge-{tier}-{acct}`, `hero-{gen}-{n}`, `founder-{gen}-{acct}`; contract pays the storage | [`nft.rs`](contract/src/nft.rs) |
| Contract tests | 29 unit tests: feeding, bites and level loss, newborn death, shields, shield expiring between bites, many-staker invariant, unbonding, lineage/hatch, sybil split, NFTs (Totem, gravestone, soulbound badges, Hero, Founder, transfer), governance, evolution deadline, Blessings at/below L3 and after death | [`tests.rs`](contract/src/tests.rs) |
| Web app | 3D farm (React Three Fiber) with an original chubby panda; feed / pet / ball / trees; totem pole = levels, treasure chest = Hoard, graveyard = lineage; day/night; glass HUD | [`web/src/`](web/src/) |
| Mochi's voice (AI) | Tap the panda or press 💬: an AI character on NEAR AI Cloud (`anthropic/claude-haiku-5-5` by default), grounded in `get_totem` / `get_lineage` / `get_caretaker` / `get_stake`; personality from on-chain traits; knows feeders by name, ancestors, founders; thanks you after a feed; ghost voice when dead. Key stays server-side, 20 msgs/min/IP, canned fallback without a key | [`web/server/mochi.ts`](web/server/mochi.ts), [`web/src/MochiChat.tsx`](web/src/MochiChat.tsx) |
| Docs | README (judge-facing), RULES.md (all parameters), brief updated to the 3D farm | root |

**Run it:**
```bash
cd contract && cargo test            # 29 passed (rust-toolchain.toml pins stable + wasm target)
cd web && npm install && npm run dev  # http://localhost:5173
```

**Know before you build on it:**
- The web app is **live on testnet** by default (NEAR Connect wallet, polled views) and keeps a **client-side mirror** of the rules ([`web/src/engine.ts`](web/src/engine.ts)) for Practice mode. The mirror has the bite rules but no staking.
- The dev server also serves `/rpc` (RPC proxy), `/api/mochi` (AI voice), `/api/guest` and `/api/relay` (gasless guests) from [`web/server/`](web/server/). A hosted build needs all four as serverless functions; `NEAR_AI_API_KEY` (and `RELAYER_PRIVATE_KEY` outside the dev machine) go in `web/.env` (see [`web/.env.example`](web/.env.example)), never in git.
- Testnet state (2026-11-11): Keepers `totem-grumbo-keeper{,2,3}.testnet` + guest `gb5456bc4.totem-grumbo-relay.testnet` (4 Keepers, 3 votes to pass); council `totem-grumbo-tribe.testnet` (constitution only). Mochi VI hatched by Keeper vote. Known quirk: this Sputnik version marks a proposal "Approved" when the vote passes even if the call it runs fails (e.g. proposal 11, a hatch while alive, refused by the contract); the app labels it "vote passed" and every path refuses to open a hatch vote while the Totem lives. A newborn starves ~2.5 min after hatching on the demo clock, so run `scripts/dao-propose.sh hatch` right before a live test or recording.
- NFT storage is paid by the contract's own NEAR balance; fund the contract account generously on deploy.
- Blessings use the level at settle time when a period closes (a small approximation; documented in the code).
- Commits go out as `xaviersharwin10` / `Raksha001` only, with no AI co-author trailers.

## Parameter decisions (from the simulation, 2026-11-11)

The simulation flagged two weak spots; both are now fixed in `Config::defaults` (contract), the sim, RULES.md, README and the brief. All 14 sim checks pass.

1. **Blessing period 7 → 3.5 Totem-days.** Same rates, paid twice as often: loyal caretakers get ~12% of their spend back (was ~8%), and the demo shows a Blessing every 7 minutes instead of 14.
2. **Shield: feed ≥ 5 (was 10), lasts 2 days (was 1).** At 10/day a 500-token staker paid more in snacks than the slashes it saved; now feeding stakers end ahead of lazy ones.

Parameters are immutable after `new()`, so re-run `sim/simulate.py` before any further change and before the final deploy.

Manual test steps for everything below and above: [TESTING.md](TESTING.md).

## Remaining (in priority order)

The brief's cut order still applies if time runs out (section 16): cut the bot first, then Keepers sync. **Never cut** feeding, bites with level loss, death, gravestone and lineage, Blessings, or the tests.

- [x] **1. Simulation:** [`sim/simulate.py`](sim/simulate.py) and `sim/out/` now use the new rules (5 scenarios, 14/14 checks pass). Two parameters were tuned from it, see "Parameter decisions" below.
- [x] **2. NFTs (NEP-171):** the Totem as a real NFT owned by the DAO that converts to a gravestone at death; soulbound Bronze / Silver / Gold, Hero and Founder badges (`nft_transfer` on a badge panics).
- [ ] **3. Remaining contract tests (brief 8.5):** done: Blessings stop below L3, Totem NFT transfer, evolution deadline → Golem, non-owner governance, old Blessings claimable after death. Still open: a period with zero points, storage deposits for brand-new accounts receiving Blessings.
- [ ] **4. Integration tests:** `near-workspaces` sandbox tests with block fast-forward (brief 12.1).
- [x] **5. Testnet deploy:** live at `totem-grumbo.testnet` (demo mode, 120 s day); genesis + Totem NFT owner `totem-grumbo-tribe.testnet` (keys in `~/.near-credentials` on Sharwin's machine). Deploy / redeploy with [`scripts/deploy.sh`](scripts/deploy.sh) (`--redeploy` keeps state). Smoke-tested: feed works on-chain. **Note:** redeploying with changed state layout needs a fresh account (no migration).
- [x] **6. Sputnik DAO:** `totem-tribe.sputnik-v2.testnet` (factory `sputnik-v2.testnet`, verified via `get_dao_list`), council `[totem-grumbo-tribe.testnet]` 1-of-1, owns the Totem NFT. [`scripts/create-dao.sh`](scripts/create-dao.sh), [`scripts/dao-propose.sh`](scripts/dao-propose.sh) `rename|evolve|hatch`. Proven on-chain: proposal 0 hatched Generation 2 (Grumbo II) and minted a Founder Badge. The live `act_proposal` needs the `proposal` kind alongside `id` and `action` (the script sends it).
- [x] **7. Keepers:** `keepers` role on the DAO (call:AddProposal/VoteApprove/VoteReject/VoteRemove/Finalize), [`scripts/keepers-sync.sh`](scripts/keepers-sync.sh) checks `get_stake(...).keeper_eligible` or a Silver/Gold badge NFT and proposes add/remove. On-chain: proposal 1 created the role with `totem-grumbo-keeper.testnet` (1,000 staked); proposal 2 (rename to Mochi) passed on the Keeper's vote alone. Note: the factory's DAO version lacks `ChangePolicyAddOrUpdateRole`, so roles are changed with a full `ChangePolicy`.
- [ ] **8. Demo script:** `scripts/demo.ts`, one full life on testnet with a labelled log and explorer links, plus `--fast` (brief 12.2).
- [x] **9. Web ↔ contract:** [`web/src/game.ts`](web/src/game.ts) is one interface over two backends: **live** (polls `get_totem` / `get_stats` / `get_lineage` on `totem-grumbo.testnet`, signs `feed` / `poke` / `faucet`) and **practice** (`engine.ts`, also the offline fallback). Wallet: NEAR Connect (`@hot-labs/near-connect@0.11.4`, the docs say Wallet Selector is deprecated) + `function-call-key-plugin@2.1.0` so zero-deposit calls sign without popups ([`web/src/chain/`](web/src/chain/)). Browser RPC goes through the dev server's `/rpc` proxy (public RPCs rate-limit per IP and a 429 shows up as a CORS error). Verified in a browser: live state renders, wallet picker opens, and the guest (no-wallet) path feeds on-chain end to end. **Not yet verified:** a real wallet (Meteor / Intear / MetaMask) sign-in + feed from the browser (needs a human with a wallet). MetaMask accounts need testnet NEAR for gas, or use ⚡ Play free.
- [ ] **10. Web staking UI:** stake, unstake, withdraw, shield status ("🛡 Shielded for 14h" / "⚠️ feed 5 to protect your stake"), unbonding countdown.
- [ ] **11. Other web screens:** claim Blessings and badges, lineage tree from `get_lineage`, rules from `get_config`, history with explorer links, faucet button.
- [x] **18. Mochi's voice:** the Totem is an AI character grounded in chain state (see Done).
- [x] **19. SOS links:** 🆘 Call for help / 📣 share sheet with a 1200×630 card (snapshot of the farm + live numbers), native share / X / Telegram / copy / save image; `/?rescue=1` opens a one-tap Rescue card (live countdown, Hoard at risk); Hero badge + Mochi's thank-you; "Brag on X" after. Nothing is ever posted automatically. [`web/src/Sos.tsx`](web/src/Sos.tsx)
- [x] **21. Tribe governance, no shortcuts:** contract `get_keeper` view (one eligibility rule; stakers of a dead generation keep their say over its successor until they withdraw) and projected `get_lineage` / `get_graveyard` / Totem NFT (a starved-but-unsettled Totem already shows its gravestone; projection proven identical to the settled record); 29 tests. DAO constitution (proposal 8): everyone proposes (0.1 NEAR bond), Keepers decide by majority (Totem calls + membership + transfers), council guards the policy only. App: hatch vote on the death card, 🏛 Tribe panel (open votes + tallies, Keepers + why, history, Nominate me, Re-stake after a hatch), gasless votes for guest Keepers (relayer allows `act_proposal` on the DAO), `/api/propose` for players without NEAR. Verified on testnet: council `ERR_PERMISSION_DENIED`; guest nominated (#9) and admitted by 2 Keepers; guest proposed + voted hatch (#10) from the death card, passed 3/3, Mochi VI hatched; re-stake via the panel. Scripts: `bootstrap-governance.sh`, `dao-propose.sh` / `keepers-sync.sh` vote with Keepers by default; keepers-sync gives a one-Totem-day grace after a hatch. [`web/src/Tribe.tsx`](web/src/Tribe.tsx), [`web/src/chain/dao.ts`](web/src/chain/dao.ts)
- [x] **20. Gasless play:** "⚡ Play free, no wallet" and the Rescue card create a zero-balance guest `g<hex>.totem-grumbo-relay.testnet` (NEP-448) whose key lives in the browser; actions are NEP-366 meta-transactions relayed by `totem-grumbo-relay.testnet` (10 testnet NEAR). The relayer only sponsors zero-deposit calls to the game's methods (≤3 actions, ≤100 Tgas each; 5 new guests/IP/hour, 40 relays/IP/hour, 30/account/hour). Verified on testnet: guest `g4b1793d4…` rescued Mochi IV with 0 NEAR and owns `hero-4-2`. [`web/server/relay.ts`](web/server/relay.ts), [`web/src/chain/guest.ts`](web/src/chain/guest.ts)
- [ ] **12. Hosting:** must also run `web/server/` (`/rpc`, `/api/mochi`, `/api/guest`, `/api/relay`) as serverless functions, with `NEAR_AI_API_KEY` and `RELAYER_PRIVATE_KEY` as secrets. Rate limits are in-memory today (per instance). Needs a host with server functions (e.g. Vercel); static hosting alone (GitHub Pages) can't run the relayer or the AI. Keep it up until at least Nov 18 (ideally Nov 25).
- [ ] **13. Telegram bot:** grammY alerts (brief section 11). First to cut.
- [ ] **14. README polish:** testnet contract + DAO addresses, working "try it in 5 minutes" steps against the hosted app, libraries used, limitations, prior art; add `.env.example`.
- [ ] **15. Demo video + X post:** recorded and posted by the team (brief section 20).
- [ ] **16. Team decisions:** team lead name and team size, the mainnet payout account (the team creates it), making the repo public, whether anyone submits a second project.
- [ ] **17. Submission:** before **2026-11-14 23:59 UTC** (aim ~18:00). Print the full payload, get a human yes, never fill `website`. Fix mistakes via request-changes, never by resubmitting.
