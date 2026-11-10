//! Unit tests for the core game loop: settle, feed, rampage, death, and the
//! supply-conservation / sybil invariants. Run with `cargo test`.

use crate::*;
use near_contract_standards::fungible_token::core::FungibleTokenCore;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::{testing_env, AccountId};

const DAY: u64 = 86_400_000_000_000; // 1 Totem-day in ns (prod)
const ONE: u128 = ONE_TOKEN;

fn contract_id() -> AccountId {
    "totem.near".parse().unwrap()
}

fn set_ctx(who: &AccountId, ts: u64) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(contract_id())
        .predecessor_account_id(who.clone())
        .block_timestamp(ts)
        .build());
}

fn setup() -> (Contract, AccountId, AccountId) {
    let genesis = accounts(0);
    let dao = accounts(1);
    set_ctx(&genesis, 0);
    let c = Contract::new(genesis.clone(), dao.clone(), false, None, Some("Grumbo".into()));
    (c, genesis, dao)
}

/// total_supply must always equal ledger(genesis-holders) + hoard + reserved.
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
        c.hoard + c.reserved,
        "contract account holds exactly hoard + reserved"
    );
}

#[test]
fn init_state_is_healthy_egg() {
    let (c, _g, dao) = setup();
    let t = c.get_totem();
    assert_eq!(t.fullness_bp, FULL_BP);
    assert_eq!(t.level, 1);
    assert_eq!(t.form, "egg");
    assert_eq!(t.mood, "happy");
    assert!(t.alive);
    assert_eq!(t.owner, dao);
    assert_eq!(c.get_stats().total_supply.0, 1_000_000_000 * ONE);
}

#[test]
fn feed_burns_half_and_hoards_half() {
    let (mut c, genesis, _dao) = setup();
    // Drain to 50% by advancing half a Totem-day.
    set_ctx(&genesis, DAY / 2);
    c.feed(near_sdk::json_types::U128(40 * ONE));

    let stats = c.get_stats();
    assert_eq!(stats.total_burned.0, 20 * ONE, "half of 40 burned");
    assert_eq!(stats.hoard.0, 20 * ONE, "half of 40 to hoard");
    assert_eq!(stats.total_fed.0, 40 * ONE);
    assert_eq!(stats.total_supply.0, 1_000_000_000 * ONE - 20 * ONE);
    assert_eq!(c.ft_balance_of(genesis.clone()).0, 1_000_000_000 * ONE - 40 * ONE);

    // fullness: 5000bp + (40/100)*10000 = 9000bp
    assert_eq!(c.get_totem().fullness_bp, 9000);
    assert_eq!(c.get_caretaker(genesis.clone()).lifetime_points.0, 40);
    assert_supply_conserved(&c, &[genesis]);
}

#[test]
fn overfeed_only_debits_what_fits() {
    let (mut c, genesis, _dao) = setup();
    set_ctx(&genesis, DAY / 2); // 50% full, room for 50 tokens at L1
    c.feed(near_sdk::json_types::U128(1000 * ONE));

    // Only 50 accepted -> 25 burned, 25 hoard, 50 debited.
    assert_eq!(c.get_stats().total_fed.0, 50 * ONE);
    assert_eq!(c.ft_balance_of(genesis.clone()).0, 1_000_000_000 * ONE - 50 * ONE);
    assert_eq!(c.get_totem().fullness_bp, FULL_BP);
    assert_eq!(c.get_caretaker(genesis).lifetime_points.0, 50);
}

#[test]
fn rescue_feed_earns_double_points() {
    let (mut c, genesis, _dao) = setup();
    // Drain to 20% (< 30% starving threshold): advance 0.8 day.
    set_ctx(&genesis, (DAY * 8) / 10);
    assert_eq!(c.get_totem().fullness_bp, 2000);
    c.feed(near_sdk::json_types::U128(10 * ONE));
    // 10 whole tokens x2 rescue = 20 points.
    assert_eq!(c.get_caretaker(genesis).lifetime_points.0, 20);
}

#[test]
fn full_totem_rejects_feed() {
    let (mut c, genesis, _dao) = setup();
    set_ctx(&genesis, 0); // still 100%
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        c.feed(near_sdk::json_types::U128(10 * ONE))
    }));
    assert!(r.is_err(), "feeding a full Totem should panic");
}

