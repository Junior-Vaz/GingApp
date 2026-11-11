import { useEffect, useState } from "react";
import { advanceIntro, EMPTY_INTRO, enqueueIntros, INTRO_MS, type IntroState } from "./intro-queue";
import type { IntroEvent, SnapshotDiff } from "./snapshot-diff";

/** Tempo da tela de campeão antes de assentar no pódio permanente. */
export const CHAMPION_MS = 12_000;

const isFresh = (diff: SnapshotDiff | null): diff is SnapshotDiff => diff !== null && !diff.initial && !diff.stale;

/**
 * Abertura "VS" do telão: devolve a luta que está na tela agora (ou null). Só nasce de uma DIFERENÇA entre snapshots (o
 * primeiro snapshot nunca abre nada), dura `INTRO_MS`, e segue a fila de `intro-queue` (a mais recente vence). O timer é
 * cancelado ao desmontar.
 */
export function useIntroQueue({ diff, seq, enabled }: { diff: SnapshotDiff | null; seq: number; enabled: boolean }): IntroEvent | null {
  const [state, setState] = useState<IntroState>(EMPTY_INTRO);

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY_INTRO);
      return;
    }
    if (!isFresh(diff) || diff.intros.length === 0) return;
    const incoming = diff.intros;
    setState((previous) => enqueueIntros(previous, incoming));
    // Só um snapshot novo (seq) dispara; `diff` muda junto com `seq`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, enabled]);

  const current = state.current;
  useEffect(() => {
    if (current === null) return;
    const timer = setTimeout(() => setState(advanceIntro), INTRO_MS);
    return () => clearTimeout(timer);
  }, [current]);

  return current;
}

export interface Celebration {
  categoryId: number;
  /** Snapshot (seq) que encerrou a categoria: chave para reiniciar as animações. */
  seq: number;
}

/**
 * Comemoração de uma categoria que PASSOU a FINISHED entre dois snapshots (nunca na primeira carga): fica ativa por
 * `CHAMPION_MS` e some. Várias de uma vez: vale a última. O timer é cancelado ao desmontar.
 */
export function useCelebration({ diff, seq }: { diff: SnapshotDiff | null; seq: number }): Celebration | null {
  const [active, setActive] = useState<Celebration | null>(null);

  useEffect(() => {
    if (!isFresh(diff) || diff.categoriesFinished.length === 0) return;
    setActive({ categoryId: diff.categoriesFinished[diff.categoriesFinished.length - 1]!, seq });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq]);

  useEffect(() => {
    if (active === null) return;
    const timer = setTimeout(() => setActive(null), CHAMPION_MS);
    return () => clearTimeout(timer);
  }, [active]);

  return active;
}
