//! One-time state migration for the prediction-market upgrade.
//!
//! The prediction market appended five fields to `Contract`. The contract
//! currently live on testnet predates it, so deploying the new code over that
//! state would panic: Borsh would reach the end of the old bytes with the new
//! `predict_*` fields still unread. `migrate()` reads the *old* layout explicitly
//! (`OldContract`, a byte-for-byte mirror of the deployed struct, which ends at
//! `faucet_last`), carries every field over unchanged, and appends the five
//! prediction-market fields empty.
//!
//! Deploy flow (deploy new code WITHOUT an init call, then migrate once):
//!   near contract deploy <id> use-file totem.wasm without-init-call ...
//!   near contract call-function as-transaction <id> migrate json-args '{}' \
//!     prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
//!     sign-with-legacy-keychain send
//!
//! VERIFY BYTE-COMPAT BEFORE TOUCHING THE LIVE CONTRACT. The unit test writes and
//! reads the same `OldContract` type, so it proves the migrate logic but not that
//! `OldContract` matches the *deployed* wasm. Do one dry run against a throwaway
//! account: deploy the OLD (pre-predict) wasm, init it, feed/level it, then
//! `--redeploy` the new wasm + `migrate` and confirm `get_totem`, balances, the
//! lineage and staking all read back unchanged.

use near_sdk::store::LookupMap;
use near_sdk::{env, near, AccountId};

use near_contract_standards::fungible_token::metadata::FungibleTokenMetadata;
use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::non_fungible_token::NonFungibleToken;

use crate::{
    Belly, Config, Contract, ContractExt, Form, GenStats, LifeRecord, Stake, StorageKey, Traits,
};

/// Byte-for-byte mirror of the deployed (pre-prediction) `Contract`. Field order
/// and types must match the live state exactly or `state_read` will misparse it.
/// Ends at `faucet_last` — the deployed struct has no `predict_*` fields.
#[near(serializers = [borsh])]
pub struct OldContract {
    token: FungibleToken,
    metadata: FungibleTokenMetadata,
    cfg: Config,

    totem_id: String,
    generation: u32,
    name: String,
    born_at: u64,
    fullness_bp: u32,
    last_settled_at: u64,
    happy_ns: u64,
    level: u32,
    max_level: u32,
    form: Form,
    l4_reached_at: Option<u64>,
    rampage_started_at: Option<u64>,
    bites_applied: u64,
    alive: bool,

    reserve: u128,
    reserved: u128,
    total_burned: u128,
    total_fed: u128,
    total_blessed: u128,

    lifetime_points: LookupMap<AccountId, u128>,
    period_points: LookupMap<(u64, AccountId), u128>,
    period_totals: LookupMap<u64, u128>,
    period_reserved: LookupMap<u64, u128>,
    period_claimed: LookupMap<u64, u128>,
    blessing_epoch_start: Option<u64>,
    last_closed_period: u64,
    period_base: u64,
    badges_claimed: LookupMap<AccountId, u8>,

    belly: Belly,
    stakes: LookupMap<AccountId, Stake>,
    bites: LookupMap<u32, Vec<u64>>,

    traits: Traits,
    founders: Vec<AccountId>,
    top_feeders: Vec<(AccountId, u128)>,
    gen_fed: LookupMap<(u32, AccountId), u128>,
    gen_stats: GenStats,
    graves: LookupMap<u32, LifeRecord>,

    nft: NonFungibleToken,
    hero_count: u64,

    faucet_last: LookupMap<AccountId, u64>,
}

