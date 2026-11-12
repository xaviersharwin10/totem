use near_sdk::json_types::U128;
use near_sdk::{near, NearToken};

/// Seconds in a production Totem-day.
pub const PROD_DAY_SECONDS: u64 = 86_400;
/// Seconds in a demo Totem-day (fast clock for live demos).
pub const DEMO_DAY_SECONDS: u64 = 120;
pub const NANOS_PER_SEC: u64 = 1_000_000_000;

/// Fullness is tracked in basis points: 10_000 == 100%.
pub const FULL_BP: u32 = 10_000;
/// Token decimals for $TOTEM.
pub const DECIMALS: u8 = 18;
pub const ONE_TOKEN: u128 = 1_000_000_000_000_000_000; // 10^18

/// All game parameters. Fixed at `new()`, never mutated, exposed via `get_config`.
/// This is the proof there is no admin key: every lever lives here and is read-only.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Config {
    pub demo_mode: bool,
    pub day_length_ns: u64,

    /// Tokens (base units) to fill an L1 egg from 0% to 100%.
    pub base_meal: U128,
    /// Appetite growth per level as a fraction (default 3/2 = 1.5x).
    pub appetite_num: u64,
    pub appetite_den: u64,

    /// Fraction of each meal burned, in basis points (default 5000 = 50%).
    pub burn_share_bp: u32,
    pub happy_threshold_bp: u32,
    pub starving_threshold_bp: u32,
    /// Point multiplier for a rescue feed (fullness below starving).
    pub rescue_multiplier: u32,

    /// Cumulative Happy-days required to reach L2, L3, L4, L5.
    pub level_thresholds: Vec<u32>,
    /// Extra Happy-days per level beyond the explicit thresholds (default 5).
    pub level_step_after: u32,

    /// Rampage: one bite per this interval while fullness is 0.
    pub bite_interval_ns: u64,
    /// Each bite burns this fraction of the Reserve, in basis points (1500 = 15%).
    pub bite_burn_bp: u32,
    /// Each bite slashes this fraction of every unshielded stake into the Reserve.
    pub stake_slash_bp: u32,
    /// Poke tip: fraction of the Reserve burned by bites that is paid to the
    /// poker instead of burned (100 = 1%).
    pub poke_tip_bp: u32,

    /// Staking (5.12). Minimum stake for the staker point bonus.
    pub min_stake: U128,
    /// Staker point multiplier as (num, den), default 3/2 = 1.5x.
    pub staker_points_num: u32,
    pub staker_points_den: u32,
    /// Stake needed to be eligible for the DAO Keepers role (read by keepers-sync).
    pub keeper_stake: U128,
    /// A feed of at least this much shields the feeder's stake.
    pub shield_min_feed: U128,
    pub shield_window_ns: u64,
    pub unbond_delay_ns: u64,
    /// Granularity of shield expiries (shield ends are rounded up to this).
    pub bucket_len_ns: u64,

    /// Cosmetic trait option counts (5.13): palette, pattern, marking, crest.
    pub trait_counts: Vec<u8>,

    pub blessing_period_ns: u64,
    /// Blessing rates (fraction of Hoard reserved per period), basis points.
    pub blessing_rate_egg_bp: u32,
    pub blessing_rate_dragon_bp: u32,
    pub blessing_rate_golem_bp: u32,
    /// +bp per level from L5, capped.
    pub blessing_bonus_from_l5_bp: u32,
    pub blessing_bonus_cap_bp: u32,
    /// Unclaimed Blessings return to the Hoard this many periods later.
    pub unclaimed_return_periods: u64,

    /// Time after reaching L4 for the DAO to choose; else defaults to Golem.
    pub evolution_deadline_ns: u64,

    /// Lifetime whole-token points for Bronze / Silver / Gold.
    pub badge_thresholds: Vec<u128>,

    pub total_supply: U128,
    /// Demo faucet: tokens per account per Totem-day.
    pub faucet_amount: U128,

    /// BaoBao follows the real moon (see moon.rs). At full moon the belly
    /// empties this much faster (5000 = 1.5x), scaled by how lit the moon is.
    pub moon_hunger_bp: u32,
    /// Extra share of each meal burned at full moon (2000 = 50% -> 70%), scaled likewise.
    pub moon_burn_bp: u32,
    /// Feeding while the moon is at least this lit earns the Moonlit badge (once per cycle).
    pub moonlit_min_bp: u32,
    /// Welcome back: a caretaker who fed before and then stayed away at least
    /// this many Totem-days gets bonus points on the feed that brings them back.
    pub welcome_back_days: u32,
    /// The bonus, as a share of that feed's points (5000 = +50%)...
    pub welcome_back_bp: u32,
    /// ...capped at this many points, so it can't be farmed with big feeds.
    pub welcome_back_max_points: u32,
}

