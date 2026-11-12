#!/usr/bin/env bash
# Build the contract and deploy + initialise it on testnet in demo mode
# (120-second Totem-day, faucet on). Uses near-cli-rs and cargo-near.
#
#   cp .env.example .env   # set CONTRACT_ID and OWNER_ID
#   scripts/deploy.sh            # create accounts (faucet), build, deploy, init
#   scripts/deploy.sh --redeploy # code only, keep state (no init)
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
: "${CONTRACT_ID:?set CONTRACT_ID in .env}"
: "${OWNER_ID:?set OWNER_ID in .env}"
NETWORK="${NETWORK:-testnet}"

account_exists() {
  near account view-account-summary "$1" network-config "$NETWORK" now >/dev/null 2>&1
}

for acct in "$CONTRACT_ID" "$OWNER_ID"; do
  if ! account_exists "$acct"; then
    echo "==> creating $acct with the testnet faucet"
    near account create-account sponsor-by-faucet-service "$acct" \
      autogenerate-new-keypair save-to-legacy-keychain network-config "$NETWORK" create
  fi
done

echo "==> building"
(cd contract && cargo near build non-reproducible-wasm)
WASM=contract/target/near/totem.wasm
ls -la "$WASM"

if [ "${1:-}" = "--redeploy" ]; then
  near contract deploy "$CONTRACT_ID" use-file "$WASM" without-init-call \
    network-config "$NETWORK" sign-with-legacy-keychain send
else
  ARGS=$(printf '{"genesis_account":"%s","dao_account":"%s","demo_mode":true,"name":"BaoBao"}' "$OWNER_ID" "$OWNER_ID")
  near contract deploy "$CONTRACT_ID" use-file "$WASM" \
    with-init-call new json-args "$ARGS" \
    prepaid-gas '100 Tgas' attached-deposit '0 NEAR' \
    network-config "$NETWORK" sign-with-legacy-keychain send
fi

echo "==> live state"
near contract call-function as-read-only "$CONTRACT_ID" get_totem json-args '{}' \
  network-config "$NETWORK" now
echo "Explorer: https://testnet.nearblocks.io/address/$CONTRACT_ID"
