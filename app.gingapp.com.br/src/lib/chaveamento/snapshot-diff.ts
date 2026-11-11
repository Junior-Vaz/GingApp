import { matchStageLabel } from "./describe";
import type { PublicCompetitor, PublicMatch, PublicSnapshot, ResultType, Slot } from "./types";

/** Uma luta que virou FINISHED entre dois snapshots (insumo da animação do vencedor e do anúncio para leitor de tela). */
export interface FinishedMatchEvent {
  categoryId: number;
  categoryName: string;
  matchId: number;
  key: string;
  stage: PublicMatch["stage"];
  round: number;
  slotAId: number | null;
  slotBId: number | null;
  nameA: string | null;
  nameB: string | null;
  /** null = empate (só em fase de grupos). */
  winnerId: number | null;
  winnerName: string | null;
  /** Luta seguinte (só no mata-mata). */
  nextMatchId: number | null;
  nextSlot: Slot | null;
  /** Atleta que "corre" pela linha até a próxima luta: o vencedor, quando existe luta seguinte; senão null. */
  advancedCompetitorId: number | null;
  scoreA: number | null;
  scoreB: number | null;
  resultType: ResultType | null;
}

/** Uma luta que virou LIVE. */
export interface StartedMatchEvent {
  categoryId: number;
  matchId: number;
  mat: string | null;
}

/** Uma luta que virou LIVE, com tudo o que a abertura "VS" do telão precisa (só campos do snapshot público). */
export interface IntroEvent {
  categoryId: number;
  categoryName: string;
  matchId: number;
  key: string;
  stage: PublicMatch["stage"];
  round: number;
  /** "Final", "Semifinais", "Grupo A · Rodada 2"... */
  stageLabel: string;
  mat: string | null;
  a: PublicCompetitor | null;
  b: PublicCompetitor | null;
}

export interface SnapshotDiff {
  /** Primeiro snapshot recebido: NUNCA anima nem anuncia (a tela só aparece). */
  initial: boolean;
  /** Revisão mais antiga que a já exibida: ignorada por inteiro. */
  stale: boolean;
  finished: FinishedMatchEvent[];
  started: StartedMatchEvent[];
  /** As mesmas lutas de `started`, com atletas e nome da rodada (abertura "VS"); luta de folga nunca entra. */
  intros: IntroEvent[];
  /** Categorias que passaram a FINISHED agora (confete do pódio). */
  categoriesFinished: number[];
}

const EMPTY: Omit<SnapshotDiff, "initial" | "stale"> = { finished: [], started: [], intros: [], categoriesFinished: [] };

/**
 * Compara o snapshot anterior com o novo (função pura). Regras:
 * - sem anterior (primeiro snapshot): nada anima;
 * - revisão menor que a anterior: `stale`, nada anima (o chamador também descarta o snapshot);
 * - luta de folga (`isBye`) nunca anima nem é anunciada;
 * - só conta luta que JÁ existia antes e mudou de estado (luta nova que nasce pronta não é "um resultado").
 */
export function diffSnapshots(prev: PublicSnapshot | null, next: PublicSnapshot): SnapshotDiff {
  if (prev === null) return { initial: true, stale: false, ...EMPTY };
  if (next.revision < prev.revision) return { initial: false, stale: true, ...EMPTY };

  const finished: FinishedMatchEvent[] = [];
  const started: StartedMatchEvent[] = [];
  const intros: IntroEvent[] = [];
  const categoriesFinished: number[] = [];

  const prevCategories = new Map(prev.categories.map((c) => [c.id, c]));
  for (const category of next.categories) {
    const before = prevCategories.get(category.id);
    if (!before) continue;
    if (before.status !== "FINISHED" && category.status === "FINISHED") categoriesFinished.push(category.id);

    const prevMatches = new Map(before.matches.map((m) => [m.id, m]));
    const names = new Map(category.competitors.map((c) => [c.id, c.name]));
    const byId = new Map(category.competitors.map((c) => [c.id, c]));
    const lastMainRound = category.matches.reduce((max, m) => (m.stage === "MAIN" ? Math.max(max, m.round) : max), 1);
    const nameOf = (id: number | null): string | null => (id === null ? null : (names.get(id) ?? null));

    for (const match of category.matches) {
      if (match.isBye) continue;
      const old = prevMatches.get(match.id);
      if (!old || old.isBye) continue;
      if (match.status === "FINISHED" && old.status !== "FINISHED") {
        finished.push({
          categoryId: category.id,
          categoryName: category.name,
          matchId: match.id,
          key: match.key,
          stage: match.stage,
          round: match.round,
          slotAId: match.slotAId,
          slotBId: match.slotBId,
          nameA: nameOf(match.slotAId),
          nameB: nameOf(match.slotBId),
          winnerId: match.winnerId,
          winnerName: nameOf(match.winnerId),
          nextMatchId: match.nextMatchId,
          nextSlot: match.nextSlot,
          advancedCompetitorId: match.winnerId !== null && match.nextMatchId !== null ? match.winnerId : null,
          scoreA: match.scoreA,
          scoreB: match.scoreB,
          resultType: match.resultType,
        });
      } else if (match.status === "LIVE" && old.status !== "LIVE") {
        started.push({ categoryId: category.id, matchId: match.id, mat: match.mat });
        intros.push({
          categoryId: category.id,
          categoryName: category.name,
          matchId: match.id,
          key: match.key,
          stage: match.stage,
          round: match.round,
          stageLabel: matchStageLabel(match, lastMainRound),
          mat: match.mat,
          a: match.slotAId === null ? null : (byId.get(match.slotAId) ?? null),
          b: match.slotBId === null ? null : (byId.get(match.slotBId) ?? null),
        });
      }
    }
  }
  return { initial: false, stale: false, finished, started, intros, categoriesFinished };
}

/** Frase para o leitor de tela: "Adulto até 70 kg: luta Atleta 1 contra Atleta 3 terminou. Atleta 1 venceu." */
export function describeFinished(event: FinishedMatchEvent): string {
  const a = event.nameA ?? "atleta a definir";
  const b = event.nameB ?? "atleta a definir";
  const tail =
    event.winnerName !== null
      ? `${event.winnerName} venceu.`
      : event.resultType === "DRAW"
        ? "Terminou empatada."
        : "Resultado registrado.";
  return `${event.categoryName}: luta ${a} contra ${b} terminou. ${tail}`;
}

/** Texto do aria-live: só mudanças (primeiro snapshot e revisão antiga geram texto vazio). */
export function announcementFor(diff: SnapshotDiff | null): string {
  if (!diff || diff.initial || diff.stale || diff.finished.length === 0) return "";
  return diff.finished.map(describeFinished).join(" ");
}
