#!/usr/bin/env bash
# Create a DAO proposal that calls the TOTEM contract, then vote it through.
#
#   scripts/dao-propose.sh rename Mochi
#   scripts/dao-propose.sh evolve dragon        # or golem; only between L4 and the deadline
#   scripts/dao-propose.sh hatch                # after a death
#
# The council in the demo is 1-of-1, so one VoteApprove executes the call.
# VOTERS (space-separated, default OWNER_ID) all vote approve.
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] && set -a && . ./.env && set +a
: "${CONTRACT_ID:?}"; : "${OWNER_ID:?}"; : "${DAO_ID:?run scripts/create-dao.sh first}"
NETWORK="${NETWORK:-testnet}"
VOTERS="${VOTERS:-$OWNER_ID}"

case "${1:-}" in
  rename) METHOD=rename; MARGS=$(printf '{"name":"%s"}' "${2:?name}"); DESC="Name the Totem \"$2\"" ;;
  evolve) METHOD=choose_evolution; MARGS=$(printf '{"form":"%s"}' "${2:?dragon|golem}"); DESC="Evolve the Totem into a $2" ;;
  hatch)  METHOD=hatch; MARGS='{}'; DESC="Hatch the next generation" ;;
  *) echo "usage: $0 rename <name> | evolve <dragon|golem> | hatch"; exit 1 ;;
esac

ARGS64=$(printf '%s' "$MARGS" | base64 -w0)
PROPOSAL=$(printf '{"proposal":{"description":"%s","kind":{"FunctionCall":{"receiver_id":"%s","actions":[{"method_name":"%s","args":"%s","deposit":"0","gas":"150000000000000"}]}}}}' \
  "$DESC" "$CONTRACT_ID" "$METHOD" "$ARGS64")

BOND=$(near contract call-function as-read-only "$DAO_ID" get_policy json-args '{}' network-config "$NETWORK" now 2>/dev/null \
  | sed -n 's/.*"proposal_bond": "\([0-9]*\)".*/\1/p')
echo "==> proposing on $DAO_ID: $DESC (bond ${BOND} yocto)"
near contract call-function as-transaction "$DAO_ID" add_proposal json-args "$PROPOSAL" \
  prepaid-gas '100 Tgas' attached-deposit "${BOND} yoctoNEAR" \
  sign-as "$OWNER_ID" network-config "$NETWORK" sign-with-legacy-keychain send
ID=$(( $(near contract call-function as-read-only "$DAO_ID" get_last_proposal_id json-args '{}' network-config "$NETWORK" now 2>/dev/null | tr -dc '0-9') - 1 ))

for v in $VOTERS; do
  echo "==> $v votes to approve proposal $ID"
  near contract call-function as-transaction "$DAO_ID" act_proposal \
    json-args "{\"id\":$ID,\"action\":\"VoteApprove\",\"proposal\":$(near contract call-function as-read-only "$DAO_ID" get_proposal json-args "{\"id\":$ID}" network-config "$NETWORK" now 2>/dev/null | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["kind"]))')}" \
    prepaid-gas '300 Tgas' attached-deposit '0 NEAR' \
    sign-as "$v" network-config "$NETWORK" sign-with-legacy-keychain send
done
near contract call-function as-read-only "$DAO_ID" get_proposal json-args "{\"id\":$ID}" network-config "$NETWORK" now 2>/dev/null | grep -E '"status"'
