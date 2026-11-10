import {
  CATEGORY_STATUSES,
  MATCH_STAGES,
  MATCH_STATUSES,
  RESULT_TYPES,
  TOURNAMENT_FORMATS,
  type PodiumEntry,
  type PublicCategory,
  type PublicCompetitor,
  type PublicEvent,
  type PublicMatch,
  type PublicSnapshot,
  type Slot,
  type StandingRow,
  type StandingsGroup,
} from "./types";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const asInt = (value: unknown): number | null => (typeof value === "number" && Number.isSafeInteger(value) ? value : null);

const asNonNegInt = (value: unknown): number => {
  const n = asInt(value);
  return n !== null && n >= 0 ? n : 0;
};

const asBool = (value: unknown): boolean => value === true;

/** Texto público opcional: string não vazia (após aparar) ou null. */
const asText = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" ? null : text;
};

const asEnum = <T extends string>(list: readonly T[], value: unknown): T | null =>
  typeof value === "string" && (list as readonly string[]).includes(value) ? (value as T) : null;

const UPLOAD_REF = /^\/api\/uploads\/[A-Za-z0-9._-]+$/;

/**
 * Referência de imagem: só caminho de upload do backend ou https/http. Qualquer outra coisa (javascript:, data:, relativo
 * estranho) vira null: o telão cai nas iniciais em vez de pedir um recurso suspeito.
 */
export function asImageRef(value: unknown): string | null {
  const text = asText(value);
  if (text === null) return null;
  if (UPLOAD_REF.test(text)) return text;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:" ? text : null;
  } catch {
    return null;
  }
}

function parseEvent(raw: unknown): PublicEvent | null {
  if (!isRecord(raw)) return null;
  const title = asText(raw["title"]);
  if (title === null) return null;
  return {
    title,
    date: typeof raw["date"] === "string" ? raw["date"] : "",
    location: asText(raw["location"]),
    imageUrl: asImageRef(raw["imageUrl"]),
  };
}

function parseCompetitor(raw: unknown): PublicCompetitor | null {
  if (!isRecord(raw)) return null;
  const id = asInt(raw["id"]);
  if (id === null) return null;
  return {
    id,
    name: asText(raw["name"]) ?? "Atleta",
    group: asText(raw["group"]),
    graduation: asText(raw["graduation"]),
    photoUrl: asImageRef(raw["photoUrl"]),
    seed: asInt(raw["seed"]),
    poolIndex: asInt(raw["poolIndex"]),
  };
}

function parseMat(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return asText(value);
}

function parseMatch(raw: unknown): PublicMatch | null {
  if (!isRecord(raw)) return null;
  const id = asInt(raw["id"]);
  const stage = asEnum(MATCH_STAGES, raw["stage"]);
  const status = asEnum(MATCH_STATUSES, raw["status"]);
  const round = asInt(raw["round"]);
  const position = asInt(raw["position"]);
  if (id === null || stage === null || status === null || round === null || position === null) return null;
  const nextSlot = raw["nextSlot"] === "A" || raw["nextSlot"] === "B" ? (raw["nextSlot"] as Slot) : null;
  return {
    id,
    key: typeof raw["key"] === "string" ? raw["key"] : `${stage}-${round}-${position}`,
    stage,
    round,
    position,
    groupIndex: asInt(raw["groupIndex"]),
    slotAId: asInt(raw["slotAId"]),
    slotBId: asInt(raw["slotBId"]),
    nextMatchId: asInt(raw["nextMatchId"]),
    nextSlot,
    isBye: asBool(raw["isBye"]),
    status,
    winnerId: asInt(raw["winnerId"]),
    scoreA: asInt(raw["scoreA"]),
    scoreB: asInt(raw["scoreB"]),
    resultType: asEnum(RESULT_TYPES, raw["resultType"]),
    mat: parseMat(raw["mat"]),
    queueOrder: asInt(raw["queueOrder"]),
  };
}

