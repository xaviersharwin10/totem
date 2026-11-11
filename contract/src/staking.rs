//! Staking into the belly (brief 5.12): stake, unstake, withdraw, shields.
//!
//! Accounting is bounded-gas with no loops over stakers:
//! - `Belly.unshielded` is the live value of every unshielded stake.
//! - `Belly.buckets` holds shielded stake keyed by shield expiry, rounded up to
//!   `bucket_len`. With a 1-day window and 1/24-day buckets there are at most
//!   ~25 live buckets, so it lives inline in contract state.
//! - Every bite multiplies `unshielded` by `(1 - stake_slash)`. Shielded stake is
//!   untouched until its bucket expires.
//! - A staker's own value is `principal x keep^k`, where `k` counts this
//!   generation's bites that fell after their checkpoint and at or after their
//!   shield end. The bite list has at most `max_level` entries.
//!
//! Rounding: each staker's value floors once per bite, as does the aggregate, so
//! `sum(individual values) <= aggregate` always holds. Withdrawals can never
//! take more than the contract holds; leftover dust stays counted in
//! `total_staked`.

use crate::events;
use crate::{Contract, ContractExt, FULL_BP};
use near_sdk::json_types::U128;
use near_sdk::{env, near, AccountId};

/// Aggregate stake accounting for the current generation.
#[near(serializers = [borsh])]
#[derive(Clone, Default)]
pub struct Belly {
    /// Live value of all unshielded stake (including unbonding amounts).
    pub unshielded: u128,
    /// Shielded stake as (expiry_ns, amount), sorted by expiry ascending.
    pub buckets: Vec<(u64, u128)>,
    /// Tokens held by the contract for stakers (all generations, until withdrawn).
    pub total_staked: u128,
}

impl Belly {
    /// Move every bucket whose shield ended at or before `t` into `unshielded`.
    pub fn expire(&mut self, t: u64) {
        let n = self.buckets.iter().take_while(|(e, _)| *e <= t).count();
        for (_, amount) in self.buckets.drain(..n) {
            self.unshielded += amount;
        }
    }

    /// Slash every unshielded stake by `slash_bp`. Returns the slashed amount,
    /// which the caller moves into the Reserve.
    pub fn slash(&mut self, slash_bp: u32) -> u128 {
        let keep = (FULL_BP - slash_bp) as u128;
        let after = self.unshielded * keep / FULL_BP as u128;
        let slashed = self.unshielded - after;
        self.unshielded = after;
        self.total_staked -= slashed;
        slashed
    }

    /// Place `amount` in the aggregate: in its bucket if shielded at `now`, else
    /// in `unshielded`.
    pub fn add(&mut self, amount: u128, shield_until: u64, now: u64) {
        if amount == 0 {
            return;
        }
        if shield_until > now {
            match self.buckets.binary_search_by_key(&shield_until, |(e, _)| *e) {
                Ok(i) => self.buckets[i].1 += amount,
                Err(i) => self.buckets.insert(i, (shield_until, amount)),
            }
        } else {
            self.unshielded += amount;
        }
    }

    /// Inverse of `add`.
    pub fn remove(&mut self, amount: u128, shield_until: u64, now: u64) {
        if amount == 0 {
            return;
        }
        if shield_until > now {
            if let Ok(i) = self.buckets.binary_search_by_key(&shield_until, |(e, _)| *e) {
                let b = &mut self.buckets[i].1;
                *b = b.saturating_sub(amount);
                if *b == 0 {
                    self.buckets.remove(i);
                }
            }
        } else {
            self.unshielded = self.unshielded.saturating_sub(amount);
        }
    }
}

/// One account's stake. Values are as of `checkpoint_at`.
#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Stake {
    /// Generation the stake belongs to. A stake from a dead generation is released.
    pub generation: u32,
    pub principal: u128,
    pub unbonding: u128,
    pub unbond_at: u64,
    pub checkpoint_at: u64,
    /// Bucket-rounded shield end. Bites at `t >= shield_until` slash this stake.
    pub shield_until: u64,
}

impl Stake {
    pub fn empty(generation: u32, now: u64) -> Self {
        Stake {
            generation,
            principal: 0,
            unbonding: 0,
            unbond_at: 0,
            checkpoint_at: now,
            shield_until: 0,
        }
    }

    pub fn total(&self) -> u128 {
        self.principal + self.unbonding
    }

    /// Value after applying the bites in `bites` that hit this stake.
    /// Returns (principal, unbonding).
    pub fn value_after(&self, bites: &[u64], slash_bp: u32) -> (u128, u128) {
        let keep = (FULL_BP - slash_bp) as u128;
        let full = FULL_BP as u128;
        let mut p = self.principal;
        let mut u = self.unbonding;
        for &t in bites {
            if t > self.checkpoint_at && t >= self.shield_until {
                p = p * keep / full;
                u = u * keep / full;
            }
        }
        (p, u)
    }
}

