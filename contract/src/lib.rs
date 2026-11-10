//! TOTEM — a community creature on NEAR that dies if the tribe ignores it.
//!
//! One contract holds everything: the NEP-141 $TOTEM token, the game state, and
//! (wired in a later layer) the NEP-171 NFTs. Feeding is an internal debit plus a
//! real burn — no cross-contract calls. Time is handled lazily: every mutating
//! call runs `settle()` first to advance hunger, XP, Rampage bites and death.
//!
//! There is no admin key. Every parameter is fixed at `new()` and read-only via
//! `get_config()`.

use near_sdk::json_types::U128;
use near_sdk::store::LookupMap;
use near_sdk::{env, near, AccountId, BorshStorageKey, PanicOnDefault, PromiseOrValue};

use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::FungibleToken;

mod config;
mod events;
mod game;
mod rewards;
mod views;

#[cfg(test)]
mod tests;

pub use config::*;

#[derive(BorshStorageKey)]
#[near(serializers = [borsh])]
enum StorageKey {
    Token,
    LifetimePoints,
    PeriodPoints,
    PeriodTotals,
    PeriodReserved,
    PeriodClaimed,
    Badges,
    FaucetLast,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    /// NEP-141 ledger. The contract's own account holds the Hoard + reserved
    /// Blessings, so `ft_total_supply` always equals the sum of ledger balances.
    token: FungibleToken,
    metadata: FungibleTokenMetadata,
    cfg: Config,

    // --- current totem ---
    totem_id: String,
    generation: u32,
    name: String,
    /// Owner of the Totem NFT — the tribe's Sputnik DAO. Governs rename/evolve/hatch.
    owner_id: AccountId,
    born_at: u64,
    /// Fullness in basis points as of `last_settled_at`.
    fullness_bp: u32,
    last_settled_at: u64,
    /// Cumulative time spent Happy, in nanoseconds (the XP measure).
    happy_ns: u64,
    level: u32,
    max_level: u32,
    form: Form,
    l4_reached_at: Option<u64>,
    rampage_started_at: Option<u64>,
    bites_applied: u64,
    alive: bool,

    // --- treasury (all held in the contract's own ledger account) ---
    hoard: u128,
    reserved: u128,
    total_burned: u128,
    total_fed: u128,
    total_blessed: u128,

    // --- points & rewards ---
    lifetime_points: LookupMap<AccountId, u128>,
    period_points: LookupMap<(u64, AccountId), u128>,
    period_totals: LookupMap<u64, u128>,
    period_reserved: LookupMap<u64, u128>,
    period_claimed: LookupMap<u64, u128>,
    blessing_epoch_start: Option<u64>,
    last_closed_period: u64,
    /// Global offset so Blessing period ids keep increasing across generations
    /// (a new egg after a death must not reuse the dead Totem's period ids).
    period_base: u64,
    /// Highest badge tier claimed per account: 1=Bronze, 2=Silver, 3=Gold.
    badges_claimed: LookupMap<AccountId, u8>,

    // --- demo faucet ---
    faucet_last: LookupMap<AccountId, u64>,
}

#[near]
impl Contract {
    /// Initialize the contract. Mints the full supply to `genesis_account`, sets
    /// the DAO as the Totem's owner, and fixes all parameters. Call once.
    #[init]
    pub fn new(
        genesis_account: AccountId,
        dao_account: AccountId,
        demo_mode: bool,
        config: Option<Config>,
        name: Option<String>,
    ) -> Self {
        let cfg = config.unwrap_or_else(|| Config::defaults(demo_mode));
        cfg.validate();

        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Totem".to_string(),
            symbol: "TOTEM".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: DECIMALS,
        };

        let mut token = FungibleToken::new(StorageKey::Token);
        // Register the genesis holder and the contract account (treasury), then mint.
        let current = env::current_account_id();
        token.internal_register_account(&genesis_account);
        if genesis_account != current {
            token.internal_register_account(&current);
        }
        token.internal_deposit(&genesis_account, cfg.total_supply.0);

