//! Unit tests for the game loop: settle, feed, bites with level loss, death,
//! staking with shields, unbonding, lineage, and the supply-conservation and
//! sybil invariants. Run with `cargo test`.

use crate::*;
use near_contract_standards::fungible_token::core::FungibleTokenCore;
use near_contract_standards::storage_management::StorageManagement;
use near_sdk::json_types::U128;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::{testing_env, AccountId, NearToken};

const DAY: u64 = 86_400_000_000_000; // 1 Totem-day in ns (prod)
const HOUR: u64 = DAY / 24;
const ONE: u128 = ONE_TOKEN;

fn contract_id() -> AccountId {
    "totem.near".parse().unwrap()
}

fn ctx(who: &AccountId, ts: u64, deposit: NearToken) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(contract_id())
        .predecessor_account_id(who.clone())
        .block_timestamp(ts)
        .attached_deposit(deposit)
        .build());
}

fn set_ctx(who: &AccountId, ts: u64) {
    ctx(who, ts, NearToken::from_yoctonear(0));
}

fn setup() -> (Contract, AccountId, AccountId) {
    let genesis = accounts(0);
    let dao = accounts(1);
    set_ctx(&genesis, 0);
    let c = Contract::new(genesis.clone(), dao.clone(), false, None, Some("Grumbo".into()));
    (c, genesis, dao)
}

/// Register `who` and send them `amount` whole tokens from genesis.
fn fund(c: &mut Contract, genesis: &AccountId, who: &AccountId, amount: u128, ts: u64) {
    ctx(genesis, ts, NearToken::from_near(1));
    c.storage_deposit(Some(who.clone()), None);
    ctx(genesis, ts, NearToken::from_yoctonear(1));
    c.ft_transfer(who.clone(), U128(amount * ONE), None);
}

/// Genesis tops the Totem up to 100% every quarter-day over [from, to], keeping
/// it Happy the whole time. Returns the time of the last feed.
fn keep_happy(c: &mut Contract, genesis: &AccountId, from: u64, to: u64) -> u64 {
    let mut t = from;
    let mut last = from;
    while t <= to {
        set_ctx(genesis, t);
        let fill = c.get_totem().fill_amount.0;
        if fill > 0 {
            c.feed(U128(fill));
            last = t;
        }
        t += DAY / 4;
    }
    last
}

/// Block time of the next bite, read from the view.
fn next_bite_at(c: &Contract, now: u64) -> u64 {
    let s = c.get_totem().seconds_until_next_bite.expect("alive").0;
    // The view reports whole seconds; the bite lands within the next second.
    now + s * 1_000_000_000 + 1_000_000_000
}

fn stake_of(c: &Contract, who: &AccountId) -> u128 {
    c.get_stake(who.clone()).map(|s| s.staked.0 + s.unbonding.0).unwrap_or(0)
}

/// total_supply == sum of ledger balances, and the contract's own ledger
/// balance == Reserve + reserved Blessings + staked tokens.
fn assert_supply_conserved(c: &Contract, holders: &[AccountId]) {
    let ledger: u128 = holders.iter().map(|h| c.ft_balance_of(h.clone()).0).sum();
    let contract_bal = c.ft_balance_of(contract_id()).0;
    assert_eq!(
        c.get_stats().total_supply.0,
        ledger + contract_bal,
        "ledger balances must sum to total_supply"
    );
    assert_eq!(
        contract_bal,
        c.reserve + c.reserved + c.belly.total_staked,
        "contract account holds exactly reserve + reserved + staked"
    );
}

// ---------------------------------------------------------------------- //
// feeding
// ---------------------------------------------------------------------- //

