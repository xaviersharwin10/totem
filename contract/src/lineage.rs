//! Generations and lineage (brief 5.13): gravestones, inherited cosmetic traits,
//! founders, and the family tree.
//!
//! Traits and founders are cosmetic only. They never change meal size, drain,
//! Blessings or anything economic. If death helped the next generation, players
//! would have a reason to let the Totem die.

use near_sdk::json_types::{U128, U64};
use near_sdk::{env, near, AccountId};

/// Cosmetic traits, rendered by the web app.
#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Eq, Debug, Default)]
pub struct Traits {
    pub palette: u8,
    pub pattern: u8,
    pub marking: u8,
    pub crest: u8,
}

/// Per-generation totals, frozen into the gravestone on death.
#[near(serializers = [borsh, json])]
#[derive(Clone, Default)]
pub struct GenStats {
    pub fed: U128,
    pub burned: U128,
    pub blessed: U128,
    pub slashed: U128,
}

/// A generation's life record. For the dead it is the gravestone, frozen at
/// death; for the living Totem `get_lineage` builds one on the fly.
#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct LifeRecord {
    pub generation: u32,
    pub totem_id: String,
    pub name: String,
    pub lineage_name: String,
    pub parent: Option<u32>,
    pub alive: bool,
    pub born_at: U64,
    pub died_at: Option<U64>,
    pub lifespan_sec: Option<U64>,
    pub max_level: u32,
    pub form: String,
    pub cause_of_death: Option<String>,
    pub traits: Traits,
    pub founders: Vec<AccountId>,
    pub top_feeders: Vec<(AccountId, U128)>,
    pub stats: GenStats,
}

/// Deterministic traits from `sha256(seed ids joined by '|' || generation)`.
pub fn derive_traits(seeds: &[AccountId], generation: u32, counts: &[u8]) -> Traits {
    let mut bytes = Vec::new();
    for (i, a) in seeds.iter().enumerate() {
        if i > 0 {
            bytes.push(b'|');
        }
        bytes.extend_from_slice(a.as_bytes());
    }
    bytes.extend_from_slice(&generation.to_le_bytes());
    let h = env::sha256(&bytes);
    Traits {
        palette: h[0] % counts[0],
        pattern: h[1] % counts[1],
        marking: h[2] % counts[2],
        crest: h[3] % counts[3],
    }
}

/// Insert or update `who` in a top-3 list ordered by amount, descending.
/// Ties keep the earlier feeder ahead.
pub fn bump_top3(top: &mut Vec<(AccountId, u128)>, who: &AccountId, total: u128) {
    top.retain(|(a, _)| a != who);
    let pos = top
        .iter()
        .position(|(_, v)| *v < total)
        .unwrap_or(top.len());
    top.insert(pos, (who.clone(), total));
    top.truncate(3);
}

pub fn roman(mut n: u32) -> String {
    const T: [(u32, &str); 13] = [
        (1000, "M"),
        (900, "CM"),
        (500, "D"),
        (400, "CD"),
        (100, "C"),
        (90, "XC"),
        (50, "L"),
        (40, "XL"),
        (10, "X"),
        (9, "IX"),
        (5, "V"),
        (4, "IV"),
        (1, "I"),
    ];
    let mut s = String::new();
    for &(v, r) in &T {
        while n >= v {
            s.push_str(r);
            n -= v;
        }
    }
    s
}

pub fn lineage_name(name: &str, generation: u32) -> String {
    format!("{} {}", name, roman(generation))
}
