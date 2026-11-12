// The Totem: a chubby, silent panda that lives on the farm. Built from soft
// primitives (no external models), animated procedurally, with a small behavior
// brain: it wanders, chases the ball, rolls, munches bamboo, sulks when hungry,
// lies down when starving, stomps around when it rampages, and plays dead.
// Original design: palette-tinted patches, a knitted scarf and a sprout on its
// head; the Egg wears its shell as a cap, the Dragon has felt horns and wings,
// the Golem a moss crown with flowers.

import { useEffect, useMemo, useRef } from "react";
import { useFrame, ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { Form, Mood } from "../engine";
import { addBurst, bump, OBSTACLES, ROAM_RADIUS, world } from "./store";
import { findPath, step, walkableNear } from "./nav";
import { Rich, bubbleText } from "../rich";

export interface PandaLook {
  patch: string; // the "black" patches, tinted per generation
  scarf: string;
  accent: string;
}

type Act = "idle" | "wander" | "ball" | "roll" | "sit" | "food" | "eat" | "pet" | "lie" | "stomp" | "dead";


export function Panda({
  mood,
  form,
  level,
  look,
  onPet,
  speech,
}: {
  mood: Mood;
  form: Form;
  level: number;
  look: PandaLook;
  onPet: () => void;
  speech?: { id: number; text: string; typing?: boolean } | null;
}) {
  const root = useRef<THREE.Group>(null!);
  const pose = useRef<THREE.Group>(null!); // squash/roll/lie transforms
  const head = useRef<THREE.Group>(null!);
  const armL = useRef<THREE.Group>(null!);
  const armR = useRef<THREE.Group>(null!);
  const legL = useRef<THREE.Mesh>(null!);
  const legR = useRef<THREE.Mesh>(null!);
  const wings = useRef<THREE.Group>(null);
  const eyesOpen = useRef<THREE.Group>(null!);
  const eyesHappy = useRef<THREE.Group>(null!);
  const eyesDead = useRef<THREE.Group>(null!);
  const mouthSmile = useRef<THREE.Mesh>(null!);
  const mouthO = useRef<THREE.Group>(null!);
  const tears = useRef<THREE.Group>(null!);
  const brows = useRef<THREE.Group>(null!);
  const pupils = useRef<THREE.Group>(null!);
  const ghost = useRef<THREE.Group>(null!);
  const scarfTail = useRef<THREE.Mesh>(null!);

  const brain = useRef({
    act: "idle" as Act,
    until: 0,
    target: new THREE.Vector3(),
    foodId: 0,
    walk: 0,
    actStart: 0,
    lastKick: 0,
    speed: 0,
    // unsticking: time spent pushing without getting anywhere, and the escape
    stuck: 0,
    escapeUntil: 0,
    escapeHeading: 0,
    // the planned route (world/nav.ts) and what it was planned for
    path: null as { x: number; z: number }[] | null,
    pathGoal: { x: 0, z: 0 },
    pathEnd: { x: 0, z: 0 },
    pathAt: 0,
  });

  // ---- materials (tinted live for rampage / death) ----
  const mats = useMemo(
    () => ({
      fur: new THREE.MeshStandardMaterial({ color: "#fbf6ee", roughness: 0.95 }),
      patch: new THREE.MeshStandardMaterial({ color: look.patch, roughness: 0.9 }),
      belly: new THREE.MeshStandardMaterial({ color: "#fff1df", roughness: 1 }),
      scarf: new THREE.MeshStandardMaterial({ color: look.scarf, roughness: 1 }),
      eyeW: new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.3 }),
      pupil: new THREE.MeshStandardMaterial({ color: "#120b10", roughness: 0.2 }),
      shine: new THREE.MeshBasicMaterial({ color: "#ffffff" }),
      blush: new THREE.MeshBasicMaterial({ color: "#ff8fb0", transparent: true, opacity: 0.55, depthWrite: false }),
      nose: new THREE.MeshStandardMaterial({ color: "#2a1b24", roughness: 0.4 }),
      cream: new THREE.MeshBasicMaterial({ color: "#fff6e6" }),
      mouth: new THREE.MeshStandardMaterial({ color: "#7a2840" }),
      tongue: new THREE.MeshStandardMaterial({ color: "#ff7a98" }),
      tear: new THREE.MeshStandardMaterial({ color: "#8fd3ff", transparent: true, opacity: 0.85 }),
      leaf: new THREE.MeshStandardMaterial({ color: "#7fcf5a", roughness: 0.8 }),
      stem: new THREE.MeshStandardMaterial({ color: "#5c9a3f" }),
      shell: new THREE.MeshStandardMaterial({ color: "#fffaf0", roughness: 0.6, side: THREE.DoubleSide }),
      horn: new THREE.MeshStandardMaterial({ color: "#fff1d0", roughness: 0.7 }),
      wing: new THREE.MeshStandardMaterial({ color: look.accent, roughness: 0.9, side: THREE.DoubleSide }),
      moss: new THREE.MeshStandardMaterial({ color: "#6fb24f", roughness: 1 }),
      petal: new THREE.MeshStandardMaterial({ color: "#ffffff" }),
      pebble: new THREE.MeshStandardMaterial({ color: "#b9b2a9", roughness: 1 }),
      ghost: new THREE.MeshStandardMaterial({ color: "#e9f3ff", transparent: true, opacity: 0.55, emissive: "#9fc8ff", emissiveIntensity: 0.4 }),
      halo: new THREE.MeshBasicMaterial({ color: "#ffe27a" }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  useEffect(() => {
    mats.patch.color.set(look.patch);
    mats.scarf.color.set(look.scarf);
    mats.wing.color.set(look.accent);
  }, [look, mats]);

  useEffect(() => {
    const dead = mood === "dead";
    const rage = mood === "rampage";
    mats.fur.color.set(dead ? "#b9b7b4" : rage ? "#ffd2cc" : "#fbf6ee");
    mats.fur.emissive.set(rage ? "#ff2a2a" : "#000000");
    mats.fur.emissiveIntensity = rage ? 0.18 : 0;
    mats.patch.color.set(dead ? "#6d6a6c" : look.patch);
    mats.scarf.color.set(dead ? "#8d8a8a" : look.scarf);
    mats.belly.color.set(dead ? "#cfccc8" : "#fff1df");
  }, [mood, look, mats]);

  const size = 1.15 + 0.08 * Math.min(Math.max(level, 1), 8);

  // ---- the brain + animation, every frame ----
  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const t = state.clock.elapsedTime;
    const now = performance.now();
    const P = world.panda;
    const b = brain.current;

    const setAct = (a: Act, dur: number) => {
      b.act = a;
      b.until = t + dur;
      b.actStart = t;
    };
    const pickTarget = (range = ROAM_RADIUS) => {
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(Math.random()) * range;
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (Math.hypot(x, z) < ROAM_RADIUS - 0.4 && OBSTACLES.every(([ox, oz, or]) => Math.hypot(x - ox, z - oz) > or + 0.8)) {
          b.target.set(x, 0, z);
          b.path = null;
          return;
        }
      }
      b.target.set(0, 0, 1);
    };

    // ---- decide ----
    const landedFood = world.foods.filter((f) => f.y <= 0.01 && f.eaten < 1);
    if (mood === "dead") {
      if (b.act !== "dead") setAct("dead", 1e9);
    } else if (now - P.petAt < 1100) {
      if (b.act !== "pet") setAct("pet", 1.1);
    } else if (landedFood.length && b.act !== "eat") {
      let best = landedFood[0];
      let bd = Infinity;
      for (const f of landedFood) {
        const d = f.pos.distanceTo(P.pos);
        if (d < bd) {
          bd = d;
          best = f;
        }
      }
      b.foodId = best.id;
      b.target.copy(best.pos);
      if (bd < 0.95 * size) setAct("eat", 999);
      else if (b.act !== "food") setAct("food", 999);
    } else if (b.act === "eat") {
      // keep eating (handled below)
    } else if (t > b.until || b.act === "dead" || b.act === "pet" || b.act === "food") {
      if (mood === "rampage") {
        pickTarget();
        setAct("stomp", 1.6 + Math.random());
      } else if (mood === "starving") {
        setAct("lie", 6 + Math.random() * 4);
      } else if (mood === "hungry") {
        if (Math.random() < 0.6) setAct("sit", 4 + Math.random() * 3);
        else {
          pickTarget(6);
          setAct("wander", 4);
        }
      } else {
        const r = Math.random();
        const ballSpeed = world.ball.vel.length();
        if (r < 0.35 || ballSpeed > 1) setAct("ball", 7);
        else if (r < 0.75) {
          pickTarget();
          setAct("wander", 6);
        } else if (r < 0.88) setAct("roll", 1.1);
        else setAct("sit", 3);
      }
    }

    // ---- act ----
    let speed = 0;
    const lookAtCam = b.act === "sit" || b.act === "idle";
    if (b.act === "wander" || b.act === "stomp" || b.act === "food" || b.act === "ball") {
      // where this act wants to go (the ball may be past the walkable edge)
      const goal = b.act === "ball" ? walkableNear(world.ball.pos.x, world.ball.pos.z) : { x: b.target.x, z: b.target.z };
      // plan a route round the obstacles; re-plan when the goal moves (the rolling ball)
      if (!b.path || Math.hypot(goal.x - b.pathGoal.x, goal.z - b.pathGoal.z) > 0.6 || t - b.pathAt > (b.act === "ball" ? 0.8 : 1.5)) {
        const plan = findPath(P.pos, goal);
        b.path = plan.points;
        b.pathGoal = goal;
        b.pathEnd = plan.end;
        b.pathAt = t;
        if (b.act === "food" && !plan.reached) {
          // the food landed somewhere walled off: it rolls to the closest spot the panda can reach
          const f = world.foods.find((x) => x.id === b.foodId);
          if (f) f.pos.set(plan.end.x, 0, plan.end.z);
          b.target.set(plan.end.x, 0, plan.end.z);
          b.pathGoal = plan.end;
        }
      }
      while (b.path.length > 1 && Math.hypot(b.path[0].x - P.pos.x, b.path[0].z - P.pos.z) < 0.35) b.path.shift();
      const wp = b.path[0];
      const toEnd = Math.hypot(b.pathEnd.x - P.pos.x, b.pathEnd.z - P.pos.z);
      const toTarget = Math.hypot(b.target.x - P.pos.x, b.target.z - P.pos.z);
      const ballDist = Math.hypot(world.ball.pos.x - P.pos.x, world.ball.pos.z - P.pos.z);
      const reach = b.act === "ball" ? 0.75 * size : b.act === "food" ? 0.9 * size : 0.3;
      const arrived =
        b.act === "ball"
          ? ballDist < reach || toEnd < 0.4 // at the ball, or as close as it can get
          : b.act === "food"
            ? toTarget <= reach
            : toEnd <= 0.3;
      if (!arrived) {
        const want = Math.atan2(wp.x - P.pos.x, wp.z - P.pos.z);
        let dh = want - P.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        P.heading += dh * Math.min(1, dt * 7);
        // slow down for sharp turns so it doesn't orbit a waypoint
        const turn = Math.max(0.35, Math.cos(Math.min(Math.abs(dh), Math.PI / 2)));
        speed = (b.act === "stomp" ? 3.2 : b.act === "ball" ? 2.8 : b.act === "food" ? 2.6 : 1.4) * turn;
        if (mood === "hungry") speed *= 0.6;
      } else if (b.act === "ball" && ballDist > reach + 2) {
        setAct("sit", 1.2); // the ball stopped somewhere it can't get to: lose interest
      } else if (b.act === "ball") {
        if (t - b.lastKick > 0.6) {
          b.lastKick = t;
          const dir = new THREE.Vector3(Math.sin(P.heading), 0, Math.cos(P.heading));
          // a ball out past the walkable edge gets kicked back towards the middle
          if (Math.hypot(world.ball.pos.x, world.ball.pos.z) > ROAM_RADIUS - 0.3) dir.set(-world.ball.pos.x, 0, -world.ball.pos.z).normalize();
          dir.x += (Math.random() - 0.5) * 0.8;
          dir.z += (Math.random() - 0.5) * 0.8;
          dir.normalize().multiplyScalar(5 + Math.random() * 3);
          world.ball.vel.copy(dir);
          world.ball.vy = 3 + Math.random() * 2;
          addBurst("spark", world.ball.pos.clone().setY(0.8));
        }
      } else if (b.act === "wander" || b.act === "stomp") {
        b.until = t; // arrived, choose again
      }
    } else b.path = null;
    if (b.act === "roll") speed = 2.2;

    // eat
    if (b.act === "eat") {
      const f = world.foods.find((x) => x.id === b.foodId);
      if (!f || f.eaten >= 1) {
        setAct("sit", 1.2);
      } else {
        const to = new THREE.Vector3().subVectors(f.pos, P.pos);
        const want = Math.atan2(to.x, to.z);
        let dh = want - P.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        P.heading += dh * Math.min(1, dt * 6);
        f.eaten += dt * (f.kind === "apple" ? 0.9 : 0.55);
        if (Math.random() < dt * 3) addBurst("spark", f.pos.clone().setY(0.6), undefined, "#9be37a");
        if (f.eaten >= 1) {
          world.foods = world.foods.filter((x) => x.id !== f.id);
          world.onAte?.(f);
          addBurst("heart", P.pos.clone().setY(2.6 * size));
          bump();
        }
      }
    }

    // escaping a wedge: walk towards open ground for a moment, then think again
    if (t < b.escapeUntil && mood !== "dead") {
      let dh = b.escapeHeading - P.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      P.heading += dh * Math.min(1, dt * 8);
      speed = 2.2;
    }

    // move
    if (speed > 0) {
      const px = P.pos.x;
      const pz = P.pos.z;
      const next = step(P.pos.x, P.pos.z, P.pos.x + Math.sin(P.heading) * speed * dt, P.pos.z + Math.cos(P.heading) * speed * dt);
      P.pos.x = next.x;
      P.pos.z = next.z;
      b.walk += dt * speed * 4.2;

      // stuck: pushing on but barely moving (a tree, the edge, or both)
      const moved = Math.hypot(P.pos.x - px, P.pos.z - pz);
      if (t >= b.escapeUntil && moved < speed * dt * 0.3) b.stuck += dt;
      else b.stuck = Math.max(0, b.stuck - dt * 2);
      if (b.stuck > 0.8) {
        b.stuck = 0;
        // head for the middle of the island, give or take, away from the nearest obstacle
        const a = Math.atan2(-P.pos.x, 1 - P.pos.z) + (Math.random() - 0.5) * 1.2;
        b.escapeHeading = a;
        b.escapeUntil = t + 0.9;
        b.path = null; // re-plan from wherever the escape leaves us
        if (b.act === "ball") setAct("sit", 1.5);
        else b.until = t + 0.9; // wander / stomp: pick a new spot after the escape
      }
    } else b.stuck = 0;
    b.speed = THREE.MathUtils.lerp(b.speed, speed, Math.min(1, dt * 8));

    // face the camera when sitting/idle
    if (lookAtCam && t >= b.escapeUntil) {
      const cam = state.camera.position;
      const want = Math.atan2(cam.x - P.pos.x, cam.z - P.pos.z);
      let dh = want - P.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      P.heading += dh * Math.min(1, dt * 2.5);
    }

    // ---- pose ----
    root.current.position.set(P.pos.x, 0, P.pos.z);
    root.current.rotation.y = P.heading;
    root.current.scale.setScalar(THREE.MathUtils.lerp(root.current.scale.x, size, dt * 2));

    const moving = b.speed > 0.2;
    const sw = Math.sin(b.walk);
    let py = 0;
    let rx = 0;
    let rz = 0;
    let sy = 1 + Math.sin(t * 2.2) * 0.025; // breathing
    let sx = 1 - Math.sin(t * 2.2) * 0.02;
    let legSwing = moving ? sw * 0.7 : 0;
    let armL_ = moving ? -sw * 0.6 : 0.15;
    let armR_ = moving ? sw * 0.6 : 0.15;
    let headTilt = 0;
    let headNod = 0;
    let wingFlap = Math.sin(t * 3) * 0.25;

    if (moving) {
      py = Math.abs(Math.sin(b.walk)) * (b.act === "stomp" ? 0.22 : 0.1);
      rz = Math.sin(b.walk) * 0.08;
    }
    switch (b.act) {
      case "sit":
      case "idle":
        py = -0.12;
        legSwing = -1.2;
        armL_ = 0.5;
        armR_ = 0.5;
        headTilt = Math.sin(t * 0.9) * 0.12;
        if (mood === "hungry") {
          armL_ = 0.9 + Math.sin(t * 3) * 0.1; // rubbing the belly
          armR_ = 0.9 - Math.sin(t * 3) * 0.1;
        }
        break;
      case "eat": {
        py = -0.12;
        legSwing = -1.2;
        const c = Math.sin(t * 12);
        armL_ = 1.9 + c * 0.25;
        armR_ = 1.9 - c * 0.25;
        headNod = Math.abs(c) * 0.12;
        break;
      }
      case "pet": {
        const k = (t - b.actStart) / 1.1;
        py = Math.sin(Math.min(k, 1) * Math.PI) * 0.9;
        root.current.rotation.y = P.heading + k * Math.PI * 2;
        armL_ = 2.4;
        armR_ = 2.4;
        sx = 1.08;
        sy = 0.94;
        wingFlap = Math.sin(t * 20) * 0.6;
        break;
      }
      case "roll": {
        const k = Math.min(1, (t - b.actStart) / 1.1);
        rx = k * Math.PI * 2;
        py = Math.sin(k * Math.PI) * 0.5;
        break;
      }
      case "lie":
        rz = 1.35;
        py = 0.18;
        legSwing = Math.sin(t * 1.5) * 0.2;
        armL_ = 0.4;
        armR_ = 0.4;
        break;
      case "dead":
        rx = -1.5;
        py = 0.42;
        legSwing = -0.6;
        armL_ = 1.6;
        armR_ = 1.6;
        break;
      case "stomp":
        wingFlap = Math.sin(t * 18) * 0.5;
        break;
    }
    if (b.act === "ball" && !moving) {
      armL_ = 1.4;
      armR_ = 1.4;
    }

    pose.current.position.y = THREE.MathUtils.lerp(pose.current.position.y, py, b.act === "pet" || moving ? 1 : dt * 6);
    pose.current.rotation.x = b.act === "roll" ? rx : THREE.MathUtils.lerp(pose.current.rotation.x, rx, dt * 5);
    pose.current.rotation.z = THREE.MathUtils.lerp(pose.current.rotation.z, rz, dt * (moving ? 12 : 4));
    pose.current.scale.set(sx, sy, sx);
    legL.current.rotation.x = legSwing;
    legR.current.rotation.x = b.act === "sit" || b.act === "eat" || b.act === "idle" || b.act === "dead" ? legSwing : -legSwing;
    armL.current.rotation.x = -armL_;
    armR.current.rotation.x = -armR_;
    armL.current.rotation.z = 0.25;
    armR.current.rotation.z = -0.25;
    head.current.rotation.z = headTilt;
    head.current.rotation.x = headNod;
    if (wings.current) {
      wings.current.children[0].rotation.y = 0.5 + wingFlap;
      wings.current.children[1].rotation.y = -0.5 - wingFlap;
    }
    scarfTail.current.rotation.x = 0.25 + Math.sin(t * 4 + b.walk) * 0.15;

    // ---- face ----
    const squint = b.act === "eat" || b.act === "pet" || (mood === "happy" && b.act === "roll");
    const blink = (t % 4.3) < 0.12;
    eyesDead.current.visible = mood === "dead";
    eyesHappy.current.visible = mood !== "dead" && squint;
    eyesOpen.current.visible = mood !== "dead" && !squint;
    eyesOpen.current.scale.y = blink ? 0.1 : 1;
    pupils.current.position.y = mood === "hungry" ? 0.012 : 0;
    mouthSmile.current.visible = mood === "happy" || squint;
    mouthO.current.visible = !mouthSmile.current.visible && mood !== "dead";
    mouthO.current.scale.setScalar(mood === "rampage" ? 1.4 : b.act === "eat" ? 0.6 + Math.abs(Math.sin(t * 12)) * 0.6 : 1);
    brows.current.visible = mood === "rampage" || mood === "starving";
    brows.current.children.forEach((c, i) => {
      c.rotation.z = (i === 0 ? 1 : -1) * (mood === "rampage" ? -0.5 : 0.45);
    });
    tears.current.visible = mood === "starving";
    if (tears.current.visible) {
      tears.current.children.forEach((c, i) => {
        const k = ((t * 0.9 + i * 0.5) % 1);
        c.position.y = 0.0 - k * 0.35;
        c.scale.setScalar(1 - k * 0.5);
      });
    }

    // ghost of the departed
    ghost.current.visible = mood === "dead";
    if (mood === "dead") {
      ghost.current.position.y = 2.2 + Math.sin(t * 1.4) * 0.25;
      ghost.current.rotation.y = Math.sin(t * 0.7) * 0.4;
    }

    // rampage steam
    if (mood === "rampage" && Math.random() < dt * 4) {
      addBurst("smoke", new THREE.Vector3(P.pos.x + (Math.random() - 0.5) * 0.8, 2.3 * size, P.pos.z));
    }
  });

  const onDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (mood === "dead") return onPet(); // the ghost can still talk
    world.panda.petAt = performance.now();
    for (let i = 0; i < 3; i++) {
      addBurst("heart", world.panda.pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 2.4 * size, 0)));
    }
    onPet();
  };

  const s = (x: number, y: number, z: number) => [x, y, z] as [number, number, number];

  return (
    <group ref={root} onPointerDown={onDown} onPointerOver={() => (document.body.style.cursor = "grab")} onPointerOut={() => (document.body.style.cursor = "")}>
      <group ref={pose}>
        {/* legs */}
        <mesh ref={legL} position={s(-0.36, 0.24, 0.1)} material={mats.patch} castShadow>
          <sphereGeometry args={[0.27, 20, 16]} />
        </mesh>
        <mesh ref={legR} position={s(0.36, 0.24, 0.1)} material={mats.patch} castShadow>
          <sphereGeometry args={[0.27, 20, 16]} />
        </mesh>
        {/* foot pads */}
        <mesh position={s(-0.36, 0.2, 0.36)} rotation={[0.3, 0, 0]} material={mats.belly}>
          <sphereGeometry args={[0.1, 12, 10]} />
        </mesh>
        <mesh position={s(0.36, 0.2, 0.36)} rotation={[0.3, 0, 0]} material={mats.belly}>
          <sphereGeometry args={[0.1, 12, 10]} />
        </mesh>

        {/* body */}
        <mesh position={s(0, 0.82, 0)} scale={s(1.08, 0.98, 1)} material={mats.fur} castShadow receiveShadow>
          <sphereGeometry args={[0.74, 36, 28]} />
        </mesh>
        <mesh position={s(0, 0.74, 0.42)} scale={s(1, 1.05, 0.55)} material={mats.belly}>
          <sphereGeometry args={[0.46, 28, 20]} />
        </mesh>
        {/* shoulder band */}
        <mesh position={s(0, 1.12, -0.02)} scale={s(1.06, 0.55, 0.95)} material={mats.patch}>
          <sphereGeometry args={[0.66, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2.2]} />
        </mesh>
        {/* tail */}
        <mesh position={s(0, 0.55, -0.74)} material={mats.fur}>
          <sphereGeometry args={[0.16, 14, 12]} />
        </mesh>

        {/* golem pebbles */}
        {form === "golem" &&
          [[-0.55, 0.9, 0.45, 0.12], [0.6, 0.65, 0.4, 0.1], [0.3, 1.0, -0.6, 0.11]].map(([x, y, z, r], i) => (
            <mesh key={i} position={s(x, y, z)} material={mats.pebble} scale={s(1, 0.7, 1)}>
              <sphereGeometry args={[r, 10, 8]} />
            </mesh>
          ))}

        {/* dragon wings */}
        {form === "dragon" && (
          <group ref={wings} position={s(0, 1.15, -0.55)}>
            <group position={s(-0.25, 0, 0)}>
              <mesh position={s(-0.38, 0.1, 0)} scale={s(0.55, 0.38, 0.06)} material={mats.wing}>
                <sphereGeometry args={[0.7, 16, 12]} />
              </mesh>
            </group>
            <group position={s(0.25, 0, 0)}>
              <mesh position={s(0.38, 0.1, 0)} scale={s(0.55, 0.38, 0.06)} material={mats.wing}>
                <sphereGeometry args={[0.7, 16, 12]} />
              </mesh>
            </group>
          </group>
        )}

        {/* arms (pivot at the shoulder) */}
        <group ref={armL} position={s(-0.66, 1.18, 0.08)}>
          <mesh position={s(-0.02, -0.3, 0.02)} scale={s(1, 1.55, 1)} material={mats.patch} castShadow>
            <sphereGeometry args={[0.21, 16, 14]} />
          </mesh>
        </group>
        <group ref={armR} position={s(0.66, 1.18, 0.08)}>
          <mesh position={s(0.02, -0.3, 0.02)} scale={s(1, 1.55, 1)} material={mats.patch} castShadow>
            <sphereGeometry args={[0.21, 16, 14]} />
          </mesh>
        </group>

        {/* scarf */}
        <mesh position={s(0, 1.3, 0.02)} rotation={[Math.PI / 2 + 0.1, 0, 0]} scale={s(1.05, 1, 1)} material={mats.scarf} castShadow>
          <torusGeometry args={[0.58, 0.13, 14, 36]} />
        </mesh>
        <mesh ref={scarfTail} position={s(0.3, 1.08, 0.6)} material={mats.scarf} castShadow>
          <boxGeometry args={[0.16, 0.42, 0.07]} />
        </mesh>

        {/* head */}
        <group ref={head} position={s(0, 1.68, 0.04)}>
          <mesh scale={s(1.12, 0.96, 1)} material={mats.fur} castShadow>
            <sphereGeometry args={[0.62, 36, 28]} />
          </mesh>
          {/* ears */}
          <mesh position={s(-0.5, 0.47, -0.05)} material={mats.patch} castShadow>
            <sphereGeometry args={[0.2, 16, 14]} />
          </mesh>
          <mesh position={s(0.5, 0.47, -0.05)} material={mats.patch} castShadow>
            <sphereGeometry args={[0.2, 16, 14]} />
          </mesh>
          {/* droopy eye patches */}
          <mesh position={s(-0.25, 0.02, 0.5)} rotation={[0, -0.2, -0.5]} scale={s(0.85, 1.2, 0.5)} material={mats.patch}>
            <sphereGeometry args={[0.18, 18, 14]} />
          </mesh>
          <mesh position={s(0.25, 0.02, 0.5)} rotation={[0, 0.2, 0.5]} scale={s(0.85, 1.2, 0.5)} material={mats.patch}>
            <sphereGeometry args={[0.18, 18, 14]} />
          </mesh>

          {/* open eyes with shine */}
          <group ref={eyesOpen} position={s(0, 0.04, 0)}>
            <group ref={pupils}>
              {[-1, 1].map((sd) => (
                <group key={sd} position={s(0.24 * sd, 0, 0.585)}>
                  <mesh material={mats.pupil}>
                    <sphereGeometry args={[0.085, 18, 14]} />
                  </mesh>
                  <mesh position={s(0.03, 0.035, 0.065)} material={mats.shine}>
                    <sphereGeometry args={[0.032, 10, 8]} />
                  </mesh>
                  <mesh position={s(-0.03, -0.03, 0.07)} material={mats.shine}>
                    <sphereGeometry args={[0.014, 8, 6]} />
                  </mesh>
                </group>
              ))}
            </group>
          </group>
          {/* happy squint ^ ^ */}
          <group ref={eyesHappy} position={s(0, 0.03, 0.6)}>
            {[-1, 1].map((sd) => (
              <mesh key={sd} position={s(0.24 * sd, 0, 0)} material={mats.cream}>
                <torusGeometry args={[0.065, 0.018, 8, 16, Math.PI]} />
              </mesh>
            ))}
          </group>
          {/* x x */}
          <group ref={eyesDead} position={s(0, 0.03, 0.6)}>
            {[-1, 1].map((sd) => (
              <group key={sd} position={s(0.24 * sd, 0, 0)}>
                <mesh rotation={[0, 0, 0.785]} material={mats.cream}>
                  <boxGeometry args={[0.17, 0.035, 0.02]} />
                </mesh>
                <mesh rotation={[0, 0, -0.785]} material={mats.cream}>
                  <boxGeometry args={[0.17, 0.035, 0.02]} />
                </mesh>
              </group>
            ))}
          </group>
          {/* brows (angry / worried) */}
          <group ref={brows} position={s(0, 0.27, 0.56)}>
            <mesh position={s(-0.22, 0, 0)} material={mats.nose}>
              <boxGeometry args={[0.17, 0.04, 0.03]} />
            </mesh>
            <mesh position={s(0.22, 0, 0)} material={mats.nose}>
              <boxGeometry args={[0.17, 0.04, 0.03]} />
            </mesh>
          </group>
          {/* tears */}
          <group ref={tears} position={s(0, -0.08, 0.6)}>
            <mesh position={s(-0.3, 0, 0)} material={mats.tear}>
              <sphereGeometry args={[0.035, 10, 8]} />
            </mesh>
            <mesh position={s(0.3, 0, 0)} material={mats.tear}>
              <sphereGeometry args={[0.035, 10, 8]} />
            </mesh>
          </group>

          {/* blush */}
          <mesh position={s(-0.4, -0.15, 0.47)} rotation={[0, -0.6, 0]} material={mats.blush}>
            <circleGeometry args={[0.09, 20]} />
          </mesh>
          <mesh position={s(0.4, -0.15, 0.47)} rotation={[0, 0.6, 0]} material={mats.blush}>
            <circleGeometry args={[0.09, 20]} />
          </mesh>
          {/* nose */}
          <mesh position={s(0, -0.13, 0.6)} scale={s(1.35, 0.85, 0.8)} material={mats.nose}>
            <sphereGeometry args={[0.065, 14, 10]} />
          </mesh>
          {/* mouths */}
          <mesh ref={mouthSmile} position={s(0, -0.22, 0.585)} rotation={[0, 0, Math.PI]} material={mats.nose}>
            <torusGeometry args={[0.055, 0.014, 8, 16, Math.PI]} />
          </mesh>
          <group ref={mouthO} position={s(0, -0.25, 0.58)}>
            <mesh scale={s(1, 1.15, 0.5)} material={mats.mouth}>
              <sphereGeometry args={[0.045, 12, 10]} />
            </mesh>
          </group>

          {/* sprout */}
          {form !== "golem" && (
            <group position={s(0, form === "egg" ? 0.82 : 0.6, 0)}>
              <mesh position={s(0, 0.06, 0)} material={mats.stem}>
                <cylinderGeometry args={[0.018, 0.022, 0.14, 6]} />
              </mesh>
              <mesh position={s(-0.09, 0.14, 0)} rotation={[0, 0, 0.6]} scale={s(1, 0.45, 0.6)} material={mats.leaf}>
                <sphereGeometry args={[0.1, 12, 8]} />
              </mesh>
              <mesh position={s(0.09, 0.15, 0)} rotation={[0, 0, -0.6]} scale={s(1, 0.45, 0.6)} material={mats.leaf}>
                <sphereGeometry args={[0.1, 12, 8]} />
              </mesh>
            </group>
          )}

          {/* egg: its shell worn as a cap */}
          {form === "egg" && (
            <group position={s(0, 0.4, -0.02)} rotation={[0.1, 0, 0.15]}>
              <mesh material={mats.shell} castShadow>
                <sphereGeometry args={[0.46, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2.4]} />
              </mesh>
              {[[0.2, 0.3, 0.25], [-0.25, 0.28, 0.2], [0.05, 0.42, -0.1]].map(([x, y, z], i) => (
                <mesh key={i} position={s(x, y, z)} material={mats.wing}>
                  <sphereGeometry args={[0.05, 8, 6]} />
                </mesh>
              ))}
            </group>
          )}
          {/* dragon horns */}
          {form === "dragon" &&
            [-1, 1].map((sd) => (
              <mesh key={sd} position={s(0.25 * sd, 0.58, 0.05)} rotation={[0, 0, -0.35 * sd]} material={mats.horn}>
                <coneGeometry args={[0.08, 0.28, 10]} />
              </mesh>
            ))}
          {/* golem moss crown with flowers */}
          {form === "golem" && (
            <group position={s(0, 0.5, 0)}>
              <mesh scale={s(1.1, 0.35, 1)} material={mats.moss}>
                <sphereGeometry args={[0.45, 18, 10]} />
              </mesh>
              {[[-0.2, 0.12, 0.25], [0.18, 0.14, 0.22], [0, 0.17, -0.1]].map(([x, y, z], i) => (
                <group key={i} position={s(x, y, z)}>
                  <mesh material={mats.petal}>
                    <sphereGeometry args={[0.06, 8, 6]} />
                  </mesh>
                  <mesh position={s(0, 0.02, 0.03)} material={mats.halo}>
                    <sphereGeometry args={[0.03, 8, 6]} />
                  </mesh>
                </group>
              ))}
            </group>
          )}
        </group>
      </group>

      {/* ghost + halo */}
      <group ref={ghost} visible={false}>
        <mesh material={mats.ghost} scale={s(1, 1.1, 1)}>
          <sphereGeometry args={[0.45, 20, 16]} />
        </mesh>
        <mesh position={s(0, 0.62, 0)} rotation={[Math.PI / 2, 0, 0]} material={mats.halo}>
          <torusGeometry args={[0.3, 0.035, 8, 24]} />
        </mesh>
        <mesh position={s(-0.15, 0.08, 0.4)} material={mats.pupil}>
          <sphereGeometry args={[0.05, 8, 6]} />
        </mesh>
        <mesh position={s(0.15, 0.08, 0.4)} material={mats.pupil}>
          <sphereGeometry args={[0.05, 8, 6]} />
        </mesh>
      </group>
      {speech && (
        <Html position={[0, 2.55, 0]} center zIndexRange={[6, 0]} style={{ pointerEvents: "none" }}>
          <div key={speech.id} className={`speech ${speech.typing ? "typing" : ""}`}>
            {speech.typing ? <span className="dots"><i /><i /><i /></span> : <Rich text={bubbleText(speech.text)} />}
          </div>
        </Html>
      )}
    </group>
  );
}

