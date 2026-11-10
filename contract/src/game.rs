//! Core game loop: lazy time settlement, feeding, rampage, death, levels.

use crate::events;
use crate::{Config, Contract, ContractExt, Form, FULL_BP, ONE_TOKEN};
use near_sdk::{env, near, AccountId};

#[near]
impl Contract {
    /// Feed the creature. Takes only what fits (excess is not debited), burns the
    /// burn-share, adds the rest to the Hoard, awards points (2x if rescuing),
    /// and ends any Rampage.
    pub fn feed(&mut self, amount: near_sdk::json_types::U128) {
        self.settle();
        assert!(self.alive, "the Totem is dead; the DAO must hatch a new egg");
        let caller = env::predecessor_account_id();
        let want = amount.0;
        assert!(want > 0, "amount must be positive");

        let ms = self.meal_size();
        let room_bp = (FULL_BP - self.fullness_bp) as u128;
        let max_accept = ms * room_bp / FULL_BP as u128;
        let accepted = want.min(max_accept);
        assert!(accepted > 0, "the Totem is full");

        let rescue = self.fullness_bp < self.cfg.starving_threshold_bp;

        let burn = accepted * self.cfg.burn_share_bp as u128 / FULL_BP as u128;
        let to_hoard = accepted - burn;

        let current = env::current_account_id();
        // Move the Hoard share into the contract's own ledger account (supply
        // unchanged), then burn the rest (supply down).
        self.token.internal_transfer(&caller, &current, to_hoard, None);
        self.token.internal_withdraw(&caller, burn);
        self.hoard += to_hoard;
        self.total_burned += burn;
        self.total_fed += accepted;
        events::ft_burn(&caller, burn);

        let gain_bp = (accepted * FULL_BP as u128 / ms) as u32;
        self.fullness_bp = (self.fullness_bp + gain_bp).min(FULL_BP);

        if self.rampage_started_at.is_some() {
            self.rampage_started_at = None;
            self.bites_applied = 0;
            events::rampage_end(&caller);
            // Hero Badge to whoever ended the Rampage.
            self.mint_hero(&caller);
        }

        let whole = accepted / ONE_TOKEN;
        let pts = whole * if rescue { self.cfg.rescue_multiplier as u128 } else { 1 };
        self.award_points(&caller, pts);

        events::feed(&caller, accepted, burn, to_hoard, pts, rescue);
    }