#[test]
fn rampage_bites_the_hoard() {
    let (mut c, genesis, _dao) = setup();
    // Build a hoard: fill up at 0.5 day.
    set_ctx(&genesis, DAY / 2);
    c.feed(near_sdk::json_types::U128(50 * ONE)); // hoard = 25
    assert_eq!(c.get_stats().hoard.0, 25 * ONE);

    // Advance to 2.0 days: fullness hits 0 at 1.5d, so 0.5d of rampage = 12 bites.
    let alice = accounts(2);
    set_ctx(&alice, 2 * DAY);
    c.poke();

    let t = c.get_totem();
    assert_eq!(t.mood, "rampage");
    assert!(t.alive);
    let hoard = c.get_stats().hoard.0;
    assert!(hoard < 25 * ONE && hoard > 0, "hoard partially eaten, not gone: {hoard}");
    assert_eq!(c.bites_applied, 12);
    assert_supply_conserved(&c, &[genesis, alice]);
}

#[test]
fn neglect_leads_to_death_and_burns_the_hoard() {
    let (mut c, genesis, _dao) = setup();
    set_ctx(&genesis, DAY / 2);
    c.feed(near_sdk::json_types::U128(50 * ONE)); // hoard = 25

    // Rampage starts at 1.5d; death after 3 more days = 4.5d. Advance to 5.0d.
    let alice = accounts(2);
    set_ctx(&alice, 5 * DAY);
    c.poke();

    let t = c.get_totem();
    assert!(!t.alive, "totem should be dead");
    assert_eq!(t.mood, "dead");
    assert_eq!(c.get_stats().hoard.0, 0, "hoard fully burned on death");
    assert_supply_conserved(&c, &[genesis, alice]);
}

#[test]
fn feeding_ends_rampage() {
    let (mut c, genesis, _dao) = setup();
    set_ctx(&genesis, DAY / 2);
    c.feed(near_sdk::json_types::U128(50 * ONE));

    // Enter rampage at 2.0d.
    set_ctx(&genesis, 2 * DAY);
    c.poke();
    assert_eq!(c.get_totem().mood, "rampage");

    // Genesis rescue-feeds -> rampage ends.
    c.feed(near_sdk::json_types::U128(50 * ONE));
    let t = c.get_totem();
    assert_ne!(t.mood, "rampage");
    assert!(t.alive);
    assert!(c.rampage_started_at.is_none());
}

#[test]
fn sybil_split_earns_identical_total() {
    // Two wallets feeding the same amount earn identical points, and the total
    // equals the whole tokens spent — splitting across wallets gains nothing.
    let (mut c, genesis, _dao) = setup();
    set_ctx(&genesis, DAY / 2);
    c.feed(near_sdk::json_types::U128(10 * ONE)); // genesis: 10 points

    // Register + fund a second wallet, then have it feed the same amount.
    let bob = accounts(3);
    testing_env!(VMContextBuilder::new()
        .current_account_id(contract_id())
        .predecessor_account_id(genesis.clone())
        .block_timestamp(DAY / 2)
        .attached_deposit(near_sdk::NearToken::from_near(1))
        .build());
    c.storage_deposit(Some(bob.clone()), None);
    testing_env!(VMContextBuilder::new()
        .current_account_id(contract_id())
        .predecessor_account_id(genesis.clone())
        .block_timestamp(DAY / 2)
        .attached_deposit(near_sdk::NearToken::from_yoctonear(1))
        .build());
    c.ft_transfer(bob.clone(), near_sdk::json_types::U128(10 * ONE), None);

    set_ctx(&bob, DAY / 2);
    c.feed(near_sdk::json_types::U128(10 * ONE)); // bob: 10 points

    let g_pts = c.get_caretaker(genesis).lifetime_points.0;
    let b_pts = c.get_caretaker(bob).lifetime_points.0;
    assert_eq!(g_pts, b_pts, "same spend -> same points regardless of wallet");
    assert_eq!(g_pts + b_pts, 20, "total points == whole tokens spent, no split bonus");
}
