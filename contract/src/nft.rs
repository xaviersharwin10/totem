//! NEP-171 NFTs (brief 5.7, 5.13): the living Totem, its gravestones, and the
//! soulbound Caretaker / Hero / Founder badges.
//!
//! Token ids:
//! - `totem-{gen}`               the Totem of a generation. Owned by the tribe's
//!                               DAO, transferable (the Reserve and governance
//!                               follow it). While alive, `nft_token` returns live
//!                               metadata (level, mood, Reserve); at death it is
//!                               converted in place into a gravestone with the
//!                               frozen life record.
//! - `badge-{tier}-{account}`    Bronze / Silver / Gold Caretaker Badge (soulbound)
//! - `hero-{gen}-{n}`            to whoever ended a Rampage (soulbound)
//! - `founder-{gen}-{account}`   to the previous generation's top 3 feeders (soulbound)
//!
//! The contract pays the storage for every token it mints, so receiving a badge
//! never needs a deposit.

use crate::{Contract, ContractExt};
use near_contract_standards::non_fungible_token::core::NonFungibleTokenCore;
use near_contract_standards::non_fungible_token::enumeration::NonFungibleTokenEnumeration;
use near_contract_standards::non_fungible_token::events::NftMint;
use near_contract_standards::non_fungible_token::metadata::{
    NFTContractMetadata, NonFungibleTokenMetadataProvider, TokenMetadata, NFT_METADATA_SPEC,
};
use near_contract_standards::non_fungible_token::{NonFungibleTokenResolver, Token, TokenId};
use near_sdk::json_types::U128;
use near_sdk::serde_json::json;
use near_sdk::{env, near, AccountId, PromiseOrValue};
use std::collections::HashMap;

pub fn is_soulbound(token_id: &str) -> bool {
    token_id.starts_with("badge-")
        || token_id.starts_with("hero-")
        || token_id.starts_with("founder-")
        || token_id.starts_with("moonlit-")
        || token_id.starts_with("returned-")
}

impl Contract {
    /// Mint a token; the contract covers storage. Emits the standard `nft_mint`.
    pub(crate) fn nft_mint_internal(
        &mut self,
        token_id: String,
        owner: &AccountId,
        meta: TokenMetadata,
    ) {
        self.nft
            .internal_mint_with_refund(token_id.clone(), owner.clone(), Some(meta), None);
        NftMint {
            owner_id: owner,
            token_ids: &[&token_id],
            memo: None,
        }
        .emit();
    }

    /// Current owner of the Totem token (alive or gravestone): the tribe's DAO,
    /// or whoever it was transferred to. Governs rename / evolve / hatch.
    pub(crate) fn totem_owner(&self) -> AccountId {
        self.nft
            .owner_by_id
            .get(&self.totem_id)
            .expect("totem token missing")
    }

    pub(crate) fn totem_base_metadata(&self) -> TokenMetadata {
        let name = crate::lineage::lineage_name(&self.name, self.generation);
        TokenMetadata {
            title: Some(name.clone()),
            description: Some(format!(
                "{name}, the living Totem of generation {}. It owns the tribe's Reserve, \
                 grows when fed and bites when starved.",
                self.generation
            )),
            issued_at: Some(self.born_at.to_string()),
            extra: Some(
                json!({ "kind": "totem", "generation": self.generation, "traits": self.traits })
                    .to_string(),
            ),
            ..Default::default()
        }
    }

    /// Convert the Totem token into a gravestone, freezing the life record.
    pub(crate) fn engrave_gravestone(&mut self, rec: &crate::LifeRecord) {
        let meta = gravestone_metadata(rec);
        if let Some(m) = self.nft.token_metadata_by_id.as_mut() {
            m.insert(&self.totem_id, &meta);
        }
    }

    pub(crate) fn mint_badge(
        &mut self,
        who: &AccountId,
        kind: &str,
        token_id: String,
        title: String,
    ) {
        let meta = TokenMetadata {
            title: Some(title),
            description: Some(format!(
                "A soulbound TOTEM {kind} badge for {who}. Cannot be transferred: it is reputation."
            )),
            issued_at: Some(env::block_timestamp().to_string()),
            extra: Some(json!({ "kind": kind, "generation": self.generation }).to_string()),
            ..Default::default()
        };
        self.nft_mint_internal(token_id, who, meta);
    }

