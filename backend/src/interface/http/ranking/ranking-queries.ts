import { Prisma, PointEventType } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { RankingBand } from './ranking-rules';

/**
 * Consultas SQL do Ginga Rank (SSOT dos rankings): usadas pelo RankingQueryService (HTTP) e pelo fechamento de
 * temporada do RankingService. SQL cru porque o ranking precisa de agregacao + funcao de janela + elegibilidade
 * de privacidade na MESMA consulta.
 *
 * Regras de visibilidade (aqui, num lugar so):
 *  - so alunos ACTIVE de grupos ACTIVE (grupo INACTIVE nunca aparece);
 *  - GROUP: todos os alunos ativos do grupo (menor tambem), mesmo com 0 ponto;
 *  - CITY/STATE/COUNTRY (abertos): so RankingProfile.optInPublic = true E (adulto OU algum responsavel com
 *    StudentGuardian.consentPublicProfile = true, o mesmo consentimento do Passaporte), e so quem tem ponto no periodo.
 *  - desempate: pontos desc, quem atingiu antes (menor occurredAt do ULTIMO ponto), studentId.
 */

export type StudentScope = 'GROUP' | 'CITY' | 'STATE' | 'COUNTRY';
export type GroupScope = 'CITY' | 'STATE' | 'COUNTRY';

export interface StudentRankParams {
  scope: StudentScope;
  /** Grupo do solicitante (GROUP filtra por ele). */
  organizationId: number;
  /** Cidade/UF-sede do grupo do solicitante (CITY/STATE comparam com a sede de cada grupo). */
  city: string | null;
  state: string | null;
  /** 'ALL' ou 'YYYY-MM'. */
  season: string;
  /** null = todos os tipos de ponto (GENERAL). */
  types: PointEventType[] | null;
  band: RankingBand | null;
  /** Soma so pontos com occurredAt anterior a esta data (posicao "da semana passada" em season=ALL). */
  before?: Date | null;
}

export interface RankedStudentRow {
  studentId: number;
  groupId: number;
  name: string;
  photo: string | null;
  birthDate: Date | null;
  groupName: string;
  groupLogo: string | null;
  city: string | null;
  state: string | null;
  nickname: string | null;
  points: number;
  lastAt: Date | null;
  rank: number;
  total: number;
}

const periodCondition = (p: Pick<StudentRankParams, 'season' | 'types' | 'before'>): Prisma.Sql => {
  const parts: Prisma.Sql[] = [];
  if (p.season !== 'ALL') parts.push(Prisma.sql`pe.season = ${p.season}`);
  if (p.types) parts.push(Prisma.sql`pe.type::text = ANY(${p.types as string[]}::text[])`);
  if (p.before) parts.push(Prisma.sql`pe."occurredAt" < ${p.before}`);
  return parts.length > 0 ? Prisma.sql`AND ${Prisma.join(parts, ' AND ')}` : Prisma.empty;
};

const AGE_YEARS = Prisma.sql`date_part('year', age(now(), s."birthDate"))`;

const bandCondition = (band: RankingBand | null): Prisma.Sql => {
  switch (band) {
    case 'KIDS':
      return Prisma.sql`AND s."birthDate" IS NOT NULL AND ${AGE_YEARS} <= 12`;
    case 'YOUTH':
      return Prisma.sql`AND s."birthDate" IS NOT NULL AND ${AGE_YEARS} BETWEEN 13 AND 17`;
    case 'ADULT':
      return Prisma.sql`AND (s."birthDate" IS NULL OR ${AGE_YEARS} >= 18)`;
    default:
      return Prisma.empty;
  }
};

/** Opt-in + (adulto OU consentimento de um responsavel). */
const OPEN_ELIGIBILITY = Prisma.sql`
  AND rp."optInPublic" = true
  AND (
    s."birthDate" IS NULL
    OR ${AGE_YEARS} >= 18
    OR EXISTS (
      SELECT 1 FROM "StudentGuardian" g WHERE g."studentId" = s.id AND g."consentPublicProfile" = true
    )
  )`;

