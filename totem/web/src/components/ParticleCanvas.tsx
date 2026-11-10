import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { Mood } from "../engine";

export type Burst = "crumb" | "coin" | "burn" | "soul" | "heart";

export interface ParticleHandle {
  emit: (kind: Burst, count: number, xFrac?: number, yFrac?: number) => void;
}

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  g: number;
  type: string;
  rot: number;
  vrot: number;
  shape: "rect" | "circle" | "emoji";
  emoji?: string;
}

const COLORS = {
  crumb: ["#f4c04e", "#e89a3c", "#b9752a"],
  coin: ["#ffd84a", "#ffb300", "#fff1a8"],
  burn: ["#ff5b3a", "#ff8c42", "#c0290f"],
  soul: ["#bcd3ff", "#e8f0ff", "#8fb0e8"],
  heart: ["#ff6b9d", "#ff9ec4"],
};

export const ParticleCanvas = forwardRef<ParticleHandle, { mood: Mood }>(
  function ParticleCanvas({ mood }, ref) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const parts = useRef<P[]>([]);
    const sizeRef = useRef({ w: 0, h: 0 });
    const moodRef = useRef(mood);
    moodRef.current = mood;

    useImperativeHandle(ref, () => ({
      emit(kind, count, xFrac = 0.5, yFrac = 0.5) {
        const { w, h } = sizeRef.current;
        const ox = w * xFrac;
        const oy = h * yFrac;
        for (let i = 0; i < count; i++) parts.current.push(makeBurst(kind, ox, oy));
      },
    }));

    useEffect(() => {
      const canvas = canvasRef.current!;
      const cctx = canvas.getContext("2d")!;
      let raf = 0;
      let last = performance.now();
      let ambientAcc = 0;

      const resize = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const r = canvas.getBoundingClientRect();
        sizeRef.current = { w: r.width, h: r.height };
        canvas.width = r.width * dpr;
        canvas.height = r.height * dpr;
        cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(canvas);

      const tick = (t: number) => {
        const dt = Math.min(48, t - last);
        last = t;
        const { w, h } = sizeRef.current;
        const m = moodRef.current;

        // ambient spawns
        ambientAcc += dt;
        if (ambientAcc > 120) {
          ambientAcc = 0;
          if (m === "happy") parts.current.push(ambient("star", w, h));
          else if (m === "rampage") {
            parts.current.push(ambient("ember", w, h));
            parts.current.push(ambient("ember", w, h));
          } else if (m === "starving") parts.current.push(ambient("ember", w, h));
          else parts.current.push(ambient("mote", w, h));
        }

        cctx.clearRect(0, 0, w, h);
        const next: P[] = [];
        for (const p of parts.current) {
          p.life -= dt;
          if (p.life <= 0) continue;
          p.vy += p.g * (dt / 16);
          p.x += p.vx * (dt / 16);
          p.y += p.vy * (dt / 16);
          p.rot += p.vrot * (dt / 16);
          const a = Math.max(0, Math.min(1, p.life / p.max));
          cctx.globalAlpha = a;
          cctx.fillStyle = p.color;
          if (p.shape === "emoji" && p.emoji) {
            cctx.globalAlpha = a;
            cctx.font = `${p.size * 2}px serif`;
            cctx.fillText(p.emoji, p.x, p.y);
          } else if (p.shape === "circle") {
            cctx.beginPath();
            cctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
            cctx.fill();
          } else {
            cctx.save();
            cctx.translate(p.x, p.y);
            cctx.rotate(p.rot);
            cctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
            cctx.restore();
          }
          next.push(p);
        }
        cctx.globalAlpha = 1;
        parts.current = next.slice(-400);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => {
        cancelAnimationFrame(raf);
        ro.disconnect();
      };
    }, []);

    return <canvas ref={canvasRef} className="particle-canvas" />;
  }
);

function makeBurst(kind: Burst, ox: number, oy: number): P {
  const palette = COLORS[kind];
  const color = palette[Math.floor(Math.random() * palette.length)];
  const ang = Math.random() * Math.PI * 2;
  const spd = 1.5 + Math.random() * 3.5;
  if (kind === "coin") {
    return {
      x: ox + (Math.random() - 0.5) * 40,
      y: oy,
      vx: (Math.random() - 0.5) * 1.5,
      vy: -2 - Math.random() * 2,
      life: 700,
      max: 700,
      size: 3 + Math.random() * 2,
      color,
      g: 0.04,
      type: kind,
      rot: 0,
      vrot: 0,
      shape: "circle",
    };
  }
  if (kind === "soul") {
    return {
      x: ox + (Math.random() - 0.5) * 30,
      y: oy,
      vx: (Math.random() - 0.5) * 0.6,
      vy: -1 - Math.random(),
      life: 1600,
      max: 1600,
      size: 4 + Math.random() * 3,
      color,
      g: -0.01,
      type: kind,
      rot: 0,
      vrot: 0,
      shape: "circle",
    };
  }
  if (kind === "heart") {
    return {
      x: ox + (Math.random() - 0.5) * 40,
      y: oy,
      vx: (Math.random() - 0.5) * 1,
      vy: -1.5 - Math.random(),
      life: 1000,
      max: 1000,
      size: 8,
      color,
      g: -0.005,
      type: kind,
      rot: 0,
      vrot: 0,
      shape: "emoji",
      emoji: "❤",
    };
  }
  // crumb / burn: explode outward with gravity
  return {
    x: ox,
    y: oy,
    vx: Math.cos(ang) * spd,
    vy: Math.sin(ang) * spd - 2,
    life: 600 + Math.random() * 300,
    max: 900,
    size: 3 + Math.random() * 3,
    color,
    g: kind === "burn" ? -0.02 : 0.14,
    type: kind,
    rot: Math.random() * Math.PI,
    vrot: (Math.random() - 0.5) * 0.4,
    shape: "rect",
  };
}

function ambient(kind: "mote" | "star" | "ember", w: number, h: number): P {
  if (kind === "ember") {
    return {
      x: Math.random() * w,
      y: h + 10,
      vx: (Math.random() - 0.5) * 0.5,
      vy: -0.6 - Math.random() * 0.9,
      life: 2200,
      max: 2200,
      size: 2 + Math.random() * 2,
      color: Math.random() > 0.5 ? "#ff7b3a" : "#ffb347",
      g: -0.004,
      type: "ember",
      rot: 0,
      vrot: 0,
      shape: "circle",
    };
  }
  if (kind === "star") {
    return {
      x: Math.random() * w,
      y: Math.random() * h * 0.7,
      vx: 0,
      vy: -0.05,
      life: 1800,
      max: 1800,
      size: 1.5 + Math.random() * 1.5,
      color: "#fff6cf",
      g: 0,
      type: "star",
      rot: 0,
      vrot: 0,
      shape: "circle",
    };
  }
  return {
    x: Math.random() * w,
    y: h + 5,
    vx: (Math.random() - 0.5) * 0.3,
    vy: -0.3 - Math.random() * 0.4,
    life: 3000,
    max: 3000,
    size: 1.5,
    color: "rgba(180,200,230,0.5)",
    g: 0,
    type: "mote",
    rot: 0,
    vrot: 0,
    shape: "circle",
  };
}
