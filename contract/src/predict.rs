//! Prediction market: bet $TOTEM on whether the Totem survives a Rampage.
//!
//! One market opens each time a Rampage begins (market ID is a global counter).
//! Players call `predict("survive"|"die", amount)` while the Rampage is live.
//! When the Rampage ends (rescue → "survive", death → "die") the market resolves:
//!   - 3% of the losing pool is burned immediately.
//!   - Winners claim their stake back + a proportional share of the remaining 97%.
//! Losers' tokens stay locked until an explicit claim (which returns 0 and clears the record).

use crate::{events, Contract, ContractExt, FULL_BP};
use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, AccountId};

/// Fee taken from the losing pool at resolution (basis points: 300 = 3%).
pub const PREDICT_FEE_BP: u128 = 300;

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct PredictMarket {
    pub market_id: u32,
    pub gen: u32,
    pub opened_at: U64,
    pub total_survive: U128,
    pub total_die: U128,
    pub resolved: bool,
    /// true = survived, false = died; None while open.
    pub outcome: Option<bool>,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct PredictBet {
    pub survive: U128,
    pub die: U128,
}

impl Contract {
    /// Open a new market when a Rampage begins.
    pub(crate) fn open_predict_market(&mut self, at: u64) {
        if self.current_predict_market.is_some() {
            return;
        }
        self.predict_next_id += 1;
        let mid = self.predict_next_id;
        let gen = self.generation;
        self.predict_markets.insert(
            mid,
            PredictMarket {
                market_id: mid,
                gen,
                opened_at: U64(at),
                total_survive: U128(0),
                total_die: U128(0),
                resolved: false,
                outcome: None,
            },
        );
        self.current_predict_market = Some(mid);
        events::predict_opened(gen, mid, at);
    }

    /// Resolve the active market. `survived`: true = Rampage ended by feeding, false = death.
    pub(crate) fn resolve_predict_market(&mut self, survived: bool) {
        let mid = match self.current_predict_market.take() {
            Some(m) => m,
            None => return,
        };
        let mut market = match self.predict_markets.get(&mid).cloned() {
            Some(m) => m,
            None => return,
        };
        if market.resolved {
            return;
        }

        let losing = if survived { market.total_die.0 } else { market.total_survive.0 };
        let winning = if survived { market.total_survive.0 } else { market.total_die.0 };

        let fee = losing * PREDICT_FEE_BP / FULL_BP as u128;
        let distributable = losing.saturating_sub(fee);

        if fee > 0 {
            let current = env::current_account_id();
            self.token.internal_withdraw(&current, fee);
            self.predict_pot = self.predict_pot.saturating_sub(fee);
            self.total_burned += fee;
            self.gen_stats.burned.0 += fee;
            events::ft_burn(&current, fee);
        }

        market.resolved = true;
        market.outcome = Some(survived);
        self.predict_markets.insert(mid, market);
        events::predict_resolved(mid, survived, winning, distributable);
    }
}

#[near]
impl Contract {
    /// Bet $TOTEM on the outcome of the current Rampage.
    /// `side`: "survive" or "die". Can bet on either or both sides.
    /// Only callable while the Totem is in Rampage and the market is open.
    pub fn predict(&mut self, side: String, amount: U128) {
        self.settle();
        let mid = self
            .current_predict_market
            .expect("no active prediction market: Rampage must be in progress");
        let mut market = self
            .predict_markets
            .get(&mid)
            .cloned()
            .expect("market not found");
        assert!(!market.resolved, "market already resolved");
        assert!(self.alive, "the Totem is dead");

        let caller = env::predecessor_account_id();
        let amt = amount.0;
        assert!(amt > 0, "amount must be positive");
        assert!(self.is_registered(&caller), "register storage first");

        let current = env::current_account_id();
        self.token.internal_transfer(&caller, &current, amt, None);
        self.predict_pot += amt;

        let key = (mid, caller.clone());
        let mut bet = self.predict_bets.get(&key).cloned().unwrap_or_default();

        match side.as_str() {
            "survive" => {
                bet.survive.0 += amt;
                market.total_survive.0 += amt;
            }
            "die" => {
                bet.die.0 += amt;
                market.total_die.0 += amt;
            }
            _ => env::panic_str("side must be 'survive' or 'die'"),
        }
        self.predict_bets.insert(key, bet);
        self.predict_markets.insert(mid, market);
        events::predict_bet(&caller, mid, &side, amt);
    }

    /// Claim winnings from a resolved market. Panics if the caller has no winning bet.
    pub fn claim_prediction(&mut self, market_id: u32) {
        let market = self
            .predict_markets
            .get(&market_id)
            .cloned()
            .expect("market not found");
        assert!(market.resolved, "market not yet resolved");

        let caller = env::predecessor_account_id();
        let key = (market_id, caller.clone());
        let bet = self.predict_bets.get(&key).cloned().unwrap_or_default();

        let survived = market.outcome.expect("resolved market must have outcome");
        let (my_winning, loser_pool, winner_pool) = if survived {
            (bet.survive.0, market.total_die.0, market.total_survive.0)
        } else {
            (bet.die.0, market.total_survive.0, market.total_die.0)
        };

        assert!(my_winning > 0, "no winning bet on this market");

        let fee = loser_pool * PREDICT_FEE_BP / FULL_BP as u128;
        let distributable = loser_pool.saturating_sub(fee);
        // Proportional share of distributable — work in whole tokens (÷ ONE_TOKEN before
        // multiplying) to stay within u128 given the 10^9-token total supply.
        use crate::ONE_TOKEN;
        let extra = if winner_pool > 0 {
            let d = distributable / ONE_TOKEN;
            let w = my_winning / ONE_TOKEN;
            let wp = winner_pool / ONE_TOKEN;
            if wp > 0 { d * w / wp * ONE_TOKEN } else { distributable }
        } else {
            0
        };
        let payout = my_winning + extra;

        // Clear the winning side to prevent double-claim.
        let zeroed = if survived {
            PredictBet { survive: U128(0), die: bet.die }
        } else {
            PredictBet { survive: bet.survive, die: U128(0) }
        };
        self.predict_bets.insert(key, zeroed);

        let current = env::current_account_id();
        if !self.is_registered(&caller) {
            self.token.internal_register_account(&caller);
        }
        self.token.internal_transfer(&current, &caller, payout, None);
        self.predict_pot = self.predict_pot.saturating_sub(payout);
        events::predict_claimed(&caller, market_id, payout);
    }

    /// Active prediction market (open during a Rampage), or None.
    pub fn get_active_predict_market(&self) -> Option<PredictMarket> {
        let mid = self.current_predict_market?;
        self.predict_markets.get(&mid).cloned()
    }

    /// Fetch a market by its ID.
    pub fn get_predict_market(&self, market_id: u32) -> Option<PredictMarket> {
        self.predict_markets.get(&market_id).cloned()
    }

    /// Fetch a bet by market ID and account.
    pub fn get_predict_bet(&self, market_id: u32, account_id: AccountId) -> PredictBet {
        self.predict_bets
            .get(&(market_id, account_id))
            .cloned()
            .unwrap_or_default()
    }

    /// List all markets for the current generation (most recent first, up to `limit`).
    pub fn get_predict_markets(&self, limit: Option<u32>) -> Vec<PredictMarket> {
        let limit = limit.unwrap_or(20).min(100) as usize;
        let hi = self.predict_next_id;
        let cur_gen = self.generation;
        (1..=hi)
            .rev()
            .filter_map(|id| {
                let m = self.predict_markets.get(&id)?.clone();
                (m.gen == cur_gen).then_some(m)
            })
            .take(limit)
            .collect()
    }
}
