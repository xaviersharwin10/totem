//! TOTEM — a community creature on NEAR that dies if the tribe ignores it.
//!
//! One contract holds everything: the NEP-141 $TOTEM token, the game state,
//! staking into the belly, the lineage of generations, and the NEP-171 NFTs (the
//! Totem / gravestones and soulbound badges). Feeding is an internal debit plus a real burn, with
//! no cross-contract calls. Time is handled lazily: every mutating call runs
//! `settle()` first to advance hunger, XP, Rampage bites (which burn the
//! Reserve, slash unshielded stakes and drop a level) and death at Level 0.
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
use near_contract_standards::non_fungible_token::NonFungibleToken;

mod config;
mod events;
mod game;
mod lineage;
mod moon;
mod nft;
mod predict;
mod rewards;
mod staking;
mod views;

#[cfg(test)]
mod tests;

pub use config::*;
pub use lineage::{GenStats, LifeRecord, Traits};
pub use predict::{PredictBet, PredictMarket};
pub use staking::{Belly, Stake};

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
    Stakes,
    Bites,
    GenFed,
    Graves,
    NftOwners,
    NftMeta,
    NftEnum,
    PredictMarkets,
    PredictBets,
    LastFed,
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
    /// Bites taken in the current Rampage (reset when a feed ends it).
    bites_applied: u64,
    alive: bool,

    // --- treasury (all held in the contract's own ledger account) ---
    /// The Totem-owned part of the Hoard. Stakes are tracked in `belly`.
    reserve: u128,
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

    // --- staking into the belly (5.12) ---
    belly: Belly,
    stakes: LookupMap<AccountId, Stake>,
    /// Bite timestamps per generation. Length <= that generation's max level.
    bites: LookupMap<u32, Vec<u64>>,

    // --- lineage (5.13) ---
    traits: Traits,
    founders: Vec<AccountId>,
    /// Top 3 feeders of the current generation by tokens fed.
    top_feeders: Vec<(AccountId, u128)>,
    gen_fed: LookupMap<(u32, AccountId), u128>,
    gen_stats: GenStats,
    /// Gravestones: frozen life records of dead generations.
    graves: LookupMap<u32, LifeRecord>,

    // --- NEP-171: the Totem / gravestones and soulbound badges ---
    nft: NonFungibleToken,
    hero_count: u64,

    // --- demo faucet ---
    faucet_last: LookupMap<AccountId, u64>,

    // --- prediction markets ---
    predict_next_id: u32,
    current_predict_market: Option<u32>,
    predict_pot: u128,
    predict_markets: LookupMap<u32, PredictMarket>,
    predict_bets: LookupMap<(u32, AccountId), PredictBet>,

    // --- welcome back ---
    /// When each account last fed (block time, ns): a long gap earns a welcome-back bonus.
    last_fed: LookupMap<AccountId, u64>,
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
        // Generation 1 has no predecessor: seed traits from genesis and the DAO.
        let traits = lineage::derive_traits(
            &[genesis_account.clone(), dao_account.clone()],
            1,
            &cfg.trait_counts,
        );
        let nft = NonFungibleToken::new(
            StorageKey::NftOwners,
            current.clone(),
            Some(StorageKey::NftMeta),
            Some(StorageKey::NftEnum),
            None::<StorageKey>,
        );
        let mut this = Self {
            token,
            metadata,
            cfg,
            totem_id: "totem-1".to_string(),
            generation: 1,
            name: name.unwrap_or_else(|| "Unnamed".to_string()),
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
            reserve: 0,
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
            belly: Belly::default(),
            stakes: LookupMap::new(StorageKey::Stakes),
            bites: LookupMap::new(StorageKey::Bites),
            traits,
            founders: vec![],
            top_feeders: vec![],
            gen_fed: LookupMap::new(StorageKey::GenFed),
            gen_stats: GenStats::default(),
            graves: LookupMap::new(StorageKey::Graves),
            nft,
            hero_count: 0,
            faucet_last: LookupMap::new(StorageKey::FaucetLast),
            predict_next_id: 0,
            current_predict_market: None,
            predict_pot: 0,
            predict_markets: LookupMap::new(StorageKey::PredictMarkets),
            predict_bets: LookupMap::new(StorageKey::PredictBets),
            last_fed: LookupMap::new(StorageKey::LastFed),
        };
        // The Totem NFT of generation 1 belongs to the tribe's DAO.
        this.ensure_treasury();
        let meta = this.totem_base_metadata();
        this.nft_mint_internal("totem-1".to_string(), &dao_account, meta);
        this
    }

    // ----- owner-gated governance (the DAO) -------------------------------- //

    /// Rename the creature's base name (the lineage numeral is added from the
    /// generation, e.g. "BaoBao III"). Only the Totem NFT owner (the DAO) may call.
    pub fn rename(&mut self, name: String) {
        self.assert_owner();
        assert!(name.len() <= 32, "name too long (max 32)");
        self.settle();
        self.name = name.clone();
        if self.alive {
            let meta = self.totem_base_metadata();
            let id = self.totem_id.clone();
            if let Some(m) = self.nft.token_metadata_by_id.as_mut() {
                m.insert(&id, &meta);
            }
        }
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
            self.totem_owner(),
            "only the Totem owner (DAO) may call this"
        );
    }

    /// After a death, the gravestone's owner hatches the next generation's egg:
    /// a new Totem NFT minted to them, Level 1, 100% full, empty Reserve. Its cosmetic traits are derived from the previous
    /// generation's top 3 feeders, who become its Founders. Nothing economic
    /// carries over. Reserved Blessings from the dead generation stay claimable,
    /// and its stakers can still withdraw their released stakes.
    pub fn hatch(&mut self) {
        self.assert_owner();
        self.settle();
        assert!(!self.alive, "the Totem is still alive");
        let now = env::block_timestamp();
        let owner = self.totem_owner();
        let founders: Vec<AccountId> = self.top_feeders.iter().map(|(a, _)| a.clone()).collect();

        self.generation += 1;
        let seeds = if founders.is_empty() {
            vec![owner.clone()]
        } else {
            founders.clone()
        };
        self.traits = lineage::derive_traits(&seeds, self.generation, &self.cfg.trait_counts);
        self.founders = founders;

        self.totem_id = format!("totem-{}", self.generation);
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
        self.reserve = 0;
        self.top_feeders.clear();
        self.gen_stats = GenStats::default();
        // Released stakes stay in total_staked until withdrawn; the live
        // aggregate starts empty for the new generation.
        self.belly.unshielded = 0;
        self.belly.buckets.clear();
        // Continue Blessing period numbering past the dead generation's ids.
        self.period_base = self.last_closed_period;
        self.blessing_epoch_start = None;

        // Prediction market: close any open market and reset for the new generation.
        self.current_predict_market = None;

        self.ensure_treasury();
        let meta = self.totem_base_metadata();
        let id = self.totem_id.clone();
        self.nft_mint_internal(id, &owner, meta);
        let gen = self.generation;
        for f in self.founders.clone() {
            self.mint_badge(
                &f,
                "founder",
                format!("founder-{gen}-{f}"),
                format!("Founder of {}", lineage::lineage_name(&self.name, gen)),
            );
            events::badge_minted(&f, "founder");
        }
        events::hatch(
            self.generation,
            &lineage::lineage_name(&self.name, self.generation),
            &owner,
            &self.traits,
            &self.founders,
        );
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

/// The contract and its treasury sub-accounts hold tokens only under the
/// game's rules (Reserve, stakes, Blessings). A plain transfer there would be
/// stuck and break the accounting, so it is refused: feed or stake instead.
fn assert_not_totem_account(receiver: &AccountId) {
    let me = env::current_account_id();
    let r = receiver.as_str();
    assert!(
        r != me.as_str() && !r.ends_with(&format!(".{me}")),
        "the Totem's accounts only take tokens by feed or stake, not by transfer"
    );
}

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        assert_not_totem_account(&receiver_id);
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
        assert_not_totem_account(&receiver_id);
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
