"""
TOTEM balance simulation.

An offline agent-based model of the TOTEM game over 60 Totem-days. It mirrors the
on-chain mechanics (see TOTEM_BRIEF.md sections 5-6) so we can tune parameters
BEFORE the contract is final. Nothing here touches NEAR; it is a design tool.

Run:  sim/.venv/bin/python sim/simulate.py
Out:  sim/out/<scenario>.png  and a printed summary table.

The goal we are tuning toward:
  - A Totem survives with MODEST, shared effort.
  - It DIES under real neglect (the "abandoned" scenario must end in death).
  - Blessings return a MEANINGFUL share of the Hoard to people who actually fed it,
    and splitting a balance across wallets earns nothing extra (sybil-neutral).
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt


# --------------------------------------------------------------------------- #
# Config — mirrors the contract's immutable parameters (brief section 6).
# All durations are in Totem-days. The simulation is unit-agnostic about
# day_length_sec; one "day" here is one Totem-day.
# --------------------------------------------------------------------------- #
@dataclass(frozen=True)
class Config:
    base_meal: float = 100.0          # tokens to fill an L1 egg from 0 -> 100%
    appetite_growth: float = 1.5      # meal size multiplier per level
    burn_share: float = 0.50          # fraction of each meal burned (rest -> Hoard)
    happy_threshold: float = 0.70
    starving_threshold: float = 0.30
    rescue_multiplier: float = 2.0
    # cumulative Happy-days required to reach L2, L3, L4, L5, then +5 each
    level_thresholds: tuple = (1.0, 3.0, 6.0, 10.0)
    level_step_after: float = 5.0
    bite_interval: float = 1.0 / 24.0  # one bite per Totem-hour at 0% fullness
    bite_size: float = 0.10            # each bite burns 10% of the Hoard
    death_after: float = 3.0           # days of continuous Rampage -> death
    blessing_period: float = 7.0       # days per Blessing period
    blessing_rate_egg: float = 0.05
    blessing_rate_dragon: float = 0.08
    blessing_rate_golem: float = 0.03
    blessing_bonus_from_l5: float = 0.01  # +1pp per level from L5
    blessing_bonus_cap: float = 0.05
    form_appetite_egg: float = 1.0
    form_appetite_dragon: float = 1.5
    form_appetite_golem: float = 0.8


CFG = Config()


def meal_size(level: int, form_appetite: float) -> float:
    """Tokens needed to go 0% -> 100% at this level and form."""
    return CFG.base_meal * (CFG.appetite_growth ** (level - 1)) * form_appetite


def level_for_xp(happy_days: float) -> int:
    """Level from cumulative Happy-days."""
    level = 1
    for thr in CFG.level_thresholds:
        if happy_days >= thr:
            level += 1
        else:
            return level
    # beyond the explicit thresholds: +5 Happy-days per extra level
    extra_base = CFG.level_thresholds[-1]
    while happy_days >= extra_base + CFG.level_step_after:
        extra_base += CFG.level_step_after
        level += 1
    return level


def blessing_rate(level: int, form: str) -> float:
    base = {
        "egg": CFG.blessing_rate_egg,
        "dragon": CFG.blessing_rate_dragon,
        "golem": CFG.blessing_rate_golem,
    }[form]
    bonus = 0.0
    if level >= 5:
        bonus = min((level - 4) * CFG.blessing_bonus_from_l5, CFG.blessing_bonus_cap)
    return base + bonus


# --------------------------------------------------------------------------- #
# Players
# --------------------------------------------------------------------------- #
@dataclass
class Player:
    name: str
    archetype: str          # loyal | opportunist | whale | freeloader
    check_rate: float       # expected check-ins per day (Poisson)
    active_from: float = 0.0
    active_until: float = 1e9
    # accounting
    lifetime_points: float = 0.0
    period_points: float = 0.0
    tokens_spent: float = 0.0
    blessings_received: float = 0.0

    def wants_to_feed(self, fullness: float) -> bool:
        if self.archetype == "freeloader":
            return False
        if self.archetype == "loyal":
            return fullness < 0.80
        if self.archetype == "opportunist":
            return fullness < CFG.starving_threshold  # only rescue feeds
        if self.archetype == "whale":
            return fullness < 0.60
        return False


# --------------------------------------------------------------------------- #
# Totem state + one simulation run
# --------------------------------------------------------------------------- #
@dataclass
class Trace:
    t: list = field(default_factory=list)
    fullness: list = field(default_factory=list)
    hoard: list = field(default_factory=list)
    supply: list = field(default_factory=list)
    level: list = field(default_factory=list)


@dataclass
class RunResult:
    scenario: str
    trace: Trace
    died_at: float | None
    final_level: int
    total_burned: float
    total_fed: float
    total_blessed: float
    period_rois: list      # blessings_received / tokens_spent per feeding player
    archetype_summary: dict


def simulate(scenario: str, players: list[Player], days: float = 60.0,
             dt: float = 1.0 / 24.0, seed: int = 0) -> RunResult:
    rng = random.Random(seed)

    fullness = 1.0
    happy_days = 0.0
    level = 1
    form = "egg"
    hoard = 0.0
    total_burned = 0.0
    total_fed = 0.0
    total_blessed = 0.0
    alive = True
    rampage_elapsed = 0.0
    time_since_bite = 0.0
    died_at: float | None = None

    initial_supply = 1_000_000_000.0
    burned_from_feed = 0.0  # supply burned by the 50% feed-burn + hoard bites

    # Blessing bookkeeping
    l3_reached_at: float | None = None
    period_index = 0
    period_reserved: dict[int, float] = {}
    period_total_points: dict[int, float] = {}

    trace = Trace()
    steps = int(days / dt)

    for i in range(steps):
        t = i * dt

        # --- settle: drain, then rampage bites, then death ---
        fullness = max(0.0, fullness - dt)  # drains 100%->0% over 1 day

        if fullness <= 0.0:
            rampage_elapsed += dt
            time_since_bite += dt
            while time_since_bite >= CFG.bite_interval and hoard > 0:
                bite = hoard * CFG.bite_size
                hoard -= bite
                total_burned += bite
                burned_from_feed += bite
                time_since_bite -= CFG.bite_interval
            if rampage_elapsed >= CFG.death_after and alive:
                alive = False
                died_at = t
                total_burned += hoard  # remaining hoard burns on death
                burned_from_feed += hoard
                hoard = 0.0
        else:
            rampage_elapsed = 0.0
            time_since_bite = 0.0
            if fullness >= CFG.happy_threshold:
                happy_days += dt

        if not alive:
            # record a flat tail then stop
            trace.t.append(t)
            trace.fullness.append(0.0)
            trace.hoard.append(hoard)
            trace.supply.append(initial_supply - burned_from_feed)
            trace.level.append(level)
            # continue the loop to keep the x-axis full but nothing changes
            continue

        # --- level up ---
        new_level = level_for_xp(happy_days)
        if new_level > level:
            level = new_level
            if level >= 4 and form == "egg":
                form = "golem"  # default evolution (DAO would choose; model worst case)
        if level >= 3 and l3_reached_at is None:
            l3_reached_at = t

        # --- blessing period close ---
        if l3_reached_at is not None:
            cur_period = int((t - l3_reached_at) // CFG.blessing_period)
            if cur_period > period_index:
                # close the finished period(s)
                for p in range(period_index, cur_period):
                    reserve = hoard * blessing_rate(level, form)
                    pts = period_total_points.get(p, 0.0)
                    if pts > 0:
                        period_reserved[p] = reserve
                        hoard -= reserve
                        total_blessed += reserve
                period_index = cur_period

        # --- players act ---
        for pl in players:
            if not (pl.active_from <= t <= pl.active_until):
                continue
            # Poisson check-ins: prob of at least one check this dt
            p_check = 1.0 - math.exp(-pl.check_rate * dt)
            if rng.random() >= p_check:
                continue
            if not pl.wants_to_feed(fullness):
                continue

            ms = meal_size(level, CFG.form_appetite_dragon if form == "dragon"
                           else CFG.form_appetite_golem if form == "golem" else 1.0)
            need = (1.0 - fullness) * ms
            if pl.archetype == "whale":
                amount = need  # whale always fills up
            elif pl.archetype == "opportunist":
                amount = need  # rescue to full
            else:
                amount = need
            if amount <= 0:
                continue

            rescue = fullness < CFG.starving_threshold
            fullness = min(1.0, fullness + amount / ms)
            burn = amount * CFG.burn_share
            to_hoard = amount - burn
            hoard += to_hoard
            total_burned += burn
            burned_from_feed += burn
            total_fed += amount
            if rampage_elapsed > 0:
                rampage_elapsed = 0.0  # feeding ends rampage

            pts = amount * (CFG.rescue_multiplier if rescue else 1.0)
            pl.lifetime_points += pts
            pl.period_points += pts
            pl.tokens_spent += amount
            if l3_reached_at is not None:
                period_total_points[period_index] = \
                    period_total_points.get(period_index, 0.0) + pts

        trace.t.append(t)
        trace.fullness.append(fullness)
        trace.hoard.append(hoard)
        trace.supply.append(initial_supply - burned_from_feed)
        trace.level.append(level)

    # --- distribute reserved blessings by period points ---
    # (pull-based on-chain; here we just attribute shares for ROI analysis)
    for p, reserve in period_reserved.items():
        total_pts = period_total_points.get(p, 0.0)
        if total_pts <= 0:
            continue
        # we didn't store per-player period points historically; approximate using
        # lifetime share among feeders active that period. Good enough for tuning.
        feeders = [pl for pl in players if pl.lifetime_points > 0]
        lp_sum = sum(pl.lifetime_points for pl in feeders)
        for pl in feeders:
            pl.blessings_received += reserve * (pl.lifetime_points / lp_sum)

    rois = [pl.blessings_received / pl.tokens_spent
            for pl in players if pl.tokens_spent > 0]

    arche = {}
    for pl in players:
        a = arche.setdefault(pl.archetype, {"spent": 0.0, "points": 0.0,
                                            "blessings": 0.0, "count": 0})
        a["spent"] += pl.tokens_spent
        a["points"] += pl.lifetime_points
        a["blessings"] += pl.blessings_received
        a["count"] += 1

    return RunResult(
        scenario=scenario, trace=trace, died_at=died_at, final_level=level,
        total_burned=total_burned, total_fed=total_fed, total_blessed=total_blessed,
        period_rois=rois, archetype_summary=arche,
    )


# --------------------------------------------------------------------------- #
# Scenario populations
# --------------------------------------------------------------------------- #
def make_players(scenario: str) -> list[Player]:
    p: list[Player] = []
    if scenario == "healthy":
        for i in range(4):
            p.append(Player(f"loyal{i}", "loyal", check_rate=4.0))
        for i in range(6):
            p.append(Player(f"opp{i}", "opportunist", check_rate=2.0))
        for i in range(10):
            p.append(Player(f"free{i}", "freeloader", check_rate=0.0))
    elif scenario == "apathetic":
        for i in range(1):
            p.append(Player(f"loyal{i}", "loyal", check_rate=2.0))
        for i in range(4):
            p.append(Player(f"opp{i}", "opportunist", check_rate=1.0))
        for i in range(20):
            p.append(Player(f"free{i}", "freeloader", check_rate=0.0))
    elif scenario == "whale-carried":
        p.append(Player("whale", "whale", check_rate=3.0))
        for i in range(15):
            p.append(Player(f"free{i}", "freeloader", check_rate=0.0))
    elif scenario == "abandoned":
        # fed for the first 8 days, then everyone stops
        for i in range(4):
            p.append(Player(f"loyal{i}", "loyal", check_rate=4.0, active_until=8.0))
        for i in range(4):
            p.append(Player(f"opp{i}", "opportunist", check_rate=2.0,
                            active_until=8.0))
    return p


# --------------------------------------------------------------------------- #
# Plot + report
# --------------------------------------------------------------------------- #
def plot_run(r: RunResult) -> str:
    fig, axes = plt.subplots(2, 2, figsize=(12, 7))
    fig.suptitle(f"TOTEM simulation — {r.scenario}", fontsize=14, weight="bold")
    tr = r.trace

    ax = axes[0][0]
    ax.plot(tr.t, [f * 100 for f in tr.fullness], color="#2e7d32")
    ax.axhline(70, ls="--", c="#9e9e9e", lw=0.8)
    ax.axhline(30, ls="--", c="#e65100", lw=0.8)
    ax.set_title("Fullness %")
    ax.set_ylim(0, 105)
    ax.set_xlabel("Totem-days")
    if r.died_at:
        ax.axvline(r.died_at, c="#b71c1c", lw=1.5)
        ax.text(r.died_at, 50, " died", c="#b71c1c")

    ax = axes[0][1]
    ax.plot(tr.t, tr.hoard, color="#1565c0")
    ax.set_title("Hoard ($TOTEM)")
    ax.set_xlabel("Totem-days")

    ax = axes[1][0]
    ax.plot(tr.t, [s / 1e6 for s in tr.supply], color="#6a1b9a")
    ax.set_title("Circulating supply (millions)")
    ax.set_xlabel("Totem-days")

    ax = axes[1][1]
    ax.plot(tr.t, tr.level, color="#ef6c00", drawstyle="steps-post")
    ax.set_title("Level")
    ax.set_xlabel("Totem-days")
    ax.set_ylim(0, max(tr.level) + 1)

    fig.tight_layout(rect=(0, 0, 1, 0.96))
    path = f"sim/out/{r.scenario}.png"
    fig.savefig(path, dpi=110)
    plt.close(fig)
    return path


def main() -> None:
    scenarios = ["healthy", "apathetic", "whale-carried", "abandoned"]
    results = []
    for s in scenarios:
        r = simulate(s, make_players(s), seed=42)
        results.append(r)
        plot_run(r)

    print("\n" + "=" * 78)
    print("TOTEM SIMULATION SUMMARY (60 Totem-days)")
    print("=" * 78)
    hdr = f"{'scenario':<16}{'outcome':<16}{'maxLvl':>7}{'fed':>12}{'burned':>12}{'blessed':>11}"
    print(hdr)
    print("-" * 78)
    for r in results:
        outcome = f"DIED @ d{r.died_at:.1f}" if r.died_at else "survived"
        print(f"{r.scenario:<16}{outcome:<16}{r.final_level:>7}"
              f"{r.total_fed:>12,.0f}{r.total_burned:>12,.0f}{r.total_blessed:>11,.0f}")
    print("-" * 78)

    print("\nCaretaker ROI (blessings received / tokens spent), by scenario:")
    for r in results:
        if r.period_rois:
            avg = sum(r.period_rois) / len(r.period_rois)
            print(f"  {r.scenario:<16} avg {avg*100:5.1f}%  "
                  f"(min {min(r.period_rois)*100:.1f}%, max {max(r.period_rois)*100:.1f}%)")
        else:
            print(f"  {r.scenario:<16} no blessings (never reached L3 or no feeders)")

    print("\nValidation checks:")
    healthy = next(r for r in results if r.scenario == "healthy")
    abandoned = next(r for r in results if r.scenario == "abandoned")
    whale = next(r for r in results if r.scenario == "whale-carried")
    print(f"  [{'PASS' if healthy.died_at is None else 'FAIL'}] healthy survives 60 days")
    print(f"  [{'PASS' if abandoned.died_at is not None else 'FAIL'}] abandoned dies")
    print(f"  [{'PASS' if whale.died_at is None else 'WARN'}] whale-carried survives")
    print(f"  [{'PASS' if healthy.final_level >= 3 else 'FAIL'}] healthy reaches L3 (blessings unlock)")
    print(f"\nCharts written to sim/out/. Review before approving final parameters.")


if __name__ == "__main__":
    main()
