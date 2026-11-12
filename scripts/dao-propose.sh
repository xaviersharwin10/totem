#!/usr/bin/env bash
# Create a DAO proposal that calls the TOTEM contract, then vote it through.
#
#   scripts/dao-propose.sh rename BaoBao
#   scripts/dao-propose.sh evolve dragon        # or golem; only between L4 and the deadline
#   scripts/dao-propose.sh hatch                # after a death
#
# Anyone may propose (OWNER_ID signs and pays the 0.1 NEAR bond, refunded when it
# passes). Keepers decide by majority: VOTERS (space-separated) all vote approve,
# default = the Keepers whose keys are on this machine. Since the tribe
# constitution (scripts/bootstrap-governance.sh) the council cannot vote here.
. "$(dirname "$0")/lib.sh"
: "${CONTRACT_ID:?}"; : "${OWNER_ID:?}"
VOTERS="${VOTERS:-$(keeper_voters)}"

case "${1:-}" in
  rename) METHOD=rename; MARGS=$(printf '{"name":"%s"}' "${2:?name}"); DESC="Name the Totem \"$2\"" ;;
  evolve) METHOD=choose_evolution; MARGS=$(printf '{"form":"%s"}' "${2:?dragon|golem}"); DESC="Evolve the Totem into a $2" ;;
  hatch)  METHOD=hatch; MARGS='{}'; DESC="Hatch the next generation" ;;
  *) echo "usage: $0 rename <name> | evolve <dragon|golem> | hatch"; exit 1 ;;
esac

# The contract refuses to hatch a living Totem; a passed vote would still show
# "Approved" in this DAO version, so don't open a pointless one.
if [ "$METHOD" = hatch ] && [ "$(view "$CONTRACT_ID" get_totem '{}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["alive"])')" = True ]; then
  echo "!! the Totem is alive: nothing to hatch"; exit 1
fi
# Reuse a hatch vote that is already open (the app may have opened one).
if [ "$METHOD" = hatch ]; then
  OPEN=$(view "$DAO_ID" get_last_proposal_id '{}' | tr -dc '0-9')
  OPEN=$(view "$DAO_ID" get_proposals "{\"from_index\":$(( OPEN > 20 ? OPEN - 20 : 0 )),\"limit\":20}" | python3 -c '
import json,sys,time
pol_period=int(sys.argv[1])
for p in json.load(sys.stdin):
  fc=p["kind"].get("FunctionCall") or {}
  if p["status"]=="InProgress" and fc.get("receiver_id")==sys.argv[2] and any(a["method_name"]=="hatch" for a in fc.get("actions",[])) and int(p["submission_time"])+pol_period>time.time_ns():
    print(p["id"]); break' "$(view "$DAO_ID" get_policy '{}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["proposal_period"])')" "$CONTRACT_ID")
  if [ -n "$OPEN" ]; then
    echo "==> hatch vote #$OPEN is already open: voting on it"
    # shellcheck disable=SC2086
    approve "$OPEN" $VOTERS
    exit 0
  fi
fi
ARGS64=$(printf '%s' "$MARGS" | base64 -w0)
KIND=$(printf '{"FunctionCall":{"receiver_id":"%s","actions":[{"method_name":"%s","args":"%s","deposit":"0","gas":"150000000000000"}]}}' \
  "$CONTRACT_ID" "$METHOD" "$ARGS64")
echo "==> proposing on $DAO_ID: $DESC"
ID=$(propose "$DESC" "$KIND")
# shellcheck disable=SC2086
approve "$ID" $VOTERS
