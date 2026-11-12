// Path finding for the panda. The farm has narrow gaps (totem pole, hoard chest,
// pond) that the panda can't fit through, and trees on the rim, so steering
// straight at a goal gets it stuck. A coarse walkability grid + a flood fill
// from the panda finds the shortest way round, or, when the goal is walled
// off, the nearest spot it *can* reach.

import { OBSTACLES, ROAM_RADIUS } from "./store";

const CELL = 0.25;
const PAD = 0.55; // how far the panda's centre stays from an obstacle's edge
const N = Math.ceil((ROAM_RADIUS * 2) / CELL) + 1;
const ORIGIN = -ROAM_RADIUS;

/** Geometry only: outside every obstacle's margin and inside the walkable circle. */
function open(x: number, z: number): boolean {
  return Math.hypot(x, z) <= ROAM_RADIUS && OBSTACLES.every(([ox, oz, r]) => Math.hypot(x - ox, z - oz) >= r + PAD);
}

const toCell = (v: number) => Math.max(0, Math.min(N - 1, Math.round((v - ORIGIN) / CELL)));
const cx = (k: number) => ORIGIN + (k % N) * CELL;
const cz = (k: number) => ORIGIN + Math.floor(k / N) * CELL;

const walk = new Uint8Array(N * N);
for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) walk[j * N + i] = open(ORIGIN + i * CELL, ORIGIN + j * CELL) ? 1 : 0;

// Keep only the area connected to the middle of the island: little pockets
// between a rim tree, the graveyard and the edge would otherwise trap the panda.
{
  const seen = new Uint8Array(N * N);
  const startK = toCell(1) * N + toCell(0);
  const stack = [startK];
  seen[startK] = 1;
  while (stack.length) {
    const k = stack.pop()!;
    const i = k % N;
    const j = Math.floor(k / N);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nk = nj * N + ni;
      if (walk[nk] && !seen[nk]) {
        seen[nk] = 1;
        stack.push(nk);
      }
    }
  }
  for (let k = 0; k < N * N; k++) if (!seen[k]) walk[k] = 0;
}

/** Can the panda's centre be here? Movement uses the planner's own grid, so any
 *  route it plans can really be walked (exact circles would block the odd corner). */
export function walkable(x: number, z: number): boolean {
  return walk[toCell(z) * N + toCell(x)] === 1;
}

/** One step with sliding collision: the whole step, else along one axis, else stay. */
export function step(x: number, z: number, nx: number, nz: number): { x: number; z: number } {
  if (!walkable(x, z)) return walkableNear(nx, nz); // spawned or pushed into a margin: get out
  if (walkable(nx, nz)) return { x: nx, z: nz };
  if (walkable(nx, z)) return { x: nx, z };
  if (walkable(x, nz)) return { x, z: nz };
  return { x, z };
}

/** The walkable cell nearest to a point (searching outward). */
function nearestWalkable(x: number, z: number): number {
  const i0 = toCell(x);
  const j0 = toCell(z);
  if (walk[j0 * N + i0]) return j0 * N + i0;
  let best = -1;
  let bd = Infinity;
  for (let r = 1; r < N && best < 0; r++)
    for (let j = j0 - r; j <= j0 + r; j++)
      for (let i = i0 - r; i <= i0 + r; i++) {
        if (i < 0 || j < 0 || i >= N || j >= N || !walk[j * N + i]) continue;
        const d = (i - i0) ** 2 + (j - j0) ** 2;
        if (d < bd) {
          bd = d;
          best = j * N + i;
        }
      }
  return Math.max(best, 0);
}

/** Straight line between two points stays on walkable cells. */
function clear(ax: number, az: number, bx: number, bz: number): boolean {
  const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL * 0.5));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    if (!walk[toCell(az + (bz - az) * t) * N + toCell(ax + (bx - ax) * t)]) return false;
  }
  return true;
}

export interface Path {
  /** Waypoints to walk, in order (the last one is the reachable end). */
  points: { x: number; z: number }[];
  /** Where the path ends: the goal itself, or the closest reachable spot to it. */
  end: { x: number; z: number };
  /** True when the goal itself is reachable. */
  reached: boolean;
}

const dist = new Float32Array(N * N);
const prev = new Int32Array(N * N);
const DIRS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
] as const;

/** Shortest walkable route from `from` towards `to`. */
export function findPath(from: { x: number; z: number }, to: { x: number; z: number }): Path {
  const start = nearestWalkable(from.x, from.z);
  const goalI = toCell(to.x);
  const goalJ = toCell(to.z);
  const goal = goalJ * N + goalI;

  // Dijkstra over the grid (a few thousand cells: well under a millisecond)
  dist.fill(Infinity);
  prev.fill(-1);
  dist[start] = 0;
  const open: number[] = [start];
  let bestEnd = start;
  let bestGoalD = Infinity;
  while (open.length) {
    // small grid: a linear scan for the minimum is fine
    let mi = 0;
    for (let q = 1; q < open.length; q++) if (dist[open[q]] < dist[open[mi]]) mi = q;
    const k = open[mi];
    open[mi] = open[open.length - 1];
    open.pop();
    const gd = (k % N - goalI) ** 2 + (Math.floor(k / N) - goalJ) ** 2;
    if (gd < bestGoalD) {
      bestGoalD = gd;
      bestEnd = k;
    }
    if (k === goal) break;
    const i = k % N;
    const j = Math.floor(k / N);
    for (const [di, dj, c] of DIRS) {
      const ni = i + di;
      const nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
      const nk = nj * N + ni;
      if (!walk[nk]) continue;
      // no cutting corners past an obstacle
      if (di && dj && (!walk[j * N + ni] || !walk[nj * N + i])) continue;
      const nd = dist[k] + c;
      if (nd < dist[nk]) {
        if (dist[nk] === Infinity) open.push(nk);
        dist[nk] = nd;
        prev[nk] = k;
      }
    }
  }

  const reached = bestEnd === goal && walk[goal] === 1;
  const end = reached ? { x: to.x, z: to.z } : { x: cx(bestEnd), z: cz(bestEnd) };
  const cells: number[] = [];
  for (let k = bestEnd; k !== -1 && k !== start; k = prev[k]) cells.push(k);
  cells.reverse();

  // string-pull: keep only the corners we can't see past
  const points: { x: number; z: number }[] = [];
  let ax = from.x;
  let az = from.z;
  for (let q = 0; q < cells.length; q++) {
    const nx = q + 1 < cells.length ? cx(cells[q + 1]) : end.x;
    const nz = q + 1 < cells.length ? cz(cells[q + 1]) : end.z;
    if (!clear(ax, az, nx, nz)) {
      ax = cx(cells[q]);
      az = cz(cells[q]);
      points.push({ x: ax, z: az });
    }
  }
  points.push(end);
  return { points, end, reached };
}

/** The nearest spot to (x, z) the panda can stand on. */
export function walkableNear(x: number, z: number): { x: number; z: number } {
  const k = nearestWalkable(x, z);
  if (k === toCell(z) * N + toCell(x)) return { x, z };
  return { x: cx(k), z: cz(k) };
}
