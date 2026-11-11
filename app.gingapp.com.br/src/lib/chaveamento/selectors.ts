import { matchStageLabel } from "./describe";
import type { PublicCategory, PublicCompetitor, PublicMatch, PublicSnapshot } from "./types";

/** Atletas da categoria por id. */
export const competitorsById = (category: PublicCategory): Map<number, PublicCompetitor> =>
  new Map(category.competitors.map((c) => [c.id, c]));

export const categoryHasLive = (category: PublicCategory): boolean => category.matches.some((m) => m.status === "LIVE");

/** A categoria já tem chave/grupos sorteados? (SETUP sem lutas = "Chave ainda não sorteada"). */
export const categoryHasMatches = (category: PublicCategory): boolean => category.matches.length > 0;

/** Categoria aberta ao carregar: a primeira com luta ao vivo; senão a primeira com lutas; senão a primeira. */
export function pickInitialCategoryId(snapshot: PublicSnapshot): number | null {
  const first = snapshot.categories.find(categoryHasLive) ?? snapshot.categories.find(categoryHasMatches) ?? snapshot.categories[0];
  return first ? first.id : null;
}

/**
 * Próxima categoria do rodízio do modo telão. Prioriza as categorias com luta AO VIVO (se houver, o rodízio gira só entre
 * elas); sem nenhuma ao vivo, gira entre as que já têm lutas (se nenhuma tem, entre todas). Devolve null sem categorias.
 */
export function nextRotationCategoryId(snapshot: PublicSnapshot, currentId: number | null): number | null {
  const all = snapshot.categories;
  if (all.length === 0) return null;
  const live = all.filter(categoryHasLive);
  const withMatches = all.filter(categoryHasMatches);
  const pool = live.length > 0 ? live : withMatches.length > 0 ? withMatches : all;
  const index = pool.findIndex((c) => c.id === currentId);
  if (index === -1) return pool[0]!.id;
  return pool[(index + 1) % pool.length]!.id;
}

/* ------------------------------------------------ agora / próximas ------------------------------------------------ */

export interface QueueEntry {
  categoryId: number;
  categoryName: string;
  match: PublicMatch;
  /** Fase da luta ("Final", "Semifinais", "Grupo A · Rodada 2"...). */
  stageLabel: string;
  a: PublicCompetitor | null;
  b: PublicCompetitor | null;
}

export interface NowPlaying {
  live: QueueEntry[];
  next: QueueEntry[];
}

const numericMat = (mat: string | null): number => {
  if (mat === null) return Number.MAX_SAFE_INTEGER;
  const n = Number.parseInt(mat, 10);
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER - 1;
};

const orderKey = (e: QueueEntry): [number, number, number, number] => [
  e.match.queueOrder ?? Number.MAX_SAFE_INTEGER,
  numericMat(e.match.mat),
  e.match.round,
  e.match.position,
];

function compareEntries(a: QueueEntry, b: QueueEntry): number {
  const ka = orderKey(a);
  const kb = orderKey(b);
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] !== kb[i]) return ka[i]! - kb[i]!;
  }
  return a.match.id - b.match.id;
}

/**
 * Lutas AO VIVO (todas as categorias: um tatame por luta) e PRÓXIMAS (READY com os dois atletas definidos, folga não conta).
 * Ordem das próximas: `queueOrder` (a ordem de chamada da equipe), depois tatame, rodada e posição.
 */
export function selectNowPlaying(snapshot: PublicSnapshot, nextLimit = 4): NowPlaying {
  const live: QueueEntry[] = [];
  const next: QueueEntry[] = [];
  for (const category of snapshot.categories) {
    const byId = competitorsById(category);
    const lastRound = lastMainRound(category);
    for (const match of category.matches) {
      if (match.isBye) continue;
      const entry: QueueEntry = {
        categoryId: category.id,
        categoryName: category.name,
        match,
        stageLabel: matchStageLabel(match, lastRound),
        a: match.slotAId === null ? null : (byId.get(match.slotAId) ?? null),
        b: match.slotBId === null ? null : (byId.get(match.slotBId) ?? null),
      };
      if (match.status === "LIVE") live.push(entry);
      else if (match.status === "READY" && entry.a && entry.b) next.push(entry);
    }
  }
  live.sort(compareEntries);
  next.sort(compareEntries);
  return { live, next: next.slice(0, nextLimit) };
}

/* ------------------------------------------------ pódio / rodada atual ------------------------------------------------ */

export interface PodiumView {
  champion: PublicCompetitor | null;
  second: PublicCompetitor | null;
  /** Um 3º lugar (com disputa) ou dois (sem disputa de 3º: os dois semifinalistas derrotados). */
  thirds: PublicCompetitor[];
}

/** Pódio da categoria já resolvido para atletas (entradas cujo atleta não existe na lista são ignoradas). */
export function selectPodium(category: PublicCategory): PodiumView {
  const byId = competitorsById(category);
  const at = (place: 1 | 2 | 3): PublicCompetitor[] =>
    category.podium
      .filter((p) => p.place === place)
      .map((p) => byId.get(p.competitorId))
      .filter((c): c is PublicCompetitor => c !== undefined);
  return { champion: at(1)[0] ?? null, second: at(2)[0] ?? null, thirds: at(3) };
}

/** Maior rodada do mata-mata (a final); 1 sem mata-mata. */
export const lastMainRound = (category: PublicCategory): number =>
  category.matches.reduce((max, m) => (m.stage === "MAIN" ? Math.max(max, m.round) : max), 1);

/**
 * Nome da fase em andamento para o cabeçalho ("Semifinais", "Final", "Grupo A · Rodada 2"): a luta AO VIVO mais adiantada;
 * sem nenhuma ao vivo, a próxima pronta; categoria encerrada = "Encerrada"; sem lutas = null.
 */
export function currentStageLabel(category: PublicCategory): string | null {
  if (category.status === "FINISHED") return "Encerrada";
  const last = lastMainRound(category);
  const real = category.matches.filter((m) => !m.isBye);
  const weight = (m: PublicMatch): number => (m.stage === "THIRD_PLACE" ? m.round - 0.5 : m.round);
  const pick = (status: PublicMatch["status"]): PublicMatch | undefined =>
    real.filter((m) => m.status === status).sort((a, b) => weight(b) - weight(a))[0];
  const live = pick("LIVE");
  if (live) return matchStageLabel(live, last);
  const ready = real.filter((m) => m.status === "READY").sort((a, b) => weight(a) - weight(b))[0];
  return ready ? matchStageLabel(ready, last) : null;
}

/** Ids das próximas lutas (ordem de chamada) da categoria, na posição da fila global: id da luta -> 1, 2, 3... */
export function nextQueueRanks(snapshot: PublicSnapshot, categoryId: number, limit = 3): Map<number, number> {
  const ranks = new Map<number, number>();
  selectNowPlaying(snapshot, limit).next.forEach((entry, index) => {
    if (entry.categoryId === categoryId) ranks.set(entry.match.id, index + 1);
  });
  return ranks;
}

/** Atletas classificados ao mata-mata (quem já está num slot do mata-mata); vazio enquanto o mata-mata não foi sorteado. */
export function qualifiedIds(category: PublicCategory): Set<number> {
  const ids = new Set<number>();
  if (category.format !== "GROUPS_KNOCKOUT") return ids;
  for (const m of category.matches) {
    if (m.stage !== "MAIN" || m.round !== 1) continue;
    if (m.slotAId !== null) ids.add(m.slotAId);
    if (m.slotBId !== null) ids.add(m.slotBId);
  }
  return ids;
}