#[test]
fn init_state_is_healthy_egg() {
    let (c, genesis, dao) = setup();
    let t = c.get_totem();
    assert_eq!(t.fullness_bp, FULL_BP);
    assert_eq!(t.level, 1);
    assert_eq!(t.bites_until_death, 1);
    assert_eq!(t.form, "egg");
    assert_eq!(t.mood, "happy");
    assert_eq!(t.lineage_name, "Grumbo I");
    assert!(t.alive);
    assert_eq!(t.owner, dao);
    assert_eq!(c.get_stats().total_supply.0, 1_000_000_000 * ONE);
    // Generation 1 traits are derived from the genesis and DAO accounts.
    let expect = lineage::derive_traits(&[genesis, dao], 1, &[8, 6, 6, 4]);
    assert_eq!(t.traits, expect);
}

#[test]
fn feed_burns_half_and_reserves_half() {
    let (mut c, genesis, _dao) = setup();
    set_ctx(&genesis, DAY / 2);
    c.feed(U128(40 * ONE));

    let stats = c.get_stats();
    assert_eq!(stats.total_burned.0, 20 * ONE, "half of 40 burned");
    assert_eq!(stats.reserve.0, 20 * ONE, "half of 40 to the Reserve");
    assert_eq!(stats.total_fed.0, 40 * ONE);
    assert_eq!(stats.total_supply.0, 1_000_000_000 * ONE - 20 * ONE);
    assert_eq!(c.ft_balance_of(genesis.clone()).0, 1_000_000_000 * ONE - 40 * ONE);
    // 5000bp + (40/100)*10000 = 9000bp
    assert_eq!(c.get_totem().fullness_bp, 9000);
    assert_eq!(c.get_caretaker(genesis.clone()).lifetime_points.0, 40);
    assert_supply_conserved(&c, &[genesis]);
}

#[test]
fn overfeed_only_debits_what_fits() {
    let (mut c, genesis, _dao) = setup();
    set_ctx(&genesis, DAY / 2); // 50% full, room for 50 tokens at L1
    c.feed(U128(1000 * ONE));
    assert_eq!(c.get_stats().total_fed.0, 50 * ONE);
    assert_eq!(c.ft_balance_of(genesis.clone()).0, 1_000_000_000 * ONE - 50 * ONE);
    assert_eq!(c.get_totem().fullness_bp, FULL_BP);
    assert_eq!(c.get_caretaker(genesis).lifetime_points.0, 50);
}

#[test]
fn rescue_feed_earns_double_points() {
    let (mut c, genesis, _dao) = setup();
    set_ctx(&genesis, (DAY * 8) / 10); // 20%, below the 30% threshold
    assert_eq!(c.get_totem().fullness_bp, 2000);
    c.feed(U128(10 * ONE));
    assert_eq!(c.get_caretaker(genesis).lifetime_points.0, 20);
}

#[test]
fn staker_bonus_stacks_with_rescue() {
    let (mut c, genesis, _dao) = setup();
    let bob = accounts(2);
    fund(&mut c, &genesis, &bob, 1_000, 0);
    set_ctx(&bob, 0);
    c.stake(U128(100 * ONE)); // exactly min_stake
    set_ctx(&bob, (DAY * 8) / 10);
    c.feed(U128(10 * ONE));
    // 10 tokens x2 rescue x1.5 staker = 30 points.
    assert_eq!(c.get_caretaker(bob).lifetime_points.0, 30);
}

#[test]
fn full_totem_rejects_feed() {
    let (mut c, genesis, _dao) = setup();
    set_ctx(&genesis, 0);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.feed(U128(10 * ONE))));
    assert!(r.is_err(), "feeding a full Totem should panic");
}

#[test]
fn sybil_split_earns_identical_total() {
    let (mut c, genesis, _dao) = setup();
    set_ctx(&genesis, DAY / 2);
    c.feed(U128(10 * ONE));
    let bob = accounts(3);
    fund(&mut c, &genesis, &bob, 10, DAY / 2);
    set_ctx(&bob, DAY / 2);
    c.feed(U128(10 * ONE));
    let g = c.get_caretaker(genesis).lifetime_points.0;
    let b = c.get_caretaker(bob).lifetime_points.0;
    assert_eq!(g, b, "same spend -> same points regardless of wallet");
    assert_eq!(g + b, 20, "total points == whole tokens spent, no split bonus");
}