impl Config {
    /// Default production parameters (tuned via sim/simulate.py).
    pub fn defaults(demo_mode: bool) -> Self {
        let day_secs = if demo_mode {
            DEMO_DAY_SECONDS
        } else {
            PROD_DAY_SECONDS
        };
        let day_ns = day_secs * NANOS_PER_SEC;
        Config {
            demo_mode,
            day_length_ns: day_ns,
            base_meal: U128(100 * ONE_TOKEN),
            appetite_num: 3,
            appetite_den: 2,
            burn_share_bp: 5_000,
            happy_threshold_bp: 7_000,
            starving_threshold_bp: 3_000,
            rescue_multiplier: 2,
            level_thresholds: vec![1, 3, 6, 10],
            level_step_after: 5,
            bite_interval_ns: day_ns / 4,
            bite_burn_bp: 1_500,
            stake_slash_bp: 1_500,
            poke_tip_bp: 100,
            min_stake: U128(100 * ONE_TOKEN),
            staker_points_num: 3,
            staker_points_den: 2,
            keeper_stake: U128(1_000 * ONE_TOKEN),
            shield_min_feed: U128(5 * ONE_TOKEN),
            shield_window_ns: 2 * day_ns,
            unbond_delay_ns: day_ns * 3 / 2,
            bucket_len_ns: day_ns / 24,
            trait_counts: vec![8, 6, 6, 4],
            blessing_period_ns: day_ns * 7 / 2,
            blessing_rate_egg_bp: 500,
            blessing_rate_dragon_bp: 800,
            blessing_rate_golem_bp: 300,
            blessing_bonus_from_l5_bp: 100,
            blessing_bonus_cap_bp: 500,
            unclaimed_return_periods: 2,
            evolution_deadline_ns: day_ns,
            badge_thresholds: vec![100, 1_000, 10_000],
            total_supply: U128(1_000_000_000 * ONE_TOKEN),
            faucet_amount: U128(1_000 * ONE_TOKEN),
            moon_hunger_bp: 5_000,
            moon_burn_bp: 2_000,
            moonlit_min_bp: 9_000,
            welcome_back_days: 3,
            welcome_back_bp: 5_000,
            welcome_back_max_points: 100,
        }
    }

    pub fn validate(&self) {
        assert!(self.day_length_ns > 0, "day_length must be positive");
        assert!(self.burn_share_bp <= FULL_BP, "burn_share > 100%");
        assert!(
            self.starving_threshold_bp < self.happy_threshold_bp,
            "starving must be below happy"
        );
        assert!(self.happy_threshold_bp <= FULL_BP, "happy > 100%");
        assert!(self.bite_burn_bp <= FULL_BP, "bite_burn > 100%");
        assert!(self.stake_slash_bp <= FULL_BP, "stake_slash > 100%");
        assert!(self.bite_interval_ns > 0, "bite_interval zero");
        assert!(self.bucket_len_ns > 0, "bucket_len zero");
        assert!(self.staker_points_den > 0, "staker_points_den zero");
        assert!(
            self.trait_counts.len() == 4 && self.trait_counts.iter().all(|&n| n > 0),
            "trait_counts must be 4 positive values"
        );
        assert!(self.poke_tip_bp <= FULL_BP, "poke_tip > 100%");
        assert!(self.appetite_den > 0, "appetite_den zero");
        assert!(!self.level_thresholds.is_empty(), "no level thresholds");
        assert!(self.total_supply.0 > 0, "zero supply");
        assert!(self.burn_share_bp + self.moon_burn_bp <= FULL_BP, "burn_share + moon_burn > 100%");
        assert!(self.moonlit_min_bp <= FULL_BP, "moonlit_min > 100%");
        assert!(self.welcome_back_days > 0, "welcome_back_days must be positive");
    }
}

/// The creature's form. Egg is the pre-evolution default (L1-L3).
#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Form {
    Egg,
    Dragon,
    Golem,
}

impl Form {
    /// Appetite multiplier as (num, den).
    pub fn appetite(&self) -> (u64, u64) {
        match self {
            Form::Egg => (1, 1),
            Form::Dragon => (3, 2), // 1.5x
            Form::Golem => (4, 5),  // 0.8x
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            Form::Egg => "egg",
            Form::Dragon => "dragon",
            Form::Golem => "golem",
        }
    }
}

/// Derived mood, for views and events.
#[near(serializers = [json])]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mood {
    Happy,
    Hungry,
    Starving,
    Rampage,
    Dead,
}

impl Mood {
    pub fn as_str(&self) -> &'static str {
        match self {
            Mood::Happy => "happy",
            Mood::Hungry => "hungry",
            Mood::Starving => "starving",
            Mood::Rampage => "rampage",
            Mood::Dead => "dead",
        }
    }
}

/// Helper: one NEAR (for storage deposits in tests/UI).
pub const ONE_NEAR: NearToken = NearToken::from_near(1);