function parseRow(raw: unknown): StandingRow | null {
  if (!isRecord(raw)) return null;
  const competitorId = asInt(raw["competitorId"]);
  if (competitorId === null) return null;
  return {
    competitorId,
    played: asNonNegInt(raw["played"]),
    wins: asNonNegInt(raw["wins"]),
    draws: asNonNegInt(raw["draws"]),
    losses: asNonNegInt(raw["losses"]),
    pointsFor: asNonNegInt(raw["pointsFor"]),
    pointsAgainst: asNonNegInt(raw["pointsAgainst"]),
    points: asNonNegInt(raw["points"]),
    rank: asNonNegInt(raw["rank"]),
  };
}

function parseStandings(raw: unknown): StandingsGroup[] {
  const groups: StandingsGroup[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!isRecord(item)) continue;
    const groupIndex = asInt(item["groupIndex"]);
    if (groupIndex === null) continue;
    const rows: StandingRow[] = [];
    for (const r of Array.isArray(item["rows"]) ? item["rows"] : []) {
      const row = parseRow(r);
      if (row) rows.push(row);
    }
    groups.push({ groupIndex, rows });
  }
  return groups;
}

function parsePodium(raw: unknown): PodiumEntry[] {
  const list: PodiumEntry[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!isRecord(item)) continue;
    const place = item["place"];
    const competitorId = asInt(item["competitorId"]);
    if ((place === 1 || place === 2 || place === 3) && competitorId !== null) list.push({ place, competitorId });
  }
  return list.sort((a, b) => a.place - b.place);
}

function parseCategory(raw: unknown): PublicCategory | null {
  if (!isRecord(raw)) return null;
  const id = asInt(raw["id"]);
  const format = asEnum(TOURNAMENT_FORMATS, raw["format"]);
  const status = asEnum(CATEGORY_STATUSES, raw["status"]);
  const name = asText(raw["name"]);
  // Formato desconhecido (fase 2) ou categoria quebrada: fica de fora em vez de ser desenhada errado.
  if (id === null || format === null || status === null || name === null) return null;
  const competitors: PublicCompetitor[] = [];
  const seenCompetitors = new Set<number>();
  for (const c of Array.isArray(raw["competitors"]) ? raw["competitors"] : []) {
    const parsed = parseCompetitor(c);
    if (parsed && !seenCompetitors.has(parsed.id)) {
      seenCompetitors.add(parsed.id);
      competitors.push(parsed);
    }
  }
  const matches: PublicMatch[] = [];
  const seenMatches = new Set<number>();
  for (const m of Array.isArray(raw["matches"]) ? raw["matches"] : []) {
    const parsed = parseMatch(m);
    if (parsed && !seenMatches.has(parsed.id)) {
      seenMatches.add(parsed.id);
      matches.push(parsed);
    }
  }
  return {
    id,
    name,
    format,
    status,
    thirdPlace: asBool(raw["thirdPlace"]),
    competitors,
    matches,
    standings: parseStandings(raw["standings"]),
    podium: parsePodium(raw["podium"]),
  };
}

/**
 * Valida o corpo do snapshot público (GET e evento SSE `snapshot` têm o MESMO formato). Lê SOMENTE as chaves do contrato:
 * qualquer chave extra é descartada, nunca renderizada. null = o corpo não é um snapshot (a conexão ignora e segue).
 */
export function parsePublicSnapshot(raw: unknown): PublicSnapshot | null {
  if (!isRecord(raw)) return null;
  const revision = asInt(raw["revision"]);
  const event = parseEvent(raw["event"]);
  if (revision === null || revision < 0 || event === null) return null;
  const categories: PublicCategory[] = [];
  const seen = new Set<number>();
  for (const c of Array.isArray(raw["categories"]) ? raw["categories"] : []) {
    const parsed = parseCategory(c);
    if (parsed && !seen.has(parsed.id)) {
      seen.add(parsed.id);
      categories.push(parsed);
    }
  }
  return {
    revision,
    serverTime: typeof raw["serverTime"] === "string" ? raw["serverTime"] : "",
    event,
    organizationName: asText(raw["organizationName"]) ?? "",
    categories,
  };
}
