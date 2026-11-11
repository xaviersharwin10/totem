#!/usr/bin/env bash
# Create the tribe's Sputnik DAO (v2 factory on testnet) and hand it the Totem NFT.
# After this, rename / choose_evolution / hatch only happen through DAO proposals.
#
#   scripts/create-dao.sh            # uses CONTRACT_ID, OWNER_ID from .env
# Factory: sputnik-v2.testnet (from the sputnik-dao-contract README; verified with
# `get_dao_list`). The DAO is created as <DAO_NAME>.sputnik-v2.testnet.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
: "${CONTRACT_ID:?}"; : "${OWNER_ID:?}"
NETWORK="${NETWORK:-testnet}"
FACTORY="${FACTORY:-sputnik-v2.testnet}"
DAO_NAME="${DAO_NAME:-totem-tribe}"
DAO_ID="$DAO_NAME.$FACTORY"
# Council: the owner account for the demo (1-of-1). Add members with AddMemberToRole proposals.
COUNCIL="${COUNCIL:-[\"$OWNER_ID\"]}"

if near account view-account-summary "$DAO_ID" network-config "$NETWORK" now >/dev/null 2>&1; then
  echo "==> $DAO_ID already exists"
else
  echo "==> creating $DAO_ID (council: $COUNCIL)"
  ARGS=$(printf '{"config":{"name":"%s","purpose":"The tribe that keeps the TOTEM alive. Owns the Totem NFT: names it, chooses its evolution, hatches the next generation.","metadata":""},"policy":%s}' "$DAO_NAME" "$COUNCIL" | base64 -w0)
  near contract call-function as-transaction "$FACTORY" create \
    json-args "{\"name\":\"$DAO_NAME\",\"args\":\"$ARGS\"}" \
    prepaid-gas '150 Tgas' attached-deposit '6 NEAR' \
    sign-as "$OWNER_ID" network-config "$NETWORK" sign-with-legacy-keychain send
fi

TOTEM_ID=$(near contract call-function as-read-only "$CONTRACT_ID" get_totem json-args '{}' \
  network-config "$NETWORK" now 2>/dev/null | sed -n 's/.*"totem_id": "\(.*\)".*/\1/p')
OWNER_NOW=$(near contract call-function as-read-only "$CONTRACT_ID" get_totem json-args '{}' \
  network-config "$NETWORK" now 2>/dev/null | sed -n 's/.*"owner": "\(.*\)".*/\1/p')
if [ "$OWNER_NOW" = "$DAO_ID" ]; then
  echo "==> the DAO already owns $TOTEM_ID"
else
  echo "==> transferring $TOTEM_ID from $OWNER_NOW to $DAO_ID"
  near contract call-function as-transaction "$CONTRACT_ID" nft_transfer \
    json-args "{\"receiver_id\":\"$DAO_ID\",\"token_id\":\"$TOTEM_ID\"}" \
    prepaid-gas '50 Tgas' attached-deposit '1 yoctoNEAR' \
    sign-as "$OWNER_NOW" network-config "$NETWORK" sign-with-legacy-keychain send
fi

grep -q '^DAO_ID=' .env && sed -i "s/^DAO_ID=.*/DAO_ID=$DAO_ID/" .env || echo "DAO_ID=$DAO_ID" >> .env
echo "==> done. DAO: https://testnet.nearblocks.io/address/$DAO_ID"
