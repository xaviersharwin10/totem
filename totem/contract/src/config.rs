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
    /// Each bite removes this fraction of the Hoard, in basis points (1000 = 10%).
    pub bite_size_bp: u32,
    /// Poke tip: fraction of each bite paid to the poker instead of burned (100 = 1%).
    pub poke_tip_bp: u32,
    /// Continuous Rampage time before death.
    pub death_after_ns: u64,

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
}

impl Config {
    /// Default production parameters (tuned via sim/simulate.py).
    pub fn defaults(demo_mode: bool) -> Self {
        let day_secs = if demo_mode { DEMO_DAY_SECONDS } else { PROD_DAY_SECONDS };
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
            bite_interval_ns: day_ns / 24,
            bite_size_bp: 1_000,
            poke_tip_bp: 100,
            death_after_ns: 3 * day_ns,
            blessing_period_ns: 7 * day_ns,
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
        assert!(self.bite_size_bp <= FULL_BP, "bite_size > 100%");
        assert!(self.poke_tip_bp <= FULL_BP, "poke_tip > 100%");
        assert!(self.appetite_den > 0, "appetite_den zero");
        assert!(!self.level_thresholds.is_empty(), "no level thresholds");
        assert!(self.total_supply.0 > 0, "zero supply");
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