// ---------------------------------------------------------------------- //
// bites, level loss, death
// ---------------------------------------------------------------------- //

#[test]
fn newborn_dies_at_its_first_bite() {
    let (mut c, genesis, _dao) = setup();
    set_ctx(&genesis, DAY / 2);
    c.feed(U128(50 * ONE)); // full at 0.5d, Reserve 25
    let alice = accounts(2);
    fund(&mut c, &genesis, &alice, 1, DAY / 2);

    // Empty at 1.5d, first bite at 1.75d. Just before it: Rampage, still alive.
    set_ctx(&alice, DAY * 7 / 4 - 1);
    c.poke();
    let t = c.get_totem();
    assert_eq!(t.mood, "rampage");
    assert!(t.alive);
    assert_eq!(t.bites_until_death, 1);
    assert_eq!(t.seconds_until_next_bite.unwrap().0, 0);

    set_ctx(&alice, DAY * 7 / 4);
    let before = c.ft_balance_of(alice.clone()).0;
    c.poke();
    let t = c.get_totem();
    assert!(!t.alive, "an L1 Totem dies at its first bite");
    assert_eq!(t.mood, "dead");
    assert_eq!(c.get_stats().reserve.0, 0, "the rest of the Reserve burns on death");
    // Poke tip = 1% of the 15% bite on a 25-token Reserve.
    let tip = 25 * ONE * 1500 / 10_000 * 100 / 10_000;
    assert_eq!(c.ft_balance_of(alice.clone()).0 - before, tip);

    let graves = c.get_graveyard(None, None);
    assert_eq!(graves.len(), 1);
    assert_eq!(graves[0].cause_of_death.as_deref(), Some("starved at Level 0"));
    assert_eq!(graves[0].lineage_name, "Grumbo I");
    assert_eq!(graves[0].stats.fed.0, 50 * ONE);
    assert_supply_conserved(&c, &[genesis, alice]);
}

#[test]
fn a_grown_totem_loses_one_level_per_bite() {
    let (mut c, genesis, _dao) = setup();
    let last = keep_happy(&mut c, &genesis, DAY / 4, 3 * DAY);
    assert_eq!(c.get_totem().level, 3, "3 Happy days -> L3");
    // Empty at last+1d; bites at +1.25d, +1.5d, +1.75d.
    let z = last + DAY;
    let reserve0 = c.reserve;

    // The view projects the first bite before anyone settles it.
    set_ctx(&genesis, z + DAY / 4);
    let v = c.get_totem();
    assert_eq!(v.level, 2);
    assert_eq!(v.bites_until_death, 2);
    assert_eq!(v.xp_happy_days, 1, "XP reset to the L2 floor");
    assert_eq!(v.reserve.0, reserve0 * 8500 / 10_000);
    c.poke();
    assert_eq!(c.level, 2);
    assert_eq!(c.happy_ns, DAY, "XP is the L2 floor: 1 Happy day");
    assert_eq!(c.reserve, reserve0 * 8500 / 10_000);
    assert_eq!(c.get_totem().meal_size.0, 150 * ONE, "meal size follows the lower level");

    set_ctx(&genesis, z + DAY / 2);
    c.poke();
    assert_eq!(c.level, 1);
    assert!(c.alive);

    // A long gap settles the last bite and death in bounded steps.
    set_ctx(&genesis, z + 10 * DAY);
    c.poke();
    assert!(!c.alive);
    assert_eq!(c.max_level, 3);
    assert_eq!(c.gen_bites(1).len(), 3, "bites per generation == levels held");
    assert_supply_conserved(&c, &[genesis]);
}