#[near]
impl Contract {
    /// Stake $TOTEM into the Totem's belly. Staked accounts earn the staker
    /// point bonus and Keeper eligibility, and are slashed by bites unless shielded.
    pub fn stake(&mut self, amount: U128) {
        self.settle();
        assert!(self.alive, "the Totem is dead; stakes are released");
        assert!(amount.0 > 0, "amount must be positive");
        let caller = env::predecessor_account_id();
        let current = env::current_account_id();
        self.token.internal_transfer(&caller, &current, amount.0, None);
        self.belly.total_staked += amount.0;

        let mut s = self.take_stake(&caller);
        s.principal += amount.0;
        let principal = s.principal;
        self.put_stake(&caller, s);
        events::stake(&caller, amount.0, principal);
    }

    /// Begin unbonding `amount`. It stays slashable until `withdraw()` after
    /// `unbond_delay`, so nobody can dodge a bite by exiting at the last moment.
    /// Unstaking again adds to the unbonding amount and restarts the delay.
    pub fn unstake(&mut self, amount: U128) {
        self.settle();
        assert!(self.alive, "the Totem is dead: call withdraw() to take your whole stake");
        let caller = env::predecessor_account_id();
        assert!(self.stakes.contains_key(&caller), "no stake");
        let mut s = self.take_stake(&caller);
        assert!(amount.0 > 0 && amount.0 <= s.principal, "amount exceeds your stake");
        s.principal -= amount.0;
        s.unbonding += amount.0;
        s.unbond_at = env::block_timestamp() + self.cfg.unbond_delay_ns;
        let at = s.unbond_at;
        self.put_stake(&caller, s);
        events::unstake(&caller, amount.0, at);
    }

    /// Withdraw matured unbonding stake, or the whole remaining stake if its
    /// generation has died (no delay after a death).
    pub fn withdraw(&mut self) {
        self.settle();
        let caller = env::predecessor_account_id();
        let s = self.stakes.get(&caller).cloned().expect("no stake");
        if self.is_released(&s) {
            let (p, u) = s.value_after(self.gen_bites(s.generation), self.cfg.stake_slash_bp);
            self.stakes.remove(&caller);
            self.pay_stake(&caller, p + u);
            return;
        }
        let mut s = self.take_stake(&caller);
        let now = env::block_timestamp();
        assert!(s.unbonding > 0, "nothing unbonding; call unstake() first");
        assert!(now >= s.unbond_at, "still unbonding");
        let out = s.unbonding;
        s.unbonding = 0;
        s.unbond_at = 0;
        self.put_stake(&caller, s);
        self.pay_stake(&caller, out);
    }

    // ------------------------------------------------------------------ //
    // internal
    // ------------------------------------------------------------------ //

    pub(crate) fn is_released(&self, s: &Stake) -> bool {
        s.generation != self.generation || !self.alive
    }

    pub(crate) fn gen_bites(&self, generation: u32) -> &[u64] {
        self.bites.get(&generation).map(|v| v.as_slice()).unwrap_or(&[])
    }

    /// Checkpoint `who` at now (state must be settled) and pull their value out
    /// of the aggregate. A released stake from a dead generation is paid out
    /// first. Always returns a live, current-generation record; the caller
    /// edits it and hands it back with `put_stake`.
    pub(crate) fn take_stake(&mut self, who: &AccountId) -> Stake {
        let now = env::block_timestamp();
        let Some(s) = self.stakes.get(who).cloned() else {
            return Stake::empty(self.generation, now);
        };
        let (p, u) = s.value_after(self.gen_bites(s.generation), self.cfg.stake_slash_bp);
        if self.is_released(&s) {
            self.stakes.remove(who);
            self.pay_stake(who, p + u);
            return Stake::empty(self.generation, now);
        }
        self.belly.remove(p + u, s.shield_until, now);
        Stake {
            principal: p,
            unbonding: u,
            checkpoint_at: now,
            ..s
        }
    }

    /// Put a checkpointed record back into the aggregate and storage.
    pub(crate) fn put_stake(&mut self, who: &AccountId, s: Stake) {
        let now = env::block_timestamp();
        self.belly.add(s.total(), s.shield_until, now);
        if s.total() == 0 {
            self.stakes.remove(who);
        } else {
            self.stakes.insert(who.clone(), s);
        }
    }

    /// Extend `who`'s shield to `now + shield_window`, rounded up to a bucket.
    pub(crate) fn extend_shield(&mut self, who: &AccountId) -> Option<u64> {
        if !self.stakes.contains_key(who) {
            return None;
        }
        let mut s = self.take_stake(who);
        if s.total() == 0 {
            // A released stake was just paid out; nothing left to shield.
            return None;
        }
        let b = self.cfg.bucket_len_ns;
        let raw = env::block_timestamp() + self.cfg.shield_window_ns;
        s.shield_until = raw.div_ceil(b) * b;
        let until = s.shield_until;
        self.put_stake(who, s);
        events::shield(who, until);
        Some(until)
    }

    /// Current (post-slash) principal of a live stake, for the staker bonus.
    pub(crate) fn live_principal(&self, who: &AccountId) -> u128 {
        match self.stakes.get(who) {
            Some(s) if !self.is_released(s) => {
                s.value_after(self.gen_bites(s.generation), self.cfg.stake_slash_bp).0
            }
            _ => 0,
        }
    }

    fn pay_stake(&mut self, who: &AccountId, amount: u128) {
        if amount == 0 {
            return;
        }
        self.belly.total_staked -= amount;
        let current = env::current_account_id();
        self.token.internal_transfer(&current, who, amount, None);
        events::withdraw(who, amount);
    }
}
