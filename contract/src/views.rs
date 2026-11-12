//! Read-only views. These project the live state at `now` without writing,
//! including Rampage bites that have fallen due but not yet been settled, so the
//! UI is always accurate between settles.

use crate::game::{bite_math, level_floor_days, level_for, meal_size_for};
use crate::lineage::{lineage_name, LifeRecord, Traits};
use crate::staking::Belly;
use crate::{Config, Contract, ContractExt, Mood, FULL_BP, NANOS_PER_SEC};
use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, AccountId};

#[near(serializers = [json])]
pub struct TotemView {
    pub totem_id: String,
    pub generation: u32,
    pub name: String,
    /// Name with the generation numeral, e.g. "Grumbo II".
    pub lineage_name: String,
    pub owner: AccountId,
    pub alive: bool,
    pub fullness_bp: u32,
    pub mood: String,
    pub level: u32,
    pub max_level: u32,
    /// Bites the Totem can survive from here (each bite costs a level; death at 0).
    pub bites_until_death: u32,
    pub form: String,
    pub xp_happy_days: u32,
    pub next_level_happy_days: Option<u32>,
    /// Totem-owned part of the Hoard: the balance of `treasury`.
    pub reserve: U128,
    /// The Totem's treasury sub-account `totem-<gen>.<contract>` (no access keys).
    pub treasury: AccountId,
    /// Every token the contract holds for stakers, all generations, until withdrawn.
    pub total_staked: U128,
    /// Stakes in the living Totem's belly (0 while dead).
    pub living_staked: U128,
    /// Stakes of dead generations, free to withdraw: their owners', not the tribe's.
    pub released_stakes: U128,
    /// reserve + living_staked, the number shown as "the Hoard". Released
    /// stakes are not part of it; a dead Totem's Hoard is 0 (its Reserve burned).
    pub hoard: U128,
    /// Blessings reserved and not yet claimed.
    pub reserved: U128,
    pub meal_size: U128,
    /// Tokens to fill from the current fullness to 100%.
    pub fill_amount: U128,
    pub traits: Traits,
    pub founders: Vec<AccountId>,
    pub seconds_until_starving: Option<U64>,
    pub seconds_until_rampage: Option<U64>,
    /// Seconds until the next bite (the first one if not yet in Rampage).
    pub seconds_until_next_bite: Option<U64>,
    /// Seconds until death if nobody feeds it.
    pub seconds_until_death: Option<U64>,
    /// Tonight's real moon (moon.rs): how lit it is, 0 = new, 10_000 = full.
    pub moon_bp: u32,
    /// "new moon", "waxing crescent", … "full moon", …
    pub moon_phase: String,
    /// How fast the belly empties under this moon (10_000 = normal, 15_000 = 1.5x).
    pub hunger_bp: u32,
    /// Share of the next meal that burns under this moon.
    pub burn_share_bp: u32,
    /// Feeding now earns the Moonlit badge (if not already earned this cycle).
    pub moonlit_now: bool,
}

/// Who may be a Keeper (vote on hatch / rename / evolve and on new Keepers in
/// the tribe's DAO). One rule, read by the app, the scripts and the voters.
#[near(serializers = [json])]
pub struct KeeperView {
    pub account_id: AccountId,
    pub eligible: bool,
    /// ≥ keeper_stake staked in the living generation, or in the generation that
    /// just died and is waiting for its successor (until withdrawn).
    pub by_stake: bool,
    /// Earned the Silver or Gold Caretaker tier (lifetime points).
    pub by_badge: bool,
    pub staked: U128,
    pub badge_earned: String,
}

#[near(serializers = [json])]
pub struct StakeView {
    pub account_id: AccountId,
    pub generation: u32,
    /// Current post-slash value, excluding unbonding.
    pub staked: U128,
    pub unbonding: U128,
    pub seconds_until_unbonded: Option<U64>,
    pub shielded: bool,
    pub seconds_shield_left: Option<U64>,
    /// True if this stake's generation has died: everything is withdrawable now.
    pub released: bool,
    pub staker_bonus: bool,
    pub keeper_eligible: bool,
}