#[test]
fn feeding_ends_rampage_but_lost_levels_stay_lost() {
    let (mut c, genesis, _dao) = setup();
    let last = keep_happy(&mut c, &genesis, DAY / 4, 3 * DAY);
    let z = last + DAY;
    let arjun = accounts(2);
    fund(&mut c, &genesis, &arjun, 1_000, last);

    set_ctx(&arjun, z + DAY / 4 + HOUR);
    c.feed(U128(100 * ONE));
    let t = c.get_totem();
    assert_ne!(t.mood, "rampage");
    assert_eq!(t.level, 2, "the bite already taken is not undone");
    assert!(c.rampage_started_at.is_none());
    assert_eq!(c.get_caretaker(arjun).lifetime_points.0, 200, "2x rescue");
}

// ---------------------------------------------------------------------- //
// staking and shields
// ---------------------------------------------------------------------- //

/// L3 Totem with bob and carol staking 500 each. Bob is shielded by a feed
/// at `last + 0.4d` (covers both bites), or with `early` at `last - 0.6d`
/// (the 2-day shield then ends between the first and second bite).
/// Returns (contract, genesis, bob, carol, rampage start).
fn staked_l3_with(early: bool) -> (Contract, AccountId, AccountId, AccountId, u64) {
    let (mut c, genesis, _dao) = setup();
    let bob = accounts(2);
    let carol = accounts(3);
    fund(&mut c, &genesis, &bob, 2_000, 0);
    fund(&mut c, &genesis, &carol, 2_000, 0);
    set_ctx(&bob, 0);
    c.stake(U128(500 * ONE));
    set_ctx(&carol, 0);
    c.stake(U128(500 * ONE));
    let last = if early {
        keep_happy(&mut c, &genesis, DAY / 4, DAY * 9 / 4);
        set_ctx(&bob, DAY * 12 / 5);
        c.feed(U128(5 * ONE));
        keep_happy(&mut c, &genesis, DAY * 5 / 2, 3 * DAY)
    } else {
        let last = keep_happy(&mut c, &genesis, DAY / 4, 3 * DAY);
        set_ctx(&bob, last + DAY * 2 / 5);
        c.feed(U128(5 * ONE));
        last
    };
    assert_eq!(c.level, 3);
    let now = c.last_settled_at;
    let z = now + c.get_totem().seconds_until_rampage.unwrap().0 * 1_000_000_000;
    let _ = last;
    (c, genesis, bob, carol, z)
}

fn staked_l3() -> (Contract, AccountId, AccountId, AccountId, u64) {
    staked_l3_with(false)
}

#[test]
fn shielded_staker_keeps_everything_unshielded_loses_slash() {
    let (mut c, genesis, bob, carol, _z) = staked_l3();
    let now = c.last_settled_at;
    let b1 = next_bite_at(&c, now);
    let shield = c.stakes.get(&bob).unwrap().shield_until;
    assert!(shield > b1, "bob's shield covers the first bite");

    let reserve0 = c.reserve;
    set_ctx(&genesis, b1);
    c.poke();
    assert_eq!(c.level, 2);
    assert_eq!(stake_of(&c, &bob), 500 * ONE, "shielded: untouched");
    assert_eq!(stake_of(&c, &carol), 425 * ONE, "unshielded: -15%");
    // The Reserve loses 15% and gains carol's 75 slashed tokens.
    assert_eq!(c.reserve, reserve0 * 8500 / 10_000 + 75 * ONE);
    assert_eq!(c.belly.total_staked, 925 * ONE);
    assert!(c.get_stake(bob.clone()).unwrap().shielded);
    assert!(!c.get_stake(carol.clone()).unwrap().shielded);
    assert_supply_conserved(&c, &[genesis, bob, carol]);
}

