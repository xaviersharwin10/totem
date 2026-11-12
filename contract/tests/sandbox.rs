//! Integration tests: the compiled contract on a local NEAR sandbox node
//! (near-workspaces). They cover what unit tests can't: real receipts and
//! logs, real sub-account creation, real time passing between blocks.
//!
//!   cd contract
//!   cargo near build non-reproducible-wasm   # writes target/near/totem.wasm
//!   cargo test --test sandbox -- --nocapture
//!
//! Demo mode: 1 Totem-day = 120 s, so a whole life fits in a few minutes of
//! sandbox time, skipped with `fast_forward`.

use near_workspaces::network::Sandbox;
use near_workspaces::result::ExecutionFinalResult;
use near_workspaces::types::NearToken;
use near_workspaces::{Account, AccountId, Contract, Worker};
use serde_json::{json, Value};

type R<T> = Result<T, Box<dyn std::error::Error>>;
const ONE: u128 = 1_000_000_000_000_000_000;
const WASM: &str = "target/near/totem.wasm";

struct World {
    worker: Worker<Sandbox>,
    c: Contract,
    dao: Account,
    alice: Account,
    bob: Account,
}

async fn world() -> R<World> {
    let worker = near_workspaces::sandbox().await?;
    let wasm = std::fs::read(WASM).map_err(|e| format!("{WASM}: {e}. Run `cargo near build non-reproducible-wasm` first"))?;
    let c = worker.dev_deploy(&wasm).await?;
    let root = worker.root_account()?;
    let mk = |name: &'static str| {
        let root = root.clone();
        async move {
            root.create_subaccount(name)
                .initial_balance(NearToken::from_near(20))
                .transact()
                .await
                .map(|r| r.into_result())
        }
    };
    let genesis = mk("genesis").await??;
    let dao = mk("dao").await??;
    let alice = mk("alice").await??;
    let bob = mk("bob").await??;
    let init = c
        .call("new")
        .args_json(json!({
            "genesis_account": genesis.id(),
            "dao_account": dao.id(),
            "demo_mode": true,
            "name": "Mochi",
        }))
        .max_gas()
        .transact()
        .await?;
    ok(&init, "new")?;
    assert!(logs(&init).contains("treasury_opened"), "init opens generation 1's treasury");
    Ok(World { worker, c, dao, alice, bob })
}

fn logs(r: &ExecutionFinalResult) -> String {
    r.logs().join("\n")
}

fn ok(r: &ExecutionFinalResult, what: &str) -> R<()> {
    if r.is_failure() {
        return Err(format!("{what} failed: {:?}", r.clone().into_result().err()).into());
    }
    Ok(())
}

async fn view(c: &Contract, m: &str, args: Value) -> R<Value> {
    Ok(c.view(m).args_json(args).await?.json::<Value>()?)
}

fn amount(v: &Value) -> u128 {
    v.as_str().and_then(|s| s.parse().ok()).unwrap_or(0)
}

async fn call(who: &Account, c: &Contract, m: &str, args: Value) -> R<ExecutionFinalResult> {
    Ok(who.call(c.id(), m).args_json(args).max_gas().transact().await?)
}

/// Advance the sandbox until `get_totem.alive` is false (or give up).
async fn wait_for_death(w: &World) -> R<()> {
    for _ in 0..80 {
        if !view(&w.c, "get_totem", json!({})).await?["alive"].as_bool().unwrap() {
            return Ok(());
        }
        w.worker.fast_forward(200).await?;
    }
    Err("the Totem never died".into())
}

