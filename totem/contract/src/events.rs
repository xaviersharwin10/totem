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

pub fn feed(account: &AccountId, amount: u128, burned: u128, to_hoard: u128, points: u128, rescue: bool) {
    emit(
        "feed",
        json!({
            "account": account,
            "amount": amount.to_string(),
            "burned": burned.to_string(),
            "to_hoard": to_hoard.to_string(),
            "points": points.to_string(),
            "rescue": rescue,
        }),
    );
}

pub fn level_up(level: u32) {
    emit("level_up", json!({ "level": level }));
}

pub fn evolve(form: &str) {
    emit("evolve", json!({ "form": form }));
}

pub fn bite(amount: u128, hoard_after: u128, tip: u128, poker: Option<&AccountId>) {
    emit(
        "bite",
        json!({
            "amount": amount.to_string(),
            "hoard_after": hoard_after.to_string(),
            "tip": tip.to_string(),
            "poker": poker,
        }),
    );
}

pub fn rampage_start() {
    emit("rampage_start", json!({}));
}

pub fn rampage_end(by: &AccountId) {
    emit("rampage_end", json!({ "by": by }));
}

pub fn death(generation: u32, name: &str, max_level: u32) {
    emit(
        "death",
        json!({ "generation": generation, "name": name, "max_level": max_level }),
    );
}

pub fn hatch(generation: u32, owner: &AccountId) {
    emit("hatch", json!({ "generation": generation, "owner": owner }));
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