/** Cidade/UF-sede do grupo (comparacao sem caixa/espacos). Sem cidade/UF no solicitante => nenhum grupo casa. */
const placeCondition = (scope: StudentScope | GroupScope, p: { city: string | null; state: string | null }): Prisma.Sql => {
  if (scope === 'CITY') {
    if (!p.city?.trim() || !p.state?.trim()) return Prisma.sql`AND false`;
    return Prisma.sql`AND lower(btrim(o.city)) = lower(btrim(${p.city})) AND upper(btrim(o.state)) = upper(btrim(${p.state}))`;
  }
  if (scope === 'STATE') {
    if (!p.state?.trim()) return Prisma.sql`AND false`;
    return Prisma.sql`AND upper(btrim(o.state)) = upper(btrim(${p.state}))`;
  }
  return Prisma.empty;
};

/** CTE `ranked` (uma linha por aluno elegivel, ja com a posicao). */
export function rankedStudentsCte(p: StudentRankParams): Prisma.Sql {
  const scopeCond = p.scope === 'GROUP' ? Prisma.sql`AND s."organizationId" = ${p.organizationId}` : placeCondition(p.scope, p);
  const open = p.scope === 'GROUP' ? Prisma.empty : OPEN_ELIGIBILITY;
  const onlyWithPoints = p.scope === 'GROUP' ? Prisma.empty : Prisma.sql`WHERE base.points > 0`;
  return Prisma.sql`
    WITH base AS (
      SELECT s.id AS "studentId", s."organizationId" AS "groupId", s.name, s.photo, s."birthDate",
             o.name AS "groupName", o.logo AS "groupLogo", o.city, o.state, rp.nickname,
             COALESCE(SUM(pe.points), 0)::int AS points, MAX(pe."occurredAt") AS "lastAt"
      FROM "Student" s
      JOIN "Organization" o ON o.id = s."organizationId"
      LEFT JOIN "RankingProfile" rp ON rp."studentId" = s.id
      LEFT JOIN "PointEvent" pe ON pe."studentId" = s.id ${periodCondition(p)}
      WHERE s.status = 'ACTIVE' AND o.status = 'ACTIVE' AND o.type = 'GROUP'
        ${scopeCond} ${open} ${bandCondition(p.band)}
      GROUP BY s.id, o.id, rp.id
    ), ranked AS (
      SELECT base.*,
             ROW_NUMBER() OVER (ORDER BY base.points DESC, base."lastAt" ASC NULLS LAST, base."studentId" ASC)::int AS rank,
             COUNT(*) OVER ()::int AS total
      FROM base ${onlyWithPoints}
    )`;
}

export async function fetchRankedStudents(
  prisma: PrismaService,
  p: StudentRankParams,
  limit: number,
  offset: number,
): Promise<RankedStudentRow[]> {
  return prisma.$queryRaw<RankedStudentRow[]>(Prisma.sql`
    ${rankedStudentsCte(p)}
    SELECT * FROM ranked ORDER BY rank ASC LIMIT ${limit} OFFSET ${offset}`);
}

