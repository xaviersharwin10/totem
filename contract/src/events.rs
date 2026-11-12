use near_sdk::serde_json::json;
use near_sdk::{env, AccountId};

/// Emit a NEP-297 event log under the "totem" standard.
/// Format: `EVENT_JSON:{"standard":"totem","version":"1.0.0","event":<e>,"data":[<data>]}`
fn emit(event: &str, data: near_sdk::serde_json::Value) {
    let payload = json!({
        "standard": "totem",
        "version": "1.0.0",
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{}", payload));
}

pub fn feed(
    account: &AccountId,
    amount: u128,
    burned: u128,
    to_reserve: u128,
    points: u128,
    rescue: bool,
    staker: bool,
) {
    emit(
        "feed",
        json!({
            "account": account,
            "amount": amount.to_string(),
            "burned": burned.to_string(),
            "to_reserve": to_reserve.to_string(),
            "points": points.to_string(),
            "rescue": rescue,
            "staker_bonus": staker,
        }),
    );
}

pub fn level_up(level: u32) {
    emit("level_up", json!({ "level": level }));
}

pub fn evolve(form: &str) {
    emit("evolve", json!({ "form": form }));
}

pub fn bite(
    reserve_burned: u128,
    stake_slashed: u128,
    tip: u128,
    poker: Option<&AccountId>,
    reserve_after: u128,
    level_after: u32,
) {
    emit(
        "bite",
        json!({
            "reserve_burned": reserve_burned.to_string(),
            "stake_slashed": stake_slashed.to_string(),
            "tip": tip.to_string(),
            "poker": poker,
            "reserve_after": reserve_after.to_string(),
            "level_after": level_after,
        }),
    );
}

pub fn level_down(level: u32) {
    emit("level_down", json!({ "level": level }));
}

pub fn rampage_start() {
    emit("rampage_start", json!({}));
}

pub fn rampage_end(by: &AccountId) {
    emit("rampage_end", json!({ "by": by }));
}

pub fn death(generation: u32, lineage_name: &str, max_level: u32, lifespan_sec: u64) {
    emit(
        "death",
        json!({
            "generation": generation,
            "name": lineage_name,
            "max_level": max_level,
            "lifespan_sec": lifespan_sec,
        }),
    );
}

pub fn hatch(
    generation: u32,
    lineage_name: &str,
    owner: &AccountId,
    traits: &crate::Traits,
    founders: &[AccountId],
) {
    emit(
        "hatch",
        json!({
            "generation": generation,
            "name": lineage_name,
            "owner": owner,
            "traits": traits,
            "founders": founders,
        }),
    );
}

pub fn stake(account: &AccountId, amount: u128, principal_after: u128) {
    emit(
        "stake",
        json!({
            "account": account,
            "amount": amount.to_string(),
            "principal": principal_after.to_string(),
        }),
    );
}

pub fn unstake(account: &AccountId, amount: u128, unbond_at: u64) {
    emit(
        "unstake",
        json!({
            "account": account,
            "amount": amount.to_string(),
            "unbond_at": unbond_at.to_string(),
        }),
    );
}

pub fn withdraw(account: &AccountId, amount: u128) {
    emit(
        "withdraw",
        json!({ "account": account, "amount": amount.to_string() }),
    );
}

pub fn shield(account: &AccountId, until: u64) {
    emit(
        "shield",
        json!({ "account": account, "until": until.to_string() }),
    );
}

pub fn rename(name: &str) {
    emit("rename", json!({ "name": name }));
}

pub fn blessing_reserved(period_id: u64, amount: u128, total_points: u128) {
    emit(
        "blessing_reserved",
        json!({
            "period_id": period_id,
            "amount": amount.to_string(),
            "total_points": total_points.to_string(),
        }),
    );
}

pub fn blessing_claimed(account: &AccountId, period_id: u64, amount: u128) {
    emit(
        "blessing_claimed",
        json!({
            "account": account,
            "period_id": period_id,
            "amount": amount.to_string(),
        }),
    );
}

pub fn badge_minted(account: &AccountId, tier: &str) {
    emit("badge_minted", json!({ "account": account, "tier": tier }));
}

/// Standard NEP-141 mint event (only the demo-mode faucet mints after init).
pub fn ft_mint(owner: &AccountId, amount: u128, memo: &str) {
    let payload = json!({
        "standard": "nep141",
        "version": "1.0.0",
        "event": "ft_mint",
        "data": [{ "owner_id": owner, "amount": amount.to_string(), "memo": memo }],
    });
    env::log_str(&format!("EVENT_JSON:{}", payload));
}

/// Standard NEP-141 burn event.
pub fn ft_burn(owner: &AccountId, amount: u128) {
    let payload = json!({
        "standard": "nep141",
        "version": "1.0.0",
        "event": "ft_burn",
        "data": [{ "owner_id": owner, "amount": amount.to_string() }],
    });
    env::log_str(&format!("EVENT_JSON:{}", payload));
}
