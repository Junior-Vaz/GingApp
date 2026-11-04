import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "@/lib/use-reduced-motion";

/** ids que já fizeram a contagem nesta sessão: voltar para a tela não conta de novo ("só na 1ª exibição"). */
const played = new Set<string>();

/** Esquece as contagens já feitas (uso em testes). */
export function resetCountUpMemory() {
  played.clear();
}

function canAnimate(reduced: boolean, target: number, id: string | undefined): boolean {
  return (
    !reduced &&
    typeof IntersectionObserver !== "undefined" &&
    typeof requestAnimationFrame === "function" &&
    Number.isFinite(target) &&
    target > 0 &&
    !(id && played.has(id))
  );
}

/**
 * Contagem crescente leve para um número principal (0 -> `target`, ~700 ms, ease-out).
 *
 * - Só na 1ª exibição (com `id`) e só quando o elemento aparece na tela (IntersectionObserver); sem IntersectionObserver
 *   (navegador muito antigo, jsdom) ou com `prefers-reduced-motion` o valor final aparece direto, sem animar.
 * - Só o número muda: o hook vive num componente minúsculo (`CountUp`), então o re-render fica restrito a ele e só
 *   acontece quando o inteiro exibido muda (~um por frame no máximo).
 * - Se `target` mudar depois da contagem (troca de aluno, refetch), pula direto para o novo valor.
 *
 * Retorna o valor exibido e a `ref` do elemento observado.
 */
export function useCountUp(target: number, options: { id?: string | undefined; duration?: number | undefined } = {}) {
  const { id, duration = 700 } = options;
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement | null>(null);
  const settled = useRef(false);
  const shown = useRef(0);
  const [value, setValue] = useState(() => {
    const start = canAnimate(reduced, target, id) ? 0 : target;
    shown.current = start;
    return start;
  });

  useEffect(() => {
    const element = ref.current;
    if (settled.current || !element || !canAnimate(reduced, target, id)) {
      settled.current = true;
      shown.current = target;
      setValue(target);
      return;
    }
    let frame = 0;
    let observer: IntersectionObserver | null = null;
    const from = shown.current;
    const run = () => {
      const startedAt = performance.now();
      const tick = (now: number) => {
        const progress = Math.min(1, (now - startedAt) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        const next = Math.round(from + (target - from) * eased);
        shown.current = next;
        setValue(next);
        if (progress < 1) {
          frame = requestAnimationFrame(tick);
        } else {
          settled.current = true;
          if (id) played.add(id);
        }
      };
      frame = requestAnimationFrame(tick);
    };
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer?.disconnect();
        run();
      }
    });
    observer.observe(element);
    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [target, reduced, id, duration]);

  return { value, ref };
}
