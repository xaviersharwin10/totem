// Shared, mutable world state for the 3D farm. The 3D scene mutates it every
// frame (cheap, no React re-render); components that list things (food, toasts)
// subscribe with `useWorld()`, which re-renders only when `bump()` is called.

import { useSyncExternalStore } from "react";
import * as THREE from "three";

export type Tool = "pet" | "bamboo" | "ball";

export interface Food {
  id: number;
  kind: "bamboo" | "apple";
  pos: THREE.Vector3; // landing spot on the ground
  y: number; // current height (falls from the sky)
  vy: number;
  size: number; // visual scale, grows with the amount fed
  bornAt: number;
  eaten: number; // 0..1 how much has been munched
}

export interface Burst {
  id: number;
  kind: "heart" | "coin" | "spark" | "smoke" | "text";
  pos: THREE.Vector3;
  text?: string;
  color?: string;
  bornAt: number;
}

/** Circular obstacles the panda steers around: [x, z, radius]. */
export const OBSTACLES: [number, number, number][] = [
  [-6.2, -5.2, 2.6], // barn
  [5.2, -4.2, 2.3], // pond
  [0, -7.2, 0.9], // totem pole
  [2.6, -7.0, 0.9], // hoard chest
  [7.2, 2.8, 1.3], // bamboo grove
  [-8.6, 1.4, 1.0], // trees
  [-7.6, 5.4, 1.0],
  [-3.4, -8.8, 1.0],
  [6.6, -7.6, 1.0],
  [8.6, -1.6, 1.0],
  [-4.8, 4.6, 1.0], // graveyard
];

export const ROAM_RADIUS = 8.6;
export const ISLAND_RADIUS = 11;

export const world = {
  foods: [] as Food[],
  bursts: [] as Burst[],
  ball: {
    pos: new THREE.Vector3(3, 0.45, 2.5),
    vel: new THREE.Vector3(),
    vy: 0,
    y: 0.45,
    spin: new THREE.Euler(),
  },
  panda: {
    pos: new THREE.Vector3(0, 0, 1),
    heading: 0,
    petAt: 0,
    eatingUntil: 0,
  },
  /** Last time each tree was shaken, by tree index. */
  treeShake: new Map<number, number>(),
  /** Called by the panda when it finishes a food item. */
  onAte: null as null | ((f: Food) => void),
  nextId: 1,
  version: 0,
};

const listeners = new Set<() => void>();

export function bump() {
  world.version++;
  listeners.forEach((l) => l());
}

export function useWorld(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => world.version
  );
}

export function dropFood(x: number, z: number, kind: Food["kind"], size = 1) {
  const p = clampToRoam(x, z);
  world.foods.push({
    id: world.nextId++,
    kind,
    pos: new THREE.Vector3(p.x, 0, p.z),
    y: 6 + Math.random() * 2,
    vy: 0,
    size,
    bornAt: performance.now(),
    eaten: 0,
  });
  bump();
}

export function addBurst(kind: Burst["kind"], pos: THREE.Vector3, text?: string, color?: string) {
  world.bursts.push({ id: world.nextId++, kind, pos: pos.clone(), text, color, bornAt: performance.now() });
  if (world.bursts.length > 60) world.bursts.splice(0, world.bursts.length - 60);
  bump();
}

export function throwBall(x: number, z: number) {
  const p = clampToRoam(x, z);
  world.ball.pos.set(p.x, 0, p.z);
  world.ball.y = 7;
  world.ball.vy = 0;
  world.ball.vel.set((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2);
}

export function clampToRoam(x: number, z: number) {
  const d = Math.hypot(x, z);
  if (d > ROAM_RADIUS) {
    x = (x / d) * ROAM_RADIUS;
    z = (z / d) * ROAM_RADIUS;
  }
  // push out of obstacles
  for (const [ox, oz, r] of OBSTACLES) {
    const dx = x - ox;
    const dz = z - oz;
    const dd = Math.hypot(dx, dz);
    if (dd < r + 0.6) {
      const k = (r + 0.6) / Math.max(dd, 0.001);
      x = ox + dx * k;
      z = oz + dz * k;
    }
  }
  return { x, z };
}