    /// Permissionless keeper call: settle state. If it applies at least one bite,
    /// the caller earns the poke tip (a cut of the bitten amount, else burned).
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
        self.token.internal_deposit(&caller, self.cfg.faucet_amount.0);
        self.faucet_last.insert(caller, now);
    }

    // ------------------------------------------------------------------ //
    // internal helpers
    // ------------------------------------------------------------------ //

    pub(crate) fn settle(&mut self) {
        self.settle_inner(None);
    }

    /// Advance all time-based state from `last_settled_at` to now. If `poker` is
    /// set, route any Rampage-bite tips to them.
    fn settle_inner(&mut self, poker: Option<AccountId>) {
        let now = env::block_timestamp();
        if now <= self.last_settled_at {
            return;
        }
        if !self.alive {
            self.last_settled_at = now;
            return;
        }

        let day = self.cfg.day_length_ns;
        let elapsed = now - self.last_settled_at;
        let f0 = self.fullness_bp;

        // XP: time spent at or above the Happy threshold during this interval.
        if f0 > self.cfg.happy_threshold_bp {
            let drop_bp = (f0 - self.cfg.happy_threshold_bp) as u128;
            let happy_dur = (drop_bp * day as u128 / FULL_BP as u128) as u64;
            self.happy_ns += happy_dur.min(elapsed);
        }

        // Drain, then Rampage, then death — in order.
        let to_zero = (f0 as u128 * day as u128 / FULL_BP as u128) as u64;
        if elapsed < to_zero {
            let drain_bp = (elapsed as u128 * FULL_BP as u128 / day as u128) as u32;
            self.fullness_bp = f0.saturating_sub(drain_bp);
        } else {
            let z = self.last_settled_at + to_zero;
            self.fullness_bp = 0;
            if self.rampage_started_at.is_none() {
                self.rampage_started_at = Some(z);
                self.bites_applied = 0;
                events::rampage_start();
            }
            let r_start = self.rampage_started_at.unwrap();
            let rampage_dur = now - r_start;
            let death = rampage_dur >= self.cfg.death_after_ns;
            let effective = if death { self.cfg.death_after_ns } else { rampage_dur };
            let total_bites = effective / self.cfg.bite_interval_ns;
            let new_bites = total_bites.saturating_sub(self.bites_applied);
            self.apply_bites(new_bites, &poker);
            self.bites_applied = total_bites;
            if death {
                self.die();
            }
        }

        if self.alive {
            self.update_level();
            self.maybe_default_evolution(now);
            self.close_due_periods(now);
        }
        self.last_settled_at = now;
    }

    /// Apply `n` Rampage bites to the Hoard (bounded by the death cap).
    fn apply_bites(&mut self, n: u64, poker: &Option<AccountId>) {
        if n == 0 || self.hoard == 0 {
            return;
        }
        let cap = self.cfg.death_after_ns / self.cfg.bite_interval_ns + 1;
        let n = n.min(cap);
        let keep = (FULL_BP - self.cfg.bite_size_bp) as u128;
        let full = FULL_BP as u128;
        let start = self.hoard;
        let mut hoard = self.hoard;
        for _ in 0..n {
            if hoard == 0 {
                break;
            }
            hoard = hoard * keep / full;
        }
        let bitten = start - hoard;
        if bitten == 0 {
            return;
        }

        let current = env::current_account_id();
        let mut tip = 0u128;
        if let Some(p) = poker {
            let t = bitten * self.cfg.poke_tip_bp as u128 / full;
            if t > 0 && self.is_registered(p) && p != &current {
                tip = t;
                self.token.internal_transfer(&current, p, tip, None);
            }
        }
        let burn = bitten - tip;
        self.token.internal_withdraw(&current, burn);
        self.hoard = hoard;
        self.total_burned += burn;
        events::ft_burn(&current, burn);
        events::bite(bitten, hoard, tip, poker.as_ref());
    }

    fn die(&mut self) {
        if self.hoard > 0 {
            let current = env::current_account_id();
            self.token.internal_withdraw(&current, self.hoard);
            self.total_burned += self.hoard;
            events::ft_burn(&current, self.hoard);
            self.hoard = 0;
        }
        self.alive = false;
        self.rampage_started_at = None;
        events::death(self.generation, &self.name, self.max_level);
        // Gravestone NFT + life record are minted in the NFT layer.
    }

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
        let mut level = 1u32;
        for &thr in &self.cfg.level_thresholds {
            if happy_days >= thr {
                level += 1;
            } else {
                return level;
            }
        }
        let mut base = *self.cfg.level_thresholds.last().unwrap();
        while happy_days >= base + self.cfg.level_step_after {
            base += self.cfg.level_step_after;
            level += 1;
        }
        level
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
        let (fnum, fden) = self.form.appetite();
        let an = self.cfg.appetite_num as u128;
        let ad = self.cfg.appetite_den as u128;
        let levels = self.level.saturating_sub(1);
        let mut num = self.cfg.base_meal.0;
        let mut den = 1u128;
        for _ in 0..levels {
            num = num.saturating_mul(an);
            den = den.saturating_mul(ad);
        }
        num = num.saturating_mul(fnum as u128);
        den = den.saturating_mul(fden as u128);
        (num / den).max(1)
    }

    pub(crate) fn is_registered(&self, account: &AccountId) -> bool {
        self.token.accounts.contains_key(account)
    }
}

/// Free helper so other modules can recompute meal size for a projected state.
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
