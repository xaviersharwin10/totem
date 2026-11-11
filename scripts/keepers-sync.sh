#!/usr/bin/env bash
# Keep the DAO's "keepers" role in sync with on-chain reputation (brief 9.3).
# A Keeper is an account with >= keeper_stake (1,000 $TOTEM) staked in the
# Totem's belly, or a Silver / Gold Caretaker Badge. Keepers can propose and
# vote on calls to the TOTEM contract (rename, evolve, hatch) on their own.
#
#   scripts/keepers-sync.sh [candidate.testnet ...]
#
# Candidates are the accounts given plus the current Keepers (the contract has
# no list of all stakers, by design: no unbounded iteration). OWNER_ID proposes
# each change (anyone may); the Keepers vote (VOTERS, default: the Keepers whose
# keys are on this machine). Players can also nominate themselves in the app.
. "$(dirname "$0")/lib.sh"
: "${CONTRACT_ID:?}"; : "${OWNER_ID:?}"; : "${DAO_ID:?}"
ROLE=keepers

eligible() {  # prints "yes" / "no" and why, from the contract's one rule: get_keeper
  view "$CONTRACT_ID" get_keeper "{\"account_id\":\"$1\"}" | python3 -c '
import json,sys
d=json.load(sys.stdin)
print(("yes" if d["eligible"] else "no"), "(stake:", int(d["staked"])//10**18, "badge:", d["badge_earned"]+")")' 2>/dev/null || echo "no (unreadable)"
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

# Grace: a hatch releases every stake of the previous life, so Keepers get one
# Totem-day to re-stake into the new Totem before anyone proposes removing them.
AGE=$(python3 - "$(view "$CONTRACT_ID" get_lineage '{"limit":100}')" "$(view "$CONTRACT_ID" get_config '{}')" <<'PY'
import json,sys,time
life=json.loads(sys.argv[1])[-1]; cfg=json.loads(sys.argv[2])
age=time.time()*1e9-int(life["born_at"])
print("young" if life["alive"] and age < int(cfg["day_length_ns"]) else "old")
PY
)
if [ "$AGE" = young ] && [ ${#REMOVE[@]} -gt 0 ]; then
  echo "==> new generation is less than a Totem-day old: not removing ${REMOVE[*]} yet (they can re-stake)"
  REMOVE=()
fi
VOTERS="${VOTERS:-$(keeper_voters)}"
for a in "${ADD[@]}"; do
  ID=$(propose "Add Keeper $a (eligible per get_keeper)" "{\"AddMemberToRole\":{\"member_id\":\"$a\",\"role\":\"$ROLE\"}}")
  # shellcheck disable=SC2086
  approve "$ID" $VOTERS
done
for a in "${REMOVE[@]}"; do
  ID=$(propose "Remove Keeper $a (no longer eligible per get_keeper)" "{\"RemoveMemberFromRole\":{\"member_id\":\"$a\",\"role\":\"$ROLE\"}}")
  # shellcheck disable=SC2086
  approve "$ID" $VOTERS
done
[ ${#ADD[@]} -eq 0 ] && [ ${#REMOVE[@]} -eq 0 ] && echo "==> keepers already in sync: ${CURRENT:-none}"
exit 0
