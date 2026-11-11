import { useEffect, useRef } from "react";
import { createBurst, createRain, MAX_PARTICLES, mulberry32, stepParticles, type Particle } from "@/lib/chaveamento/confetti";

export interface ConfettiCanvasProps {
  /** Tempo total (rajada inicial + chuva suave); depois o canvas esvazia e o rAF para. */
  durationMs: number;
  /** Semente do sorteio das partículas (determinístico: facilita testar e nunca usa Math.random). */
  seed?: number;
}

/**
 * Confete leve em <canvas> (sem biblioteca): no máximo 150 partículas vivas, rajada inicial + chuva suave, cores ouro/verde/branco.
 * O `requestAnimationFrame` é cancelado ao desmontar e quando a aba fica oculta (volta quando ela reaparece), e o laço
 * termina sozinho quando acaba o tempo e não sobra nenhuma partícula.
 */
export function ConfettiCanvas({ durationMs, seed = 20_26 }: ConfettiCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas.getContext("2d");
    } catch {
      ctx = null;
    }
    if (!ctx) return; // sem canvas (navegador antigo/teste): sem confete, a tela segue igual
    const g = ctx;

    const width = Math.max(1, window.innerWidth);
    const height = Math.max(1, window.innerHeight);
    canvas.width = width; // 1 px de canvas por px de CSS: TV fraca não paga o dobro (devicePixelRatio) à toa
    canvas.height = height;

    const rand = mulberry32(seed);
    const particles: Particle[] = [];
    const spawn = (list: Particle[]): void => {
      const room = Math.max(0, MAX_PARTICLES - particles.length);
      particles.push(...list.slice(0, room));
    };
    spawn(createBurst(rand, width, height, 90));

    let frame = 0;
    let last = 0;
    let elapsed = 0;
    let rainClock = 0;
    let secondBurst = false;
    let finished = false;

    const draw = (): void => {
      g.clearRect(0, 0, width, height);
      for (const p of particles) {
        const c = Math.cos(p.rot);
        const s = Math.sin(p.rot);
        g.setTransform(c, s, -s, c, p.x, p.y);
        g.fillStyle = p.color;
        // "vira" a folha de confete: a altura oscila com o giro
        g.fillRect(-p.w / 2, (-p.h / 2) * Math.abs(Math.cos(p.sway)), p.w, p.h * Math.abs(Math.cos(p.sway)));
      }
      g.setTransform(1, 0, 0, 1, 0, 0);
    };

    const tick = (now: number): void => {
      frame = 0;
      const dt = last === 0 ? 1 / 60 : (now - last) / 1000;
      last = now;
      elapsed += Math.min(dt, 0.1);
      if (!secondBurst && elapsed > 0.45) {
        secondBurst = true;
        spawn(createBurst(rand, width, height, 60));
      }
      rainClock += dt;
      if (elapsed < (durationMs / 1000) * 0.8 && rainClock > 0.14) {
        rainClock = 0;
        spawn(createRain(rand, width, 3));
      }
      const alive = stepParticles(particles, dt, height);
      draw();
      if (elapsed >= durationMs / 1000 && alive === 0) {
        finished = true;
        g.clearRect(0, 0, width, height);
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };

    const start = (): void => {
      if (frame !== 0 || finished) return;
      last = 0;
      frame = window.requestAnimationFrame(tick);
    };
    const stop = (): void => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      frame = 0;
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "hidden") stop();
      else start();
    };
    document.addEventListener("visibilitychange", onVisibility);
    if (document.visibilityState !== "hidden") start();

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
      try {
        g.clearRect(0, 0, width, height);
      } catch {
        /* canvas já solto */
      }
    };
  }, [durationMs, seed]);

  return <canvas ref={canvasRef} className="cv-confetti" data-testid="cv-confetti" aria-hidden="true" />;
}
