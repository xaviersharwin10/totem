"""
TOTEM balance simulation.

An offline agent-based model of the TOTEM game over 60 Totem-days. It mirrors the
contract's rules (contract/src, TOTEM_BRIEF.md sections 5-6, RULES.md):

  - Fullness drains 100% -> 0% over one Totem-day. Feeding burns 50% and puts
    50% into the Reserve (the Totem-owned part of the Hoard).
  - At 0% the Totem bites every 1/4 day: burns 15% of the Reserve, slashes 15%
    of every UNSHIELDED stake into the Reserve, and drops one level. A bite at
    Level 1 kills it. Feeding ends the Rampage; lost levels stay lost.
  - Staking: a feed of >= 5 $TOTEM shields the feeder's stake for 2 days.
    Stakers with >= 100 staked earn x1.5 points.
  - Blessings: from L3, every 3.5 days the contract reserves rate x Reserve and
    splits it by points earned in that period (only while the level is >= 3).
  - Generations: after a death the DAO hatches a new Level-1 egg (no economic
    carry-over); stakes from the dead generation are released.

Nothing here touches NEAR; it is a design tool for the parameters.

Run:  sim/.venv/bin/python sim/simulate.py     (needs numpy-free stdlib + matplotlib)
Out:  sim/out/<scenario>.png and a printed summary with validation checks.

What we are tuning toward (brief 12.3):
  - The Totem survives with modest, shared effort and dies under real neglect.
  - A grown Totem survives a weekend gap, losing some levels.
  - Blessings return a meaningful share to active caretakers.
  - Staking + feeding beats staking alone, and staking alone loses money
    whenever the Totem is neglected.
"""

from __future__ import annotations

import math
import os
import random
from dataclasses import dataclass, field

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


# --------------------------------------------------------------------------- #
# Config: mirrors contract/src/config.rs defaults. Durations in Totem-days.
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Config:
    base_meal: float = 100.0
    appetite_growth: float = 1.5
    burn_share: float = 0.50
    happy_threshold: float = 0.70
    starving_threshold: float = 0.30
    rescue_multiplier: float = 2.0
    level_thresholds: tuple = (1.0, 3.0, 6.0, 10.0)
    level_step_after: float = 5.0
    bite_interval: float = 0.25
    bite_burn: float = 0.15
    stake_slash: float = 0.15
    min_stake: float = 100.0
    staker_multiplier: float = 1.5
    shield_min_feed: float = 5.0
    shield_window: float = 2.0
    blessing_period: float = 3.5
    blessing_rate_egg: float = 0.05
    blessing_rate_dragon: float = 0.08
    blessing_rate_golem: float = 0.03
    blessing_bonus_from_l5: float = 0.01
    blessing_bonus_cap: float = 0.05
    hatch_delay: float = 0.5  # how long the DAO takes to vote a hatch


CFG = Config()
FORM_APPETITE = {"egg": 1.0, "dragon": 1.5, "golem": 0.8}


def meal_size(level: int, form: str) -> float:
    return CFG.base_meal * (CFG.appetite_growth ** (level - 1)) * FORM_APPETITE[form]