#[near(serializers = [json])]
pub struct StatsView {
    pub total_supply: U128,
    pub total_burned: U128,
    pub total_fed: U128,
    pub total_blessed: U128,
    pub reserve: U128,
    pub total_staked: U128,
    pub reserved: U128,
}

#[near(serializers = [json])]
pub struct CaretakerView {
    pub account_id: AccountId,
    pub lifetime_points: U128,
    pub badge_earned: String,
    pub badge_claimed: String,
}

#[near(serializers = [json])]
pub struct ClaimView {
    pub period_id: u64,
    pub amount: U128,
    /// Periods left to claim before it returns to the Reserve (None: no deadline,
    /// because its generation has ended).
    pub periods_left: Option<u64>,
}

#[near(serializers = [json])]
pub struct PeriodView {
    pub period_id: u64,
    pub total_points: U128,
    pub reserved: U128,
    pub claimed: U128,
}

/// The live state projected to `now`.
struct Projection {
    fullness: u32,
    alive: bool,
    in_rampage: bool,
    level: u32,
    happy_days: u32,
    reserve: u128,
    belly: Belly,
    /// Times of bites that are due but not yet settled.
    pending: Vec<u64>,
    /// Burned / slashed by the pending bites (and the Reserve burned at a projected death).
    burned: u128,
    slashed: u128,
    /// Highest level reached once pending XP is counted (before pending bites).
    peak_level: u32,
    /// Time of the final bite, if the projection says the Totem died.
    died_at: Option<u64>,
    /// Start of the (projected) current Rampage.
    rampage_start: Option<u64>,
    bites_done: u64,
}

#[near]
impl Contract {
    /// Live projected state of the creature at the current block time.
    pub fn get_totem(&self) -> TotemView {
        let now = env::block_timestamp();
        let p = self.project(now);
        let mood = self.mood_for(p.fullness, p.alive, p.in_rampage);
        let next = if p.alive {
            Some(level_floor_days(&self.cfg, p.level + 1))
        } else {
            None
        };

        let ms = meal_size_for(&self.cfg, p.level.max(1), self.form);
        let room_bp = (FULL_BP - p.fullness) as u128;
        let fill = if p.alive {
            ms * room_bp / FULL_BP as u128
        } else {
            0
        };

        let day = crate::moon::drain_day_ns(&self.cfg, now);
        let iv = self.cfg.bite_interval_ns;
        let secs = |ns: u64| U64(ns / NANOS_PER_SEC);
        let alive_and = |v: Option<U64>| if p.alive { v } else { None };

        let to_starving = (p.fullness > self.cfg.starving_threshold_bp).then(|| {
            secs((p.fullness - self.cfg.starving_threshold_bp) as u64 * day / FULL_BP as u64)
        });
        let to_rampage_ns = p.fullness as u64 * day / FULL_BP as u64;
        let next_bite_ns = match p.rampage_start {
            Some(r) => (r + (p.bites_done + 1) * iv).saturating_sub(now),
            None => to_rampage_ns + iv,
        };
        let death_ns = next_bite_ns + (p.level.saturating_sub(1) as u64) * iv;
        // The living generation's stakes; the rest of total_staked is released
        // (dead generations) or rounding dust.
        let living = if p.alive {
            let b = &p.belly;
            (b.unshielded + b.buckets.iter().map(|(_, a)| a).sum::<u128>()).min(b.total_staked)
        } else {
            0
        };

        TotemView {
            totem_id: self.totem_id.clone(),
            generation: self.generation,
            name: self.name.clone(),
            lineage_name: lineage_name(&self.name, self.generation),
            owner: self.totem_owner(),
            alive: p.alive,
            fullness_bp: p.fullness,
            mood: mood.as_str().to_string(),
            level: p.level,
            max_level: self.max_level.max(p.level),
            bites_until_death: p.level,
            form: self.form.as_str().to_string(),
            xp_happy_days: p.happy_days,
            next_level_happy_days: next,
            reserve: U128(p.reserve),
            treasury: self.treasury_id(),
            total_staked: U128(p.belly.total_staked),
            living_staked: U128(living),
            released_stakes: U128(p.belly.total_staked.saturating_sub(living)),
            hoard: U128(p.reserve + living),
            reserved: U128(self.reserved),
            meal_size: U128(ms),
            fill_amount: U128(fill),
            traits: self.traits.clone(),
            founders: self.founders.clone(),
            seconds_until_starving: alive_and(to_starving),
            seconds_until_rampage: alive_and((p.fullness > 0).then(|| secs(to_rampage_ns))),
            seconds_until_next_bite: alive_and(Some(secs(next_bite_ns))),
            seconds_until_death: alive_and(Some(secs(death_ns))),
            moon_bp: crate::moon::moon_bp(now),
            moon_phase: crate::moon::phase_name(now).to_string(),
            hunger_bp: crate::moon::hunger_bp(&self.cfg, now),
            burn_share_bp: crate::moon::burn_share_bp(&self.cfg, now),
            moonlit_now: p.alive && crate::moon::moon_bp(now) >= self.cfg.moonlit_min_bp,
        }
    }

