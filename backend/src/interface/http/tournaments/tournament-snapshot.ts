import type {
  TournamentCategory,
  TournamentCompetitor,
  TournamentMatch,
} from '@prisma/client';
import { computePodium, computeStandings, MatchResult, PodiumMatch, StandingRow } from './engine';
import { AgeGroupValue, ageGroupFromBirthDates, ownPhotoPublicPath, photoVisibleOnPublic, publicPhotoRef } from './tournament-rules';

/**
 * Montagem das VISOES de uma categoria a partir de dados em memoria (sem banco): a visao do OPERADOR
 * (`GET /categories/:cid`) e o snapshot PUBLICO do telao (docs/CONTRATO_CHAVEAMENTO.md 5).
 *
 * PRIVACIDADE (5): o snapshot publico e montado CAMPO A CAMPO (lista branca explicita; nunca `...entidade`). Nunca entram:
 * studentId, eventParticipantId, ageGroup, photoAuthorized*, data de nascimento, e-mail, telefone, note, organizationId,
 * publicToken, dados de responsavel. A foto publica so existe se o atleta for ADULT ou tiver a foto autorizada; a foto do
 * aluno e derivada de Student.photo na leitura e a faixa etaria dele e RECALCULADA da data de nascimento. A foto PROPRIA do
 * atleta de fora (photoFile) sai como `/api/public/tournaments/<token>/photos/<arquivo>`, montada a cada snapshot a partir do
 * token; a coluna LEGADA photoUrl NAO e mais lida.
 */

/** O que se le do aluno ligado ao atleta (somente o necessario para foto e faixa etaria). */
export interface StudentInfo {
  photo: string | null;
  birthDate: Date | null;
  anonymizedAt: Date | null;
  person: { birthDate: Date | null } | null;
}

export interface CompetitorData {
  row: TournamentCompetitor;
  student: StudentInfo | null;
}

/** Luta como o telao a le: SEM `note`. O operador usa a linha inteira. */
export type PublicMatchRow = Omit<TournamentMatch, 'note'>;

export interface CategoryData<M extends PublicMatchRow = TournamentMatch> {
  category: TournamentCategory;
  competitors: CompetitorData[];
  matches: M[];
}

/** Nome mostrado no lugar de um atleta cujo aluno foi anonimizado (LGPD). */
export const ANONYMIZED_NAME = 'Atleta removido';

/** Faixa etaria efetiva: aluno = recalculada da(s) data(s) de nascimento; convidado = a informada pelo operador. */
export function effectiveAgeGroup(data: CompetitorData, now: Date): AgeGroupValue {
  if (data.student) {
    if (data.student.anonymizedAt) return 'UNKNOWN';
    return ageGroupFromBirthDates([data.student.person?.birthDate, data.student.birthDate], now);
  }
  return data.row.ageGroup;
}

/** Foto do ALUNO (Student.photo, derivada na leitura) de um atleta ligado a aluno; null para os demais (e aluno anonimizado). */
export function studentPhoto(data: CompetitorData): string | null {
  return data.student && !data.student.anonymizedAt ? data.student.photo : null;
}

/** O atleta tem foto PROPRIA (arquivo)? Atleta ligado a aluno nunca tem (a foto vem do cadastro do aluno). */
export function hasOwnPhoto(row: Pick<TournamentCompetitor, 'photoFile' | 'studentId'>): boolean {
  return row.studentId === null && !!row.photoFile;
}

/**
 * A REGRA da foto publica (uma so, usada pelo snapshot, pelo SSE e pela rota do arquivo): so ADULT ou autorizada, avaliada
 * AGORA (idade recalculada para aluno). `photoVisible` diz se a regra deixa; `publicPhotoFor` diz o que aparece.
 */
export function photoVisible(data: CompetitorData, now: Date): boolean {
  return photoVisibleOnPublic(effectiveAgeGroup(data, now), data.row.photoAuthorized);
}

/** A foto APARECE no telao publico agora? (a regra + existir foto utilizavel); mesma conta do `publicPhotoFor`, sem precisar do token. */
export function photoShownOnPublic(data: CompetitorData, now: Date): boolean {
  if (!photoVisible(data, now)) return false;
  if (data.student || data.row.studentId !== null) return publicPhotoRef(studentPhoto(data)) !== null;
  return !!data.row.photoFile;
}