#[tokio::test]
async fn a_whole_life_on_a_real_node() -> R<()> {
    let w = world().await?;
    let treasury: AccountId = format!("totem-1.{}", w.c.id()).parse()?;

    // the treasury is a real account, and nobody holds a key to it
    let acct = w.worker.view_account(&treasury).await?;
    assert_eq!(acct.balance, NearToken::from_yoctonear(0), "a zero-balance account");
    assert!(w.worker.view_access_keys(&treasury).await?.is_empty(), "no access keys at all");
    assert_eq!(view(&w.c, "get_totem", json!({})).await?["treasury"], json!(treasury.to_string()));

    // the demo faucet mints, and says so with a NEP-141 ft_mint event
    for p in [&w.alice, &w.bob] {
        let r = call(p, &w.c, "faucet", json!({})).await?;
        ok(&r, "faucet")?;
        assert!(logs(&r).contains("\"ft_mint\""), "faucet logs ft_mint");
    }

    // bob stakes without feeding (unshielded); let the belly drop, then alice feeds
    ok(&call(&w.bob, &w.c, "stake", json!({ "amount": (300 * ONE).to_string() })).await?, "stake")?;
    w.worker.fast_forward(60).await?;
    let fill = amount(&view(&w.c, "get_totem", json!({})).await?["fill_amount"]);
    assert!(fill > 0, "some room in the belly");
    let r = call(&w.alice, &w.c, "feed", json!({ "amount": fill.to_string() })).await?;
    ok(&r, "feed")?;
    assert!(logs(&r).contains("\"ft_burn\""), "half of the meal is burned");
    let t = view(&w.c, "get_totem", json!({})).await?;
    let reserve = amount(&t["reserve"]);
    assert!(reserve > 0);
    assert_eq!(
        amount(&view(&w.c, "ft_balance_of", json!({ "account_id": treasury })).await?),
        reserve,
        "the treasury account's balance is the Reserve"
    );

    // nobody can pay into the treasury or the contract by plain transfer
    for to in [treasury.to_string(), w.c.id().to_string()] {
        let r = w
            .alice
            .call(w.c.id(), "ft_transfer")
            .args_json(json!({ "receiver_id": to, "amount": ONE.to_string() }))
            .deposit(NearToken::from_yoctonear(1))
            .transact()
            .await?;
        assert!(r.is_failure(), "transfer to {to} must fail");
    }

    // nobody but the DAO governs
    assert!(call(&w.alice, &w.c, "rename", json!({ "name": "Hacked" })).await?.is_failure());

    // starve it on real block time
    wait_for_death(&w).await?;
    let r = call(&w.alice, &w.c, "poke", json!({})).await?;
    ok(&r, "poke")?;
    let all = logs(&r);
    assert!(all.contains("\"bite\"") && all.contains("\"death\""), "the settle bit and killed it: {all}");
    assert_eq!(amount(&view(&w.c, "ft_balance_of", json!({ "account_id": treasury })).await?), 0, "death burns the treasury");
    let bob_stake = view(&w.c, "get_stake", json!({ "account_id": w.bob.id() })).await?;
    assert!(amount(&bob_stake["staked"]) < 300 * ONE, "the unshielded staker was slashed");
    assert_eq!(bob_stake["released"], json!(true));

    // the Totem NFT is now a gravestone
    let nft = view(&w.c, "nft_token", json!({ "token_id": "totem-1" })).await?;
    assert!(nft["metadata"]["extra"].as_str().unwrap().contains("gravestone"));

    // only the DAO can hatch; generation 2 gets a fresh treasury account
    assert!(call(&w.alice, &w.c, "hatch", json!({})).await?.is_failure());
    ok(&call(&w.dao, &w.c, "hatch", json!({})).await?, "hatch")?;
    let t2: AccountId = format!("totem-2.{}", w.c.id()).parse()?;
    w.worker.view_account(&t2).await?;
    assert!(w.worker.view_access_keys(&t2).await?.is_empty());
    let t = view(&w.c, "get_totem", json!({})).await?;
    assert_eq!(t["generation"], json!(2));
    assert_eq!(t["treasury"], json!(t2.to_string()));

    // bob takes his released stake back
    let before = amount(&view(&w.c, "ft_balance_of", json!({ "account_id": w.bob.id() })).await?);
    ok(&call(&w.bob, &w.c, "withdraw", json!({})).await?, "withdraw")?;
    let after = amount(&view(&w.c, "ft_balance_of", json!({ "account_id": w.bob.id() })).await?);
    assert_eq!(after - before, amount(&bob_stake["staked"]) + amount(&bob_stake["unbonding"]));
    Ok(())
}

#[tokio::test]
async fn the_ledger_always_adds_up() -> R<()> {
    let w = world().await?;
    for p in [&w.alice, &w.bob] {
        ok(&call(p, &w.c, "faucet", json!({})).await?, "faucet")?;
    }
    ok(&call(&w.bob, &w.c, "stake", json!({ "amount": (250 * ONE).to_string() })).await?, "stake")?;
    w.worker.fast_forward(60).await?;
    let fill = amount(&view(&w.c, "get_totem", json!({})).await?["fill_amount"]);
    ok(&call(&w.alice, &w.c, "feed", json!({ "amount": fill.to_string() })).await?, "feed")?;

    let s = view(&w.c, "get_stats", json!({})).await?;
    let t = view(&w.c, "get_totem", json!({})).await?;
    let bal = |id: String| {
        let c = &w.c;
        async move { view(c, "ft_balance_of", json!({ "account_id": id })).await.map(|v| amount(&v)) }
    };
    let holders = bal(w.alice.id().to_string()).await? + bal(w.bob.id().to_string()).await? + bal(format!("genesis.{}", w.worker.root_account()?.id())).await?;
    let contract = bal(w.c.id().to_string()).await?;
    let treasury = bal(t["treasury"].as_str().unwrap().to_string()).await?;
    assert_eq!(amount(&s["total_supply"]), holders + contract + treasury, "every token is somewhere");
    assert_eq!(treasury, amount(&s["reserve"]), "treasury = Reserve");
    assert_eq!(contract, amount(&s["reserved"]) + amount(&s["total_staked"]), "contract = Blessings + stakes");
    // 1B at launch + two faucet claims - burned
    assert_eq!(
        amount(&s["total_supply"]),
        1_000_000_000 * ONE + 2 * 1_000 * ONE - amount(&s["total_burned"])
    );
    Ok(())
}
