// The ledger and the lives: every mint, burn, bite, stake and life of the Totem,
// read from the contract's own on-chain events (server/history.ts) and the
// lineage records (get_lineage). Each row links to its transaction.

import { useEffect, useMemo, useState } from "react";
import { useNear } from "./chain/near";
import { EXPLORER, toTokens } from "./chain/config";
import { shortGuest } from "./chain/guest";
import { fmt, fmtTime } from "./engine";

export interface HistoryEvent {
  id: string;
  tx: string;
  ts: number;
  method: string | null;
  standard: string;
  kind: string;
  data: Record<string, string | number | boolean>;
  generation?: number;
}
interface Life {
  generation: number;
  totem_id: string;
  lineage_name: string;
  alive: boolean;
  born_at: string;
  died_at: string | null;
  lifespan_sec: string | null;
  max_level: number;
  form: string;
  cause_of_death: string | null;
  founders: string[];
  top_feeders: [string, string][];
  stats: { fed: string; burned: string; blessed: string; slashed: string };
}
interface Stats {
  total_supply: string;
  total_burned: string;
  total_fed: string;
  total_blessed: string;
}

const LAUNCH_SUPPLY = 1_000_000_000;
const who = (a: unknown) => {
  const s = String(a ?? "");
  return shortGuest(s.length > 30 && /^[0-9a-f]{40,}|^0x/.test(s) ? `${s.slice(0, 6)}…${s.slice(-4)}` : s);
};
const tk = (v: unknown) => fmt(toTokens(String(v ?? "0")));
const ago = (ts: number) => {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

type Filter = "all" | "supply" | "life" | "stakes" | "rewards";
const GROUP: Record<string, Filter> = {
  feed: "supply",
  ft_mint: "supply",
  ft_burn: "supply",
  bite: "life",
  death: "life",
  hatch: "life",
  level_up: "life",
  level_down: "life",
  rampage_start: "life",
  rampage_end: "life",
  rename: "life",
  treasury_opened: "life",
  evolve: "life",
  stake: "stakes",
  unstake: "stakes",
  withdraw: "stakes",
  blessing_reserved: "rewards",
  blessing_claimed: "rewards",
  badge_minted: "rewards",
};

/** Hide ft_burn lines a feed or bite in the same receipt already reports. */
function dedupe(events: HistoryEvent[]): HistoryEvent[] {
  const byReceipt = new Map<string, HistoryEvent[]>();
  for (const e of events) {
    const r = e.id.split(":")[0];
    byReceipt.set(r, [...(byReceipt.get(r) ?? []), e]);
  }
  const hidden = new Set<string>();
  for (const list of byReceipt.values()) {
    const explained: bigint[] = [];
    for (const e of list) {
      if (e.kind === "feed") explained.push(BigInt(String(e.data.burned ?? 0)));
      if (e.kind === "bite") {
        const burned = BigInt(String(e.data.reserve_burned ?? 0));
        explained.push(burned, burned - BigInt(String(e.data.tip ?? 0)));
      }
    }
    for (const e of list) {
      if (e.kind !== "ft_burn") continue;
      const i = explained.indexOf(BigInt(String(e.data.amount ?? 0)));
      if (i >= 0) {
        hidden.add(e.id);
        explained.splice(i, 1);
      }
    }
  }
  return events.filter((e) => !hidden.has(e.id) && e.kind !== "shield");
}

function line(e: HistoryEvent, receiptHasDeath: boolean): { icon: string; text: string; tone?: "burn" | "mint" | "bad" | "good" } {
  const d = e.data;
  switch (e.kind) {
    case "feed":
      return {
        icon: d.rescue ? "🦸" : "🎋",
        text: `${who(d.account)} fed ${tk(d.amount)} · 🔥 ${tk(d.burned)} burned · ${tk(d.to_reserve)} to the Reserve${d.rescue ? " · rescue!" : ""}`,
        tone: "burn",
      };
    case "ft_burn":
      return { icon: "🔥", text: `${tk(d.amount)} $TOTEM burned${receiptHasDeath ? ": the Reserve, at death" : ""}`, tone: "burn" };
    case "ft_mint":
      return { icon: "🚰", text: `${who(d.owner_id)} got ${tk(d.amount)} from the demo faucet (minted; testnet only)`, tone: "mint" };
    case "bite":
      return {
        icon: "⚔️",
        text: `BITE: 🔥 ${tk(d.reserve_burned)} of the Reserve burned, ${tk(d.stake_slashed)} slashed from unshielded stakes → Level ${d.level_after}${
          Number(d.tip) > 0 ? ` · ${who(d.poker)} got a ${tk(d.tip)} tip for poking` : ""
        }`,
        tone: "bad",
      };
    case "death":
      return { icon: "💀", text: `${d.name} starved. It reached Level ${d.max_level} and lived ${fmtTime(Number(d.lifespan_sec))}. A gravestone NFT stays forever.`, tone: "bad" };
    case "hatch":
      return { icon: "🥚", text: `${d.name} hatched by the tribe's DAO vote`, tone: "good" };
    case "level_up":
      return { icon: "⬆️", text: `Reached Level ${d.level}`, tone: "good" };
    case "level_down":
      return { icon: "💔", text: `Dropped to Level ${d.level}`, tone: "bad" };
    case "rampage_start":
      return { icon: "🔥", text: "RAMPAGE: the belly hit 0%", tone: "bad" };
    case "rampage_end":
      return { icon: "🦸", text: `${who(d.by)} ended the Rampage`, tone: "good" };
    case "stake":
      return { icon: "🛡", text: `${who(d.account)} staked ${tk(d.amount)} into the belly` };
    case "unstake":
      return { icon: "⏳", text: `${who(d.account)} started unstaking ${tk(d.amount)}` };
    case "withdraw":
      return { icon: "↩️", text: `${who(d.account)} withdrew ${tk(d.amount)}` };
    case "blessing_reserved":
      return { icon: "🎁", text: `Blessing #${d.period_id}: ${tk(d.amount)} set aside for the period's feeders`, tone: "good" };
    case "blessing_claimed":
      return { icon: "🎁", text: `${who(d.account)} claimed ${tk(d.amount)} (Blessing #${d.period_id})`, tone: "good" };
    case "badge_minted":
      return { icon: "🏅", text: `${who(d.account)} earned the ${d.tier} badge (soulbound NFT)`, tone: "good" };
    case "treasury_opened":
      return { icon: "🏦", text: `Treasury account ${d.account} opened for generation ${d.generation}: no keys, its balance is the Reserve` };
    case "rename":
      return { icon: "✏️", text: `Named “${d.name}” by DAO vote` };
    case "evolve":
      return { icon: "🐉", text: `Evolved into a ${d.form} by DAO vote`, tone: "good" };
    default:
      return { icon: "•", text: `${e.kind}` };
  }
}

function useHistoryData(active: boolean) {
  const near = useNear();
  const [events, setEvents] = useState<HistoryEvent[] | null>(null);
  const [lives, setLives] = useState<Life[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!active) return;
    let stop = false;
    const load = async () => {
      try {
        const [h, l, s] = await Promise.all([
          fetch("/api/history").then((r) => r.json() as Promise<{ events?: HistoryEvent[]; error?: string }>),
          near.view<Life[]>("get_lineage", { limit: 100 }),
          near.view<Stats>("get_stats"),
        ]);
        if (stop) return;
        if (h.error || !h.events) setErr(h.error ?? "The history service is not running");
        else {
          setEvents(dedupe(h.events));
          setErr("");
        }
        setLives([...l].reverse());
        setStats(s);
      } catch (e) {
        if (!stop) setErr(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const t = setInterval(load, 10_000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [active, near]);
  return { events, lives, stats, err };
}

function Rows({ events }: { events: HistoryEvent[] }) {
  const deaths = new Set(events.filter((e) => e.kind === "death").map((e) => e.id.split(":")[0]));
  if (!events.length) return <div className="tribe-empty">Nothing here yet.</div>;
  return (
    <div className="hist-rows">
      {events.map((e) => {
        const l = line(e, deaths.has(e.id.split(":")[0]));
        return (
          <div key={e.id} className={`hrow2 ${l.tone ?? ""}`}>
            <span className="h-icon">{l.icon}</span>
            <span className="h-text">{l.text}</span>
            <span className="h-meta">
              {e.generation ? `gen ${e.generation} · ` : ""}
              {ago(e.ts)} ·{" "}
              <a href={`${EXPLORER}/txns/${e.tx}`} target="_blank" rel="noreferrer">tx ↗</a>
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LifeCard({ l, events, open, onToggle }: { l: Life; events: HistoryEvent[]; open: boolean; onToggle: () => void }) {
  const mine = events.filter((e) => e.generation === l.generation);
  return (
    <div className={`life ${l.alive ? "alive" : ""} ${open ? "open" : ""}`}>
      <button className="life-head" onClick={onToggle}>
        <span className="life-name">{l.alive ? "🐼" : "🪦"} {l.lineage_name}</span>
        <span className="life-sub">
          {l.alive ? "alive" : (l.cause_of_death ?? "dead")} · Level {l.max_level} at best
          {l.lifespan_sec ? ` · lived ${fmtTime(Number(l.lifespan_sec))}` : ""}
        </span>
      </button>
      {open && (
        <div className="life-body">
          <div className="life-stats">
            <div><b>{tk(l.stats.fed)}</b><span>fed</span></div>
            <div><b>{tk(l.stats.burned)}</b><span>burned</span></div>
            <div><b>{tk(l.stats.slashed)}</b><span>slashed</span></div>
            <div><b>{tk(l.stats.blessed)}</b><span>blessed</span></div>
          </div>
          {l.top_feeders.length > 0 && (
            <div className="life-feeders">
              Top feeders (they seed the next egg's traits):{" "}
              {l.top_feeders.slice(0, 3).map(([a, v], i) => (
                <span key={a}>{i ? ", " : ""}{who(a)} ({tk(v)})</span>
              ))}
            </div>
          )}
          <div className="life-nft">
            NFT <code>{l.totem_id}</code>: {l.alive ? "the living Totem, owned by the DAO" : "now a gravestone; its metadata is this frozen record"} · founders {l.founders.map(who).join(", ")}
          </div>
          <Rows events={mine} />
          {mine.length === 0 && <div className="tribe-empty">This life is older than the indexed window; its record above is complete and on-chain.</div>}
        </div>
      )}
    </div>
  );
}

export function HistoryPanel({ onClose, focusGeneration }: { onClose: () => void; focusGeneration: number | null }) {
  const { events, lives, stats, err } = useHistoryData(true);
  const [tab, setTab] = useState<"ledger" | "lives">(focusGeneration ? "lives" : "ledger");
  const [filter, setFilter] = useState<Filter>("all");
  const [openGen, setOpenGen] = useState<number | null>(focusGeneration);
  const shown = useMemo(() => (events ?? []).filter((e) => filter === "all" || GROUP[e.kind] === filter), [events, filter]);

  const supply = stats ? toTokens(stats.total_supply) : 0;
  const burned = stats ? toTokens(stats.total_burned) : 0;
  const faucet = stats ? Math.max(0, supply + burned - LAUNCH_SUPPLY) : 0;

  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="tribe hist glass" onClick={(e) => e.stopPropagation()}>
        <button className="dc-close" aria-label="Close" onClick={onClose}>✕</button>
        <div className="tribe-title">📜 On-chain history</div>
        {stats && (
          <div className="supply">
            <div><b>{fmt(LAUNCH_SUPPLY)}</b><span>minted once at launch</span></div>
            <div className="mint"><b>+{fmt(faucet)}</b><span>demo faucet (testnet)</span></div>
            <div className="burn"><b>−{fmt(burned)}</b><span>burned forever</span></div>
            <div><b>{fmt(supply)}</b><span>supply now</span></div>
          </div>
        )}
        <div className="tabs">
          <button className={tab === "ledger" ? "on" : ""} onClick={() => setTab("ledger")}>Ledger</button>
          <button className={tab === "lives" ? "on" : ""} onClick={() => setTab("lives")}>Lives ({lives.length})</button>
        </div>

        {tab === "ledger" && (
          <>
            <div className="chips">
              {(
                [
                  ["all", "All"],
                  ["supply", "🔥 Mints & burns"],
                  ["life", "⚔️ Life & death"],
                  ["stakes", "🛡 Stakes"],
                  ["rewards", "🏅 Rewards"],
                ] as [Filter, string][]
              ).map(([k, label]) => (
                <button key={k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{label}</button>
              ))}
            </div>
            {err && !events && <div className="tribe-empty">Couldn't read the history: {err}</div>}
            {!err && !events && <div className="tribe-empty">Reading the contract's events…</div>}
            {events && <Rows events={shown} />}
          </>
        )}

        {tab === "lives" && (
          <div className="plist">
            {lives.map((l) => (
              <LifeCard key={l.generation} l={l} events={events ?? []} open={openGen === l.generation} onToggle={() => setOpenGen((g) => (g === l.generation ? null : l.generation))} />
            ))}
          </div>
        )}

        <div className="tribe-foot">
          Every line is a NEP-297 event the contract logged; tap tx ↗ to check it on the explorer. Totals come from <code>get_stats</code>, each life from <code>get_lineage</code>.
        </div>
      </div>
    </div>
  );
}
