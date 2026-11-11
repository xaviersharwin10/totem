// The tribe's Sputnik DAO, read and acted on from the app.
//
// Who decides what is the DAO's own policy (scripts/bootstrap-governance.sh):
// Keepers (by majority) hatch / rename / evolve the Totem and admit Keepers,
// and (by two thirds) change those rules; there is no council. Anyone may propose. Keeper eligibility is one contract view, get_keeper.
// Nothing here is simulated: every number is read from the DAO and the contract.

import { useCallback, useEffect, useRef, useState } from "react";
import { useNear } from "./near";
import { CONTRACT_ID, DAO_ID } from "./config";

export type Vote = "Approve" | "Reject" | "Remove";
type Kind = Record<string, unknown>;

export interface Proposal {
  id: number;
  proposer: string;
  description: string;
  kind: Kind;
  status: string; // InProgress | Approved | Rejected | Removed | Expired | Moved | Failed
  votes: Record<string, Vote>;
  submission_time: string;
  type: "hatch" | "rename" | "evolve" | "add_keeper" | "remove_keeper" | "policy" | "other";
  subject?: string; // the member for add/remove, the name for rename…
}

export interface KeeperInfo {
  account_id: string;
  eligible: boolean;
  by_stake: boolean;
  by_badge: boolean;
  staked: string;
  badge_earned: string;
  /** a released stake from an earlier life, still in the contract: re-stake to count again */
  releasedStake: string;
}
interface StakeView {
  staked: string;
  unbonding: string;
  released: boolean;
}

interface Role {
  name: string;
  kind: "Everyone" | { Group: string[] } | Record<string, unknown>;
  permissions: string[];
  vote_policy: Record<string, { threshold: [number, number] | string }>;
}
interface Policy {
  roles: Role[];
  default_vote_policy: { threshold: [number, number] | string };
  proposal_bond: string;
  proposal_period: string;
}

export interface Tribe {
  ready: boolean;
  keepers: string[];
  needed: number; // Keeper votes needed to pass (majority)
  /** Keeper votes a given proposal needs (constitution changes need two thirds). */
  neededFor: (p: Proposal) => number;
  bond: string; // yoctoNEAR
  proposals: Proposal[]; // newest first
  open: Proposal[];
  openHatch: Proposal | null;
  keeperInfo: Record<string, KeeperInfo>;
  me: KeeperInfo | null;
  amKeeper: boolean;
  myNomination: Proposal | null;
  busy: string | null;
  refresh: () => Promise<void>;
  proposeHatch: () => Promise<number>;
  nominateMe: () => Promise<number>;
  /** Move a released stake from an earlier life into the living Totem (withdraw + stake). */
  restake: () => Promise<void>;
  vote: (p: Proposal, action: "VoteApprove" | "VoteReject") => Promise<void>;
}

const group = (r?: Role) => (r && typeof r.kind === "object" && "Group" in r.kind ? (r.kind.Group as string[]) : []);

/** Sputnik's threshold: min(floor(n × num / den) + 1, n). */
export function votesNeeded(n: number, t: [number, number] | string): number {
  if (!Array.isArray(t)) return Math.max(1, Math.ceil(n / 2));
  return Math.min(Math.floor((n * t[0]) / t[1]) + 1, n);
}

function classify(p: Omit<Proposal, "type" | "subject">): Pick<Proposal, "type" | "subject"> {
  const k = p.kind;
  const fc = k.FunctionCall as { receiver_id: string; actions: { method_name: string; args: string }[] } | undefined;
  if (fc && fc.receiver_id === CONTRACT_ID) {
    const a = fc.actions[0];
    let args: Record<string, string> = {};
    try {
      args = JSON.parse(atob(a.args));
    } catch {
      /* ignore */
    }
    if (a.method_name === "hatch") return { type: "hatch" };
    if (a.method_name === "rename") return { type: "rename", subject: args.name };
    if (a.method_name === "choose_evolution") return { type: "evolve", subject: args.form };
  }
  const add = k.AddMemberToRole as { member_id: string; role: string } | undefined;
  if (add && add.role === "keepers") return { type: "add_keeper", subject: add.member_id };
  const rem = k.RemoveMemberFromRole as { member_id: string; role: string } | undefined;
  if (rem && rem.role === "keepers") return { type: "remove_keeper", subject: rem.member_id };
  if (k.ChangePolicy) return { type: "policy" };
  return { type: "other" };
}