#[near]
impl Contract {
    /// Migrate the deployed state to the prediction-market layout. Call once,
    /// right after deploying the new code with `without-init-call`. Only the
    /// contract account itself may call it (the deploy key signs the migrate).
    #[init(ignore_state)]
    pub fn migrate() -> Self {
        assert_eq!(
            env::predecessor_account_id(),
            env::current_account_id(),
            "migrate may only be called by the contract account"
        );
        let old: OldContract = env::state_read().expect("no existing state to migrate");
        Self {
            token: old.token,
            metadata: old.metadata,
            cfg: old.cfg,
            totem_id: old.totem_id,
            generation: old.generation,
            name: old.name,
            born_at: old.born_at,
            fullness_bp: old.fullness_bp,
            last_settled_at: old.last_settled_at,
            happy_ns: old.happy_ns,
            level: old.level,
            max_level: old.max_level,
            form: old.form,
            l4_reached_at: old.l4_reached_at,
            rampage_started_at: old.rampage_started_at,
            bites_applied: old.bites_applied,
            alive: old.alive,
            reserve: old.reserve,
            reserved: old.reserved,
            total_burned: old.total_burned,
            total_fed: old.total_fed,
            total_blessed: old.total_blessed,
            lifetime_points: old.lifetime_points,
            period_points: old.period_points,
            period_totals: old.period_totals,
            period_reserved: old.period_reserved,
            period_claimed: old.period_claimed,
            blessing_epoch_start: old.blessing_epoch_start,
            last_closed_period: old.last_closed_period,
            period_base: old.period_base,
            badges_claimed: old.badges_claimed,
            belly: old.belly,
            stakes: old.stakes,
            bites: old.bites,
            traits: old.traits,
            founders: old.founders,
            top_feeders: old.top_feeders,
            gen_fed: old.gen_fed,
            gen_stats: old.gen_stats,
            graves: old.graves,
            nft: old.nft,
            hero_count: old.hero_count,
            faucet_last: old.faucet_last,
            // --- new prediction-market fields ---
            predict_next_id: 0,
            current_predict_market: None,
            predict_pot: 0,
            predict_markets: LookupMap::new(StorageKey::PredictMarkets),
            predict_bets: LookupMap::new(StorageKey::PredictBets),
            // --- welcome-back field (also absent from the deployed state) ---
            last_fed: LookupMap::new(StorageKey::LastFed),
        }
    }
}

/// Test-only: drop the prediction-market fields from a live `Contract` and
/// persist it under the old (pre-predict) layout, simulating the deployed state
/// that `migrate` must read. Only a descendant of the crate root may destructure
/// `Contract`'s private fields, so this lives here rather than in `tests.rs`.
#[cfg(test)]
pub(crate) fn simulate_pre_predict_state(c: Contract) {
    let Contract {
        token,
        metadata,
        cfg,
        totem_id,
        generation,
        name,
        born_at,
        fullness_bp,
        last_settled_at,
        happy_ns,
        level,
        max_level,
        form,
        l4_reached_at,
        rampage_started_at,
        bites_applied,
        alive,
        reserve,
        reserved,
        total_burned,
        total_fed,
        total_blessed,
        lifetime_points,
        period_points,
        period_totals,
        period_reserved,
        period_claimed,
        blessing_epoch_start,
        last_closed_period,
        period_base,
        badges_claimed,
        belly,
        stakes,
        bites,
        traits,
        founders,
        top_feeders,
        gen_fed,
        gen_stats,
        graves,
        nft,
        hero_count,
        faucet_last,
        .. // ignore the five prediction-market fields
    } = c;
    let old = OldContract {
        token,
        metadata,
        cfg,
        totem_id,
        generation,
        name,
        born_at,
        fullness_bp,
        last_settled_at,
        happy_ns,
        level,
        max_level,
        form,
        l4_reached_at,
        rampage_started_at,
        bites_applied,
        alive,
        reserve,
        reserved,
        total_burned,
        total_fed,
        total_blessed,
        lifetime_points,
        period_points,
        period_totals,
        period_reserved,
        period_claimed,
        blessing_epoch_start,
        last_closed_period,
        period_base,
        badges_claimed,
        belly,
        stakes,
        bites,
        traits,
        founders,
        top_feeders,
        gen_fed,
        gen_stats,
        graves,
        nft,
        hero_count,
        faucet_last,
    };
    env::state_write(&old);
}
