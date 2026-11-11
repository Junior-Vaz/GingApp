/** Motor PURO do confete (sem DOM e sem Math.random): partículas determinísticas por semente, no máximo 150 ao mesmo tempo. */

export const MAX_PARTICLES = 150;
export const CONFETTI_COLORS = ["#f5c542", "#ffd86b", "#e0a526", "#4ade80", "#22c55e", "#ffffff", "#f1f5f9"] as const;

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  rot: number;
  vr: number;
  /** Fase do "balanço" lateral. */
  sway: number;
  color: string;
  /** Segundos de vida restantes. */
  life: number;
}

/** Gerador pseudo-aleatório determinístico (mulberry32): mesma semente, mesma sequência. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rajada: sai de dois canhões nos cantos de baixo, para cima e para dentro. */
export function createBurst(rand: () => number, width: number, height: number, count: number): Particle[] {
  const n = Math.max(0, Math.min(MAX_PARTICLES, Math.floor(count)));
  const out: Particle[] = [];
  for (let i = 0; i < n; i += 1) {
    const fromLeft = i % 2 === 0;
    const angle = (fromLeft ? -60 : -120) * (Math.PI / 180) + (rand() - 0.5) * 0.9;
    const speed = height * (0.55 + rand() * 0.75);
    out.push({
      x: fromLeft ? width * 0.04 : width * 0.96,
      y: height * 1.02,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      w: 7 + rand() * 7,
      h: 11 + rand() * 9,
      rot: rand() * Math.PI * 2,
      vr: (rand() - 0.5) * 14,
      sway: rand() * Math.PI * 2,
      color: CONFETTI_COLORS[Math.floor(rand() * CONFETTI_COLORS.length)]!,
      life: 3.2 + rand() * 1.6,
    });
  }
  return out;
}

/** Chuva suave: cai do alto em posições espalhadas. */
export function createRain(rand: () => number, width: number, count: number): Particle[] {
  const n = Math.max(0, Math.min(MAX_PARTICLES, Math.floor(count)));
  const out: Particle[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      x: rand() * width,
      y: -20 - rand() * 60,
      vx: (rand() - 0.5) * 60,
      vy: 90 + rand() * 120,
      w: 6 + rand() * 6,
      h: 10 + rand() * 8,
      rot: rand() * Math.PI * 2,
      vr: (rand() - 0.5) * 9,
      sway: rand() * Math.PI * 2,
      color: CONFETTI_COLORS[Math.floor(rand() * CONFETTI_COLORS.length)]!,
      life: 5 + rand() * 2.5,
    });
  }
  return out;
}

/**
 * Avança as partículas `dt` segundos (muda a lista no lugar e devolve quantas sobraram): gravidade + arrasto + balanço.
 * Sai da tela por baixo ou acaba a vida = removida.
 */
export function stepParticles(particles: Particle[], dt: number, height: number): number {
  const step = Math.min(Math.max(dt, 0), 0.05);
  let write = 0;
  for (let read = 0; read < particles.length; read += 1) {
    const p = particles[read]!;
    p.life -= step;
    p.vy += 520 * step;
    const drag = Math.max(0, 1 - 1.6 * step);
    p.vx *= drag;
    p.vy = p.vy > 260 ? p.vy * Math.max(0, 1 - 2.2 * step) : p.vy;
    p.sway += step * 4;
    p.x += (p.vx + Math.sin(p.sway) * 38) * step;
    p.y += p.vy * step;
    p.rot += p.vr * step;
    if (p.life > 0 && p.y < height + 40) particles[write++] = p;
  }
  particles.length = write;
  return write;
}
