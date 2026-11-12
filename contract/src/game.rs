//! Core game loop: lazy time settlement, feeding, Rampage bites, level loss,
//! death and the gravestone.

use crate::events;
use crate::lineage::{self, LifeRecord};
use crate::staking::Belly;
use crate::{Config, Contract, ContractExt, Form, FULL_BP, ONE_TOKEN};
use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, AccountId, Promise};

#[near]
impl Contract {
    /// Feed the creature. Takes only what fits (excess is not debited), burns the
    /// burn share, adds the rest to the Reserve, awards points (x2 if rescuing,
    /// x1.5 if staked >= min_stake), shields the feeder's stake if the feed is at
    /// least `shield_min_feed`, and ends any Rampage.
    pub fn feed(&mut self, amount: U128) {
        self.settle();
        assert!(
            self.alive,
            "the Totem is dead; the DAO must hatch a new egg"
        );
        let caller = env::predecessor_account_id();
        let want = amount.0;
        assert!(want > 0, "amount must be positive");

        let ms = self.meal_size();
        let room_bp = (FULL_BP - self.fullness_bp) as u128;
        let max_accept = ms * room_bp / FULL_BP as u128;
        let accepted = want.min(max_accept);
        assert!(accepted > 0, "the Totem is full");

        let rescue = self.fullness_bp < self.cfg.starving_threshold_bp;
        let staker = self.live_principal(&caller) >= self.cfg.min_stake.0;

        let now = env::block_timestamp();
        // a brighter moon burns a bigger share of the meal (moon.rs)
        let burn = accepted * crate::moon::burn_share_bp(&self.cfg, now) as u128 / FULL_BP as u128;
        let to_reserve = accepted - burn;

        // Move the Reserve share into the Totem's treasury account (supply
        // unchanged), then burn the rest (supply down).
        let treasury = self.treasury_id();
        self.token
            .internal_transfer(&caller, &treasury, to_reserve, None);
        self.token.internal_withdraw(&caller, burn);
        self.reserve += to_reserve;
        self.total_burned += burn;
        self.total_fed += accepted;
        self.gen_stats.fed.0 += accepted;
        self.gen_stats.burned.0 += burn;
        events::ft_burn(&caller, burn);

        let gain_bp = (accepted * FULL_BP as u128 / ms) as u32;
        self.fullness_bp = (self.fullness_bp + gain_bp).min(FULL_BP);

        if self.rampage_started_at.is_some() {
            // Bites already taken (levels lost, stake slashed) are not undone.
            self.rampage_started_at = None;
            self.bites_applied = 0;
            events::rampage_end(&caller);
            self.resolve_predict_market(true);
            self.mint_hero(&caller);
        }

        // Lineage: track this generation's top feeders by tokens fed.
        let key = (self.generation, caller.clone());
        let fed = self.gen_fed.get(&key).copied().unwrap_or(0) + accepted;
        self.gen_fed.insert(key, fed);
        lineage::bump_top3(&mut self.top_feeders, &caller, fed);

        if accepted >= self.cfg.shield_min_feed.0 {
            self.extend_shield(&caller);
        }

        // feeding under a (nearly) full moon: the Moonlit badge, once per lunar cycle
        if crate::moon::moon_bp(now) >= self.cfg.moonlit_min_bp {
            let id = format!("moonlit-{}-{}", crate::moon::cycle(now), caller);
            if self.nft.owner_by_id.get(&id).is_none() {
                self.mint_badge(&caller, "moonlit", id, "Moonlit Feeder".to_string());
                events::badge_minted(&caller, "moonlit");
            }
        }

        let whole = accepted / ONE_TOKEN;
        let mut pts = whole
            * if rescue {
                self.cfg.rescue_multiplier as u128
            } else {
                1
            };
        if staker {
            pts = pts * self.cfg.staker_points_num as u128 / self.cfg.staker_points_den as u128;
        }
        self.award_points(&caller, pts);

        events::feed(&caller, accepted, burn, to_reserve, pts, rescue, staker);
    }