def level_for_xp(happy_days: float) -> int:
    level = 1
    for thr in CFG.level_thresholds:
        if happy_days >= thr:
            level += 1
        else:
            return level
    base = CFG.level_thresholds[-1]
    return level + int((happy_days - base) // CFG.level_step_after)


def level_floor(level: int) -> float:
    if level <= 1:
        return 0.0
    t = CFG.level_thresholds
    if level - 2 < len(t):
        return t[level - 2]
    return t[-1] + (level - 1 - len(t)) * CFG.level_step_after


def blessing_rate(level: int, form: str) -> float:
    base = {"egg": CFG.blessing_rate_egg, "dragon": CFG.blessing_rate_dragon,
            "golem": CFG.blessing_rate_golem}[form]
    bonus = min((level - 4) * CFG.blessing_bonus_from_l5, CFG.blessing_bonus_cap) if level >= 5 else 0.0
    return base + bonus


# --------------------------------------------------------------------------- #
# Players
# --------------------------------------------------------------------------- #
@dataclass
class Player:
    name: str
    archetype: str  # loyal | opportunist | whale | freeloader | staker_feeder | staker_lazy
    check_rate: float  # check-ins per day (Poisson)
    stake: float = 0.0  # stake re-deposited at every hatch
    active: list = field(default_factory=lambda: [(0.0, 1e9)])  # active windows
    # accounting
    spent: float = 0.0
    blessings: float = 0.0
    stake_value: float = 0.0
    stake_deposited: float = 0.0
    stake_returned: float = 0.0
    shield_until: float = -1.0
    period_points: dict = field(default_factory=dict)  # (gen, period) -> points

    def is_active(self, t: float) -> bool:
        return any(a <= t < b for a, b in self.active)

    def feed_amount(self, fullness: float, ms: float, t: float) -> float:
        need = (1.0 - fullness) * ms
        a = self.archetype
        if a == "loyal":
            return need if fullness < 0.80 else 0.0
        if a == "opportunist":
            return need if fullness < CFG.starving_threshold else 0.0
        if a == "whale":
            return need if fullness < 0.60 else 0.0
        if a == "staker_feeder":
            # the minimum the shield rule asks for: a 5-token snack before the
            # shield runs out (it barely moves the belly of a grown Totem)
            if self.shield_until < t + 0.3:
                return min(need, CFG.shield_min_feed)
            return 0.0
        return 0.0  # freeloader, staker_lazy

    @property
    def stake_pnl(self) -> float:
        return self.stake_value + self.stake_returned - self.stake_deposited

    @property
    def net(self) -> float:
        return self.blessings + self.stake_pnl - self.spent


# --------------------------------------------------------------------------- #
# One run
# --------------------------------------------------------------------------- #
@dataclass
class Trace:
    t: list = field(default_factory=list)
    fullness: list = field(default_factory=list)
    level: list = field(default_factory=list)
    reserve: list = field(default_factory=list)
    staked: list = field(default_factory=list)
    supply: list = field(default_factory=list)
    lazy_stake: list = field(default_factory=list)
    feeder_stake: list = field(default_factory=list)


@dataclass
class RunResult:
    scenario: str
    trace: Trace
    deaths: list
    hatches: list
    bites: int
    max_level: int
    total_fed: float
    total_burned: float
    total_blessed: float
    total_slashed: float
    players: list


def simulate(scenario: str, players: list[Player], days: float = 60.0,
             dt: float = 1.0 / 96.0, seed: int = 0) -> RunResult:
    rng = random.Random(seed)

    # generation state
    gen = 1
    alive = True
    fullness = 1.0
    happy = 0.0
    level = 1
    max_level_all = 1
    form = "egg"
    l4_at: float | None = None
    reserve = 0.0
    rampage_start: float | None = None
    bites_done = 0
    epoch: float | None = None  # blessing epoch start (first time L3 this gen)
    period = 0
    dead_since: float | None = None

    period_points: dict = {}  # (gen, period) -> total points

    total_fed = total_burned = total_blessed = total_slashed = 0.0
    bites = 0
    deaths: list = []
    hatches: list = []
    trace = Trace()

    def deposit_stakes() -> None:
        for p in players:
            if p.stake > 0:
                p.stake_value = p.stake
                p.stake_deposited += p.stake
                p.shield_until = -1.0

    deposit_stakes()

    steps = int(days / dt)
    for i in range(steps):
        t = i * dt

        # ---- hatch after a death ----
        # the Keepers only vote a hatch when someone in the tribe is around
        if (not alive and dead_since is not None and t - dead_since >= CFG.hatch_delay
                and any(p.is_active(t) and p.check_rate > 0 for p in players)):
            gen += 1
            alive = True
            fullness, happy, level, form, l4_at = 1.0, 0.0, 1, "egg", None
            reserve, rampage_start, bites_done, epoch, period = 0.0, None, 0, None, 0
            dead_since = None
            hatches.append(t)
            deposit_stakes()

        if alive:
            # ---- drain + XP ----
            if fullness >= CFG.happy_threshold:
                happy += min(dt, (fullness - CFG.happy_threshold) + 1e-12)
            new_level = level_for_xp(happy)
            if new_level > level:
                level = new_level
                if level >= 4 and form == "egg" and l4_at is None:
                    l4_at = t
                if level >= 3 and epoch is None:
                    epoch = t
            if form == "egg" and l4_at is not None and t - l4_at > 1.0:
                form = "golem"  # default evolution (worst case: lowest Blessings)
            fullness = max(0.0, fullness - dt)

            # ---- rampage bites ----
            if fullness <= 0.0:
                if rampage_start is None:
                    rampage_start = t
                    bites_done = 0
                due = int((t - rampage_start) / CFG.bite_interval + 1e-9)
                while alive and bites_done < due:
                    bites_done += 1
                    bite_t = rampage_start + bites_done * CFG.bite_interval
                    burn = reserve * CFG.bite_burn
                    reserve -= burn
                    total_burned += burn
                    for p in players:
                        if p.stake_value > 0 and bite_t >= p.shield_until:
                            s = p.stake_value * CFG.stake_slash
                            p.stake_value -= s
                            reserve += s
                            total_slashed += s
                    bites += 1
                    level -= 1
                    happy = level_floor(level)
                    if level == 0:
                        alive = False
                        total_burned += reserve
                        reserve = 0.0
                        deaths.append(t)
                        dead_since = t
                        # stakes released: withdrawn at once
                        for p in players:
                            p.stake_returned += p.stake_value
                            p.stake_value = 0.0

            # ---- blessing periods (only while L3+) ----
            if alive and epoch is not None:
                cur = int((t - epoch) // CFG.blessing_period)
                while period < cur:
                    key = (gen, period)
                    tot = period_points.get(key, 0.0)
                    if tot > 0 and level >= 3:
                        amt = reserve * blessing_rate(level, form)
                        reserve -= amt
                        total_blessed += amt
                        for p in players:  # pull-based on chain; attributed here
                            mine = p.period_points.get(key, 0.0)
                            if mine:
                                p.blessings += amt * mine / tot
                    period += 1

        # ---- players act ----
        if alive:
            for p in players:
                if not p.is_active(t):
                    continue
                if rng.random() >= 1.0 - math.exp(-p.check_rate * dt):
                    continue
                ms = meal_size(level, form)
                amount = p.feed_amount(fullness, ms, t)
                if amount <= 0:
                    continue
                rescue = fullness < CFG.starving_threshold
                fullness = min(1.0, fullness + amount / ms)
                burn = amount * CFG.burn_share
                reserve += amount - burn
                total_burned += burn
                total_fed += amount
                p.spent += amount
                rampage_start = None  # feeding ends the Rampage
                if amount >= CFG.shield_min_feed:
                    p.shield_until = t + CFG.shield_window
                pts = math.floor(amount) * (CFG.rescue_multiplier if rescue else 1.0)
                if p.stake_value >= CFG.min_stake:
                    pts *= CFG.staker_multiplier
                if epoch is not None:
                    key = (gen, int((t - epoch) // CFG.blessing_period))
                    p.period_points[key] = p.period_points.get(key, 0.0) + pts
                    period_points[key] = period_points.get(key, 0.0) + pts

        max_level_all = max(max_level_all, level)
        # stake value relative to one 500 deposit, net of everything lost so far
        lazy = [p.stake + p.stake_pnl for p in players if p.archetype == "staker_lazy"]
        feeders = [p.stake + p.stake_pnl for p in players if p.archetype == "staker_feeder"]
        trace.t.append(t)
        trace.fullness.append(fullness if alive else 0.0)
        trace.level.append(level if alive else 0)
        trace.reserve.append(reserve)
        trace.staked.append(sum(p.stake_value for p in players))
        trace.supply.append(total_burned)
        trace.lazy_stake.append(sum(lazy) / len(lazy) if lazy else float("nan"))
        trace.feeder_stake.append(sum(feeders) / len(feeders) if feeders else float("nan"))

    return RunResult(scenario, trace, deaths, hatches, bites, max_level_all,
                     total_fed, total_burned, total_blessed, total_slashed, players)


# --------------------------------------------------------------------------- #
# Scenarios
# --------------------------------------------------------------------------- #
def weekdays_only(days: float = 60.0) -> list:
    """Active Mon-Fri, away every weekend (days 5-7 of each week)."""
    return [(w * 7.0, w * 7.0 + 5.0) for w in range(int(days // 7) + 1)]


def stakers(n_feed: int, n_lazy: int, stake: float = 500.0, active=None) -> list[Player]:
    out = []
    for i in range(n_feed):
        out.append(Player(f"stakeF{i}", "staker_feeder", 2.0, stake=stake,
                          active=active or [(0.0, 1e9)]))
    for i in range(n_lazy):
        out.append(Player(f"stakeL{i}", "staker_lazy", 0.0, stake=stake))
    return out


def make_players(scenario: str) -> list[Player]:
    p: list[Player] = []
    if scenario == "healthy":
        p += [Player(f"loyal{i}", "loyal", 4.0) for i in range(4)]
        p += [Player(f"opp{i}", "opportunist", 2.0) for i in range(6)]
        p += [Player(f"free{i}", "freeloader", 0.0) for i in range(10)]
        p += stakers(3, 3)
    elif scenario == "weekend-gaps":
        # the tribe feeds on weekdays and mostly forgets it on weekends
        p += [Player(f"loyal{i}", "loyal", 4.0, active=weekdays_only()) for i in range(4)]
        p += [Player(f"opp{i}", "opportunist", 0.6) for i in range(4)]
        p += [Player(f"free{i}", "freeloader", 0.0) for i in range(10)]
        p += stakers(3, 3)  # stakers have skin in the game: they check in at weekends too
    elif scenario == "apathetic":
        p += [Player("loyal0", "loyal", 1.5)]
        p += [Player(f"opp{i}", "opportunist", 0.8) for i in range(3)]
        p += [Player(f"free{i}", "freeloader", 0.0) for i in range(20)]
        p += stakers(2, 4)
    elif scenario == "whale-carried":
        p += [Player("whale", "whale", 3.0)]
        p += [Player(f"free{i}", "freeloader", 0.0) for i in range(15)]
        p += stakers(0, 3)
    elif scenario == "abandoned-reborn":
        # fed for 10 days, abandoned until day 25, then the tribe returns
        windows = [(0.0, 10.0), (25.0, 1e9)]
        p += [Player(f"loyal{i}", "loyal", 4.0, active=windows) for i in range(4)]
        p += [Player(f"opp{i}", "opportunist", 2.0, active=windows) for i in range(4)]
        p += stakers(2, 2, active=windows)
    return p


SCENARIOS = ["healthy", "weekend-gaps", "apathetic", "whale-carried", "abandoned-reborn"]


# --------------------------------------------------------------------------- #
# Plot + report
# --------------------------------------------------------------------------- #
def plot_run(r: RunResult, outdir: str) -> str:
    tr = r.trace
    fig, axes = plt.subplots(2, 3, figsize=(16, 8))
    fig.suptitle(f"TOTEM simulation: {r.scenario}  (deaths: {len(r.deaths)}, bites: {r.bites})",
                 fontsize=14, weight="bold")

    def marks(ax):
        for d in r.deaths:
            ax.axvline(d, c="#b71c1c", lw=1.2, alpha=0.8)
        for h in r.hatches:
            ax.axvline(h, c="#2e7d32", lw=1.0, ls=":", alpha=0.8)

    ax = axes[0][0]
    ax.plot(tr.t, [f * 100 for f in tr.fullness], color="#2e7d32", lw=0.8)
    ax.axhline(70, ls="--", c="#9e9e9e", lw=0.8)
    ax.axhline(30, ls="--", c="#e65100", lw=0.8)
    ax.set_title("Fullness %")
    ax.set_ylim(0, 105)
    marks(ax)

    ax = axes[0][1]
    ax.plot(tr.t, tr.level, color="#ef6c00", drawstyle="steps-post")
    ax.set_title("Level (bites drop it; 0 = dead)")
    ax.set_ylim(0, max(tr.level) + 1)
    marks(ax)

    ax = axes[0][2]
    ax.plot(tr.t, tr.reserve, color="#1565c0", label="Reserve")
    ax.plot(tr.t, tr.staked, color="#8e24aa", label="Total staked")
    ax.set_title("Hoard: Reserve + stakes ($TOTEM)")
    ax.legend(fontsize=8)
    marks(ax)

    ax = axes[1][0]
    ax.plot(tr.t, tr.supply, color="#6a1b9a")
    ax.set_title("Total burned, i.e. supply removed ($TOTEM)")
    ax.set_xlabel("Totem-days")

    ax = axes[1][1]
    ax.plot(tr.t, tr.feeder_stake, color="#2e7d32", label="staker who feeds")
    ax.plot(tr.t, tr.lazy_stake, color="#c62828", label="staker who doesn't")
    ax.set_title("Stake value (500 staked; net of slashes)")
    ax.set_xlabel("Totem-days")
    ax.legend(fontsize=8)
    marks(ax)

    ax = axes[1][2]
    arch = summarize(r)
    names = [a for a in ["loyal", "opportunist", "whale", "staker_feeder", "staker_lazy"] if a in arch]
    x = range(len(names))
    w = 0.27
    ax.bar([i - w for i in x], [-arch[a]["spent"] for a in names], w, color="#ef9a9a", label="fed (cost)")
    ax.bar(list(x), [arch[a]["blessings"] for a in names], w, color="#90caf9", label="Blessings")
    ax.bar([i + w for i in x], [arch[a]["stake_pnl"] for a in names], w, color="#ce93d8", label="stake P&L")
    ax.axhline(0, c="#555", lw=0.8)
    ax.set_xticks(list(x))
    ax.set_xticklabels([n.replace("_", "\n") for n in names], fontsize=8)
    ax.set_title("Per-player average ($TOTEM)")
    ax.legend(fontsize=8)
    ax.set_xlabel("")

    fig.tight_layout(rect=(0, 0, 1, 0.95))
    path = os.path.join(outdir, f"{r.scenario}.png")
    fig.savefig(path, dpi=100)
    plt.close(fig)
    return path


def summarize(r: RunResult) -> dict:
    out: dict = {}
    for p in r.players:
        a = out.setdefault(p.archetype, {"n": 0, "spent": 0.0, "blessings": 0.0, "stake_pnl": 0.0, "net": 0.0})
        a["n"] += 1
        a["spent"] += p.spent
        a["blessings"] += p.blessings
        a["stake_pnl"] += p.stake_pnl
        a["net"] += p.net
    for a in out.values():
        for k in ("spent", "blessings", "stake_pnl", "net"):
            a[k] /= a["n"]
    return out


def main() -> None:
    outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "out")
    os.makedirs(outdir, exist_ok=True)
    for f in os.listdir(outdir):  # drop charts of scenarios that no longer exist
        if f.endswith(".png") and f[:-4] not in SCENARIOS:
            os.remove(os.path.join(outdir, f))

    results = []
    for s in SCENARIOS:
        r = simulate(s, make_players(s), seed=42)
        results.append(r)
        plot_run(r, outdir)

    print("\n" + "=" * 92)
    print("TOTEM SIMULATION SUMMARY (60 Totem-days)")
    print("=" * 92)
    print(f"{'scenario':<18}{'deaths':>7}{'bites':>7}{'maxLvl':>8}{'fed':>11}{'burned':>11}"
          f"{'blessed':>10}{'slashed':>10}")
    print("-" * 92)
    for r in results:
        print(f"{r.scenario:<18}{len(r.deaths):>7}{r.bites:>7}{r.max_level:>8}{r.total_fed:>11,.0f}"
              f"{r.total_burned:>11,.0f}{r.total_blessed:>10,.0f}{r.total_slashed:>10,.0f}")

    print("\nPer-player average by archetype (fed = cost; net = blessings + stake P&L - fed):")
    for r in results:
        print(f"  {r.scenario}")
        for a, v in summarize(r).items():
            if a == "freeloader":
                continue
            roi = f"{v['blessings'] / v['spent'] * 100:5.1f}%" if v["spent"] else "   - "
            print(f"    {a:<15} fed {v['spent']:>9,.0f}  blessings {v['blessings']:>8,.0f} ({roi})"
                  f"  stake P&L {v['stake_pnl']:>+8,.0f}  net {v['net']:>+9,.0f}")

    by = {r.scenario: r for r in results}
    checks = []

    def check(ok: bool, text: str, warn: bool = False):
        checks.append(ok)
        print(f"  [{'PASS' if ok else ('WARN' if warn else 'FAIL')}] {text}")

    print("\nValidation checks:")
    h, wk, ab = by["healthy"], by["weekend-gaps"], by["abandoned-reborn"]
    check(not h.deaths, "healthy: survives 60 days")
    check(h.max_level >= 3, "healthy: reaches L3 (Blessings unlock)")
    check(not wk.deaths and wk.bites > 0, "weekend-gaps: a grown Totem survives the gaps but loses levels to bites")
    check(len(ab.deaths) >= 1 and len(ab.hatches) >= 1, "abandoned-reborn: dies under neglect and a new generation hatches")
    for r in results:
        s = summarize(r)
        if "staker_lazy" in s and r.bites > 0:
            check(s["staker_lazy"]["stake_pnl"] < 0, f"{r.scenario}: staking alone loses money when it bites")
        if "staker_lazy" in s and "staker_feeder" in s:
            check(s["staker_feeder"]["stake_pnl"] >= s["staker_lazy"]["stake_pnl"],
                  f"{r.scenario}: feeding stakers keep more stake than lazy stakers")
    wsum = summarize(wk)
    check(wsum["staker_feeder"]["net"] >= wsum["staker_lazy"]["net"],
          "weekend-gaps: counting snack costs, a feeding staker (500 staked) ends net ahead of a lazy one",
          warn=True)
    loyal = summarize(h)["loyal"]
    check(loyal["blessings"] / max(loyal["spent"], 1) >= 0.10,
          "healthy: loyal caretakers get >= 10% of their spend back as Blessings", warn=True)
    print(f"\n{sum(checks)}/{len(checks)} checks passed. Charts written to {outdir}/")


if __name__ == "__main__":
    main()