#[test]
fn shield_expiring_between_bites_is_slashed_by_the_second_only() {
    let (mut c, genesis, bob, carol, _z) = staked_l3_with(true);
    let b1 = next_bite_at(&c, c.last_settled_at);
    set_ctx(&genesis, b1);
    c.poke();
    let b2 = next_bite_at(&c, b1);
    let shield = c.stakes.get(&bob).unwrap().shield_until;
    assert!(shield > b1 && shield <= b2, "shield ends between the bites");

    // Project the second bite in the view, then settle it.
    set_ctx(&genesis, b2);
    assert_eq!(c.get_stake(bob.clone()).unwrap().staked.0, 425 * ONE);
    c.poke();
    assert_eq!(c.level, 1);
    assert_eq!(stake_of(&c, &bob), 425 * ONE, "bob slashed by bite 2 only");
    assert_eq!(stake_of(&c, &carol), 36_125 * ONE / 100, "carol slashed twice");
    assert_supply_conserved(&c, &[genesis, bob, carol]);
}

#[test]
fn many_stakers_sum_never_exceeds_aggregate() {
    let (mut c, genesis, _dao) = setup();
    let stakers: Vec<AccountId> = (2..6).map(accounts).collect();
    let amounts = [137u128, 1_001, 333, 77_777];
    for (s, a) in stakers.iter().zip(amounts) {
        fund(&mut c, &genesis, s, a + 100, 0);
        set_ctx(s, 0);
        c.stake(U128(a * ONE + 7)); // odd yocto amounts to exercise rounding
    }
    let last = keep_happy(&mut c, &genesis, DAY / 4, 6 * DAY);
    assert_eq!(c.level, 4);
    // Staggered shields: each staker feeds at a different time before the gap.
    for (i, s) in stakers.iter().enumerate() {
        set_ctx(s, last + (i as u64 + 1) * DAY / 6);
        c.feed(U128(10 * ONE));
    }
    // Walk through every bite, checking the invariant after each.
    let mut now = c.last_settled_at;
    while c.alive {
        now = next_bite_at(&c, now);
        set_ctx(&genesis, now);
        c.poke();
        let sum: u128 = stakers.iter().map(|s| stake_of(&c, s)).sum();
        assert!(sum <= c.belly.total_staked, "individuals never exceed the aggregate");
        assert!(c.belly.total_staked - sum <= 16, "rounding dust stays tiny");
        let mut all = stakers.clone();
        all.push(genesis.clone());
        assert_supply_conserved(&c, &all);
    }
    // Released: everyone withdraws at once, with no unbonding delay.
    for s in &stakers {
        set_ctx(s, now + 1);
        c.withdraw();
        assert!(c.get_stake(s.clone()).is_none());
    }
    assert!(c.belly.total_staked <= 16, "only dust remains");
}

#[test]
fn unbonding_stays_slashable_and_matures() {
    let (mut c, genesis, bob, _carol, _z) = staked_l3();
    // Carol is unshielded; she tries to exit before the bite.
    let carol = accounts(3);
    let now = c.last_settled_at;
    set_ctx(&carol, now);
    c.unstake(U128(500 * ONE));
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.withdraw()));
    assert!(r.is_err(), "withdraw before maturity panics");

    let b1 = next_bite_at(&c, now);
    set_ctx(&genesis, b1);
    c.poke();
    let v = c.get_stake(carol.clone()).unwrap();
    assert_eq!(v.unbonding.0, 425 * ONE, "unbonding stake is still slashed");
    assert_eq!(v.staked.0, 0);

    // After a death, everything is withdrawable at once.
    set_ctx(&genesis, b1 + 10 * DAY);
    c.poke();
    assert!(!c.alive);
    let before = c.ft_balance_of(bob.clone()).0;
    let bob_val = stake_of(&c, &bob);
    set_ctx(&bob, b1 + 10 * DAY);
    c.withdraw();
    assert_eq!(c.ft_balance_of(bob.clone()).0 - before, bob_val);
    set_ctx(&carol, b1 + 10 * DAY);
    c.withdraw();
    assert_supply_conserved(&c, &[genesis, bob, carol]);
}