    /// An account's stake, projected to now (pending bites applied).
    pub fn get_stake(&self, account_id: AccountId) -> Option<StakeView> {
        let s = self.stakes.get(&account_id)?;
        let now = env::block_timestamp();
        let p = self.project(now);
        let released = s.generation != self.generation || !p.alive;
        let mut bites = self.gen_bites(s.generation).to_vec();
        if s.generation == self.generation {
            bites.extend_from_slice(&p.pending);
        }
        let (principal, unbonding) = s.value_after(&bites, self.cfg.stake_slash_bp);
        let shielded = !released && s.shield_until > now;
        Some(StakeView {
            account_id,
            generation: s.generation,
            staked: U128(principal),
            unbonding: U128(unbonding),
            seconds_until_unbonded: (unbonding > 0 && !released && s.unbond_at > now)
                .then(|| U64((s.unbond_at - now) / NANOS_PER_SEC)),
            shielded,
            seconds_shield_left: shielded.then(|| U64((s.shield_until - now) / NANOS_PER_SEC)),
            released,
            staker_bonus: !released && principal >= self.cfg.min_stake.0,
            // Stakers of the generation that just died keep their say over its
            // successor until they withdraw.
            keeper_eligible: principal >= self.cfg.keeper_stake.0
                && (!released || (s.generation == self.generation && !p.alive)),
        })
    }

    /// The family tree: every generation from `from` (default 1), gravestones
    /// plus the living (or freshly dead, not yet hatched) Totem, with parent links.
    pub fn get_lineage(&self, from: Option<u32>, limit: Option<u32>) -> Vec<LifeRecord> {
        let from = from.unwrap_or(1).max(1);
        let limit = limit.unwrap_or(50).min(100);
        let mut out = Vec::new();
        let mut g = from;
        while g <= self.generation && (out.len() as u32) < limit {
            if let Some(rec) = self.graves.get(&g) {
                out.push(rec.clone());
            } else if g == self.generation {
                out.push(self.projected_life_record(env::block_timestamp()));
            }
            g += 1;
        }
        out
    }

    /// Flat list of gravestones (dead generations only).
    pub fn get_graveyard(&self, from: Option<u32>, limit: Option<u32>) -> Vec<LifeRecord> {
        self.get_lineage(from, limit)
            .into_iter()
            .filter(|r| !r.alive)
            .collect()
    }

    /// All immutable parameters. Proves there is no admin key and nothing hidden.
    pub fn get_config(&self) -> Config {
        self.cfg.clone()
    }

