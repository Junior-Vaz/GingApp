import { useCallback, useState } from "react";

export type StudentsView = "cards" | "table";

/** Chave do localStorage com a escolha "Cards | Tabela" da tela de Alunos. */
export const STUDENTS_VIEW_KEY = "painel:alunos:view";

/** Lê a escolha salva (padrão: cards). localStorage pode estar bloqueado/indisponível: nunca lança. */
export function readStudentsView(): StudentsView {
  try {
    return localStorage.getItem(STUDENTS_VIEW_KEY) === "table" ? "table" : "cards";
  } catch {
    return "cards";
  }
}

/** Modo de visualização da lista de alunos, lembrado em localStorage (com try/catch). */
export function useStudentsView(): [StudentsView, (view: StudentsView) => void] {
  const [view, setViewState] = useState<StudentsView>(readStudentsView);
  const setView = useCallback((next: StudentsView) => {
    setViewState(next);
    try {
      localStorage.setItem(STUDENTS_VIEW_KEY, next);
    } catch {
      // armazenamento indisponível: a escolha vale só nesta sessão da página
    }
  }, []);
  return [view, setView];
}