    /// Permissionless keeper call: settle state. If it applies at least one bite,
    /// the caller receives `poke_tip` of the Reserve burned by those bites.
    pub fn poke(&mut self) {
        let poker = env::predecessor_account_id();
        self.settle_inner(Some(poker));
    }

    /// Demo-only faucet: mints `faucet_amount` once per Totem-day per account.
    pub fn faucet(&mut self) {
        assert!(self.cfg.demo_mode, "faucet is only available in demo mode");
        let caller = env::predecessor_account_id();
        let now = env::block_timestamp();
        if let Some(&last) = self.faucet_last.get(&caller) {
            assert!(
                now - last >= self.cfg.day_length_ns,
                "faucet can be claimed once per Totem-day"
            );
        }
        if !self.is_registered(&caller) {
            self.token.internal_register_account(&caller);
        }
        self.token
            .internal_deposit(&caller, self.cfg.faucet_amount.0);
        crate::events::ft_mint(&caller, self.cfg.faucet_amount.0, "demo faucet");
        self.faucet_last.insert(caller, now);
    }

    // ------------------------------------------------------------------ //
    // internal helpers
    // ------------------------------------------------------------------ //

    pub(crate) fn settle(&mut self) {
        self.settle_inner(None);
    }

    /// Advance all time-based state from `last_settled_at` to now, in time order:
    /// XP and level-ups while fed, drain, Rampage start, then each due bite
    /// (interleaved with shield expiries), then death at Level 0.
    ///
    /// Bounded gas: every bite removes a level and death stops the loop, so at
    /// most `level` bites run; shield buckets number at most ~25.
    fn settle_inner(&mut self, poker: Option<AccountId>) {
        self.ensure_treasury();
        let now = env::block_timestamp();
        if now <= self.last_settled_at {
            return;
        }
        if !self.alive {
            self.last_settled_at = now;
            return;
        }

        // how long a full belly lasts under tonight's moon (moon.rs)
        let day = crate::moon::drain_day_ns(&self.cfg, now);
        let elapsed = now - self.last_settled_at;
        let f0 = self.fullness_bp;

        // XP: time spent at or above the Happy threshold during this interval.
        if f0 > self.cfg.happy_threshold_bp {
            let drop_bp = (f0 - self.cfg.happy_threshold_bp) as u128;
            let happy_dur = (drop_bp * day as u128 / FULL_BP as u128) as u64;
            self.happy_ns += happy_dur.min(elapsed);
        }
        // Level-ups earned while fed happen before any bite in this interval.
        self.update_level();

        let to_zero = (f0 as u128 * day as u128 / FULL_BP as u128) as u64;
        if elapsed < to_zero {
            let drain_bp = (elapsed as u128 * FULL_BP as u128 / day as u128) as u32;
            self.fullness_bp = f0.saturating_sub(drain_bp);
        } else {
            self.fullness_bp = 0;
            if self.rampage_started_at.is_none() {
                self.rampage_started_at = Some(self.last_settled_at + to_zero);
                self.bites_applied = 0;
                events::rampage_start();
                self.open_predict_market(self.last_settled_at + to_zero);
            }
            let r_start = self.rampage_started_at.unwrap();
            let due = (now - r_start) / self.cfg.bite_interval_ns;
            while self.alive && self.bites_applied < due {
                self.bites_applied += 1;
                let t = r_start + self.bites_applied * self.cfg.bite_interval_ns;
                self.belly.expire(t);
                self.apply_bite(t, &poker);
            }
        }

        if self.alive {
            self.belly.expire(now);
            self.maybe_default_evolution(now);
            self.close_due_periods(now);
        }
        self.last_settled_at = now;
    }

