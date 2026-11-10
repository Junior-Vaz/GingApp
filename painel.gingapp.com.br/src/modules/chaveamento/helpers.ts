import { appOrigin } from "@/lib/format";
import { isUploadPath } from "@/lib/uploads";
import { MATCH_STATUS_LABEL, RESULT_TYPE_LABEL, type OperatorCategory, type OperatorCompetitor, type OperatorMatch } from "./types";

export type CompetitorMap = ReadonlyMap<number, OperatorCompetitor>;

export const competitorMap = (category: Pick<OperatorCategory, "competitors">): CompetitorMap =>
  new Map(category.competitors.map((c) => [c.id, c]));

/** Nome do atleta do lado da luta (`null` = lugar vazio). */
export function sideName(map: CompetitorMap, id: number | null): string | null {
  return id === null ? null : (map.get(id)?.displayName ?? "Atleta");
}

export const EMPTY_SLOT = "A definir";
export const BYE_LABEL = "Folga";

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, Math.max(max - 1, 1)).trimEnd()}…`;
}

/** "Grupo A", "Grupo B"… (índice 0-based do backend). */
export const groupLabel = (index: number): string =>
  `Grupo ${index < 26 ? String.fromCharCode(65 + index) : String(index + 1)}`;

/** Rótulo curto da luta para leitores de tela e cabeçalhos. */
export function matchTitle(match: OperatorMatch, map: CompetitorMap): string {
  const a = sideName(map, match.slotAId) ?? (match.isBye ? BYE_LABEL : EMPTY_SLOT);
  const b = sideName(map, match.slotBId) ?? (match.isBye ? BYE_LABEL : EMPTY_SLOT);
  return `${a} contra ${b}`;
}

export function stageLabel(match: OperatorMatch, lastMainRound?: number): string {
  if (match.stage === "THIRD_PLACE") return "Disputa de 3º lugar";
  if (match.stage === "GROUP") return `Rodada ${String(match.round)}`;
  if (lastMainRound === undefined) return `Mata-mata, rodada ${String(match.round)}`;
  const fromEnd = lastMainRound - match.round;
  return ["Final", "Semifinal", "Quartas de final", "Oitavas de final"][fromEnd] ?? `Rodada ${String(match.round)}`;
}

/** Texto de status que NÃO depende só de cor (cor + texto). */
export function statusText(match: OperatorMatch): string {
  if (match.isBye) return "Folga";
  const base = MATCH_STATUS_LABEL[match.status];
  if (match.status === "FINISHED" && match.resultType && match.resultType !== "NORMAL") {
    return `${base} (${RESULT_TYPE_LABEL[match.resultType]})`;
  }
  return base;
}

export function scoreText(match: OperatorMatch): string | null {
  if (match.scoreA === null && match.scoreB === null) return null;
  return `${String(match.scoreA ?? 0)} x ${String(match.scoreB ?? 0)}`;
}

export const matLabel = (mat: number | null): string | null => (mat === null ? null : mat === 0 ? "Sem tatame" : `Tatame ${String(mat)}`);

/** Alguma luta de verdade (não folga) já começou ou terminou? */
export const hasPlayedMatches = (category: Pick<OperatorCategory, "matches">): boolean =>
  category.matches.some((m) => !m.isBye && (m.status === "LIVE" || m.status === "FINISHED"));

/** A troca de atletas só vale em eliminatória simples gerada e sem nenhuma luta começada (backend: SWAP_NOT_ALLOWED). */
export const canSwapSlots = (category: OperatorCategory): boolean =>
  category.format === "SINGLE_ELIMINATION" &&
  category.status === "RUNNING" &&
  category.matches.length > 0 &&
  !hasPlayedMatches(category);

/** Luta cujos dois lugares podem participar de uma troca (1ª rodada, com dois atletas). */
export function isSwappableMatch(match: OperatorMatch, firstRound: number): boolean {
  return match.stage === "MAIN" && match.round === firstRound && !match.isBye && match.slotAId !== null && match.slotBId !== null;
}

export const firstMainRound = (matches: readonly OperatorMatch[]): number =>
  matches.filter((m) => m.stage === "MAIN").reduce((min, m) => Math.min(min, m.round), Number.POSITIVE_INFINITY);

export const lastMainRound = (matches: readonly OperatorMatch[]): number =>
  matches.filter((m) => m.stage === "MAIN").reduce((max, m) => Math.max(max, m.round), 0);

/** Foto: só menor/desconhecido precisa de autorização do responsável. */
export const needsPhotoAuthorization = (c: Pick<OperatorCompetitor, "ageGroup">): boolean => c.ageGroup !== "ADULT";

/** Texto do indicador "foto no telão" (regra decidida pelo servidor: `photoPublic`). */
export const photoIndicatorText = (c: Pick<OperatorCompetitor, "photoPublic">): string =>
  `Foto no telão: ${c.photoPublic ? "sim" : "não"}`;

/**
 * Foto aceita (mesma regra do backend): caminho de upload do GingApp ou `https://`. Qualquer outra coisa
 * (`javascript:`, `data:`, `http:`) NUNCA vai para um `<img src>`.
 */
export function isAcceptablePhotoUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  if (isUploadPath(value)) return true;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

/** Endereço público do telão (`?tv=1` liga o modo telão). */
export const liveUrl = (token: string, tv = false): string => `${appOrigin()}/ao-vivo/${token}${tv ? "?tv=1" : ""}`;

export const chaveamentoHref = (eventId: number): string => `/eventos/${String(eventId)}/chaveamento`;

/** Texto vazio = sem valor (`null`); senão inteiro dentro dos limites. `undefined` = inválido. */
export function parseOptionalInt(text: string, min: number, max: number): number | null | undefined {
  const value = text.trim();
  if (value === "") return null;
  if (!/^\d+$/.test(value)) return undefined;
  const n = Number(value);
  return n >= min && n <= max ? n : undefined;
}
