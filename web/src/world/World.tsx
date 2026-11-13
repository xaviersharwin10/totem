import { useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Sparkles, Stars, ContactShadows } from "@react-three/drei";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Form, Mood } from "../engine";
import { Panda, PandaLook } from "./Panda";
import {
  Ball,
  Bamboo,
  Barn,
  Bursts,
  Butterflies,
  Clouds,
  Foods,
  Graveyard,
  HoardChest,
  Island,
  Moon,
  Pond,
  SkyAndLight,
  TotemPole,
  Trees,
} from "./Farm";
import { MOON_POS, world } from "./store";

export interface WorldProps {
  mood: Mood;
  form: Form;
  level: number;
  hoard: number;
  dayFrac: number;
  look: PandaLook;
  graves: { name: string; maxLevel: number; generation?: number }[];
  onGrave?: (generation: number) => void;
  follow: boolean;
  onGround: (p: THREE.Vector3) => void;
  onPet: () => void;
  speech?: { id: number; text: string; typing?: boolean } | null;
  onShakeTree: () => void;
  onInfo: (what: "totem" | "hoard" | "moon") => void;
  /** tonight's real moon: 0 = new … 1 = full */
  moonLit: number;
  moonWaxing: boolean;
}

export function World(p: WorldProps) {
  const night = Math.sin(p.dayFrac * Math.PI * 2) < -0.1;
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [8.2, 4.5, 22.5], fov: 42 }}
      gl={{ antialias: true, preserveDrawingBuffer: true }} // lets the SOS card snapshot the farm
      onCreated={({ scene }) => {
        scene.background = new THREE.Color("#a8dcff");
        scene.fog = new THREE.Fog("#a8dcff", 28, 60);
      }}
    >
      <SkyAndLight dayFrac={p.dayFrac} mood={p.mood} />
      <Moon lit={p.moonLit} waxing={p.moonWaxing} onInfo={() => p.onInfo("moon")} />
      <Island onGround={p.onGround} rampage={p.mood === "rampage"} />
      <ContactShadows position={[0, 0.02, 0]} opacity={0.25} scale={24} blur={2.4} far={4} />
      <Trees onShake={p.onShakeTree} />
      <Barn />
      <Pond />
      <Bamboo />
      <TotemPole level={p.level} onInfo={() => p.onInfo("totem")} />
      <HoardChest hoard={p.hoard} rampage={p.mood === "rampage"} onInfo={() => p.onInfo("hoard")} />
      <Graveyard graves={p.graves} onPick={p.onGrave} />
      <Butterflies />
      <Clouds />
      <Foods />
      <Ball />
      <Panda mood={p.mood} form={p.form} level={p.level} look={p.look} onPet={p.onPet} speech={p.speech} />
      <Bursts />
      {night && <Stars radius={60} depth={20} count={1500} factor={3} fade speed={0.6} />}
      {night && <Sparkles count={40} scale={[18, 3, 18]} position={[0, 1.4, 0]} size={4} speed={0.4} color="#fff3a0" />}
      {p.mood === "rampage" && (
        <Sparkles count={60} scale={[3, 2, 3]} position={[2.6, 1.2, -7]} size={6} speed={2} color="#ff7a3c" />
      )}
      <CameraRig follow={p.follow} />
    </Canvas>
  );
}

const PLAY_TARGET = new THREE.Vector3(0, 1, 0);
// smootherstep: zero velocity AND zero acceleration at both ends, so the
// cinematic eases off the moon and settles into play with no kick or freeze.
const smoother = (x: number) => { const q = Math.min(1, Math.max(0, x)); return q * q * q * (q * (q * 6 - 15) + 10); };

function CameraRig({ follow }: { follow: boolean }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const tmp = useRef(new THREE.Vector3());
  const introStart = useRef<number | null>(null);
  const INTRO = 6.2; // seconds of cinematic reveal on load
  const LOOK = 5; // seconds the camera spends on the moon after the moon chip is tapped
  const look = useRef<{ start: number; from: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  useFrame((state, dt) => {
    const c = controls.current;
    if (!c) return;

    // ---- cinematic intro: open on tonight's moon, then tilt and glide down into the play view ----
    if (introStart.current === null) introStart.current = state.clock.elapsedTime;
    const t = state.clock.elapsedTime - introStart.current;
    if (t < INTRO) {
      c.enabled = false;
      // one continuous smootherstep across the whole reveal: lingers on the
      // moon at the start, glides down, and settles into play — no dead hold.
      const e = smoother(t / INTRO);
      const az = (1 - e) * 0.35;
      const R = 24 - (24 - 13) * e;
      const h = 4.5 + (7.2 - 4.5) * e;
      camera.position.set(Math.sin(az) * R, h, Math.cos(az) * R);
      camera.lookAt(tmp.current.copy(MOON_POS).lerp(PLAY_TARGET, e));
      c.target.copy(PLAY_TARGET);
      return;
    }

    // ---- tapping the moon chip: look up at the moon for a few seconds, then back ----
    if (world.moonLook && (!look.current || look.current.start !== world.moonLook)) {
      const prev = look.current;
      look.current = { start: world.moonLook, from: prev?.from ?? camera.position.clone(), target: prev?.target ?? c.target.clone() };
    }
    if (look.current) {
      const L = look.current;
      const s = (performance.now() - L.start) / 1000;
      if (s < LOOK) {
        c.enabled = false;
        const ease = (x: number) => { const q = Math.min(1, Math.max(0, x)); return q * q * (3 - 2 * q); };
        const b = s < 1.2 ? ease(s / 1.2) : s > LOOK - 1.2 ? ease((LOOK - s) / 1.2) : 1;
        // step back a little so the moon and the farm share the frame
        camera.position.copy(L.from).add(tmp.current.set(0, -1.5 * b, 4 * b));
        // wide screens: aim under the moon so it sits in the upper third, above the cards
        const aim = tmp.current.copy(MOON_POS).setY(MOON_POS.y - (state.size.width > state.size.height ? 5 : 1));
        camera.lookAt(aim.lerp(L.target, 1 - b));
        return;
      }
      camera.position.copy(L.from);
      c.target.copy(L.target);
      look.current = null;
      world.moonLook = 0;
      c.enabled = true;
      c.update();
    }

    if (!c.enabled) {
      c.enabled = true;
      c.target.set(0, 1, 0);
      c.update();
    }

    const want = follow ? tmp.current.copy(world.panda.pos).setY(1.2) : tmp.current.set(0, 1, 0);
    const before = c.target.clone();
    c.target.lerp(want, Math.min(1, dt * (follow ? 3 : 1.5)));
    // move the camera with the target so following feels like a tracking shot
    camera.position.add(c.target.clone().sub(before));
    c.update();
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.08}
      minDistance={7}
      maxDistance={30}
      minPolarAngle={0.35}
      maxPolarAngle={1.7}
      rotateSpeed={0.6}
    />
  );
}
