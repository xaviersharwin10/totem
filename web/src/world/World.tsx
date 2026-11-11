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
  graves: { name: string; maxLevel: number }[];
  follow: boolean;
  onGround: (p: THREE.Vector3) => void;
  onPet: () => void;
  speech?: { id: number; text: string; typing?: boolean } | null;
  onShakeTree: () => void;
  onInfo: (what: "totem" | "hoard") => void;
}

export function World(p: WorldProps) {
  const night = Math.sin(p.dayFrac * Math.PI * 2) < -0.1;
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [0, 7.2, 13], fov: 42 }}
      gl={{ antialias: true }}
      onCreated={({ scene }) => {
        scene.background = new THREE.Color("#a8dcff");
        scene.fog = new THREE.Fog("#a8dcff", 28, 60);
      }}
    >
      <SkyAndLight dayFrac={p.dayFrac} mood={p.mood} />
      <Island onGround={p.onGround} rampage={p.mood === "rampage"} />
      <ContactShadows position={[0, 0.02, 0]} opacity={0.25} scale={24} blur={2.4} far={4} />
      <Trees onShake={p.onShakeTree} />
      <Barn />
      <Pond />
      <Bamboo />
      <TotemPole level={p.level} onInfo={() => p.onInfo("totem")} />
      <HoardChest hoard={p.hoard} rampage={p.mood === "rampage"} onInfo={() => p.onInfo("hoard")} />
      <Graveyard graves={p.graves} />
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
  useFrame((_, dt) => {
    const c = controls.current;
    if (!c) return;
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
      maxDistance={26}
      minPolarAngle={0.35}
      maxPolarAngle={1.32}
      rotateSpeed={0.6}
    />
  );
}
