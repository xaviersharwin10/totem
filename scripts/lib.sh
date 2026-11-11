# Shared helpers for the TOTEM scripts (sourced, not run).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
[ -f .env ] && set -a && . ./.env && set +a
NETWORK="${NETWORK:-testnet}"

# view <contract> <method> <json-args>  -> JSON on stdout
view() {
  near contract call-function as-read-only "$1" "$2" json-args "$3" network-config "$NETWORK" now 2>/dev/null
}

# call <signer> <contract> <method> <json-args> [deposit] [gas]
call() {
  near contract call-function as-transaction "$2" "$3" json-args "$4" \
    prepaid-gas "${6:-100 Tgas}" attached-deposit "${5:-0 NEAR}" \
    sign-as "$1" network-config "$NETWORK" sign-with-legacy-keychain send 2>&1 \
    | grep -E "Transaction ID|EVENT_JSON|Error|error:|panicked|Smart contract panicked" | cut -c1-240 || true
}

# propose <description> <proposal-kind-json>  -> prints the new proposal id
propose() {
  : "${DAO_ID:?run scripts/create-dao.sh first}"
  local bond
  bond=$(view "$DAO_ID" get_policy '{}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["proposal_bond"])')
  local p
  p=$(python3 -c 'import json,sys; print(json.dumps({"proposal":{"description":sys.argv[1],"kind":json.loads(sys.argv[2])}}))' "$1" "$2")
  local out
  out=$(call "$OWNER_ID" "$DAO_ID" add_proposal "$p" "$bond yoctoNEAR")
  echo "$out" >&2
  if echo "$out" | grep -q -E "Error|panicked"; then
    echo "!! add_proposal failed; not voting" >&2
    exit 1
  fi
  echo $(( $(view "$DAO_ID" get_last_proposal_id '{}' | tr -dc '0-9') - 1 ))
}

# approve <proposal-id> <voter...>
approve() {
  local id=$1; shift
  local kind
  kind=$(view "$DAO_ID" get_proposal "{\"id\":$id}" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["kind"]))')
  for v in "$@"; do
    echo "==> $v votes to approve proposal $id" >&2
    call "$v" "$DAO_ID" act_proposal "{\"id\":$id,\"action\":\"VoteApprove\",\"proposal\":$kind}" "0 NEAR" "300 Tgas" >&2
  done
  view "$DAO_ID" get_proposal "{\"id\":$id}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("proposal", d["id"], d["status"], "-", d["description"])'
}

# Keepers whose keys are on this machine (the default voters since the tribe
# constitution: the council can no longer vote on the Totem or on members).
keeper_voters() {
  view "$DAO_ID" get_policy '{}' | python3 -c '
import json,sys,os
p=json.load(sys.stdin)
r=[x for x in p["roles"] if x["name"]=="keepers"]
ks=r[0]["kind"]["Group"] if r and isinstance(r[0]["kind"],dict) else []
home=os.path.expanduser("~/.near-credentials/"+sys.argv[1])
print(" ".join(k for k in ks if os.path.exists(f"{home}/{k}.json")))' "$NETWORK"
}