#[test]
fn unstake_withdraw_after_delay_while_alive() {
    let (mut c, genesis, _dao) = setup();
    let bob = accounts(2);
    fund(&mut c, &genesis, &bob, 500, 0);
    set_ctx(&bob, 0);
    c.stake(U128(300 * ONE));
    c.unstake(U128(100 * ONE));
    // Keep it fed so no bite happens during the 1.5-day delay.
    keep_happy(&mut c, &genesis, DAY / 4, 2 * DAY);
    set_ctx(&bob, DAY * 3 / 2);
    c.withdraw();
    assert_eq!(c.ft_balance_of(bob.clone()).0, 300 * ONE);
    assert_eq!(stake_of(&c, &bob), 200 * ONE);
    assert_supply_conserved(&c, &[genesis, bob]);
}

// ---------------------------------------------------------------------- //
// lineage
// ---------------------------------------------------------------------- //

#[test]
fn death_leaves_a_gravestone_and_hatch_inherits_traits() {
    let (mut c, genesis, dao) = setup();
    let feeders: Vec<AccountId> = (2..6).map(accounts).collect();
    for f in &feeders {
        fund(&mut c, &genesis, f, 1_000, 0);
    }
    // Different amounts so the top 3 are well-defined: 5 > 4 > 3 > 2 tokens.
    set_ctx(&feeders[0], DAY / 2);
    c.feed(U128(2 * ONE));
    set_ctx(&feeders[1], DAY / 2);
    c.feed(U128(5 * ONE));
    set_ctx(&feeders[2], DAY / 2);
    c.feed(U128(3 * ONE));
    set_ctx(&feeders[3], DAY / 2);
    c.feed(U128(4 * ONE));

    set_ctx(&genesis, 5 * DAY);
    c.poke();
    assert!(!c.alive);

    // Only the owner (the DAO) can hatch.
    set_ctx(&genesis, 5 * DAY);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.hatch()));
    assert!(r.is_err(), "non-owner hatch panics");

    set_ctx(&dao, 5 * DAY);
    c.hatch();
    let top3 = vec![feeders[1].clone(), feeders[3].clone(), feeders[2].clone()];
    let t = c.get_totem();
    assert_eq!(t.generation, 2);
    assert_eq!(t.lineage_name, "Grumbo II");
    assert_eq!(t.founders, top3);
    assert_eq!(t.traits, lineage::derive_traits(&top3, 2, &[8, 6, 6, 4]));
    // No economic carry-over.
    assert_eq!(t.level, 1);
    assert_eq!(t.reserve.0, 0);
    assert_eq!(t.fullness_bp, FULL_BP);

    let tree = c.get_lineage(None, None);
    assert_eq!(tree.len(), 2);
    assert!(!tree[0].alive && tree[1].alive);
    assert_eq!(tree[1].parent, Some(1));
    assert_eq!(tree[0].top_feeders[0].0, feeders[1]);
    assert_eq!(tree[0].stats.fed.0, 14 * ONE);

    // A second hatch while alive is rejected.
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| c.hatch()));
    assert!(r.is_err());
}

#[test]
fn released_stake_from_a_dead_generation_is_paid_out_on_restake() {
    let (mut c, genesis, dao) = setup();
    let bob = accounts(2);
    fund(&mut c, &genesis, &bob, 1_000, 0);
    set_ctx(&bob, 0);
    c.stake(U128(400 * ONE));
    set_ctx(&genesis, 5 * DAY);
    c.poke(); // L1 dies at its first bite: bob was unshielded, so -15%
    assert!(!c.alive);
    assert_eq!(stake_of(&c, &bob), 340 * ONE);
    set_ctx(&dao, 5 * DAY);
    c.hatch();

    set_ctx(&bob, 5 * DAY);
    c.stake(U128(100 * ONE));
    assert_eq!(c.ft_balance_of(bob.clone()).0, (600 + 340 - 100) * ONE);
    let v = c.get_stake(bob.clone()).unwrap();
    assert_eq!(v.generation, 2);
    assert_eq!(v.staked.0, 100 * ONE);
    assert_supply_conserved(&c, &[genesis, bob]);
}