export function useTribe(active: boolean): Tribe {
  const near = useNear();
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [keeperInfo, setKeeperInfo] = useState<Record<string, KeeperInfo>>({});
  const [me, setMe] = useState<KeeperInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const inflight = useRef(false);

  const refresh = useCallback(async () => {
    if (inflight.current) return;
    inflight.current = true;
    try {
      const [pol, last] = await Promise.all([
        near.viewAt<Policy>(DAO_ID, "get_policy"),
        near.viewAt<number>(DAO_ID, "get_last_proposal_id"),
      ]);
      const from = Math.max(0, last - 25);
      const raw = await near.viewAt<Omit<Proposal, "type" | "subject">[]>(DAO_ID, "get_proposals", { from_index: from, limit: 25 });
      const list = raw.map((p) => ({ ...p, ...classify(p) })).reverse();
      const ks = group(pol.roles.find((r) => r.name === "keepers"));
      const info = async (a: string): Promise<KeeperInfo | null> => {
        const [k, st] = await Promise.all([
          near.view<KeeperInfo>("get_keeper", { account_id: a }),
          near.view<StakeView | null>("get_stake", { account_id: a }).catch(() => null),
        ]);
        const rel = st && st.released ? (BigInt(st.staked) + BigInt(st.unbonding)).toString() : "0";
        return { ...k, releasedStake: rel };
      };
      const infos = await Promise.all(ks.map((a) => info(a).catch(() => null)));
      const map: Record<string, KeeperInfo> = {};
      infos.forEach((k) => k && (map[k.account_id] = k));
      setPolicy(pol);
      setProposals(list);
      setKeeperInfo(map);
      setMe(near.accountId ? await info(near.accountId).catch(() => null) : null);
    } catch {
      /* keep the last good read */
    } finally {
      inflight.current = false;
    }
  }, [near]);

  useEffect(() => {
    if (!active) return;
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [active, refresh, near.accountId]);

  const keepersRole = policy?.roles.find((r) => r.name === "keepers");
  const keepers = group(keepersRole);
  const dflt = policy?.default_vote_policy.threshold ?? [1, 2];
  const needed = votesNeeded(keepers.length, keepersRole?.vote_policy?.call?.threshold ?? dflt);
  const neededFor = (p: Proposal) => {
    const label = p.type === "policy" ? "policy" : p.type === "add_keeper" ? "add_member_to_role" : p.type === "remove_keeper" ? "remove_member_from_role" : "call";
    return votesNeeded(keepers.length, keepersRole?.vote_policy?.[label]?.threshold ?? dflt);
  };
  const open = proposals.filter((p) => p.status === "InProgress");
  const openHatch = open.find((p) => p.type === "hatch") ?? null;
  const amKeeper = !!near.accountId && keepers.includes(near.accountId);
  const myNomination = open.find((p) => p.type === "add_keeper" && p.subject === near.accountId) ?? null;

  const withBusy = async <T,>(label: string, f: () => Promise<T>): Promise<T> => {
    setBusy(label);
    try {
      return await f();
    } finally {
      setBusy(null);
      refresh();
    }
  };

  /** Open a proposal: from the player's wallet (they pay the refundable bond),
   * or, for guests, through /api/propose (the game pays the bond). */
  const open_ = async (type: "hatch" | "keeper", kind: Kind, description: string): Promise<number> => {
    if (near.accountId && !near.isGuest && policy) {
      const id = await near.callAt(DAO_ID, "add_proposal", { proposal: { description, kind } }, { deposit: policy.proposal_bond, gas: "50000000000000" });
      return Number(id);
    }
    const r = await fetch("/api/propose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type, accountId: near.accountId || undefined }),
    });
    const j = (await r.json()) as { id?: number; error?: string };
    if (j.error) throw new Error(j.error);
    return j.id!;
  };

  const proposeHatch = () =>
    withBusy("Opening the hatch vote…", async () => {
      if (openHatch) return openHatch.id;
      const args = btoa("{}");
      return open_(
        "hatch",
        { FunctionCall: { receiver_id: CONTRACT_ID, actions: [{ method_name: "hatch", args, deposit: "0", gas: "150000000000000" }] } },
        `Hatch the next generation (proposed from the app by ${near.accountId})`
      );
    });

  const nominateMe = () =>
    withBusy("Nominating you…", async () => {
      if (!near.accountId) throw new Error("Connect a wallet or play free first");
      if (myNomination) return myNomination.id;
      if (!me?.eligible) throw new Error("Not eligible yet: stake 1,000 $TOTEM in the living Totem, or earn the Silver badge.");
      const why = me.by_badge ? `${me.badge_earned} badge` : `${Math.floor(Number(BigInt(me.staked) / 10n ** 18n)).toLocaleString("en-US")} TOTEM staked`;
      return open_("keeper", { AddMemberToRole: { member_id: near.accountId, role: "keepers" } }, `Add Keeper ${near.accountId} (${why}, verified by get_keeper)`);
    });

  const restake = () =>
    withBusy("Re-staking…", async () => {
      const amt = me?.releasedStake ?? "0";
      if (BigInt(amt) === 0n) throw new Error("No released stake to move");
      await near.callMany([
        { method: "withdraw" },
        { method: "stake", args: { amount: amt } },
      ]);
    });

  const vote = (p: Proposal, action: "VoteApprove" | "VoteReject") =>
    withBusy(action === "VoteApprove" ? "Voting yes…" : "Voting no…", async () => {
      // This DAO version wants the proposal kind alongside the id.
      await near.callAt(DAO_ID, "act_proposal", { id: p.id, action, proposal: p.kind }, { gas: "250000000000000" });
    });

  return {
    ready: !!policy,
    keepers,
    needed,
    neededFor,
    bond: policy?.proposal_bond ?? "0",
    proposals,
    open,
    openHatch,
    keeperInfo,
    me,
    amKeeper,
    myNomination,
    busy,
    refresh,
    proposeHatch,
    nominateMe,
    restake,
    vote,
  };
}