    /// One Rampage bite at time `t`: burn `bite_burn` of the Reserve (minus the
    /// poke tip), slash every unshielded stake into the Reserve, drop a level,
    /// and die at Level 0.
    fn apply_bite(&mut self, t: u64, poker: &Option<AccountId>) {
        let (burn, slashed) = bite_math(&mut self.reserve, &mut self.belly, &self.cfg);
        let current = env::current_account_id();
        let treasury = self.treasury_id();
        // slashed stake leaves the belly (held by the contract) for the treasury
        if slashed > 0 {
            self.token.internal_transfer(&current, &treasury, slashed, None);
        }
        let mut tip = 0u128;
        if let Some(p) = poker {
            let tt = burn * self.cfg.poke_tip_bp as u128 / FULL_BP as u128;
            if tt > 0 && self.is_registered(p) && p != &current && p != &treasury {
                tip = tt;
                self.token.internal_transfer(&treasury, p, tip, None);
            }
        }
        let burned = burn - tip;
        if burned > 0 {
            self.token.internal_withdraw(&treasury, burned);
            events::ft_burn(&treasury, burned);
        }
        self.total_burned += burned;
        self.gen_stats.burned.0 += burned;
        self.gen_stats.slashed.0 += slashed;

        let mut list = self
            .bites
            .get(&self.generation)
            .cloned()
            .unwrap_or_default();
        list.push(t);
        self.bites.insert(self.generation, list);

        self.level -= 1;
        self.happy_ns = self.level_floor_days(self.level) as u64 * self.cfg.day_length_ns;
        events::bite(
            burned,
            slashed,
            tip,
            poker.as_ref(),
            self.reserve,
            self.level,
        );
        if self.level > 0 {
            events::level_down(self.level);
        } else {
            self.die(t);
        }
    }

    /// Level 0: burn the Reserve, release stakes, freeze the gravestone.
    fn die(&mut self, at: u64) {
        if self.reserve > 0 {
            let treasury = self.treasury_id();
            self.token.internal_withdraw(&treasury, self.reserve);
            self.total_burned += self.reserve;
            self.gen_stats.burned.0 += self.reserve;
            events::ft_burn(&treasury, self.reserve);
            self.reserve = 0;
        }
        self.alive = false;
        self.rampage_started_at = None;
        self.resolve_predict_market(false);
        // Stakes are released: values are frozen at their post-slash amounts and
        // withdrawable at once. The live aggregate is no longer needed.
        self.belly.unshielded = 0;
        self.belly.buckets.clear();

        let rec = self.life_record(Some(at), Some("starved at Level 0".to_string()));
        events::death(
            self.generation,
            &rec.lineage_name,
            self.max_level,
            rec.lifespan_sec.map(|s| s.0).unwrap_or(0),
        );
        self.engrave_gravestone(&rec);
        self.graves.insert(self.generation, rec);
    }

    /// The current generation's life record (a gravestone if `died_at` is set).
    pub(crate) fn life_record(&self, died_at: Option<u64>, cause: Option<String>) -> LifeRecord {
        LifeRecord {
            generation: self.generation,
            totem_id: self.totem_id.clone(),
            name: self.name.clone(),
            lineage_name: lineage::lineage_name(&self.name, self.generation),
            parent: if self.generation > 1 {
                Some(self.generation - 1)
            } else {
                None
            },
            alive: died_at.is_none(),
            born_at: U64(self.born_at),
            died_at: died_at.map(U64),
            lifespan_sec: died_at
                .map(|d| U64(d.saturating_sub(self.born_at) / crate::config::NANOS_PER_SEC)),
            max_level: self.max_level,
            form: self.form.as_str().to_string(),
            cause_of_death: cause,
            traits: self.traits.clone(),
            founders: self.founders.clone(),
            top_feeders: self
                .top_feeders
                .iter()
                .map(|(a, v)| (a.clone(), U128(*v)))
                .collect(),
            stats: self.gen_stats.clone(),
        }
    }

    /// Level-ups from XP. Levels only go down through bites.
    fn update_level(&mut self) {
        let happy_days = (self.happy_ns / self.cfg.day_length_ns) as u32;
        let new_level = self.level_for(happy_days);
        if new_level > self.level {
            self.level = new_level;
            if self.level > self.max_level {
                self.max_level = self.level;
            }
            if self.level >= 4 && self.form == Form::Egg && self.l4_reached_at.is_none() {
                self.l4_reached_at = Some(env::block_timestamp());
            }
            if self.level >= 3 && self.blessing_epoch_start.is_none() {
                self.blessing_epoch_start = Some(env::block_timestamp());
                self.last_closed_period = self.period_base;
            }
            events::level_up(self.level);
        }
    }