/** Total de alunos no ranking (independe da pagina). */
export async function countRankedStudents(prisma: PrismaService, p: StudentRankParams): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    ${rankedStudentsCte(p)}
    SELECT COUNT(*)::int AS n FROM ranked`);
  return rows[0]?.n ?? 0;
}

/** studentId -> { rank, points } so dos pedidos que estao no ranking. */
export async function fetchStudentRanks(
  prisma: PrismaService,
  p: StudentRankParams,
  studentIds: number[],
): Promise<Map<number, { rank: number; points: number }>> {
  const map = new Map<number, { rank: number; points: number }>();
  if (studentIds.length === 0) return map;
  const rows = await prisma.$queryRaw<Array<{ studentId: number; rank: number; points: number }>>(Prisma.sql`
    ${rankedStudentsCte(p)}
    SELECT "studentId", rank, points FROM ranked WHERE "studentId" = ANY(${studentIds}::int[])`);
  for (const r of rows) map.set(r.studentId, { rank: r.rank, points: r.points });
  return map;
}

/** Pontos de UM aluno no periodo/categoria (sem regra de elegibilidade): para o "me" fora da lista. */
export async function sumStudentPoints(
  prisma: PrismaService,
  studentId: number,
  p: Pick<StudentRankParams, 'season' | 'types' | 'before'>,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ points: number }>>(Prisma.sql`
    SELECT COALESCE(SUM(pe.points), 0)::int AS points FROM "PointEvent" pe
    WHERE pe."studentId" = ${studentId} ${periodCondition(p)}`);
  return rows[0]?.points ?? 0;
}

/** Pontos acumulados de todos os tempos (para a liga) de varios alunos. */
export async function allTimePoints(prisma: PrismaService, studentIds: number[]): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (studentIds.length === 0) return map;
  const rows = await prisma.$queryRaw<Array<{ studentId: number; points: number }>>(Prisma.sql`
    SELECT "studentId", SUM(points)::int AS points FROM "PointEvent"
    WHERE "studentId" = ANY(${studentIds}::int[]) GROUP BY "studentId"`);
  for (const r of rows) map.set(r.studentId, r.points);
  return map;
}

// ---------------------------------------------------------------------------------------------
// Ranking de GRUPOS
// ---------------------------------------------------------------------------------------------

/** Grupos precisam de pelo menos 3 alunos ativos para entrar (evita fraude com 1 aluno). */
export const MIN_STUDENTS_FOR_GROUP_RANK = 3;

export interface GroupRankParams {
  scope: GroupScope;
  organizationId: number;
  city: string | null;
  state: string | null;
  season: string;
}

export interface RankedGroupRow {
  groupId: number;
  name: string;
  logo: string | null;
  city: string | null;
  state: string | null;
  studentsCount: number;
  totalPoints: number;
  rank: number;
  total: number;
}

/**
 * Media de pontos POR ALUNO ATIVO (grupo pequeno compete com grande). Aparecem so grupos ACTIVE com mapVisible=true
 * ("aparece em rankings abertos") e com >= 3 alunos ativos. Todos os alunos ativos contam no divisor (inclusive os
 * sem ponto e os menores): so ha agregado, nenhum dado individual sai daqui.
 */
export async function fetchRankedGroups(
  prisma: PrismaService,
  p: GroupRankParams,
  limit: number,
  offset: number,
): Promise<RankedGroupRow[]> {
  const season = p.season === 'ALL' ? Prisma.empty : Prisma.sql`AND season = ${p.season}`;
  return prisma.$queryRaw<RankedGroupRow[]>(Prisma.sql`
    WITH agg AS (
      SELECT o.id AS "groupId", o.name, o.logo, o.city, o.state,
             COUNT(s.id)::int AS "studentsCount",
             COALESCE(SUM(pts.points), 0)::int AS "totalPoints"
      FROM "Organization" o
      JOIN "Student" s ON s."organizationId" = o.id AND s.status = 'ACTIVE'
      LEFT JOIN (
        SELECT "studentId", SUM(points)::int AS points FROM "PointEvent" WHERE true ${season} GROUP BY "studentId"
      ) pts ON pts."studentId" = s.id
      WHERE o.status = 'ACTIVE' AND o.type = 'GROUP' AND o."mapVisible" = true ${placeCondition(p.scope, p)}
      GROUP BY o.id
      HAVING COUNT(s.id) >= ${MIN_STUDENTS_FOR_GROUP_RANK}
    ), ranked AS (
      SELECT agg.*,
             ROW_NUMBER() OVER (
               ORDER BY (agg."totalPoints"::numeric / agg."studentsCount") DESC, agg."totalPoints" DESC, agg."groupId" ASC
             )::int AS rank,
             COUNT(*) OVER ()::int AS total
      FROM agg
    )
    SELECT * FROM ranked ORDER BY rank ASC LIMIT ${limit} OFFSET ${offset}`);
}