        let now = env::block_timestamp();
        let this = Self {
            token,
            metadata,
            cfg,
            totem_id: "totem-1".to_string(),
            generation: 1,
            name: name.unwrap_or_else(|| "Unnamed".to_string()),
            owner_id: dao_account,
            born_at: now,
            fullness_bp: FULL_BP,
            last_settled_at: now,
            happy_ns: 0,
            level: 1,
            max_level: 1,
            form: Form::Egg,
            l4_reached_at: None,
            rampage_started_at: None,
            bites_applied: 0,
            alive: true,
            hoard: 0,
            reserved: 0,
            total_burned: 0,
            total_fed: 0,
            total_blessed: 0,
            lifetime_points: LookupMap::new(StorageKey::LifetimePoints),
            period_points: LookupMap::new(StorageKey::PeriodPoints),
            period_totals: LookupMap::new(StorageKey::PeriodTotals),
            period_reserved: LookupMap::new(StorageKey::PeriodReserved),
            period_claimed: LookupMap::new(StorageKey::PeriodClaimed),
            blessing_epoch_start: None,
            last_closed_period: 0,
            period_base: 0,
            badges_claimed: LookupMap::new(StorageKey::Badges),
            faucet_last: LookupMap::new(StorageKey::FaucetLast),
        };
        this
    }

    // ----- owner-gated governance (the DAO) -------------------------------- //

    /// Rename the creature. Only the Totem NFT owner (the DAO) may call.
    pub fn rename(&mut self, name: String) {
        self.assert_owner();
        assert!(name.len() <= 32, "name too long (max 32)");
        self.settle();
        self.name = name.clone();
        events::rename(&name);
    }

    /// Choose the evolution at L4. Only the owner, only within the deadline.
    pub fn choose_evolution(&mut self, form: String) {
        self.assert_owner();
        self.settle();
        assert!(self.alive, "totem is dead");
        assert!(self.level >= 4, "not yet level 4");
        let l4 = self.l4_reached_at.expect("l4 not recorded");
        assert!(
            env::block_timestamp() <= l4 + self.cfg.evolution_deadline_ns,
            "evolution deadline passed"
        );
        assert!(self.form == Form::Egg, "already evolved");
        self.form = match form.as_str() {
            "dragon" => Form::Dragon,
            "golem" => Form::Golem,
            _ => env::panic_str("form must be 'dragon' or 'golem'"),
        };
        events::evolve(self.form.as_str());
    }

    fn assert_owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner_id,
            "only the Totem owner (DAO) may call this"
        );
    }

    /// After a death, hatch a new egg: Level 1, 100% full, empty Hoard, new id.
    /// Reserved Blessings from the previous generation remain claimable.
    pub fn hatch(&mut self) {
        self.assert_owner();
        self.settle();
        assert!(!self.alive, "the Totem is still alive");
        let now = env::block_timestamp();
        self.generation += 1;
        self.totem_id = format!("totem-{}", self.generation);
        self.name = "Unnamed".to_string();
        self.born_at = now;
        self.fullness_bp = FULL_BP;
        self.last_settled_at = now;
        self.happy_ns = 0;
        self.level = 1;
        self.max_level = 1;
        self.form = Form::Egg;
        self.l4_reached_at = None;
        self.rampage_started_at = None;
        self.bites_applied = 0;
        self.alive = true;
        self.hoard = 0;
        // Continue Blessing period numbering past the dead generation's ids.
        self.period_base = self.last_closed_period;
        self.blessing_epoch_start = None;
        events::hatch(self.generation, &self.owner_id);
    }
}

impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.clone()
    }
}

// NEP-141 + NEP-145 implemented by delegating to the standard `FungibleToken`.
// (The 5.30 `impl_fungible_token_*` macros are deprecated and mis-typed, so we
// wire the traits by hand.)
use near_contract_standards::fungible_token::core::FungibleTokenCore;
use near_contract_standards::fungible_token::resolver::FungibleTokenResolver;
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::NearToken;

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        self.token
            .ft_resolve_transfer(sender_id, receiver_id, amount)
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.storage_unregister(force)
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}