    pub(crate) fn level_for(&self, happy_days: u32) -> u32 {
        level_for(&self.cfg, happy_days)
    }

    /// Cumulative Happy-days at which `level` begins (its XP floor).
    pub(crate) fn level_floor_days(&self, level: u32) -> u32 {
        level_floor_days(&self.cfg, level)
    }

    fn maybe_default_evolution(&mut self, now: u64) {
        if self.form == Form::Egg {
            if let Some(l4) = self.l4_reached_at {
                if now > l4 + self.cfg.evolution_deadline_ns {
                    self.form = Form::Golem;
                    events::evolve(self.form.as_str());
                }
            }
        }
    }

    /// Meal size (tokens to go 0% -> 100%) at the current level and form.
    pub(crate) fn meal_size(&self) -> u128 {
        meal_size_for(&self.cfg, self.level, self.form)
    }

    pub(crate) fn is_registered(&self, account: &AccountId) -> bool {
        self.token.accounts.contains_key(account)
    }

    /// The living Totem's treasury: the sub-account `totem-<gen>.<contract>`.
    /// Its $TOTEM balance is the Reserve, always equal to `self.reserve`.
    pub(crate) fn treasury_id(&self) -> AccountId {
        format!("{}.{}", self.totem_id, env::current_account_id())
            .parse()
            .expect("valid treasury account id")
    }

    /// Open the current generation's treasury once: register it in the ledger,
    /// move any Reserve still held by the contract itself into it (one-time
    /// migration from the pre-treasury layout), and create the real NEAR
    /// account with no access keys: nobody can ever sign for it, so its tokens
    /// move only by this contract's rules.
    pub(crate) fn ensure_treasury(&mut self) {
        let t = self.treasury_id();
        if self.is_registered(&t) {
            return;
        }
        self.token.internal_register_account(&t);
        if self.reserve > 0 {
            let current = env::current_account_id();
            self.token.internal_transfer(&current, &t, self.reserve, None);
        }
        // zero balance, no keys, no code: a NEP-448 zero-balance account
        Promise::new(t.clone()).create_account().detach();
        events::treasury_opened(self.generation, &t);
    }
}

/// The economic core of one bite, shared by `settle` and the read-only views.
/// Returns (reserve burned before any tip, stake slashed into the Reserve).
pub(crate) fn bite_math(reserve: &mut u128, belly: &mut Belly, cfg: &Config) -> (u128, u128) {
    let burn = *reserve * cfg.bite_burn_bp as u128 / FULL_BP as u128;
    *reserve -= burn;
    let slashed = belly.slash(cfg.stake_slash_bp);
    *reserve += slashed;
    (burn, slashed)
}

pub(crate) fn level_for(cfg: &Config, happy_days: u32) -> u32 {
    let mut level = 1u32;
    for &thr in &cfg.level_thresholds {
        if happy_days >= thr {
            level += 1;
        } else {
            return level;
        }
    }
    let base = *cfg.level_thresholds.last().unwrap();
    level + (happy_days - base) / cfg.level_step_after.max(1)
}

pub(crate) fn level_floor_days(cfg: &Config, level: u32) -> u32 {
    let t = &cfg.level_thresholds;
    if level <= 1 {
        0
    } else if (level as usize - 2) < t.len() {
        t[level as usize - 2]
    } else {
        let extra = level - 1 - t.len() as u32;
        t.last().unwrap() + extra * cfg.level_step_after
    }
}

/// Meal size for a projected level and form.
pub(crate) fn meal_size_for(cfg: &Config, level: u32, form: Form) -> u128 {
    let (fnum, fden) = form.appetite();
    let an = cfg.appetite_num as u128;
    let ad = cfg.appetite_den as u128;
    let levels = level.saturating_sub(1);
    let mut num = cfg.base_meal.0;
    let mut den = 1u128;
    for _ in 0..levels {
        num = num.saturating_mul(an);
        den = den.saturating_mul(ad);
    }
    num = num.saturating_mul(fnum as u128);
    den = den.saturating_mul(fden as u128);
    (num / den).max(1)
}
