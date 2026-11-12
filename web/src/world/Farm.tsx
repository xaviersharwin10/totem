// The farm island the Totem lives on, and everything you can poke at.

import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame, ThreeEvent } from "@react-three/fiber";
import { Html, Sparkles } from "@react-three/drei";
import * as THREE from "three";
import { Mood } from "../engine";
import { addBurst, bump, dropFood, ISLAND_RADIUS, OBSTACLES, useWorld, world, Food } from "./store";

const s3 = (x: number, y: number, z: number) => [x, y, z] as [number, number, number];

function rand(seed: number) {
  let h = seed * 2654435761;
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------------- //
// ground
// ------------------------------------------------------------------------- //

export function Island({ onGround, rampage }: { onGround: (p: THREE.Vector3) => void; rampage: boolean }) {
  const grass = useRef<THREE.MeshStandardMaterial>(null!);
  // one profile: a thin vertical lip at the top that curves gradually into a rocky point
  const base = useMemo(() => {
    const pts = [
      [ISLAND_RADIUS, 0.0],
      [ISLAND_RADIUS, -0.45], // thin disc lip
      [ISLAND_RADIUS - 0.5, -0.9], // start easing inward
      [ISLAND_RADIUS - 1.6, -1.7],
      [ISLAND_RADIUS - 3.4, -2.7],
      [ISLAND_RADIUS - 5.6, -3.7],
      [ISLAND_RADIUS - 7.8, -4.7],
      [ISLAND_RADIUS - 9.6, -5.5],
      [0.6, -6.0],
      [0.0, -6.2],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    return new THREE.LatheGeometry(pts, 15);
  }, []);
  useFrame((_, dt) => {
    const target = new THREE.Color(rampage ? "#a8b46a" : "#8fd16a");
    grass.current.color.lerp(target, Math.min(1, dt * 2));
  });
  return (
    <group>
      {/* grass top */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={(e) => {
          // a tap, not the end of a drag to look around (that used to drop food and,
          // on live, open a transaction)
          if (e.delta > 6) return;
          e.stopPropagation();
          onGround(e.point);
        }}
      >
        <circleGeometry args={[ISLAND_RADIUS, 64]} />
        <meshStandardMaterial ref={grass} color="#8fd16a" roughness={1} />
      </mesh>
      {/* grassy lip just under the rim */}
      <mesh position={s3(0, -0.08, 0)}>
        <cylinderGeometry args={[ISLAND_RADIUS + 0.05, ISLAND_RADIUS, 0.18, 64, 1, true]} />
        <meshStandardMaterial color="#79bd55" roughness={1} side={THREE.DoubleSide} />
      </mesh>
      {/* thin dirt lip curving gradually into the faceted rocky underside (one piece) */}
      <mesh geometry={base} castShadow>
        <meshStandardMaterial color="#a8794f" roughness={1} flatShading side={THREE.DoubleSide} />
      </mesh>
      {/* rocky bumps studding the base + roots + drifting rocks */}
      <Underside />
      <Roots />
      <FloatingRocks />
      <BaseClouds />
      {/* dirt path */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={s3(0, 0.01, -3)}>
        <ringGeometry args={[3.3, 4.3, 48, 1, Math.PI * 0.15, Math.PI * 0.7]} />
        <meshStandardMaterial color="#e3c896" roughness={1} />
      </mesh>
      <Fence />
      <Flowers />
      <Bushes />
      <Rocks />
    </group>
  );
}

/** Rocky bumps studded over the tapering base so it reads as one jagged mass of land. */
function Underside() {
  const rocks = useMemo(() => {
    const r = rand(23);
    const out: { x: number; z: number; y: number; s: number; rot: number; dark: boolean }[] = [];
    const n = 34;
    // profile matching the Island lathe: [y, radius] top -> tip
    const prof: [number, number][] = [
      [-0.45, ISLAND_RADIUS], [-0.9, ISLAND_RADIUS - 0.5], [-1.7, ISLAND_RADIUS - 1.6],
      [-2.7, ISLAND_RADIUS - 3.4], [-3.7, ISLAND_RADIUS - 5.6], [-4.7, ISLAND_RADIUS - 7.8],
      [-5.5, ISLAND_RADIUS - 9.6], [-6.0, 0.6],
    ];
    const radAt = (y: number) => {
      for (let k = 1; k < prof.length; k++) {
        if (y >= prof[k][0]) {
          const [y0, r0] = prof[k - 1];
          const [y1, r1] = prof[k];
          return r0 + (r1 - r0) * ((y - y0) / (y1 - y0));
        }
      }
      return prof[prof.length - 1][1];
    };
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + r() * 0.6;
      // bias chunks toward the upper half so the disc bottom is densely rocky
      const y = -0.7 - Math.pow(r(), 1.5) * 5.0;
      const s = 0.7 + r() * 1.4;
      const surfR = radAt(y) - s * 0.3; // protrude a little so they read as attached chunks
      out.push({ x: Math.cos(ang) * surfR, z: Math.sin(ang) * surfR, y, s, rot: r() * Math.PI, dark: i % 2 === 0 });
    }
    // a chunk at the very tip
    out.push({ x: 0, z: 0, y: -5.7, s: 1.2, rot: r() * Math.PI, dark: true });
    return out;
  }, []);
  return (
    <group>
      {rocks.map((rk, i) => (
        <mesh key={i} position={s3(rk.x, rk.y, rk.z)} rotation={[rk.rot, rk.rot * 1.7, rk.rot * 0.5]} scale={s3(1, 1.2, 1)} castShadow>
          <icosahedronGeometry args={[rk.s, 0]} />
          <meshStandardMaterial color={rk.dark ? "#8a6244" : "#9c7450"} roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/** Green vines draping from the rim, swaying gently (bamboo-sway pattern). */
function Roots() {
  const g = useRef<THREE.Group>(null!);
  const vines = useMemo(() => {
    const r = rand(29);
    return Array.from({ length: 9 }, () => {
      const ang = r() * Math.PI * 2;
      const rad = ISLAND_RADIUS - 0.5 - r() * 1.2;
      return { x: Math.cos(ang) * rad, z: Math.sin(ang) * rad, len: 1.6 + r() * 2.4, p: r() * 6, tilt: (r() - 0.5) * 0.25, dark: r() > 0.5 };
    });
  }, []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    g.current.children.forEach((c, i) => {
      c.rotation.z = vines[i].tilt + Math.sin(t * 0.8 + vines[i].p) * 0.12;
      c.rotation.x = Math.cos(t * 0.7 + vines[i].p) * 0.08;
    });
  });
  return (
    <group ref={g}>
      {vines.map((v, i) => (
        <group key={i} position={s3(v.x, -0.5, v.z)}>
          {/* a gentle drape: two angled segments */}
          <mesh position={s3(0, -v.len * 0.3, 0)}>
            <cylinderGeometry args={[0.05, 0.07, v.len * 0.6, 6]} />
            <meshStandardMaterial color={v.dark ? "#4e7a33" : "#5c8f3c"} roughness={1} />
          </mesh>
          <group position={s3(0, -v.len * 0.6, 0)} rotation={[0.35, 0, 0.15]}>
            <mesh position={s3(0, -v.len * 0.22, 0)}>
              <cylinderGeometry args={[0.03, 0.05, v.len * 0.45, 6]} />
              <meshStandardMaterial color={v.dark ? "#4e7a33" : "#5c8f3c"} roughness={1} />
            </mesh>
            {/* leaf at the tip */}
            <mesh position={s3(0, -v.len * 0.46, 0)} rotation={[0, 0, 0.6]} scale={s3(0.5, 1.2, 0.1)}>
              <icosahedronGeometry args={[0.18, 0]} />
              <meshStandardMaterial color="#7dcd5a" roughness={0.9} flatShading />
            </mesh>
          </group>
        </group>
      ))}
    </group>
  );
}

/** A couple of small rocks drifting below the island. */
function FloatingRocks() {
  const g = useRef<THREE.Group>(null!);
  const rocks = useMemo(() => {
    const r = rand(31);
    return Array.from({ length: 4 }, () => ({
      x: (r() - 0.5) * 20,
      z: (r() - 0.5) * 20,
      y: -5.5 - r() * 3.0,
      s: 0.35 + r() * 0.5,
      p: r() * 6,
      spin: 0.1 + r() * 0.2,
    }));
  }, []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    g.current.children.forEach((c, i) => {
      c.position.y = rocks[i].y + Math.sin(t * 0.5 + rocks[i].p) * 0.4;
      c.rotation.y = t * rocks[i].spin;
      c.rotation.x = t * rocks[i].spin * 0.5;
    });
  });
  return (
    <group ref={g}>
      {rocks.map((rk, i) => (
        <mesh key={i} position={s3(rk.x, rk.y, rk.z)} scale={rk.s}>
          <dodecahedronGeometry args={[1, 0]} />
          <meshStandardMaterial color="#8a6845" roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  );
}

/** A soft cloud layer below the island, so it reads as floating high above the clouds. */
function BaseClouds() {
  const g = useRef<THREE.Group>(null!);
  const puffs = useMemo(() => {
    const r = rand(41);
    const out: { x: number; y: number; z: number; s: number; p: number }[] = [];
    const n = 6;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + r() * 0.6;
      const rad = ISLAND_RADIUS - 3 + r() * 5;
      // well below the rocky tip (~-8.7), spread out, so they're a layer the island sits above
      out.push({ x: Math.cos(ang) * rad, y: -10 - r() * 2.5, z: Math.sin(ang) * rad, s: 2 + r() * 1.8, p: r() * 6 });
    }
    return out;
  }, []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    g.current.children.forEach((c, i) => {
      c.position.x = puffs[i].x + Math.sin(t * 0.12 + puffs[i].p) * 0.6; // slow drift
    });
  });
  return (
    <group ref={g}>
      {puffs.map((p, i) => (
        <group key={i} position={s3(p.x, p.y, p.z)} scale={p.s}>
          {/* overlapping rounded blobs read as one soft cloud */}
          {[[0, 0, 0, 1], [0.9, -0.05, 0.2, 0.72], [-0.8, -0.05, -0.1, 0.68], [0.25, 0.1, -0.6, 0.6], [-0.3, 0.05, 0.6, 0.58]].map(([bx, by, bz, br], j) => (
            <mesh key={j} position={s3(bx, by, bz)} scale={br as number}>
              <sphereGeometry args={[0.7, 12, 10]} />
              <meshStandardMaterial color="#ffffff" roughness={1} transparent opacity={0.72} depthWrite={false} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function Fence() {
  const woodTex = useMemo(() => {
    const W = 64, H = 256;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#9b5a32";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#5a2e12";
    ctx.lineWidth = 1.8;
    for (let g = 0; g < 5; g++) {
      const xb = 5 + g * 13;
      ctx.beginPath();
      ctx.moveTo(xb, 0);
      for (let y = 0; y < H; y += 4)
        ctx.lineTo(xb + Math.sin(y * 0.22 + g * 1.7) * 2.8, y + 4);
      ctx.stroke();
    }
    // subtle edge glow
    const gr = ctx.createLinearGradient(0, 0, W, 0);
    gr.addColorStop(0, "rgba(255,160,60,0.12)");
    gr.addColorStop(0.25, "rgba(255,160,60,0)");
    gr.addColorStop(0.85, "rgba(0,0,0,0)");
    gr.addColorStop(1, "rgba(0,0,0,0.2)");
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }, []);

  const railTex = useMemo(() => {
    const W = 256, H = 32;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d")!;
    ctx.fillStyle = "#7a4228";
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = "#4e2412";
    ctx.lineWidth = 1.2;
    for (let g = 0; g < 4; g++) {
      const yb = 4 + g * 8;
      ctx.beginPath();
      ctx.moveTo(0, yb);
      for (let x = 0; x < W; x += 8)
        ctx.lineTo(x + 8, yb + Math.sin(x * 0.12 + g) * 1.8);
      ctx.stroke();
    }
    return new THREE.CanvasTexture(cv);
  }, []);

  const posts = useMemo(() => {
    const out: { x: number; z: number; a: number; h: number; lean: number; twist: number; dz: number }[] = [];
    const n = 44;
    const r = rand(61);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      out.push({
        x: Math.cos(a) * (ISLAND_RADIUS - 0.5),
        z: Math.sin(a) * (ISLAND_RADIUS - 0.5),
        a,
        h: 0.52 + r() * 0.34,
        lean: (r() - 0.5) * 0.22,
        twist: (r() - 0.5) * 0.3,
        dz: (r() - 0.5) * 0.12,
      });
    }
    return out;
  }, []);

  return (
    <group>
      {posts.map((p, i) => (
        <group key={i} position={s3(p.x, 0, p.z)} rotation={[0, -p.a, 0]}>
          <group position={s3(0, 0, p.dz)} rotation={[p.lean, p.twist, 0]}>
            {/* chunky picket board with wood-grain texture */}
            <mesh position={s3(0, p.h / 2, 0)} castShadow>
              <boxGeometry args={[0.26, p.h, 0.1]} />
              <meshStandardMaterial map={woodTex} roughness={0.88} />
            </mesh>
            {/* rounded/chamfered top cap — 8-sided tapered cylinder, NOT a sharp spike */}
            <mesh position={s3(0, p.h + 0.07, 0)} castShadow>
              <cylinderGeometry args={[0.07, 0.13, 0.14, 8]} />
              <meshStandardMaterial map={woodTex} roughness={0.88} />
            </mesh>
          </group>
          {/* two horizontal rails with grain texture */}
          <mesh position={s3(0, 0.52, 0.78)}>
            <boxGeometry args={[0.08, 0.11, 1.62]} />
            <meshStandardMaterial map={railTex} roughness={0.9} />
          </mesh>
          <mesh position={s3(0, 0.24, 0.78)}>
            <boxGeometry args={[0.08, 0.11, 1.62]} />
            <meshStandardMaterial map={railTex} roughness={0.9} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** Rounded leafy bushes dotted around the grass (low-poly, like the reference). */
function Bushes() {
  const spots = useMemo<[number, number, number][]>(
    () => [
      [-2.4, 5.6, 1.0], [6.2, -0.4, 0.9], [-6.4, 2.2, 1.05], [0.6, 5.2, 0.8],
      [3.6, -5.2, 0.95], [-4.2, -6.2, 0.85], [8.4, -2.8, 0.8], [-8.2, -1.2, 0.9],
      [2.2, 4.2, 0.7],
    ],
    [],
  );
  return (
    <group>
      {spots.map(([x, z, s], i) => {
        const r = rand(100 + i);
        const blobs: [number, number, number, number][] = [
          [0, 0.35, 0, 0.55], [0.4, 0.3, 0.1, 0.4], [-0.35, 0.28, -0.1, 0.42], [0.1, 0.5, -0.3, 0.36],
        ];
        const col = r() > 0.5 ? "#5fae44" : "#6cc04a";
        return (
          <group key={i} position={s3(x, 0, z)} scale={s}>
            {blobs.map(([bx, by, bz, br], j) => (
              <mesh key={j} position={s3(bx, by, bz)} castShadow>
                <icosahedronGeometry args={[br, 0]} />
                <meshStandardMaterial color={col} roughness={0.9} flatShading />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}

function Flowers() {
  const ref = useRef<THREE.InstancedMesh>(null!);
  const stems = useRef<THREE.InstancedMesh>(null!);
  const N = 140;
  const data = useMemo(() => {
    const r = rand(7);
    const cols = ["#ff8fb0", "#ffd966", "#ffffff", "#b79cff", "#ff9f6b"];
    const out: { x: number; z: number; c: string; s: number; p: number }[] = [];
    while (out.length < N) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * (ISLAND_RADIUS - 1.2);
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      if (OBSTACLES.some(([ox, oz, or]) => Math.hypot(x - ox, z - oz) < or + 0.3)) continue;
      out.push({ x, z, c: cols[Math.floor(r() * cols.length)], s: 0.7 + r() * 0.6, p: r() * 6.28 });
    }
    return out;
  }, []);
  useEffect(() => {
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    data.forEach((f, i) => {
      m.compose(new THREE.Vector3(f.x, 0.22 * f.s, f.z), new THREE.Quaternion(), new THREE.Vector3(f.s, f.s * 0.6, f.s));
      ref.current.setMatrixAt(i, m);
      ref.current.setColorAt(i, c.set(f.c));
      m.compose(new THREE.Vector3(f.x, 0.1 * f.s, f.z), new THREE.Quaternion(), new THREE.Vector3(1, f.s, 1));
      stems.current.setMatrixAt(i, m);
    });
    ref.current.instanceMatrix.needsUpdate = true;
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true;
    stems.current.instanceMatrix.needsUpdate = true;
  }, [data]);
  // gentle nodding — shift each flower head a touch on a per-flower phase
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const sc = useMemo(() => new THREE.Vector3(), []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    for (let i = 0; i < data.length; i++) {
      const f = data[i];
      const dx = Math.sin(t * 1.6 + f.p) * 0.035 * f.s;
      const dz = Math.cos(t * 1.3 + f.p) * 0.035 * f.s;
      v.set(f.x + dx, 0.22 * f.s, f.z + dz);
      sc.set(f.s, f.s * 0.6, f.s);
      m.compose(v, q, sc);
      ref.current.setMatrixAt(i, m);
    }
    ref.current.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      <instancedMesh ref={stems} args={[undefined, undefined, N]}>
        <cylinderGeometry args={[0.015, 0.015, 0.2, 4]} />
        <meshStandardMaterial color="#5c9a3f" />
      </instancedMesh>
      <instancedMesh ref={ref} args={[undefined, undefined, N]}>
        <sphereGeometry args={[0.08, 8, 6]} />
        <meshStandardMaterial roughness={0.8} />
      </instancedMesh>
    </group>
  );
}

function Rocks() {
  const rocks = [
    [9.2, 4.5, 0.4],
    [-9.4, -3.6, 0.5],
    [2.0, 9.5, 0.35],
    [-1.4, -9.6, 0.45],
    [-3.2, -3.4, 0.3],
  ];
  return (
    <group>
      {rocks.map(([x, z, r], i) => (
        <mesh key={i} position={s3(x, r * 0.4, z)} scale={s3(1.2, 0.7, 1)} castShadow>
          <dodecahedronGeometry args={[r, 0]} />
          <meshStandardMaterial color="#c2bcb4" roughness={1} flatShading />
        </mesh>
      ))}
    </group>
  );
}

// ------------------------------------------------------------------------- //
// trees (click to shake: apples fall and the panda goes for them)
// ------------------------------------------------------------------------- //

const TREES: [number, number, number, string][] = [
  [-8.6, 1.4, 1.0, "#6cc04a"],
  [-7.6, 5.4, 0.9, "#7dcd5a"],
  [-3.4, -8.8, 1.1, "#5fb446"],
  [6.6, -7.6, 1.05, "#74c752"],
  [8.6, -1.6, 1.0, "#68bd4c"],
];

export function Trees({ onShake }: { onShake: () => void }) {
  return (
    <group>
      {TREES.map(([x, z, sc, col], i) => (
        <Tree key={i} idx={i} x={x} z={z} sc={sc} color={col} onShake={onShake} />
      ))}
    </group>
  );
}

function Tree({ idx, x, z, sc, color, onShake }: { idx: number; x: number; z: number; sc: number; color: string; onShake: () => void }) {
  const crown = useRef<THREE.Group>(null!);
  const [hover, setHover] = useState(false);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const shook = world.treeShake.get(idx) ?? -10;
    const k = Math.max(0, 1 - (performance.now() - shook) / 900);
    crown.current.rotation.z = Math.sin(t * 1.2 + idx) * 0.03 + Math.sin(t * 30) * 0.12 * k;
    crown.current.rotation.x = Math.cos(t * 1.1 + idx) * 0.02;
    const target = hover ? 1.06 : 1;
    crown.current.scale.lerp(new THREE.Vector3(target, target, target), 0.15);
  });
  const down = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    world.treeShake.set(idx, performance.now());
    const n = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      dropFood(x + Math.cos(a) * 1.6, z + Math.sin(a) * 1.6, "apple", 1);
    }
    addBurst("spark", new THREE.Vector3(x, 3 * sc, z), undefined, "#9be37a");
    onShake();
  };
  const blobs = [
    [0, 2.5, 0, 1.15],
    [0.7, 2.2, 0.3, 0.8],
    [-0.7, 2.25, -0.2, 0.85],
    [0.1, 3.15, -0.1, 0.8],
    [-0.2, 2.2, 0.75, 0.7],
  ];
  return (
    <group position={s3(x, 0, z)} scale={sc}>
      <mesh position={s3(0, 0.9, 0)} castShadow>
        <cylinderGeometry args={[0.18, 0.28, 1.8, 8]} />
        <meshStandardMaterial color="#9a6a45" roughness={1} />
      </mesh>
      <group
        ref={crown}
        position={s3(0, 0, 0)}
        onPointerDown={down}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHover(true);
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => {
          setHover(false);
          document.body.style.cursor = "";
        }}
      >
        {blobs.map(([bx, by, bz, r], i) => (
          <mesh key={i} position={s3(bx, by, bz)} castShadow>
            <icosahedronGeometry args={[r, 1]} />
            <meshStandardMaterial color={color} roughness={0.9} flatShading />
          </mesh>
        ))}
        {[[0.6, 2.6, 0.75], [-0.75, 2.4, 0.5], [0.3, 3.3, 0.6], [-0.4, 2.9, -0.7], [0.85, 2.3, -0.3], [-0.9, 3.1, 0.2], [0.1, 2.2, 0.9], [0.5, 3.4, -0.4]].map(([ax, ay, az], i) => (
          <mesh key={i} position={s3(ax, ay, az)}>
            <sphereGeometry args={[0.13, 10, 8]} />
            <meshStandardMaterial color="#ff5a5a" roughness={0.5} />
          </mesh>
        ))}
      </group>
    </group>
  );
}

// ------------------------------------------------------------------------- //
// buildings & props
// ------------------------------------------------------------------------- //

export function Barn() {
  const body = useRef<THREE.Group>(null!);
  const blades = useRef<THREE.Group>(null!);
  const smoke = useRef<THREE.Group>(null!);
  // shallow triangular gable end (base 2.6 wide along z, apex 1.03 up)
  const gable = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, -1.3, 0, 0, 1.3, 0, 1.03, 0], 3));
    g.computeVertexNormals();
    return g;
  }, []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const b = 1 + Math.sin(t * 1.4) * 0.012; // slow breathing
    body.current.scale.set(b, b, b);
    blades.current.rotation.z = t * 0.9; // spinning windmill
    // rising, fading chimney smoke
    smoke.current.children.forEach((c, i) => {
      const k = (t * 0.45 + i / smoke.current.children.length) % 1;
      c.position.set(Math.sin(k * 6) * 0.12, 3.9 + k * 1.5, 0);
      c.scale.setScalar(0.18 + k * 0.3);
      ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = 0.45 * (1 - k);
    });
  });
  return (
    <group ref={body} position={s3(-6.2, 0, -5.2)} rotation={[0, 0.7, 0]}>
      <mesh position={s3(0, 1.1, 0)} castShadow receiveShadow>
        <boxGeometry args={[3.2, 2.2, 2.6]} />
        <meshStandardMaterial color="#e2574c" roughness={0.9} />
      </mesh>
      {/* pitched gable roof */}
      {([1, -1] as const).map((side) => (
        <mesh key={side} position={s3(0, 2.73, side * 0.68)} rotation={[side * 0.62, 0, 0]} castShadow>
          <boxGeometry args={[3.5, 0.16, 1.8]} />
          <meshStandardMaterial color="#8a4b3c" roughness={0.9} />
        </mesh>
      ))}
      {/* ridge beam */}
      <mesh position={s3(0, 3.24, 0)} castShadow>
        <boxGeometry args={[3.55, 0.14, 0.16]} />
        <meshStandardMaterial color="#6f4a2e" roughness={0.9} />
      </mesh>
      {/* gable end walls fill the triangular gaps */}
      {([1, -1] as const).map((side) => (
        <mesh key={side} geometry={gable} position={s3(side * 1.58, 2.2, 0)}>
          <meshStandardMaterial color="#d6504a" roughness={0.9} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* door */}
      <mesh position={s3(0, 0.75, 1.31)}>
        <boxGeometry args={[1.2, 1.5, 0.05]} />
        <meshStandardMaterial color="#fff4e4" />
      </mesh>
      <mesh position={s3(0, 0.75, 1.34)} rotation={[0, 0, 0.9]}>
        <boxGeometry args={[1.7, 0.1, 0.03]} />
        <meshStandardMaterial color="#e2574c" />
      </mesh>
      <mesh position={s3(0, 0.75, 1.34)} rotation={[0, 0, -0.9]}>
        <boxGeometry args={[1.7, 0.1, 0.03]} />
        <meshStandardMaterial color="#e2574c" />
      </mesh>
      {/* round window with a gold glow */}
      <mesh position={s3(0, 1.7, 1.32)}>
        <cylinderGeometry args={[0.32, 0.32, 0.06, 16]} />
        <meshStandardMaterial color="#ffe9a8" emissive="#ffcf5a" emissiveIntensity={0.5} roughness={0.4} />
      </mesh>
      <mesh position={s3(0, 1.7, 1.3)} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.34, 0.04, 8, 20]} />
        <meshStandardMaterial color="#8a4b3c" roughness={0.8} />
      </mesh>
      {/* chimney + smoke */}
      <mesh position={s3(1.0, 3.3, 0)} castShadow>
        <boxGeometry args={[0.4, 0.9, 0.4]} />
        <meshStandardMaterial color="#8a4b3c" roughness={0.9} />
      </mesh>
      <group ref={smoke} position={s3(1.0, 0, 0)}>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i}>
            <icosahedronGeometry args={[0.5, 0]} />
            <meshStandardMaterial color="#d7d0c4" roughness={1} flatShading transparent opacity={0.4} depthWrite={false} />
          </mesh>
        ))}
      </group>
      {/* windmill wheel on the front gable */}
      <group position={s3(0.9, 2.02, 1.42)}>
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.24, 8]} />
          <meshStandardMaterial color="#6f4a2e" roughness={0.9} />
        </mesh>
        <group ref={blades} position={s3(0, 0, 0.14)}>
          {[0, 1, 2, 3].map((i) => (
            <group key={i} rotation={[0, 0, (i * Math.PI) / 2]}>
              <mesh position={s3(0, 0.38, 0)}>
                <boxGeometry args={[0.16, 0.74, 0.03]} />
                <meshStandardMaterial color="#fff4e4" roughness={0.7} />
              </mesh>
              {/* sail frame */}
              <mesh position={s3(0, 0.38, 0.02)}>
                <boxGeometry args={[0.03, 0.74, 0.04]} />
                <meshStandardMaterial color="#8a4b3c" roughness={0.8} />
              </mesh>
            </group>
          ))}
          <mesh>
            <sphereGeometry args={[0.11, 10, 8]} />
            <meshStandardMaterial color="#6f4a2e" roughness={0.7} />
          </mesh>
        </group>
      </group>
      {/* hay bales */}
      {[[2.2, 0.35, 1.0], [2.0, 0.35, 1.8], [2.1, 0.95, 1.4]].map(([x, y, z], i) => (
        <mesh key={i} position={s3(x, y, z)} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.35, 0.35, 0.7, 16]} />
          <meshStandardMaterial color="#f1cf6b" roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

export function Pond() {
  const water = useRef<THREE.MeshStandardMaterial>(null!);
  const duck = useRef<THREE.Group>(null!);
  const ripples = useRef<THREE.Group>(null!);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    water.current.emissiveIntensity = 0.12 + Math.sin(t * 2) * 0.04;
    duck.current.position.set(5.2 + Math.cos(t * 0.4) * 1.3, 0.12 + Math.sin(t * 3) * 0.02, -4.2 + Math.sin(t * 0.4) * 1.1);
    duck.current.rotation.y = -t * 0.4;
    // expanding ripple rings around the duck
    ripples.current.children.forEach((c, i) => {
      const k = (t * 0.4 + i / ripples.current.children.length) % 1;
      c.scale.setScalar(0.3 + k * 1.6);
      ((c as THREE.Mesh).material as THREE.MeshStandardMaterial).opacity = 0.5 * (1 - k);
      c.position.set(duck.current.position.x, 0.04, duck.current.position.z);
    });
  });
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={s3(5.2, 0.03, -4.2)}>
        <circleGeometry args={[2.2, 40]} />
        <meshStandardMaterial ref={water} color="#6cc6ee" emissive="#5ab8ff" emissiveIntensity={0.12} roughness={0.15} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={s3(5.2, 0.02, -4.2)}>
        <ringGeometry args={[2.15, 2.45, 40]} />
        <meshStandardMaterial color="#d7c9a7" />
      </mesh>
      {/* ripples */}
      <group ref={ripples}>
        {[0, 1, 2].map((i) => (
          <mesh key={i} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.5, 0.6, 24]} />
            <meshStandardMaterial color="#ffffff" transparent opacity={0.4} depthWrite={false} />
          </mesh>
        ))}
      </group>
      {[[4.3, -3.4], [6.1, -5.0], [5.8, -3.3]].map(([x, z], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, i]} position={s3(x, 0.05, z)}>
          <circleGeometry args={[0.32, 12, 0, Math.PI * 1.75]} />
          <meshStandardMaterial color="#5fb446" />
        </mesh>
      ))}
      <group ref={duck}>
        <mesh scale={s3(1, 0.7, 1.4)}>
          <sphereGeometry args={[0.22, 14, 10]} />
          <meshStandardMaterial color="#fff6c2" />
        </mesh>
        <mesh position={s3(0, 0.2, 0.22)}>
          <sphereGeometry args={[0.13, 12, 10]} />
          <meshStandardMaterial color="#fff6c2" />
        </mesh>
        <mesh position={s3(0, 0.18, 0.36)} rotation={[Math.PI / 2, 0, 0]}>
          <coneGeometry args={[0.05, 0.12, 8]} />
          <meshStandardMaterial color="#ff9a3c" />
        </mesh>
      </group>
    </group>
  );
}

export function Bamboo() {
  const stalks = useMemo(() => {
    const r = rand(3);
    // several groves around the island (kept clear of the barn, pond and graveyard)
    const clusters: [number, number, number][] = [
      [7.2, 2.8, 10], [-2.0, 7.6, 7], [8.6, 5.2, 6], [-8.8, -4.4, 6],
    ];
    const out: { x: number; z: number; h: number; p: number }[] = [];
    for (const [cx, cz, count] of clusters) {
      for (let i = 0; i < count; i++) {
        out.push({ x: cx + (r() - 0.5) * 2.4, z: cz + (r() - 0.5) * 2.4, h: 2.0 + r() * 1.8, p: r() * 6 });
      }
    }
    return out;
  }, []);
  const g = useRef<THREE.Group>(null!);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    g.current.children.forEach((c, i) => {
      c.rotation.z = Math.sin(t * 1.3 + stalks[i].p) * 0.05;
    });
  });
  return (
    <group ref={g}>
      {stalks.map((st, i) => (
        <group key={i} position={s3(st.x, 0, st.z)}>
          {Array.from({ length: Math.floor(st.h / 0.55) }, (_, k) => (
            <mesh key={k} position={s3(0, 0.28 + k * 0.55, 0)} castShadow>
              <cylinderGeometry args={[0.08, 0.09, 0.52, 8]} />
              <meshStandardMaterial color={k % 2 ? "#8fcf5e" : "#7fc552"} roughness={0.7} />
            </mesh>
          ))}
          <mesh position={s3(0.18, st.h - 0.2, 0)} rotation={[0, 0, -0.8]} scale={s3(1, 0.25, 0.5)}>
            <sphereGeometry args={[0.25, 8, 6]} />
            <meshStandardMaterial color="#5fb446" />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ------------------------------------------------------------------------- //
// the Totem pole: one carved block per level. A bite knocks the top one off.
// ------------------------------------------------------------------------- //

const BLOCK_COLORS = ["#f3a64a", "#57b8c9", "#e5604d", "#9b7ad8", "#5cbf7a", "#f2cf4a", "#ef7fa8", "#4f86d9"];

export function TotemPole({ level, onInfo }: { level: number; onInfo: () => void }) {
  const n = Math.max(0, Math.min(level, 10));
  const [falling, setFalling] = useState<{ id: number; idx: number; t0: number }[]>([]);
  const prev = useRef(n);
  useEffect(() => {
    if (n < prev.current) {
      const now = performance.now();
      const add: { id: number; idx: number; t0: number }[] = [];
      for (let i = n; i < prev.current; i++) add.push({ id: now + i, idx: i, t0: now });
      setFalling((f) => [...f, ...add]);
      setTimeout(() => setFalling((f) => f.filter((x) => !add.some((a) => a.id === x.id))), 2200);
    }
    prev.current = n;
  }, [n]);
  return (
    <group
      position={s3(0, 0, -7.2)}
      onPointerDown={(e) => {
        e.stopPropagation();
        onInfo();
      }}
      onPointerOver={() => (document.body.style.cursor = "help")}
      onPointerOut={() => (document.body.style.cursor = "")}
    >
      <mesh position={s3(0, 0.1, 0)} receiveShadow>
        <cylinderGeometry args={[0.75, 0.85, 0.2, 16]} />
        <meshStandardMaterial color="#b8a58a" roughness={1} />
      </mesh>
      {Array.from({ length: n }, (_, i) => (
        <PoleBlock key={i} idx={i} />
      ))}
      {falling.map((f) => (
        <FallingBlock key={f.id} idx={f.idx} t0={f.t0} />
      ))}
      {n > 0 && (
        <mesh position={s3(0, 0.2 + n * 0.62 + 0.18, 0)} rotation={[0, 0, 0]}>
          <coneGeometry args={[0.35, 0.4, 4]} />
          <meshStandardMaterial color="#ffd54a" emissive="#ffb300" emissiveIntensity={0.35} />
        </mesh>
      )}
    </group>
  );
}

function BlockFace({ idx }: { idx: number }) {
  const c = BLOCK_COLORS[idx % BLOCK_COLORS.length];
  return (
    <group>
      <mesh castShadow>
        <cylinderGeometry args={[0.44, 0.48, 0.6, 10]} />
        <meshStandardMaterial color={c} roughness={0.8} flatShading />
      </mesh>
      {/* carved face */}
      <mesh position={s3(-0.15, 0.08, 0.43)}>
        <boxGeometry args={[0.14, 0.1, 0.06]} />
        <meshStandardMaterial color="#2a1b24" />
      </mesh>
      <mesh position={s3(0.15, 0.08, 0.43)}>
        <boxGeometry args={[0.14, 0.1, 0.06]} />
        <meshStandardMaterial color="#2a1b24" />
      </mesh>
      <mesh position={s3(0, -0.12, 0.44)}>
        <boxGeometry args={[0.24, idx % 2 ? 0.06 : 0.1, 0.06]} />
        <meshStandardMaterial color="#fff4e4" />
      </mesh>
      {idx % 3 === 2 &&
        [-1, 1].map((sd) => (
          <mesh key={sd} position={s3(0.55 * sd, 0.05, 0)} rotation={[0, 0, sd * 0.4]}>
            <boxGeometry args={[0.3, 0.12, 0.08]} />
            <meshStandardMaterial color={c} flatShading />
          </mesh>
        ))}
    </group>
  );
}

function PoleBlock({ idx }: { idx: number }) {
  const g = useRef<THREE.Group>(null!);
  const born = useRef(performance.now());
  useFrame(() => {
    const k = Math.min(1, (performance.now() - born.current) / 500);
    const e = 1 - Math.pow(1 - k, 3);
    g.current.position.y = 0.5 + idx * 0.62 + (1 - e) * 2.5;
    g.current.scale.setScalar(0.6 + 0.4 * e);
  });
  return (
    <group ref={g}>
      <BlockFace idx={idx} />
    </group>
  );
}

function FallingBlock({ idx, t0 }: { idx: number; t0: number }) {
  const g = useRef<THREE.Group>(null!);
  const dir = useMemo(() => (Math.random() < 0.5 ? -1 : 1), []);
  useFrame(() => {
    const k = (performance.now() - t0) / 1000;
    if (k > 2) {
      g.current.visible = false;
      return;
    }
    g.current.position.set(dir * k * 1.6, Math.max(0.3, 0.5 + idx * 0.62 + 2.2 * k - 6 * k * k), k * 0.8);
    g.current.rotation.z = -dir * k * 3;
    g.current.rotation.x = k * 2;
  });
  return (
    <group ref={g}>
      <BlockFace idx={idx} />
    </group>
  );
}

// ------------------------------------------------------------------------- //
// the Treasury: a treasure chest whose coin pile grows with the Reserve
// ------------------------------------------------------------------------- //

export function HoardChest({ hoard, rampage, onInfo }: { hoard: number; rampage: boolean; onInfo: () => void }) {
  const coins = Math.min(60, Math.floor(Math.log10(hoard + 1) * 14));
  const lid = useRef<THREE.Group>(null!);
  const chest = useRef<THREE.Group>(null!);
  const lock = useRef<THREE.MeshStandardMaterial>(null!);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    lid.current.rotation.x = -0.6 - Math.sin(t * 2) * 0.04 - (rampage ? Math.abs(Math.sin(t * 16)) * 0.25 : 0);
    chest.current.position.x = rampage ? Math.sin(t * 40) * 0.04 : 0;
    chest.current.position.y = Math.sin(t * 1.6) * 0.04; // gentle bob
    if (lock.current) lock.current.emissiveIntensity = 0.4 + Math.sin(t * 3) * 0.2;
  });
  const pile = useMemo(() => {
    const r = rand(11);
    return Array.from({ length: 60 }, (_, i) => ({
      x: (r() - 0.5) * (1.2 - i * 0.012),
      z: (r() - 0.5) * (0.8 - i * 0.008),
      y: 0.62 + Math.floor(i / 10) * 0.06 + r() * 0.03,
      r: r() * 3,
    }));
  }, []);
  return (
    <group
      position={s3(2.6, 0, -7.0)}
      rotation={[0, -0.35, 0]}
      onPointerDown={(e) => {
        e.stopPropagation();
        onInfo();
      }}
      onPointerOver={() => (document.body.style.cursor = "help")}
      onPointerOut={() => (document.body.style.cursor = "")}
    >
      <group ref={chest}>
        <mesh position={s3(0, 0.35, 0)} castShadow>
          <boxGeometry args={[1.4, 0.7, 0.95]} />
          <meshStandardMaterial color="#9c5d32" roughness={0.8} />
        </mesh>
        {/* gold corner straps */}
        {[-0.5, 0.5].map((x) => (
          <mesh key={x} position={s3(x, 0.35, 0)}>
            <boxGeometry args={[0.12, 0.72, 0.97]} />
            <meshStandardMaterial color="#f2c14e" metalness={0.6} roughness={0.3} />
          </mesh>
        ))}
        {/* iron band around the body */}
        <mesh position={s3(0, 0.18, 0)}>
          <boxGeometry args={[1.43, 0.12, 0.98]} />
          <meshStandardMaterial color="#8a6a2e" metalness={0.5} roughness={0.4} />
        </mesh>
        {/* lock plate + glowing keyhole */}
        <mesh position={s3(0, 0.5, 0.49)}>
          <boxGeometry args={[0.26, 0.3, 0.06]} />
          <meshStandardMaterial color="#f2c14e" metalness={0.7} roughness={0.25} />
        </mesh>
        <mesh position={s3(0, 0.47, 0.53)}>
          <sphereGeometry args={[0.055, 10, 8]} />
          <meshStandardMaterial ref={lock} color="#3a2a14" emissive="#ffcf5a" emissiveIntensity={0.4} />
        </mesh>
        <group ref={lid} position={s3(0, 0.7, -0.47)}>
          {/* flat box lid, hinged at the back edge */}
          <mesh position={s3(0, 0.08, 0.47)} castShadow>
            <boxGeometry args={[1.44, 0.16, 0.95]} />
            <meshStandardMaterial color="#a8653a" roughness={0.8} />
          </mesh>
          {/* gold trim along the lid's front lip */}
          <mesh position={s3(0, 0.08, 0.93)}>
            <boxGeometry args={[1.47, 0.2, 0.08]} />
            <meshStandardMaterial color="#f2c14e" metalness={0.6} roughness={0.3} />
          </mesh>
          {/* side gold straps on the lid */}
          {[-0.5, 0.5].map((x) => (
            <mesh key={x} position={s3(x, 0.09, 0.47)}>
              <boxGeometry args={[0.12, 0.19, 0.97]} />
              <meshStandardMaterial color="#f2c14e" metalness={0.6} roughness={0.3} />
            </mesh>
          ))}
        </group>
        {pile.slice(0, coins).map((c, i) => (
          <mesh key={i} position={s3(c.x, c.y, c.z)} rotation={[c.r, c.r * 2, 0]}>
            <cylinderGeometry args={[0.1, 0.1, 0.03, 12]} />
            <meshStandardMaterial color="#ffd54a" emissive="#ffb300" emissiveIntensity={0.25} metalness={0.7} roughness={0.25} />
          </mesh>
        ))}
        {/* treasure shimmer, denser the richer the hoard */}
        {hoard > 0 && (
          <Sparkles count={Math.max(6, Math.min(34, coins))} scale={[1.3, 0.9, 0.9]} position={s3(0, 1.0, 0)} size={4} speed={0.5} color="#ffdf7a" />
        )}
      </group>
    </group>
  );
}

// ------------------------------------------------------------------------- //
// the graveyard: one gravestone per past generation (the lineage)
// ------------------------------------------------------------------------- //

export function Graveyard({
  graves,
  onPick,
}: {
  graves: { name: string; maxLevel: number; generation?: number }[];
  onPick?: (generation: number) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  return (
    <group position={s3(-4.8, 0, 4.6)}>
      {graves.slice(-6).map((g, i) => {
        const a = i * 1.05;
        const x = Math.cos(a) * (i ? 0.75 : 0);
        const z = Math.sin(a) * (i ? 0.75 : 0);
        return (
          <group
            key={i}
            position={s3(x, 0, z)}
            rotation={[0, 0.4, (i % 2 ? 1 : -1) * 0.06]}
            onPointerOver={(e) => {
              e.stopPropagation();
              setHover(i);
            }}
            onPointerOut={() => setHover(null)}
            onClick={(e) => {
              e.stopPropagation();
              if (g.generation && onPick) onPick(g.generation);
            }}
          >
            <mesh position={s3(0, 0.42, 0)} castShadow>
              <boxGeometry args={[0.5, 0.7, 0.14]} />
              <meshStandardMaterial color="#c9c4bd" roughness={1} />
            </mesh>
            <mesh position={s3(0, 0.77, 0)} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.25, 0.25, 0.14, 16, 1, false, 0, Math.PI]} />
              <meshStandardMaterial color="#c9c4bd" roughness={1} />
            </mesh>
            <mesh position={s3(0, 0.55, 0.075)}>
              <boxGeometry args={[0.06, 0.26, 0.01]} />
              <meshStandardMaterial color="#8f8a84" />
            </mesh>
            <mesh position={s3(0, 0.6, 0.075)}>
              <boxGeometry args={[0.2, 0.06, 0.01]} />
              <meshStandardMaterial color="#8f8a84" />
            </mesh>
            <mesh position={s3(0, 0.04, 0.3)} rotation={[-Math.PI / 2, 0, 0]}>
              <circleGeometry args={[0.28, 12]} />
              <meshStandardMaterial color="#7fbf5a" />
            </mesh>
            {hover === i && (
              <Html position={s3(0, 1.4, 0)} center distanceFactor={10}>
                <div className="grave-tip">
                  🪦 <b>{g.name}</b>
                  <br />
                  reached Level {g.maxLevel} · starved
                  {g.generation && onPick ? (
                    <>
                      <br />
                      <i>tap for its life story</i>
                    </>
                  ) : null}
                </div>
              </Html>
            )}
          </group>
        );
      })}
    </group>
  );
}

// ------------------------------------------------------------------------- //
// living things: butterflies, clouds
// ------------------------------------------------------------------------- //

export function Butterflies({ count = 6 }: { count?: number }) {
  const g = useRef<THREE.Group>(null!);
  const seeds = useMemo(() => Array.from({ length: count }, (_, i) => ({ p: i * 1.7, r: 2 + (i % 3) * 2.2, c: ["#ffb3d9", "#ffe066", "#b3d9ff", "#d9b3ff", "#ffffff", "#ffc38a"][i % 6], flee: 0 })), [count]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    g.current.children.forEach((b, i) => {
      const s = seeds[i];
      const k = Math.max(0, 1 - (performance.now() - s.flee) / 1500);
      const tt = t * 0.35 + s.p;
      b.position.set(Math.cos(tt) * s.r + Math.sin(tt * 2.3) * 1.2, 1.1 + Math.sin(tt * 3) * 0.4 + k * 3, Math.sin(tt * 1.3) * s.r);
      b.rotation.y = -tt + Math.PI / 2;
      const flap = Math.sin(t * 22 + i) * 0.9;
      b.children[0].rotation.z = flap;
      b.children[1].rotation.z = -flap;
    });
  });
  return (
    <group ref={g}>
      {seeds.map((s, i) => (
        <group
          key={i}
          onPointerDown={(e) => {
            e.stopPropagation();
            s.flee = performance.now();
            addBurst("spark", e.point, undefined, s.c);
          }}
        >
          <mesh position={s3(-0.09, 0, 0)} scale={s3(1, 0.1, 0.8)}>
            <sphereGeometry args={[0.11, 8, 6]} />
            <meshStandardMaterial color={s.c} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={s3(0.09, 0, 0)} scale={s3(1, 0.1, 0.8)}>
            <sphereGeometry args={[0.11, 8, 6]} />
            <meshStandardMaterial color={s.c} side={THREE.DoubleSide} />
          </mesh>
          {/* bigger invisible hit area */}
          <mesh visible={false}>
            <sphereGeometry args={[0.35, 6, 4]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export function Clouds() {
  const g = useRef<THREE.Group>(null!);
  const clouds = useMemo(() => {
    const r = rand(5);
    return Array.from({ length: 7 }, () => ({ a: r() * Math.PI * 2, d: 14 + r() * 8, y: 7 + r() * 4, s: 0.8 + r() * 0.8 }));
  }, []);
  useFrame((_, dt) => {
    g.current.children.forEach((c, i) => {
      clouds[i].a += dt * 0.012;
      c.position.set(Math.cos(clouds[i].a) * clouds[i].d, clouds[i].y, Math.sin(clouds[i].a) * clouds[i].d);
    });
  });
  return (
    <group ref={g}>
      {clouds.map((c, i) => (
        <group key={i} scale={c.s}>
          {[[0, 0, 0, 1.2], [1.1, -0.2, 0.2, 0.9], [-1.1, -0.25, -0.1, 0.85], [0.4, 0.5, 0, 0.8]].map(([x, y, z, r], k) => (
            <mesh key={k} position={s3(x, y, z)}>
              <sphereGeometry args={[r, 14, 10]} />
              <meshStandardMaterial color="#ffffff" roughness={1} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

// ------------------------------------------------------------------------- //
// food, ball, bursts
// ------------------------------------------------------------------------- //

export function Foods() {
  useWorld();
  return (
    <group>
      {world.foods.map((f) => (
        <FoodItem key={f.id} f={f} />
      ))}
    </group>
  );
}

function FoodItem({ f }: { f: Food }) {
  const g = useRef<THREE.Group>(null!);
  const landed = useRef(false);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    if (f.y > 0) {
      f.vy -= 22 * dt;
      f.y += f.vy * dt;
      if (f.y <= 0) {
        f.y = 0;
        if (!landed.current) {
          landed.current = true;
          addBurst("smoke", f.pos.clone().setY(0.2), undefined, "#f3e6c8");
        }
      }
    }
    g.current.position.set(f.pos.x, f.y + 0.12 * f.size, f.pos.z);
    const k = Math.max(0.05, 1 - f.eaten);
    g.current.scale.setScalar(f.size * k);
    g.current.rotation.y += dt * (f.y > 0 ? 6 : 0);
  });
  if (f.kind === "apple") {
    return (
      <group ref={g}>
        <mesh castShadow position={s3(0, 0.12, 0)}>
          <sphereGeometry args={[0.18, 14, 12]} />
          <meshStandardMaterial color="#ff4f4f" roughness={0.4} />
        </mesh>
        <mesh position={s3(0.05, 0.33, 0)} rotation={[0, 0, -0.6]} scale={s3(1, 0.4, 0.6)}>
          <sphereGeometry args={[0.07, 8, 6]} />
          <meshStandardMaterial color="#5fb446" />
        </mesh>
      </group>
    );
  }
  return (
    <group ref={g}>
      {[-0.12, 0.12].map((zo, j) => (
        <group key={j} position={s3(0, 0.1 + j * 0.12, zo)} rotation={[0, j * 0.6, Math.PI / 2]}>
          {[0, 1, 2].map((k) => (
            <mesh key={k} position={s3(0, (k - 1) * 0.3, 0)} castShadow>
              <cylinderGeometry args={[0.07, 0.075, 0.28, 8]} />
              <meshStandardMaterial color={k % 2 ? "#8fd35e" : "#76c24b"} />
            </mesh>
          ))}
        </group>
      ))}
      <mesh position={s3(0.3, 0.3, 0)} rotation={[0, 0, -0.5]} scale={s3(1, 0.3, 0.5)}>
        <sphereGeometry args={[0.18, 8, 6]} />
        <meshStandardMaterial color="#5fb446" />
      </mesh>
    </group>
  );
}

export function Ball() {
  const m = useRef<THREE.Mesh>(null!);
  // segmented beach-ball texture: vertical blue / red / orange bands around the sphere
  const tex = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = 96;
    c.height = 48;
    const x = c.getContext("2d")!;
    const cols = ["#3f8ddb", "#e24d3b", "#f2a53c", "#3f8ddb", "#e24d3b", "#f2a53c"];
    const seg = c.width / cols.length;
    cols.forEach((col, i) => {
      x.fillStyle = col;
      x.fillRect(i * seg, 0, seg + 1, c.height);
    });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }, []);
  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const B = world.ball;
    // vertical
    if (B.y > 0.45 || B.vy !== 0) {
      B.vy -= 20 * dt;
      B.y += B.vy * dt;
      if (B.y < 0.45) {
        B.y = 0.45;
        B.vy = Math.abs(B.vy) > 2 ? -B.vy * 0.5 : 0;
      }
    }
    B.pos.x += B.vel.x * dt;
    B.pos.z += B.vel.z * dt;
    const fr = Math.pow(0.35, dt);
    B.vel.multiplyScalar(fr);
    const d = Math.hypot(B.pos.x, B.pos.z);
    const lim = ISLAND_RADIUS - 1.1;
    if (d > lim) {
      const nx = B.pos.x / d;
      const nz = B.pos.z / d;
      B.pos.x = nx * lim;
      B.pos.z = nz * lim;
      const dot = B.vel.x * nx + B.vel.z * nz;
      B.vel.x -= 2 * dot * nx;
      B.vel.z -= 2 * dot * nz;
    }
    for (const [ox, oz, or] of OBSTACLES) {
      const dx = B.pos.x - ox;
      const dz = B.pos.z - oz;
      const dd = Math.hypot(dx, dz);
      if (dd < or + 0.4) {
        const nx = dx / dd;
        const nz = dz / dd;
        B.pos.x = ox + nx * (or + 0.4);
        B.pos.z = oz + nz * (or + 0.4);
        const dot = B.vel.x * nx + B.vel.z * nz;
        if (dot < 0) {
          B.vel.x -= 2 * dot * nx;
          B.vel.z -= 2 * dot * nz;
        }
      }
    }
    m.current.position.set(B.pos.x, B.y, B.pos.z);
    m.current.rotation.x += B.vel.z * dt * 2.2;
    m.current.rotation.z -= B.vel.x * dt * 2.2;
  });
  return (
    <mesh
      ref={m}
      castShadow
      onPointerDown={(e) => {
        e.stopPropagation();
        const dir = new THREE.Vector3().subVectors(world.ball.pos, e.camera.position).setY(0).normalize();
        world.ball.vel.copy(dir.multiplyScalar(7));
        world.ball.vy = 5;
        addBurst("spark", world.ball.pos.clone().setY(1));
      }}
      onPointerOver={() => (document.body.style.cursor = "pointer")}
      onPointerOut={() => (document.body.style.cursor = "")}
    >
      <sphereGeometry args={[0.45, 24, 18]} />
      <meshStandardMaterial map={tex} roughness={0.45} />
    </mesh>
  );
}

const BURST_LIFE = 1400;

export function Bursts() {
  useWorld();
  useFrame(() => {
    const now = performance.now();
    if (world.bursts.length && now - world.bursts[0].bornAt > BURST_LIFE) {
      world.bursts = world.bursts.filter((b) => now - b.bornAt < BURST_LIFE);
      bump();
    }
  });
  return (
    <group>
      {world.bursts.map((b) =>
        b.kind === "smoke" ? (
          <Puff key={b.id} pos={b.pos} color={b.color} />
        ) : (
          <Html key={b.id} position={b.pos} center zIndexRange={[20, 0]} style={{ pointerEvents: "none" }}>
            <div className={`burst burst-${b.kind}`} style={b.color ? { color: b.color } : undefined}>
              {b.kind === "heart" ? "💗" : b.kind === "coin" ? "🪙" : b.kind === "text" ? b.text : "✦"}
            </div>
          </Html>
        )
      )}
    </group>
  );
}

function Puff({ pos, color }: { pos: THREE.Vector3; color?: string }) {
  const m = useRef<THREE.Mesh>(null!);
  const born = useRef(performance.now());
  useFrame(() => {
    const k = (performance.now() - born.current) / BURST_LIFE;
    m.current.position.set(pos.x, pos.y + k * 1.2, pos.z);
    m.current.scale.setScalar(0.2 + k * 0.6);
    (m.current.material as THREE.MeshStandardMaterial).opacity = Math.max(0, 0.8 - k);
  });
  return (
    <mesh ref={m}>
      <sphereGeometry args={[0.5, 10, 8]} />
      <meshStandardMaterial color={color ?? "#ffffff"} transparent opacity={0.8} depthWrite={false} />
    </mesh>
  );
}

// ------------------------------------------------------------------------- //
// sky: day/night tied to the Totem-day, red when it rampages
// ------------------------------------------------------------------------- //

export function SkyAndLight({ dayFrac, mood }: { dayFrac: number; mood: Mood }) {
  const sun = useRef<THREE.DirectionalLight>(null!);
  const hemi = useRef<THREE.HemisphereLight>(null!);
  useFrame((state, dt) => {
    // dayFrac 0..1: 0 = sunrise, 0.25 noon, 0.5 sunset, 0.75 midnight
    const a = dayFrac * Math.PI * 2;
    const elev = Math.sin(a);
    const daylight = THREE.MathUtils.clamp(elev * 1.6 + 0.35, 0.12, 1);
    sun.current.position.set(Math.cos(a) * 14, Math.max(2, elev * 14), 6);
    sun.current.intensity = 0.4 + daylight * 1.6;
    hemi.current.intensity = 0.35 + daylight * 0.6;

    const day = new THREE.Color("#a8dcff");
    const dusk = new THREE.Color("#ffb38a");
    const night = new THREE.Color("#1d2550");
    const sky = new THREE.Color();
    if (elev > 0.25) sky.copy(day);
    else if (elev > -0.15) sky.lerpColors(dusk, day, (elev + 0.15) / 0.4);
    else sky.lerpColors(night, dusk, Math.max(0, (elev + 0.6) / 0.45));
    if (mood === "rampage") sky.lerp(new THREE.Color("#ff5a4a"), 0.45);
    if (mood === "dead") sky.lerp(new THREE.Color("#6f7385"), 0.6);
    const bg = state.scene.background as THREE.Color;
    bg.lerp(sky, Math.min(1, dt * 3));
    if (state.scene.fog) (state.scene.fog as THREE.Fog).color.copy(bg);
    sun.current.color.set(elev < 0.2 ? "#ffd2a8" : "#fff6e8");
  });
  return (
    <>
      <hemisphereLight ref={hemi} args={["#ffffff", "#7fb35a", 0.8]} />
      <directionalLight
        ref={sun}
        castShadow
        position={[8, 14, 6]}
        intensity={1.8}
        shadow-mapSize-width={1536}
        shadow-mapSize-height={1536}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={14}
        shadow-camera-bottom={-14}
        shadow-bias={-0.0005}
      />
    </>
  );
}

// --------------------------------------------------------------------------- //
// the real moon: tonight's phase, drawn on a camera-facing disc
// --------------------------------------------------------------------------- //

function drawMoon(lit: number, waxing: boolean): HTMLCanvasElement {
  const S = 256;
  const c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d")!;
  const r = S * 0.34;
  const cx = S / 2;
  const cy = S / 2;
  // glow, brighter the fuller it is
  const glow = g.createRadialGradient(cx, cy, r * 0.8, cx, cy, S / 2);
  glow.addColorStop(0, `rgba(255,248,214,${0.15 + 0.45 * lit})`);
  glow.addColorStop(1, "rgba(255,248,214,0)");
  g.fillStyle = glow;
  g.fillRect(0, 0, S, S);
  // the unlit part: faint earthshine, like the real moon in a day sky
  const DARK = "rgba(214,222,242,0.38)";
  g.fillStyle = DARK;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
  // the lit part: a half disc on the lit side, then the terminator ellipse
  const right = waxing; // northern-hemisphere view: waxing is lit on the right
  g.fillStyle = "#fff6d6";
  g.beginPath();
  g.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, !right);
  g.fill();
  const w = r * Math.abs(1 - 2 * lit);
  // a crescent's terminator is cut back to the unlit colour (clear first so it isn't doubled)
  if (lit <= 0.5) {
    g.save();
    g.globalCompositeOperation = "destination-out";
    g.beginPath();
    g.ellipse(cx, cy, w, r, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  g.fillStyle = lit > 0.5 ? "#fff6d6" : DARK;
  g.beginPath();
  g.ellipse(cx, cy, w, r, 0, 0, Math.PI * 2);
  g.fill();
  // a few craters
  g.fillStyle = "rgba(120,110,90,0.18)";
  for (const [x, y, rr] of [[-0.3, -0.25, 0.14], [0.2, 0.3, 0.1], [0.35, -0.1, 0.07], [-0.1, 0.15, 0.06]])
    g.beginPath(), g.arc(cx + x * r, cy + y * r, rr * r, 0, Math.PI * 2), g.fill();
  return c;
}

export function Moon({ lit, waxing, onInfo }: { lit: number; waxing: boolean; onInfo: () => void }) {
  const key = Math.round(lit * 100) + (waxing ? "w" : "n");
  const tex = useMemo(() => {
    const t = new THREE.CanvasTexture(drawMoon(lit, waxing));
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const ref = useRef<THREE.Sprite>(null!);
  useFrame((state) => {
    ref.current.position.y = 8.5 + Math.sin(state.clock.elapsedTime * 0.2) * 0.25;
  });
  return (
    <sprite
      ref={ref}
      position={[3.5, 8.5, -32]}
      scale={[4.6, 4.6, 1]}
      onClick={(e) => {
        e.stopPropagation();
        onInfo();
      }}
    >
      <spriteMaterial map={tex} transparent depthWrite={false} fog={false} />
    </sprite>
  );
}