/** Foto que o telao publico mostra (ou null): do aluno (/api/uploads/...) ou a PROPRIA (rota publica com o token). */
export function publicPhotoFor(data: CompetitorData, now: Date, token: string): string | null {
  if (!photoVisible(data, now)) return null;
  if (data.student || data.row.studentId !== null) return publicPhotoRef(studentPhoto(data));
  return data.row.photoFile ? ownPhotoPublicPath(token, data.row.photoFile) : null;
}

export function displayNameOf(data: CompetitorData): string {
  return data.student?.anonymizedAt ? ANONYMIZED_NAME : data.row.displayName;
}

// --------------------------------------------------------------------------------------------------------------
// Classificacao e podio (iguais para operador e telao)
// --------------------------------------------------------------------------------------------------------------

export interface StandingsGroup {
  groupIndex: number;
  rows: StandingRow[];
}

const seedOrder = (a: TournamentCompetitor, b: TournamentCompetitor): number =>
  (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER) || a.id - b.id;

/** Resultados (jogos de grupo terminados com os dois atletas) no formato do motor. */
export function groupResults(matches: readonly PublicMatchRow[], groupIndex: number | null): MatchResult[] {
  const results: MatchResult[] = [];
  for (const m of matches) {
    if (m.stage !== 'GROUP' || m.status !== 'FINISHED') continue;
    if (groupIndex !== null && (m.groupIndex ?? 0) !== groupIndex) continue;
    if (m.slotAId === null || m.slotBId === null) continue;
    results.push({
      slotA: m.slotAId,
      slotB: m.slotBId,
      winnerId: m.winnerId,
      scoreA: m.scoreA,
      scoreB: m.scoreB,
      resultType: m.resultType ?? 'NORMAL',
    });
  }
  return results;
}

/** Classificacao de um conjunto de atletas (ids na ordem de desempate final: semente, depois cadastro). */
export function standingsFor(
  competitors: readonly TournamentCompetitor[],
  matches: readonly PublicMatchRow[],
  groupIndex: number | null,
): StandingRow[] {
  const ordered = [...competitors].sort(seedOrder);
  const seedById = new Map<number, number | null>(ordered.map((c) => [c.id, c.seed]));
  return computeStandings(
    ordered.map((c) => c.id),
    groupResults(matches, groupIndex),
    undefined,
    seedById,
  ).sort((a, b) => a.rank - b.rank);
}

/** Classificados de cada grupo (GROUPS_KNOCKOUT) na ordem de classificacao, para gerar o mata-mata. */
export function orderedGroupIds(competitors: readonly TournamentCompetitor[], matches: readonly PublicMatchRow[], groupCount: number): number[][] {
  const groups: number[][] = [];
  for (let g = 0; g < groupCount; g++) {
    const members = competitors.filter((c) => c.poolIndex === g);
    groups.push(standingsFor(members, matches, g).map((r) => r.competitorId));
  }
  return groups;
}

/** Classificacao exibida: todos contra todos = 1 tabela; grupos = 1 por grupo; chave eliminatoria = nenhuma. */
export function deriveStandings(
  category: Pick<TournamentCategory, 'format'>,
  competitors: readonly TournamentCompetitor[],
  matches: readonly PublicMatchRow[],
): StandingsGroup[] {
  if (matches.length === 0) return [];
  if (category.format === 'ROUND_ROBIN') return [{ groupIndex: 0, rows: standingsFor(competitors, matches, 0) }];
  if (category.format === 'GROUPS_KNOCKOUT') {
    const indexes = [...new Set(competitors.map((c) => c.poolIndex).filter((i): i is number => i !== null))].sort((a, b) => a - b);
    return indexes.map((g) => ({
      groupIndex: g,
      rows: standingsFor(
        competitors.filter((c) => c.poolIndex === g),
        matches,
        g,
      ),
    }));
  }
  return [];
}

export function derivePodium(
  category: Pick<TournamentCategory, 'format' | 'thirdPlace'>,
  standings: readonly StandingsGroup[],
  matches: readonly PublicMatchRow[],
): Array<{ place: 1 | 2 | 3; competitorId: number }> {
  if (matches.length === 0) return [];
  const podiumMatches: PodiumMatch[] = matches.map((m) => ({
    key: m.key,
    stage: m.stage,
    round: m.round,
    status: m.status,
    slotA: m.slotAId,
    slotB: m.slotBId,
    winnerId: m.winnerId,
    isBye: m.isBye,
  }));
  return computePodium({
    format: category.format,
    thirdPlace: category.thirdPlace,
    matches: podiumMatches,
    standings: category.format === 'ROUND_ROBIN' ? (standings[0]?.rows ?? []) : [],
  }).map((p) => ({ place: p.place, competitorId: p.competitorId }));
}

