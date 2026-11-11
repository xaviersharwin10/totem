#!/usr/bin/env bash
# Keep the DAO's "keepers" role in sync with on-chain reputation (brief 9.3).
# A Keeper is an account with >= keeper_stake (1,000 $TOTEM) staked in the
# Totem's belly, or a Silver / Gold Caretaker Badge. Keepers can propose and
# vote on calls to the TOTEM contract (rename, evolve, hatch) on their own.
#
#   scripts/keepers-sync.sh [candidate.testnet ...]
#
# Candidates are the accounts given plus the current Keepers (the contract has
# no list of all stakers, by design: no unbounded iteration). The council
# (OWNER_ID) proposes and approves each change.
. "$(dirname "$0")/lib.sh"
: "${CONTRACT_ID:?}"; : "${OWNER_ID:?}"; : "${DAO_ID:?}"
ROLE=keepers

eligible() {  # prints "yes" / "no" and why
  local a=$1 stake badges
  stake=$(view "$CONTRACT_ID" get_stake "{\"account_id\":\"$a\"}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("yes" if d and d.get("keeper_eligible") else "no")' 2>/dev/null || echo no)
  badges=$(view "$CONTRACT_ID" nft_tokens_for_owner "{\"account_id\":\"$a\",\"limit\":100}" | python3 -c 'import json,sys; ids=[t["token_id"] for t in json.load(sys.stdin)]; print("yes" if any(i.startswith(("badge-silver-","badge-gold-")) for i in ids) else "no")' 2>/dev/null || echo no)
  if [ "$stake" = yes ] || [ "$badges" = yes ]; then echo "yes (stake:$stake silver+badge:$badges)"; else echo "no (stake:$stake silver+badge:$badges)"; fi
}

POLICY=$(view "$DAO_ID" get_policy '{}')
CURRENT=$(printf '%s' "$POLICY" | python3 -c '
import json,sys
p=json.load(sys.stdin)
r=[x for x in p["roles"] if x["name"]=="keepers"]
print(" ".join(r[0]["kind"]["Group"]) if r and isinstance(r[0]["kind"],dict) and "Group" in r[0]["kind"] else ("-" if not r else ""))')
ROLE_EXISTS=yes; [ "$CURRENT" = "-" ] && ROLE_EXISTS=no && CURRENT=""

CANDIDATES=$(printf '%s\n' "$@" $CURRENT | sort -u | grep -v '^$' || true)
ADD=(); REMOVE=()
for a in $CANDIDATES; do
  e=$(eligible "$a")
  member=no; [[ " $CURRENT " == *" $a "* ]] && member=yes
  echo "  $a: eligible=$e member=$member"
  if [[ $e == yes* && $member == no ]]; then ADD+=("$a"); fi
  if [[ $e == no* && $member == yes ]]; then REMOVE+=("$a"); fi
done

if [ "$ROLE_EXISTS" = no ]; then
  if [ ${#ADD[@]} -eq 0 ]; then echo "==> no eligible Keepers yet; role not created"; exit 0; fi
  # The factory's DAO version has no ChangePolicyAddOrUpdateRole shortcut, so
  # propose the whole policy (current policy + the new role) via ChangePolicy.
  KIND=$(printf '%s' "$POLICY" | python3 -c '
import json,sys
policy=json.load(sys.stdin)
policy["roles"].append({"name":sys.argv[1],"kind":{"Group":sys.argv[2:]},
  "permissions":["call:AddProposal","call:VoteApprove","call:VoteReject","call:VoteRemove","call:Finalize"],
  "vote_policy":{}})
print(json.dumps({"ChangePolicy":{"policy":policy}}))' "$ROLE" "${ADD[@]}")
  echo "==> creating the keepers role with ${ADD[*]}"
  ID=$(propose "Create the Keepers role: stakers with >= 1,000 TOTEM or a Silver badge govern the Totem" "$KIND")
  approve "$ID" "$OWNER_ID"
  exit 0
fi

for a in "${ADD[@]}"; do
  ID=$(propose "Add Keeper $a (>= 1,000 staked or Silver badge)" "{\"AddMemberToRole\":{\"member_id\":\"$a\",\"role\":\"$ROLE\"}}")
  approve "$ID" "$OWNER_ID"
done
for a in "${REMOVE[@]}"; do
  ID=$(propose "Remove Keeper $a (no longer eligible)" "{\"RemoveMemberFromRole\":{\"member_id\":\"$a\",\"role\":\"$ROLE\"}}")
  approve "$ID" "$OWNER_ID"
done
[ ${#ADD[@]} -eq 0 ] && [ ${#REMOVE[@]} -eq 0 ] && echo "==> keepers already in sync: ${CURRENT:-none}"
exit 0
