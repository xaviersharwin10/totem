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
import { world } from "./store";

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
      camera={{ position: [0, 7.2, 13], fov: 42 }}
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

function CameraRig({ follow }: { follow: boolean }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const tmp = useRef(new THREE.Vector3());
  const introStart = useRef<number | null>(null);
  const INTRO = 5.4; // seconds of cinematic reveal on load
  useFrame((state, dt) => {
    const c = controls.current;
    if (!c) return;

    // ---- cinematic intro: a descending orbit that settles into the play view ----
    if (introStart.current === null) introStart.current = state.clock.elapsedTime;
    const t = state.clock.elapsedTime - introStart.current;
    if (t < INTRO) {
      c.enabled = false;
      const k = t / INTRO;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // easeInOut
      const az = (1 - e) * 2.4; // sweep ~140° -> 0
      const R = 27 - (27 - 13) * e; // dolly in
      const h = 16 - (16 - 7.2) * e; // descend
      camera.position.set(Math.sin(az) * R, h, Math.cos(az) * R);
      camera.lookAt(0, 1, 0);
      c.target.set(0, 1, 0);
      return;
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
