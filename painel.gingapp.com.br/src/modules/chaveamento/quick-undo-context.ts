import { createContext, useContext } from "react";

/** Janela do "desfazer rápido": depois disso o desfazer volta a pedir confirmação. */
export const QUICK_UNDO_MS = 10_000;

export interface QuickUndoEntry {
  /** Muda a cada resultado salvo (reinicia a animação da contagem e do pulso). */
  id: number;
  matchId: number;
  categoryId: number;
  /** Texto curto para a barra, ex.: "Ana venceu · Adulto até 70 kg". */
  label: string;
}

export interface QuickUndoApi {
  /** Resultado que ainda pode ser desfeito sem confirmação (ou `null`). */
  current: QuickUndoEntry | null;
  offer: (entry: Omit<QuickUndoEntry, "id">) => void;
  dismiss: () => void;
}

export const QuickUndoContext = createContext<QuickUndoApi>({ current: null, offer: () => undefined, dismiss: () => undefined });

export const useQuickUndo = (): QuickUndoApi => useContext(QuickUndoContext);