    /// Live metadata for the living Totem: a dynamic NFT.
    fn live_totem_metadata(&self) -> TokenMetadata {
        let v = self.get_totem();
        let mut m = self.totem_base_metadata();
        m.extra = Some(
            json!({
                "kind": "totem",
                "generation": self.generation,
                "traits": self.traits,
                "alive": v.alive,
                "level": v.level,
                "mood": v.mood,
                "form": v.form,
                "fullness_bp": v.fullness_bp,
                "reserve": v.reserve,
                "treasury": v.treasury,
                "total_staked": v.total_staked,
                "founders": self.founders,
            })
            .to_string(),
        );
        m
    }
}

/// Gravestone metadata: the frozen life record.
fn gravestone_metadata(rec: &crate::LifeRecord) -> TokenMetadata {
    TokenMetadata {
        title: Some(format!("🪦 {}", rec.lineage_name)),
        description: Some(format!(
            "Here lies {}, generation {}. Reached Level {}; {}.",
            rec.lineage_name,
            rec.generation,
            rec.max_level,
            rec.cause_of_death.clone().unwrap_or_default()
        )),
        issued_at: Some(rec.born_at.0.to_string()),
        updated_at: rec.died_at.map(|d| d.0.to_string()),
        extra: Some(json!({ "kind": "gravestone", "life": rec }).to_string()),
        ..Default::default()
    }
}

#[near]
impl NonFungibleTokenCore for Contract {
    #[payable]
    fn nft_transfer(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
    ) {
        assert!(
            !is_soulbound(&token_id),
            "badges are soulbound and cannot be transferred"
        );
        self.nft
            .nft_transfer(receiver_id, token_id, approval_id, memo)
    }

    #[payable]
    fn nft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        token_id: TokenId,
        approval_id: Option<u64>,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<bool> {
        assert!(
            !is_soulbound(&token_id),
            "badges are soulbound and cannot be transferred"
        );
        self.nft
            .nft_transfer_call(receiver_id, token_id, approval_id, memo, msg)
    }

    fn nft_token(&self, token_id: TokenId) -> Option<Token> {
        let mut t = self.nft.nft_token(token_id.clone())?;
        if token_id == self.totem_id && self.alive {
            // Dynamic NFT: live state, or the gravestone if it starved but the
            // death has not been settled by a transaction yet.
            let rec = self.projected_life_record(env::block_timestamp());
            t.metadata = Some(if rec.alive {
                self.live_totem_metadata()
            } else {
                gravestone_metadata(&rec)
            });
        }
        Some(t)
    }
}

#[near]
impl NonFungibleTokenResolver for Contract {
    #[private]
    fn nft_resolve_transfer(
        &mut self,
        previous_owner_id: AccountId,
        receiver_id: AccountId,
        token_id: TokenId,
        approved_account_ids: Option<HashMap<AccountId, u64>>,
    ) -> bool {
        self.nft.nft_resolve_transfer(
            previous_owner_id,
            receiver_id,
            token_id,
            approved_account_ids,
        )
    }
}

#[near]
impl NonFungibleTokenEnumeration for Contract {
    fn nft_total_supply(&self) -> U128 {
        self.nft.nft_total_supply()
    }

    fn nft_tokens(&self, from_index: Option<U128>, limit: Option<u64>) -> Vec<Token> {
        self.nft.nft_tokens(from_index, limit)
    }

    fn nft_supply_for_owner(&self, account_id: AccountId) -> U128 {
        self.nft.nft_supply_for_owner(account_id)
    }

    fn nft_tokens_for_owner(
        &self,
        account_id: AccountId,
        from_index: Option<U128>,
        limit: Option<u64>,
    ) -> Vec<Token> {
        self.nft.nft_tokens_for_owner(account_id, from_index, limit)
    }
}

#[near]
impl NonFungibleTokenMetadataProvider for Contract {
    fn nft_metadata(&self) -> NFTContractMetadata {
        NFTContractMetadata {
            spec: NFT_METADATA_SPEC.to_string(),
            name: "TOTEM creatures and badges".to_string(),
            symbol: "TOTEMNFT".to_string(),
            icon: None,
            base_uri: None,
            reference: None,
            reference_hash: None,
        }
    }
}
