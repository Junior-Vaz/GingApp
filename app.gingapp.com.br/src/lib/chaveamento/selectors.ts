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
    for (const match of category.matches) {
      if (match.isBye) continue;
      const entry: QueueEntry = {
        categoryId: category.id,
        categoryName: category.name,
        match,
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
