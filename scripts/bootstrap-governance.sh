#!/usr/bin/env bash
# One-time governance bootstrap for a tribe DAO (run after create-dao.sh).
#
#   scripts/bootstrap-governance.sh keeper1.testnet keeper2.testnet keeper3.testnet
#
# 1. Makes sure the Totem is alive (hatches it with the founding policy if not)
#    and fed while the setup runs.
# 2. Gives each Keeper candidate 1,500 $TOTEM from the genesis holder and stakes
#    it (testnet accounts are created with the faucet service if missing). The
#    contract's get_keeper view must then say eligible.
# 3. Adds them to the DAO's "keepers" role.
# 4. Replaces the founding policy with the tribe constitution:
#      all      anyone may propose (bond 0.1 NEAR, refunded when it passes)
#      keepers  hatch / rename / evolve the Totem, admit and remove Keepers,
#               move the DAO's NEAR: majority of Keepers (2 of 3)
#      council  constitution only (policy, config, upgrades). It cannot hatch,
#               rename, evolve or pick Keepers. If every Keeper leaves, its
#               only power is to rewrite the policy and appoint new ones.
#
# Steps 1-4 are the last things the founding council decides alone.
. "$(dirname "$0")/lib.sh"
: "${CONTRACT_ID:?}"; : "${OWNER_ID:?}"; : "${DAO_ID:?}"
[ $# -ge 1 ] || { echo "usage: $0 keeper.testnet [keeper2.testnet ...]"; exit 1; }
KEEPERS=("$@")
ONE=000000000000000000   # 18 decimals

alive() { view "$CONTRACT_ID" get_totem '{}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["alive"])'; }
feed_full() {
  local fill
  fill=$(view "$CONTRACT_ID" get_totem '{}' | python3 -c 'import json,sys; print(json.load(sys.stdin)["fill_amount"])')
  [ "$fill" != "0" ] && call "$OWNER_ID" "$CONTRACT_ID" feed "{\"amount\":\"$fill\"}" >/dev/null || true
}

echo "==> 1. the Totem"
if [ "$(alive)" != "True" ]; then
  echo "    dead: hatching with the founding policy"
  VOTERS="$OWNER_ID" scripts/dao-propose.sh hatch
fi
feed_full

echo "==> 2. Keeper stakes"
for k in "${KEEPERS[@]}"; do
  if ! near account view-account-summary "$k" network-config "$NETWORK" now >/dev/null 2>&1; then
    echo "    creating $k"
    near account create-account sponsor-by-faucet-service "$k" \
      autogenerate-new-keypair save-to-legacy-keychain network-config "$NETWORK" create >/dev/null 2>&1
    sleep 2
  fi
  call "$OWNER_ID" "$CONTRACT_ID" storage_deposit "{\"account_id\":\"$k\"}" "0.00125 NEAR" >/dev/null
  call "$OWNER_ID" "$CONTRACT_ID" ft_transfer "{\"receiver_id\":\"$k\",\"amount\":\"1500$ONE\"}" "1 yoctoNEAR" >/dev/null
  feed_full
  call "$k" "$CONTRACT_ID" stake "{\"amount\":\"1500$ONE\"}" >/dev/null
  view "$CONTRACT_ID" get_keeper "{\"account_id\":\"$k\"}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print("   ", d["account_id"], "eligible" if d["eligible"] else "NOT ELIGIBLE", "staked", int(d["staked"])//10**18)'
done

echo "==> 3. Keepers role"
CURRENT=$(view "$DAO_ID" get_policy '{}' | python3 -c '
import json,sys
p=json.load(sys.stdin)
r=[x for x in p["roles"] if x["name"]=="keepers"]
print(" ".join(r[0]["kind"]["Group"]) if r else "")')
for k in "${KEEPERS[@]}"; do
  if [[ " $CURRENT " != *" $k "* ]]; then
    ID=$(propose "Add Keeper $k (1,500 TOTEM staked)" "{\"AddMemberToRole\":{\"member_id\":\"$k\",\"role\":\"keepers\"}}")
    approve "$ID" "$OWNER_ID"
  fi
done
feed_full

echo "==> 4. the tribe constitution"
KIND=$(view "$DAO_ID" get_policy '{}' | python3 -c '
import json,sys
old=json.load(sys.stdin)
keepers=[x for x in old["roles"] if x["name"]=="keepers"][0]["kind"]["Group"]
council=[x for x in old["roles"] if x["name"]=="council"][0]["kind"]["Group"]
acts=["VoteApprove","VoteReject","VoteRemove","Finalize"]
perm=lambda kinds:[f"{k}:{a}" for k in kinds for a in acts]
policy={
  "roles":[
    {"name":"all","kind":"Everyone","permissions":["*:AddProposal"],"vote_policy":{}},
    {"name":"keepers","kind":{"Group":keepers},
     "permissions":perm(["call","add_member_to_role","remove_member_from_role","transfer","vote"]),"vote_policy":{}},
    {"name":"council","kind":{"Group":council},
     "permissions":perm(["policy","config","upgrade_self","upgrade_remote","set_vote_token"]),"vote_policy":{}},
  ],
  "default_vote_policy":{"weight_kind":"RoleWeight","quorum":"0","threshold":[1,2]},
  "proposal_bond":"100000000000000000000000",
  "proposal_period":old["proposal_period"],
  "bounty_bond":old["bounty_bond"],
  "bounty_forgiveness_period":old["bounty_forgiveness_period"],
}
print(json.dumps({"ChangePolicy":{"policy":policy}}))')
ID=$(propose "Adopt the tribe constitution: Keepers (majority) govern the Totem and membership; the council only guards the policy" "$KIND")
approve "$ID" "$OWNER_ID"
feed_full
echo "==> done"
view "$DAO_ID" get_policy '{}' | python3 -c '
import json,sys
p=json.load(sys.stdin)
for r in p["roles"]: print("   ", r["name"], r["kind"], len(r["permissions"]), "permissions")
print("    bond", int(p["proposal_bond"])/1e24, "NEAR; threshold", p["default_vote_policy"]["threshold"])'
