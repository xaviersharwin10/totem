//! Read-only views. These project the live state at `now` without writing, so the
//! UI is always accurate between settles.

use crate::game::meal_size_for;
use crate::{Config, Contract, ContractExt, Mood, FULL_BP};
use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, AccountId};

#[near(serializers = [json])]
pub struct TotemView {
    pub totem_id: String,
    pub generation: u32,
    pub name: String,
    pub owner: AccountId,
    pub alive: bool,
    pub fullness_bp: u32,
    pub mood: String,
    pub level: u32,
    pub max_level: u32,
    pub form: String,
    pub xp_happy_days: u32,
    pub next_level_happy_days: Option<u32>,
    pub hoard: U128,
    pub reserved: U128,
    pub meal_size: U128,
    /// Tokens to fill from the current fullness to 100%.
    pub fill_amount: U128,
    pub seconds_until_starving: Option<U64>,
    pub seconds_until_rampage: Option<U64>,
    pub seconds_until_death: Option<U64>,
}

#[near(serializers = [json])]
pub struct StatsView {
    pub total_supply: U128,
    pub total_burned: U128,
    pub total_fed: U128,
    pub total_blessed: U128,
    pub hoard: U128,
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
pub struct PeriodView {
    pub period_id: u64,
    pub total_points: U128,
    pub reserved: U128,
    pub claimed: U128,
}

#[near]
impl Contract {
    /// Live projected state of the creature at the current block time.
    pub fn get_totem(&self) -> TotemView {
        let now = env::block_timestamp();
        let (fullness, in_rampage, rampage_dur) = self.project_fullness(now);
        let alive = self.alive;
        let mood = self.mood_for(fullness, alive, in_rampage);

        let happy_days = self.project_happy_days(now);
        let level = self.level_for(happy_days).max(self.level);
        let next = self.next_level_threshold(level);

        let ms = meal_size_for(&self.cfg, level, self.form);
        let room_bp = (FULL_BP - fullness) as u128;
        let fill = ms * room_bp / FULL_BP as u128;

        let day = self.cfg.day_length_ns;
        let secs = |ns: u64| ns / crate::config::NANOS_PER_SEC;

        let until_starving = if fullness > self.cfg.starving_threshold_bp {
            Some(U64(secs(
                (fullness - self.cfg.starving_threshold_bp) as u64 * day / FULL_BP as u64,
            )))
        } else {
            None
        };
        let until_rampage = if fullness > 0 {
            Some(U64(secs(fullness as u64 * day / FULL_BP as u64)))
        } else {
            None
        };
        let until_death = if in_rampage && alive {
            Some(U64(secs(
                self.cfg.death_after_ns.saturating_sub(rampage_dur),
            )))
        } else {
            None
        };

        TotemView {
            totem_id: self.totem_id.clone(),
            generation: self.generation,
            name: self.name.clone(),
            owner: self.owner_id.clone(),
            alive,
            fullness_bp: fullness,
            mood: mood.as_str().to_string(),
            level,
            max_level: self.max_level.max(level),
            form: self.form.as_str().to_string(),
            xp_happy_days: happy_days,
            next_level_happy_days: next,
            hoard: U128(self.hoard),
            reserved: U128(self.reserved),
            meal_size: U128(ms),
            fill_amount: U128(fill),
            seconds_until_starving: until_starving,
            seconds_until_rampage: until_rampage,
            seconds_until_death: until_death,
        }
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
            hoard: U128(self.hoard),
            reserved: U128(self.reserved),
        }
    }

    pub fn get_caretaker(&self, account_id: AccountId) -> CaretakerView {
        let lt = self.lifetime_points.get(&account_id).copied().unwrap_or(0);
        let earned = crate::rewards::tier_name(self.tier_for(lt));
        let claimed = crate::rewards::tier_name(
            self.badges_claimed.get(&account_id).copied().unwrap_or(0),
        );
        CaretakerView {
            account_id,
            lifetime_points: U128(lt),
            badge_earned: earned.to_string(),
            badge_claimed: claimed.to_string(),
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
        U128(reserve * my / total)
    }

    // ------------------------------------------------------------------ //
    // projection helpers (read-only mirrors of the settle math)
    // ------------------------------------------------------------------ //

    fn project_fullness(&self, now: u64) -> (u32, bool, u64) {
        if !self.alive {
            return (0, false, 0);
        }
        if now <= self.last_settled_at {
            let in_r = self.rampage_started_at.is_some();
            let rd = self
                .rampage_started_at
                .map(|s| now.saturating_sub(s))
                .unwrap_or(0);
            return (self.fullness_bp, in_r, rd);
        }
        let day = self.cfg.day_length_ns;
        let elapsed = now - self.last_settled_at;
        let f0 = self.fullness_bp;
        let to_zero = (f0 as u128 * day as u128 / FULL_BP as u128) as u64;
        if elapsed < to_zero {
            let drain = (elapsed as u128 * FULL_BP as u128 / day as u128) as u32;
            (f0.saturating_sub(drain), false, 0)
        } else {
            let z = self.last_settled_at + to_zero;
            let r_start = self.rampage_started_at.unwrap_or(z);
            (0, true, now.saturating_sub(r_start))
        }
    }

    fn project_happy_days(&self, now: u64) -> u32 {
        let mut happy = self.happy_ns;
        if self.alive && now > self.last_settled_at {
            let f0 = self.fullness_bp;
            if f0 > self.cfg.happy_threshold_bp {
                let day = self.cfg.day_length_ns;
                let elapsed = now - self.last_settled_at;
                let drop_bp = (f0 - self.cfg.happy_threshold_bp) as u128;
                let dur = (drop_bp * day as u128 / FULL_BP as u128) as u64;
                happy += dur.min(elapsed);
            }
        }
        (happy / self.cfg.day_length_ns) as u32
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

    /// Cumulative Happy-days needed for the level after `level` (None if unbounded math).
    fn next_level_threshold(&self, level: u32) -> Option<u32> {
        let t = &self.cfg.level_thresholds;
        let idx = (level - 1) as usize;
        if idx < t.len() {
            Some(t[idx])
        } else {
            let base = *t.last().unwrap();
            let steps_past = (level as usize) - t.len();
            Some(base + self.cfg.level_step_after * (steps_past as u32 + 1))
        }
    }
}