    pub fn get_stats(&self) -> StatsView {
        StatsView {
            total_supply: U128(self.token.total_supply),
            total_burned: U128(self.total_burned),
            total_fed: U128(self.total_fed),
            total_blessed: U128(self.total_blessed),
            reserve: U128(self.reserve),
            total_staked: U128(self.belly.total_staked),
            reserved: U128(self.reserved),
        }
    }

    pub fn get_caretaker(&self, account_id: AccountId) -> CaretakerView {
        let lt = self.lifetime_points.get(&account_id).copied().unwrap_or(0);
        let earned = crate::rewards::tier_name(self.tier_for(lt));
        let claimed =
            crate::rewards::tier_name(self.badges_claimed.get(&account_id).copied().unwrap_or(0));
        CaretakerView {
            account_id,
            lifetime_points: U128(lt),
            badge_earned: earned.to_string(),
            badge_claimed: claimed.to_string(),
        }
    }

    pub fn get_keeper(&self, account_id: AccountId) -> KeeperView {
        let stake = self.get_stake(account_id.clone());
        let by_stake = stake.as_ref().is_some_and(|s| s.keeper_eligible);
        let staked = stake.map(|s| s.staked).unwrap_or(U128(0));
        let lt = self.lifetime_points.get(&account_id).copied().unwrap_or(0);
        let tier = self.tier_for(lt);
        KeeperView {
            account_id,
            eligible: by_stake || tier >= 2,
            by_stake,
            by_badge: tier >= 2,
            staked,
            badge_earned: crate::rewards::tier_name(tier).to_string(),
        }
    }

    pub fn get_period(&self, period_id: u64) -> PeriodView {
        PeriodView {
            period_id,
            total_points: U128(self.period_totals.get(&period_id).copied().unwrap_or(0)),
            reserved: U128(self.period_reserved.get(&period_id).copied().unwrap_or(0)),
            claimed: U128(self.period_claimed.get(&period_id).copied().unwrap_or(0)),
        }
    }

    /// Claimable Blessing share for an account in a given period (0 if none/claimed).
    pub fn get_blessing_share(&self, period_id: u64, account_id: AccountId) -> U128 {
        let reserve = self.period_reserved.get(&period_id).copied().unwrap_or(0);
        let total = self.period_totals.get(&period_id).copied().unwrap_or(0);
        if reserve == 0 || total == 0 {
            return U128(0);
        }
        let my = self
            .period_points
            .get(&(period_id, account_id))
            .copied()
            .unwrap_or(0);
        let claimed = self.period_claimed.get(&period_id).copied().unwrap_or(0);
        let share = reserve * my / total;
        // expired (returned to the Reserve) or otherwise not payable
        U128(if claimed + share <= reserve { share } else { 0 })
    }

    /// Every Blessing this account can claim now, newest first. Scans the last
    /// 32 closed periods (bounded gas); older ones have long been returned.
    pub fn get_claimable(&self, account_id: AccountId) -> Vec<ClaimView> {
        let last = self.last_closed_period;
        let from = last.saturating_sub(32);
        let ret = self.cfg.unclaimed_return_periods;
        (from..last)
            .rev()
            .filter_map(|p| {
                let amount = self.get_blessing_share(p, account_id.clone()).0;
                (amount > 0).then(|| ClaimView {
                    period_id: p,
                    amount: U128(amount),
                    // while this generation's periods keep closing, the share
                    // returns to the Reserve when period p + ret closes
                    periods_left: self
                        .blessing_epoch_start
                        .is_some()
                        .then(|| (p + ret + 1).saturating_sub(last)),
                })
            })
            .collect()
    }

    // ------------------------------------------------------------------ //
    // projection (a read-only mirror of settle)
    // ------------------------------------------------------------------ //

