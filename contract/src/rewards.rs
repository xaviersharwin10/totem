//! Points, Blessings (pull-based rewards) and Caretaker Badges.

use crate::events;
use crate::{Contract, ContractExt, Form, FULL_BP};
use near_sdk::{env, near, AccountId};

#[near]
impl Contract {
    /// Claim your share of a closed Blessing period, pro-rata to the points you
    /// earned that period. Pull-based: the contract never loops over users.
    pub fn claim_blessing(&mut self, period_id: u64) {
        self.settle();
        let caller = env::predecessor_account_id();
        assert!(self.is_registered(&caller), "register storage first (storage_deposit)");

        let reserve = self.period_reserved.get(&period_id).copied().unwrap_or(0);
        assert!(reserve > 0, "no blessing reserved for that period");
        let total = self.period_totals.get(&period_id).copied().unwrap_or(0);
        assert!(total > 0, "period had no points");

        let key = (period_id, caller.clone());
        let my = self.period_points.get(&key).copied().unwrap_or(0);
        assert!(my > 0, "you earned no points that period (or already claimed)");

        let share = reserve * my / total;
        assert!(share > 0, "your share rounds to zero");

        // Zero the caller's period points so they cannot claim twice.
        self.period_points.insert(key, 0);
        let claimed = self.period_claimed.get(&period_id).copied().unwrap_or(0) + share;
        self.period_claimed.insert(period_id, claimed);
        self.reserved -= share;

        let current = env::current_account_id();
        self.token.internal_transfer(&current, &caller, share, None);
        events::blessing_claimed(&caller, period_id, share);
    }

    /// Mint the highest Bronze/Silver/Gold badge you have earned and not claimed,
    /// as a soulbound NEP-171 token `badge-{tier}-{account}`.
    pub fn claim_badge(&mut self) {
        self.settle();
        let caller = env::predecessor_account_id();
        assert!(self.max_level >= 2, "badges unlock once the Totem reaches L2");
        let lt = self.lifetime_points.get(&caller).copied().unwrap_or(0);
        let tier = self.tier_for(lt);
        assert!(tier > 0, "no badge earned yet");
        let have = self.badges_claimed.get(&caller).copied().unwrap_or(0);
        assert!(tier > have, "your highest badge is already claimed");
        self.badges_claimed.insert(caller.clone(), tier);
        let name = tier_name(tier);
        let mut title = name.to_string();
        title[..1].make_ascii_uppercase();
        self.mint_badge(&caller, name, format!("badge-{name}-{caller}"), format!("{title} Caretaker"));
        events::badge_minted(&caller, name);
    }

    // ------------------------------------------------------------------ //
    // internal
    // ------------------------------------------------------------------ //

    pub(crate) fn award_points(&mut self, who: &AccountId, pts: u128) {
        if pts == 0 {
            return;
        }
        let lt = self.lifetime_points.get(who).copied().unwrap_or(0) + pts;
        self.lifetime_points.insert(who.clone(), lt);
        if let Some(epoch) = self.blessing_epoch_start {
            let now = env::block_timestamp();
            let period = self.period_base + now.saturating_sub(epoch) / self.cfg.blessing_period_ns;
            let key = (period, who.clone());
            let pp = self.period_points.get(&key).copied().unwrap_or(0) + pts;
            self.period_points.insert(key, pp);
            let tot = self.period_totals.get(&period).copied().unwrap_or(0) + pts;
            self.period_totals.insert(period, tot);
        }
    }

    /// Close every Blessing period that has fully elapsed, reserving `rate x Reserve`
    /// for each, and return still-unclaimed reservations that have aged out.
    pub(crate) fn close_due_periods(&mut self, now: u64) {
        let epoch = match self.blessing_epoch_start {
            Some(e) => e,
            None => return,
        };
        if now <= epoch {
            return;
        }
        let current = self.period_base + (now - epoch) / self.cfg.blessing_period_ns;
        while self.last_closed_period < current {
            let p = self.last_closed_period;
            let tot = self.period_totals.get(&p).copied().unwrap_or(0);
            // Perks follow the current level: below L3 a period closes with no
            // payout (its points simply earn nothing).
            if tot > 0 && self.level >= 3 {
                let rate = self.blessing_rate_bp();
                let reserve = self.reserve * rate as u128 / FULL_BP as u128;
                if reserve > 0 {
                    self.reserve -= reserve;
                    self.reserved += reserve;
                    self.total_blessed += reserve;
                    self.gen_stats.blessed.0 += reserve;
                    self.period_reserved.insert(p, reserve);
                    events::blessing_reserved(p, reserve, tot);
                }
            }
            // Return unclaimed reservations from `unclaimed_return_periods` ago.
            if p >= self.period_base + self.cfg.unclaimed_return_periods {
                let q = p - self.cfg.unclaimed_return_periods;
                let res = self.period_reserved.get(&q).copied().unwrap_or(0);
                let claimed = self.period_claimed.get(&q).copied().unwrap_or(0);
                if res > claimed {
                    let ret = res - claimed;
                    self.reserved -= ret;
                    self.reserve += ret;
                    self.period_claimed.insert(q, res);
                }
            }
            self.last_closed_period += 1;
        }
    }

    pub(crate) fn blessing_rate_bp(&self) -> u32 {
        let base = match self.form {
            Form::Egg => self.cfg.blessing_rate_egg_bp,
            Form::Dragon => self.cfg.blessing_rate_dragon_bp,
            Form::Golem => self.cfg.blessing_rate_golem_bp,
        };
        let bonus = if self.level >= 5 {
            ((self.level - 4) * self.cfg.blessing_bonus_from_l5_bp)
                .min(self.cfg.blessing_bonus_cap_bp)
        } else {
            0
        };
        base + bonus
    }

    pub(crate) fn tier_for(&self, lifetime_points: u128) -> u8 {
        let t = &self.cfg.badge_thresholds;
        if t.len() >= 3 && lifetime_points >= t[2] {
            3
        } else if t.len() >= 2 && lifetime_points >= t[1] {
            2
        } else if !t.is_empty() && lifetime_points >= t[0] {
            1
        } else {
            0
        }
    }

    pub(crate) fn mint_hero(&mut self, who: &AccountId) {
        self.hero_count += 1;
        let id = format!("hero-{}-{}", self.generation, self.hero_count);
        self.mint_badge(who, "hero", id, "Hero of the Rampage".to_string());
        events::badge_minted(who, "hero");
    }
}

pub(crate) fn tier_name(tier: u8) -> &'static str {
    match tier {
        1 => "bronze",
        2 => "silver",
        3 => "gold",
        _ => "none",
    }
}
