import { useCallback, useEffect, useRef, useState } from "react";
import { categoryHasLive, nextRotationCategoryId } from "./selectors";
import type { PublicSnapshot } from "./types";

/** Tempo de cada categoria no rodízio do modo telão quando nenhuma tem luta ao vivo. */
export const ROTATION_MS = 20_000;
/** Sem mexer o mouse/tocar por este tempo, o cursor some no modo telão. */
export const CURSOR_IDLE_MS = 3_000;

/**
 * Mantém a tela acesa (Screen Wake Lock). Tudo em try/catch: sem suporte ou negado = segue sem. O navegador solta o
 * bloqueio quando a aba some; ao voltar a ficar visível, pede de novo. Libera ao desmontar.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async (): Promise<void> => {
      try {
        if (typeof navigator === "undefined" || !("wakeLock" in navigator) || !navigator.wakeLock) return;
        if (document.visibilityState !== "visible") return;
        if (sentinel && !sentinel.released) return;
        const next = await navigator.wakeLock.request("screen");
        if (cancelled) {
          void next.release().catch(() => undefined);
          return;
        }
        sentinel = next;
      } catch {
        /* sem suporte, bateria baixa ou negado: o telão funciona igual */
      }
    };
    const onVisible = (): void => {
      if (document.visibilityState === "visible") void acquire();
    };
    document.addEventListener("visibilitychange", onVisible);
    void acquire();
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      try {
        void sentinel?.release().catch(() => undefined);
      } catch {
        /* nada a fazer */
      }
      sentinel = null;
    };
  }, [enabled]);
}

export interface FullscreenControl {
  supported: boolean;
  active: boolean;
  toggle: () => void;
}

/** Tela cheia da página (Fullscreen API) com try/catch; `active` acompanha o evento do navegador (ex.: tecla Esc). */
export function useFullscreen(): FullscreenControl {
  const supported = typeof document !== "undefined" && typeof document.documentElement.requestFullscreen === "function";
  const [active, setActive] = useState<boolean>(() => typeof document !== "undefined" && document.fullscreenElement != null);
  useEffect(() => {
    const onChange = (): void => setActive(document.fullscreenElement != null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);
  const toggle = useCallback((): void => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
      else void document.documentElement.requestFullscreen().catch(() => undefined);
    } catch {
      /* o navegador recusou: nada a fazer */
    }
  }, []);
  return { supported, active, toggle };
}

/** true depois de `ms` sem atividade do usuário (mouse, toque, teclado). Desligado = sempre false. */
export function useIdle(ms: number, enabled: boolean): boolean {
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setIdle(false);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => setIdle(true), ms);
    };
    const onActivity = (): void => {
      setIdle(false);
      arm();
    };
    const events = ["pointermove", "pointerdown", "keydown", "touchstart", "wheel"] as const;
    for (const name of events) window.addEventListener(name, onActivity, { passive: true });
    arm();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      for (const name of events) window.removeEventListener(name, onActivity);
    };
  }, [ms, enabled]);
  return idle;
}

export interface TvRotationOptions {
  /** Só liga no modo telão (`?tv=1`). */
  enabled: boolean;
  /** O usuário tocou numa aba: o rodízio para até ele mandar retomar. */
  paused: boolean;
  snapshot: PublicSnapshot | null;
  currentId: number | null;
  /** Sobe a cada snapshot aceito. */
  seq: number;
  /** Categorias onde uma luta acabou de ficar AO VIVO neste snapshot. */
  startedCategoryIds: readonly number[];
  onSelect: (categoryId: number) => void;
  intervalMs?: number;
}

/**
 * Rodízio automático das categorias no modo telão: troca a cada 20 s (só entre as que têm luta ao vivo, se houver) e salta
 * na hora para a categoria onde uma luta acabou de começar quando a atual não tem nenhuma ao vivo.
 */
export function useTvRotation({ enabled, paused, snapshot, currentId, seq, startedCategoryIds, onSelect, intervalMs = ROTATION_MS }: TvRotationOptions): void {
  const latest = useRef({ snapshot, currentId, started: startedCategoryIds });
  useEffect(() => {
    latest.current = { snapshot, currentId, started: startedCategoryIds };
  });

  useEffect(() => {
    if (!enabled || paused) return;
    const timer = setInterval(() => {
      const { snapshot: s, currentId: current } = latest.current;
      if (!s) return;
      const next = nextRotationCategoryId(s, current);
      if (next !== null && next !== current) onSelect(next);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, paused, intervalMs, onSelect]);

  useEffect(() => {
    if (!enabled || paused || seq === 0) return;
    const { snapshot: s, currentId: current, started } = latest.current;
    if (!s || started.length === 0) return;
    const currentCategory = s.categories.find((c) => c.id === current);
    if (currentCategory && categoryHasLive(currentCategory)) return;
    const target = started[0]!;
    if (target !== current) onSelect(target);
    // Só reage a um snapshot novo (seq): os demais valores são lidos da ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);
}

/** Tempo de cada página quando uma lista (grupos, rodadas) não cabe de uma vez no telão. */
export const PAGE_MS = 10_000;

/** Página atual de uma lista paginada: gira a cada `ms` quando `enabled` e há mais de uma página; o timer é cancelado ao desmontar. */
export function useRotatingPage(count: number, enabled: boolean, ms = PAGE_MS): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled || count <= 1) return;
    const timer = setInterval(() => setTick((value) => value + 1), ms);
    return () => clearInterval(timer);
  }, [enabled, count, ms]);
  return count <= 1 ? 0 : tick % count;
}