const STAGE_ORDER: Record<string, number> = { GROUP: 0, MAIN: 1, THIRD_PLACE: 2 };

/** Ordem estavel das lutas: fase, grupo, rodada, posicao, id. */
export function sortMatches<T extends Pick<PublicMatchRow, 'stage' | 'groupIndex' | 'round' | 'position' | 'id'>>(matches: readonly T[]): T[] {
  return [...matches].sort(
    (a, b) =>
      (STAGE_ORDER[a.stage] ?? 9) - (STAGE_ORDER[b.stage] ?? 9) ||
      (a.groupIndex ?? -1) - (b.groupIndex ?? -1) ||
      a.round - b.round ||
      a.position - b.position ||
      a.id - b.id,
  );
}

// --------------------------------------------------------------------------------------------------------------
// Visao do OPERADOR
// --------------------------------------------------------------------------------------------------------------

export function buildOperatorCategory(data: CategoryData, tournamentRevision: number, now: Date) {
  const { category } = data;
  const rows = data.competitors.map((c) => c.row);
  const matches = sortMatches(data.matches);
  const standings = deriveStandings(category, rows, matches);
  return {
    id: category.id,
    tournamentId: category.tournamentId,
    revision: tournamentRevision,
    name: category.name,
    position: category.position,
    format: category.format,
    status: category.status,
    thirdPlace: category.thirdPlace,
    groupCount: category.groupCount,
    advancePerGroup: category.advancePerGroup,
    drawSeed: category.drawSeed,
    generatedAt: category.generatedAt,
    competitors: data.competitors.map((c) => {
      const age = effectiveAgeGroup(c, now);
      return {
        id: c.row.id,
        displayName: displayNameOf(c),
        groupName: c.student?.anonymizedAt ? null : c.row.groupName,
        graduationLabel: c.student?.anonymizedAt ? null : c.row.graduationLabel,
        seed: c.row.seed,
        poolIndex: c.row.poolIndex,
        studentId: c.row.studentId,
        eventParticipantId: c.row.eventParticipantId,
        /** SO a foto do ALUNO (/api/uploads/...); atleta de fora usa GET .../photo. */
        photoUrl: publicPhotoRef(studentPhoto(c)),
        hasOwnPhoto: hasOwnPhoto(c.row),
        /** Troca da foto propria (ms) para quebrar o cache do painel. */
        photoVersion: hasOwnPhoto(c.row) && c.row.photoUpdatedAt ? c.row.photoUpdatedAt.getTime() : null,
        ageGroup: age,
        photoAuthorized: c.row.photoAuthorized,
        photoAuthorizedAt: c.row.photoAuthorizedAt,
        /** A foto aparece no telao publico? (adulto, ou menor/desconhecido com autorizacao) */
        photoPublic: photoShownOnPublic(c, now),
        createdAt: c.row.createdAt,
      };
    }),
    matches: matches.map((m) => ({
      id: m.id,
      key: m.key,
      stage: m.stage,
      round: m.round,
      position: m.position,
      groupIndex: m.groupIndex,
      slotAId: m.slotAId,
      slotBId: m.slotBId,
      nextMatchId: m.nextMatchId,
      nextSlot: m.nextSlot,
      loserNextMatchId: m.loserNextMatchId,
      loserNextSlot: m.loserNextSlot,
      isBye: m.isBye,
      status: m.status,
      winnerId: m.winnerId,
      scoreA: m.scoreA,
      scoreB: m.scoreB,
      resultType: m.resultType,
      note: m.note,
      mat: m.mat,
      queueOrder: m.queueOrder,
      startedAt: m.startedAt,
      finishedAt: m.finishedAt,
    })),
    standings,
    podium: derivePodium(category, standings, matches),
  };
}

// --------------------------------------------------------------------------------------------------------------
// Snapshot PUBLICO (formato exato do contrato 5)
// --------------------------------------------------------------------------------------------------------------

export interface PublicSnapshotInput {
  revision: number;
  event: { title: string; date: Date; location: string | null; imageUrl: string | null };
  organizationName: string;
  categories: CategoryData<PublicMatchRow>[];
  now: Date;
  /** Token do telao: entra SO na URL da foto propria (o snapshot memoizado e POR TOKEN; rotacionar invalida). */
  publicToken: string;
}