    fn project(&self, now: u64) -> Projection {
        let mut p = Projection {
            fullness: self.fullness_bp,
            alive: self.alive,
            in_rampage: self.rampage_started_at.is_some(),
            level: self.level,
            happy_days: (self.happy_ns / self.cfg.day_length_ns) as u32,
            reserve: self.reserve,
            belly: self.belly.clone(),
            pending: vec![],
            burned: 0,
            slashed: 0,
            peak_level: self.max_level,
            died_at: None,
            rampage_start: self.rampage_started_at,
            bites_done: self.bites_applied,
        };
        if !self.alive {
            p.fullness = 0;
            p.in_rampage = false;
            p.level = 0;
            p.rampage_start = None;
            return p;
        }
        if now <= self.last_settled_at {
            return p;
        }
        let day = crate::moon::drain_day_ns(&self.cfg, now); // same as settle
        let elapsed = now - self.last_settled_at;
        let f0 = self.fullness_bp;

        let mut happy_ns = self.happy_ns;
        if f0 > self.cfg.happy_threshold_bp {
            let drop_bp = (f0 - self.cfg.happy_threshold_bp) as u128;
            let dur = (drop_bp * day as u128 / FULL_BP as u128) as u64;
            happy_ns += dur.min(elapsed);
        }
        p.happy_days = (happy_ns / self.cfg.day_length_ns) as u32;
        p.level = level_for(&self.cfg, p.happy_days).max(self.level);
        p.peak_level = p.peak_level.max(p.level);

        let to_zero = (f0 as u128 * day as u128 / FULL_BP as u128) as u64;
        if elapsed < to_zero {
            let drain = (elapsed as u128 * FULL_BP as u128 / day as u128) as u32;
            p.fullness = f0.saturating_sub(drain);
        } else {
            p.fullness = 0;
            p.in_rampage = true;
            let r = self
                .rampage_started_at
                .unwrap_or(self.last_settled_at + to_zero);
            if self.rampage_started_at.is_none() {
                p.bites_done = 0;
            }
            p.rampage_start = Some(r);
            let iv = self.cfg.bite_interval_ns;
            let due = (now - r) / iv;
            while p.level > 0 && p.bites_done < due {
                p.bites_done += 1;
                let t = r + p.bites_done * iv;
                p.belly.expire(t);
                let (burn, slashed) = bite_math(&mut p.reserve, &mut p.belly, &self.cfg);
                p.burned += burn;
                p.slashed += slashed;
                p.level -= 1;
                p.happy_days = level_floor_days(&self.cfg, p.level);
                p.pending.push(t);
            }
            if p.level == 0 {
                p.alive = false;
                p.died_at = p.pending.last().copied();
                p.burned += p.reserve; // death burns what is left of the Reserve
                p.reserve = 0;
                p.in_rampage = false;
                p.rampage_start = None;
            }
        }
        p.belly.expire(now);
        p
    }

    /// The current generation's life record projected to `now`: pending bites
    /// are counted, and a Totem that starved but was not settled by a
    /// transaction yet already shows as dead with its gravestone record.
    pub(crate) fn projected_life_record(&self, now: u64) -> crate::LifeRecord {
        let p = self.project(now);
        let cause = p.died_at.map(|_| "starved at Level 0".to_string());
        let mut rec = self.life_record(p.died_at, cause);
        rec.stats.burned.0 += p.burned;
        rec.stats.slashed.0 += p.slashed;
        rec.max_level = rec.max_level.max(p.peak_level);
        rec
    }

    fn mood_for(&self, fullness: u32, alive: bool, in_rampage: bool) -> Mood {
        if !alive {
            return Mood::Dead;
        }
        if in_rampage || fullness == 0 {
            return Mood::Rampage;
        }
        if fullness >= self.cfg.happy_threshold_bp {
            Mood::Happy
        } else if fullness >= self.cfg.starving_threshold_bp {
            Mood::Hungry
        } else {
            Mood::Starving
        }
    }
}
