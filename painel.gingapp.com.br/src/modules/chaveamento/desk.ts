import type { OperatorCategory, OperatorMatch } from "./types";

/**
 * Mesa de controle: funções PURAS que olham todas as categorias em andamento e separam "AO VIVO agora" de "PRÓXIMAS".
 * Nada aqui chama a API nem inventa dado: tudo vem de `OperatorMatch` (status, tatame `mat`, ordem `queueOrder`).
 */

export interface DeskEntry {
  category: OperatorCategory;
  match: OperatorMatch;
}

/** `"all"` = todos os tatames; `"none"` = lutas sem tatame; número = aquele tatame. */
export type MatFilter = "all" | "none" | number;

/** Tatame de verdade (1..40). `null` e `0` significam "sem tatame". */
export const realMat = (mat: number | null): number | null => (mat === null || mat === 0 ? null : mat);

/** A luta é "de verdade" (não é folga) e tem os dois atletas. */
const playable = (m: OperatorMatch): boolean => !m.isBye && m.slotAId !== null && m.slotBId !== null;

const nullsLast = (n: number | null): number => (n === null ? Number.POSITIVE_INFINITY : n);
const stageRank = (m: OperatorMatch): number => (m.stage === "THIRD_PLACE" ? 1 : 0);

/** Ordem de chamada: `queueOrder` primeiro, depois tatame, depois categoria, rodada e posição. */
export function compareEntries(a: DeskEntry, b: DeskEntry): number {
  return (
    nullsLast(a.match.queueOrder) - nullsLast(b.match.queueOrder) ||
    nullsLast(realMat(a.match.mat)) - nullsLast(realMat(b.match.mat)) ||
    a.category.position - b.category.position ||
    a.category.id - b.category.id ||
    stageRank(a.match) - stageRank(b.match) ||
    a.match.round - b.match.round ||
    a.match.position - b.match.position ||
    a.match.id - b.match.id
  );
}

export function matchesFilter(match: OperatorMatch, filter: MatFilter): boolean {
  if (filter === "all") return true;
  const mat = realMat(match.mat);
  return filter === "none" ? mat === null : mat === filter;
}

export interface DeskData {
  /** Lutas LIVE (filtradas pelo tatame), na ordem de chamada. */
  live: DeskEntry[];
  /** Lutas READY com os dois atletas (filtradas pelo tatame), na ordem de chamada. */
  next: DeskEntry[];
  /** Tatames que aparecem em alguma luta ainda por jogar (LIVE/READY), em ordem crescente. */
  mats: number[];
  /** Existe luta por jogar sem tatame? (habilita o filtro "Sem tatame") */
  hasNoMat: boolean;
}

export function collectDesk(categories: readonly OperatorCategory[], filter: MatFilter = "all"): DeskData {
  const open: DeskEntry[] = [];
  for (const category of categories) {
    if (category.status !== "RUNNING") continue;
    for (const match of category.matches) {
      if (playable(match) && (match.status === "LIVE" || match.status === "READY")) open.push({ category, match });
    }
  }
  open.sort(compareEntries);
  const mats = [...new Set(open.map((e) => realMat(e.match.mat)).filter((m): m is number => m !== null))].sort((a, b) => a - b);
  const shown = open.filter((e) => matchesFilter(e.match, filter));
  return {
    live: shown.filter((e) => e.match.status === "LIVE"),
    next: shown.filter((e) => e.match.status === "READY"),
    mats,
    hasNoMat: open.some((e) => realMat(e.match.mat) === null),
  };
}
