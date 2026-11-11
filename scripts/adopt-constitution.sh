#!/usr/bin/env bash
# Adopt the tribe constitution: no council, no founder powers. The Keepers own
# everything the DAO can do, including its own rules.
#
#   scripts/adopt-constitution.sh
#
#   all      anyone may propose (bond 0.1 NEAR, refunded when it passes)
#   keepers  hatch / rename / evolve the Totem, admit and remove Keepers, move
#            the DAO's NEAR: simple majority
#            change the constitution (policy, config, upgrades): two thirds
#
# Whoever holds the "policy" vote today approves it (the founding council, on
# its last vote). Run once; afterwards only a Keeper supermajority changes it.
. "$(dirname "$0")/lib.sh"
: "${DAO_ID:?}"

POLICY=$(view "$DAO_ID" get_policy '{}')

KIND=$(printf '%s' "$POLICY" | python3 -c '
import json,sys
old=json.load(sys.stdin)
keepers=[x for x in old["roles"] if x["name"]=="keepers"][0]["kind"]["Group"]
acts=["VoteApprove","VoteReject","VoteRemove","Finalize"]
perm=lambda kinds:[f"{k}:{a}" for k in kinds for a in acts]
rules=["policy","config","upgrade_self","upgrade_remote","set_vote_token"]
super_={"weight_kind":"RoleWeight","quorum":"0","threshold":[2,3]}
policy={
  "roles":[
    {"name":"all","kind":"Everyone","permissions":["*:AddProposal"],"vote_policy":{}},
    {"name":"keepers","kind":{"Group":keepers},
     "permissions":perm(["call","add_member_to_role","remove_member_from_role","transfer","vote"]+rules),
     "vote_policy":{k:super_ for k in rules}},
  ],
  "default_vote_policy":{"weight_kind":"RoleWeight","quorum":"0","threshold":[1,2]},
  "proposal_bond":"100000000000000000000000",
  "proposal_period":old["proposal_period"],
  "bounty_bond":old["bounty_bond"],
  "bounty_forgiveness_period":old["bounty_forgiveness_period"],
}
print(json.dumps({"ChangePolicy":{"policy":policy}}))')

# Members of every role that can approve a policy change today, with keys here.
VOTERS=$(printf '%s' "$POLICY" | python3 -c '
import json,sys,os
p=json.load(sys.stdin)
home=os.path.expanduser("~/.near-credentials/"+sys.argv[1])
vs=[]
for r in p["roles"]:
  if isinstance(r["kind"],dict) and any(x in r["permissions"] for x in ("policy:VoteApprove","*:VoteApprove","*:*")):
    vs+= [m for m in r["kind"]["Group"] if os.path.exists(f"{home}/{m}.json") and m not in vs]
print(" ".join(vs))' "$NETWORK")
[ -n "$VOTERS" ] || { echo "!! nobody with a policy vote has keys on this machine"; exit 1; }

echo "==> proposing the tribe constitution on $DAO_ID (voters: $VOTERS)"
ID=$(propose "Adopt the tribe constitution: the Keepers govern everything. Majority for the Totem and membership, two thirds to change these rules. No council." "$KIND")
# shellcheck disable=SC2086
approve "$ID" $VOTERS
view "$DAO_ID" get_policy '{}' | python3 -c '
import json,sys
p=json.load(sys.stdin)
for r in p["roles"]: print("   ", r["name"], r["kind"], len(r["permissions"]), "permissions", r["vote_policy"] and "rules need 2/3" or "")'