/** Chaves de PRIMEIRO nivel e por objeto (usadas pelos testes de conformidade/privacidade). */
export const PUBLIC_SNAPSHOT_KEYS = {
  top: ['revision', 'serverTime', 'event', 'organizationName', 'categories'],
  event: ['title', 'date', 'location', 'imageUrl'],
  category: ['id', 'name', 'format', 'status', 'thirdPlace', 'competitors', 'matches', 'standings', 'podium'],
  competitor: ['id', 'name', 'group', 'graduation', 'photoUrl', 'seed', 'poolIndex'],
  match: [
    'id', 'key', 'stage', 'round', 'position', 'groupIndex', 'slotAId', 'slotBId', 'nextMatchId', 'nextSlot', 'isBye',
    'status', 'winnerId', 'scoreA', 'scoreB', 'resultType', 'mat', 'queueOrder',
  ],
  standingsGroup: ['groupIndex', 'rows'],
  standingRow: ['competitorId', 'played', 'wins', 'draws', 'losses', 'pointsFor', 'pointsAgainst', 'points', 'rank'],
  podium: ['place', 'competitorId'],
} as const;

/**
 * Snapshot publico SEM o `serverTime` (que e injetado a cada resposta para nao invalidar o cache): objeto montado campo a
 * campo, na ordem do contrato.
 */
export function buildPublicSnapshotBody(input: PublicSnapshotInput) {
  const { now } = input;
  return {
    revision: input.revision,
    event: {
      title: input.event.title,
      date: input.event.date.toISOString(),
      location: input.event.location,
      imageUrl: publicPhotoRef(input.event.imageUrl),
    },
    organizationName: input.organizationName,
    categories: input.categories.map((data) => {
      const { category } = data;
      const rows = data.competitors.map((c) => c.row);
      const matches = sortMatches(data.matches);
      const standings = deriveStandings(category, rows, matches);
      return {
        id: category.id,
        name: category.name,
        format: category.format,
        status: category.status,
        thirdPlace: category.thirdPlace,
        competitors: data.competitors.map((c) => ({
          id: c.row.id,
          name: displayNameOf(c),
          group: c.student?.anonymizedAt ? null : c.row.groupName,
          graduation: c.student?.anonymizedAt ? null : c.row.graduationLabel,
          photoUrl: publicPhotoFor(c, now, input.publicToken),
          seed: c.row.seed,
          poolIndex: c.row.poolIndex,
        })),
        matches: matches.map((m) => ({
          id: m.id,
          key: m.key,
          stage: m.stage,
          round: m.round,
          position: m.position,
          groupIndex: m.groupIndex,
          slotAId: m.slotAId,
          slotBId: m.slotBId,
          nextMatchId: m.nextMatchId,
          nextSlot: m.nextSlot,
          isBye: m.isBye,
          status: m.status,
          winnerId: m.winnerId,
          scoreA: m.scoreA,
          scoreB: m.scoreB,
          resultType: m.resultType,
          mat: m.mat === null ? null : String(m.mat),
          queueOrder: m.queueOrder,
        })),
        standings: standings.map((g) => ({
          groupIndex: g.groupIndex,
          rows: g.rows.map((r) => ({
            competitorId: r.competitorId,
            played: r.played,
            wins: r.wins,
            draws: r.draws,
            losses: r.losses,
            pointsFor: r.pointsFor,
            pointsAgainst: r.pointsAgainst,
            points: r.points,
            rank: r.rank,
          })),
        })),
        podium: derivePodium(category, standings, matches).map((p) => ({ place: p.place, competitorId: p.competitorId })),
      };
    }),
  };
}

export type PublicSnapshotBody = ReturnType<typeof buildPublicSnapshotBody>;

/** Corpo serializado UMA vez (memoizado): `tail` = o JSON sem a abertura `{` e sem `revision`/`serverTime`. */
export interface SerializedSnapshot {
  revision: number;
  tail: string;
}

export function serializePublicBody(body: PublicSnapshotBody): SerializedSnapshot {
  const { revision, ...rest } = body;
  return { revision, tail: JSON.stringify(rest).slice(1) };
}

/** JSON final com o `serverTime` na 2a posicao (ordem do contrato), sem reserializar o corpo. */
export function composeSnapshotJson(snapshot: SerializedSnapshot, serverTime: Date): string {
  return `{"revision":${snapshot.revision},"serverTime":${JSON.stringify(serverTime.toISOString())},${snapshot.tail}`;
}
