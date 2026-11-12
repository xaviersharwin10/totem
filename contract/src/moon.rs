//! BaoBao follows the real moon.
//!
//! The contract computes tonight's moon from the block time alone: no oracle,
//! no admin, nothing anyone can switch off. Anyone can check it against the sky.
//!
//! - **Hunger:** the fuller the moon, the faster the belly empties (up to
//!   `moon_hunger_bp` faster at full moon). Full-moon nights are rally nights.
//! - **Burn:** the fuller the moon, the bigger the burned share of every meal
//!   (`burn_share_bp` + up to `moon_burn_bp`).
//! - **Moonlit badge:** feeding while the moon is at least `moonlit_min_bp` lit
//!   mints a soulbound `moonlit-<cycle>-<account>` badge, once per lunar cycle.
//!
//! Every lever lives in `Config` (fixed at `new`, readable via `get_config`).
//! The moon's position comes from a known new moon (2000-01-06 18:14 UTC) and
//! the mean synodic month (29.530588853 days). Its illuminated fraction is
//! `sin²(π·age/month)`, computed in integers with Bhaskara's sine
//! approximation (within ~0.2% of the true sine), so there are no floats.

use crate::config::{Config, FULL_BP};

/// A known new moon: 2000-01-06 18:14 UTC, in nanoseconds since the Unix epoch.
pub const NEW_MOON_REF_NS: u64 = 947_182_440_000_000_000;
/// The mean synodic month (new moon to new moon): 29.530588853 days, in ns.
pub const SYNODIC_NS: u64 = 2_551_442_876_899_200;

const Q: u128 = 1_000_000_000; // fixed-point scale

/// Time since the last new moon, in ns.
pub fn age_ns(now: u64) -> u64 {
    now.saturating_sub(NEW_MOON_REF_NS) % SYNODIC_NS
}

/// Lunar cycles since the reference new moon (one Moonlit badge per cycle).
pub fn cycle(now: u64) -> u64 {
    now.saturating_sub(NEW_MOON_REF_NS) / SYNODIC_NS
}

/// How much of the moon is lit, in basis points: 0 = new moon, 10_000 = full.
pub fn moon_bp(now: u64) -> u32 {
    let u = age_ns(now) as u128 * Q / SYNODIC_NS as u128; // phase in [0, Q)
    let a = u * (Q - u) / Q; // u(1-u), in [0, Q/4]
                             // Bhaskara: sin(pi*u) ~= 16 u(1-u) / (5 - 4 u(1-u))
    let sin = 16 * a * Q / (5 * Q - 4 * a);
    let lit = sin * sin / Q; // sin^2, scaled by Q
    (lit * FULL_BP as u128 / Q).min(FULL_BP as u128) as u32
}

/// The phase by name (eight phases, like a calendar).
pub fn phase_name(now: u64) -> &'static str {
    let eighth = (age_ns(now) as u128 * 16 / SYNODIC_NS as u128) as u32; // sixteenths
    match eighth {
        0 | 15 => "new moon",
        1 | 2 => "waxing crescent",
        3 | 4 => "first quarter",
        5 | 6 => "waxing gibbous",
        7 | 8 => "full moon",
        9 | 10 => "waning gibbous",
        11 | 12 => "last quarter",
        _ => "waning crescent",
    }
}

/// How long a full belly lasts right now: one Totem-day at new moon, shorter
/// under a bright moon.
pub fn drain_day_ns(cfg: &Config, now: u64) -> u64 {
    let m = moon_bp(now) as u128;
    let boost = cfg.moon_hunger_bp as u128 * m / FULL_BP as u128;
    (cfg.day_length_ns as u128 * FULL_BP as u128 / (FULL_BP as u128 + boost)) as u64
}

/// Hunger multiplier right now, in basis points (10_000 = normal).
pub fn hunger_bp(cfg: &Config, now: u64) -> u32 {
    FULL_BP + (cfg.moon_hunger_bp as u128 * moon_bp(now) as u128 / FULL_BP as u128) as u32
}

/// The share of a meal burned right now, in basis points.
pub fn burn_share_bp(cfg: &Config, now: u64) -> u32 {
    let extra = (cfg.moon_burn_bp as u128 * moon_bp(now) as u128 / FULL_BP as u128) as u32;
    (cfg.burn_share_bp + extra).min(FULL_BP)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: u64 = 86_400_000_000_000;
    fn at(y: i64, m: u32, d: u32, h: u32) -> u64 {
        // days from civil (Howard Hinnant), enough for test dates
        let y = if m <= 2 { y - 1 } else { y };
        let era = y.div_euclid(400);
        let yoe = y - era * 400;
        let mp = (m as i64 + 9) % 12;
        let doy = (153 * mp + 2) / 5 + d as i64 - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        let days = era * 146_097 + doe - 719_468;
        (days as u64) * DAY + h as u64 * 3_600_000_000_000
    }

    #[test]
    fn the_reference_new_moon_is_dark_and_half_a_month_later_is_full() {
        assert_eq!(moon_bp(NEW_MOON_REF_NS), 0);
        assert_eq!(moon_bp(NEW_MOON_REF_NS + SYNODIC_NS / 2), FULL_BP);
        assert_eq!(phase_name(NEW_MOON_REF_NS), "new moon");
        assert_eq!(phase_name(NEW_MOON_REF_NS + SYNODIC_NS / 2), "full moon");
    }

    #[test]
    fn november_2026_new_moon_on_the_10th_full_moon_on_the_24th() {
        // The mean-moon model (fixed synodic month) can drift from the true moon
        // by up to about half a day, so these windows are a day wide.
        assert!(
            moon_bp(at(2026, 11, 10, 0)) < 150,
            "new moon around Nov 9-10"
        );
        assert!(
            moon_bp(at(2026, 11, 24, 12)) > 9_900,
            "full moon around Nov 24"
        );
        let q = moon_bp(at(2026, 11, 17, 0)); // first quarter ~Nov 17
        assert!(
            (4_500..=5_600).contains(&q),
            "about half lit at first quarter, got {q}"
        );
    }

    #[test]
    fn bhaskara_stays_close_to_the_true_curve() {
        // sin^2(pi*u) at u = 1/8, 1/4, 3/8: 14.64%, 50%, 85.36%
        for (k, want) in [(1u64, 1_464u32), (2, 5_000), (3, 8_536)] {
            let got = moon_bp(NEW_MOON_REF_NS + SYNODIC_NS * k / 8);
            assert!(got.abs_diff(want) <= 40, "u={k}/8: got {got}, want {want}");
        }
    }
}
