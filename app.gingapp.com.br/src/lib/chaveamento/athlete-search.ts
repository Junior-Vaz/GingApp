import { matchStageLabel } from "./describe";
import { competitorsById, lastMainRound } from "./selectors";
import type { PublicCategory, PublicCompetitor, PublicMatch, PublicSnapshot } from "./types";

/** Texto de busca: só texto, no máximo 60 caracteres (vem do campo, do `?q=` da URL ou da sessão; nunca vira HTML). */
export const MAX_QUERY_LENGTH = 60;

// Controles C0/C1, DEL, espaços de largura zero, marcas/sobreposições bidirecionais e < > (não existem em nome de atleta).
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u{0}-\u{1f}\u{7f}-\u{9f}\u{200b}-\u{200f}\u{202a}-\u{202e}\u{2066}-\u{2069}\u{feff}<>]/gu;

/** Limpa um texto vindo de fora (campo, URL, sessão): só texto, espaços colapsados, até 60 caracteres. Qualquer outro tipo = "". */
export function sanitizeQuery(raw: unknown): string {
  let text: string;
  if (typeof raw === "string") text = raw;
  else if (typeof raw === "number" && Number.isFinite(raw)) text = String(raw);
  else return "";
  const cleaned = text.replace(UNSAFE, " ").replace(/\s+/g, " ").trim();
  return Array.from(cleaned).slice(0, MAX_QUERY_LENGTH).join("").trim();
}

/** Menos que isto não busca (uma letra casaria com todo mundo). */
export const MIN_QUERY_LENGTH = 2;
/** Única coisa que o telão guarda na sessão do navegador: o TEXTO digitado na busca (nenhum dado de atleta). */
export const SEARCH_STORAGE_KEY = "gingapp:ao-vivo:busca";

/** Minúsculas sem acento (busca "joao" acha "João"). */
export function normalizeText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ").trim();
}

export type AthleteState = "live" | "next" | "waiting" | "none";

export interface AthleteHit {
  categoryId: number;
  categoryName: string;
  competitor: PublicCompetitor;
  /** Luta que ele disputa AGORA (ao vivo) ou a próxima já pronta; null nos demais casos. */
  match: PublicMatch | null;
  state: AthleteState;
  /** Luta para onde a tela rola: a ao vivo, a próxima, a que aguarda a anterior ou a última disputada; null = nenhuma luta. */
  targetMatchId: number | null;
  stageLabel: string | null;
  opponent: PublicCompetitor | null;
}

const realMatches = (category: PublicCategory, competitorId: number): PublicMatch[] =>
  category.matches.filter((m) => !m.isBye && (m.slotAId === competitorId || m.slotBId === competitorId));

function describeAthlete(category: PublicCategory, competitor: PublicCompetitor, byId: ReadonlyMap<number, PublicCompetitor>): AthleteHit {
  const mine = realMatches(category, competitor.id);
  const last = lastMainRound(category);
  const live = mine.find((m) => m.status === "LIVE");
  const ready = mine.filter((m) => m.status === "READY").sort((a, b) => (a.queueOrder ?? Number.MAX_SAFE_INTEGER) - (b.queueOrder ?? Number.MAX_SAFE_INTEGER) || a.round - b.round)[0];
  const pending = mine.filter((m) => m.status === "PENDING").sort((a, b) => a.round - b.round)[0];
  const finished = mine.filter((m) => m.status === "FINISHED").sort((a, b) => b.round - a.round || b.id - a.id)[0];
  const opponentOf = (m: PublicMatch | undefined): PublicCompetitor | null => {
    if (!m) return null;
    const otherId = m.slotAId === competitor.id ? m.slotBId : m.slotAId;
    return otherId === null ? null : (byId.get(otherId) ?? null);
  };
  const pick = (m: PublicMatch, state: AthleteState): AthleteHit => ({
    categoryId: category.id,
    categoryName: category.name,
    competitor,
    match: state === "live" || state === "next" ? m : null,
    state,
    targetMatchId: m.id,
    stageLabel: matchStageLabel(m, last),
    opponent: opponentOf(m),
  });
  if (live) return pick(live, "live");
  if (ready) return pick(ready, "next");
  if (pending) return pick(pending, "waiting");
  if (finished) return pick(finished, "none");
  return { categoryId: category.id, categoryName: category.name, competitor, match: null, state: "none", targetMatchId: null, stageLabel: null, opponent: null };
}

/**
 * Atletas (ou grupos) que casam com o texto: todas as palavras precisam aparecer no nome ou no grupo (sem acento, sem
 * diferença de caixa). Quem começa pelo texto vem antes. Só lê o snapshot PÚBLICO; nada é guardado.
 */
export function searchAthletes(snapshot: PublicSnapshot, query: string, limit = 8): AthleteHit[] {
  const clean = normalizeText(sanitizeQuery(query));
  if (Array.from(clean).length < MIN_QUERY_LENGTH) return [];
  const tokens = clean.split(" ");
  const found: Array<{ hit: AthleteHit; rank: number; order: number }> = [];
  let order = 0;
  for (const category of snapshot.categories) {
    const byId = competitorsById(category);
    for (const competitor of category.competitors) {
      const name = normalizeText(competitor.name);
      const group = normalizeText(competitor.group ?? "");
      const haystack = `${name} ${group}`;
      if (!tokens.every((token) => haystack.includes(token))) continue;
      const rank = name.startsWith(tokens[0]!) ? 0 : tokens.every((token) => name.includes(token)) ? 1 : 2;
      found.push({ hit: describeAthlete(category, competitor, byId), rank, order: order++ });
    }
  }
  found.sort((a, b) => a.rank - b.rank || a.order - b.order);
  return found.slice(0, limit).map((item) => item.hit);
}

/** Texto curto do estado do atleta (a informação nunca depende só de cor). */
export function athleteStateLabel(hit: AthleteHit): string {
  if (hit.state === "live") return "Luta ao vivo agora";
  if (hit.state === "next") return "Próxima luta definida";
  if (hit.state === "waiting") return "Aguardando a luta anterior";
  return "Sem luta pendente";
}

/** Caminho do atleta na chave: todas as lutas em que ele aparece num dos lados (da 1ª rodada até onde chegou). */
export function athletePathMatchIds(matches: readonly Pick<PublicMatch, "id" | "slotAId" | "slotBId">[], competitorId: number): Set<number> {
  const ids = new Set<number>();
  for (const match of matches) if (match.slotAId === competitorId || match.slotBId === competitorId) ids.add(match.id);
  return ids;
}
