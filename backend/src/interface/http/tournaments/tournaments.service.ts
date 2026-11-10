import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import {
  ParticipantStatus,
  Prisma,
  TournamentAgeGroup,
  TournamentCategory,
  TournamentCategoryStatus,
  TournamentFormat,
  TournamentMatch,
  TournamentMatchStatus,
} from '@prisma/client';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { groupWideOrUnitFilter, scopeAllows, UnitScope, UnitScopeService, unitScopeFilter } from '../../../shared/access/unit-scope';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import {
  AddCompetitorDto,
  CreateCategoryDto,
  GenerateDto,
  ImportParticipantsDto,
  MatchResultDto,
  SwapSlotsDto,
  UpdateCategoryDto,
  UpdateCompetitorDto,
  UpdateMatchDto,
} from './dto/tournament.dto';
import {
  buildKnockoutFromGroups,
  EngineCompetitor,
  generateGroups,
  generateRoundRobin,
  generateSingleElimination,
  MatchSpec,
} from './engine';
import {
  allGroupMatchesFinished,
  deriveCategoryStatus,
  MatchNode,
  PatchMap,
  planResult,
  planStart,
  planSwap,
  planUndo,
  statusFromSlots,
} from './tournament-flow';
import { CloseReason, TournamentLiveHub } from './tournament-live-hub';
import { STUDENT_INFO_SELECT, TournamentPublicService } from './tournament-public.service';
import {
  badRequest,
  canReadTournaments,
  canWriteTournaments,
  cleanText,
  conflict,
  generatePublicToken,
  groupConfigError,
  groupSizeError,
  newDrawSeed,
  normalizeCategoryConfig,
  notFound,
  publicPhotoRef,
  TOURNAMENT_EVENT_TYPE,
  TOURNAMENT_LIMITS as L,
  TournamentErrorCode as Code,
} from './tournament-rules';
import { buildOperatorCategory, CategoryData, CompetitorData, effectiveAgeGroup, orderedGroupIds, sourcePhoto } from './tournament-snapshot';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaService;

interface AuditInput {
  action: string;
  entity: string;
  entityId: number;
  meta?: Record<string, unknown>;
}

/** Resultado de uma transacao de mutacao: o que devolver e o que fazer DEPOIS do commit (auditoria + hub). */
interface Outcome<T> {
  value: T;
  tournamentId: number;
  /** false = nada mudou (repeticao idempotente): sem revisao nova, sem auditoria, sem notificar. */
  changed: boolean;
  audits?: AuditInput[];
  /** Fecha os streams em vez de so notificar (token rotacionado / telao desligado). */
  close?: CloseReason;
}

interface Actor {
  organizationId: number;
  user: AuthenticatedUser;
  scope: UnitScope;
}

/**
 * Chaveamento de campeonato ao vivo (docs/CONTRATO_CHAVEAMENTO.md 4): API do OPERADOR.
 *
 * Regras de ouro:
 *  - `organizationId` SEMPRE do token; todo id (evento, categoria, atleta, luta) e conferido contra a organizacao E o evento
 *    da URL: id de outro grupo = 404, nunca 403/200;
 *  - toda mutacao roda em UMA transacao que trava a linha da categoria (SELECT ... FOR UPDATE), sobe `Tournament.revision` e
 *    devolve a categoria completa; a auditoria e o aviso ao hub SSE so acontecem DEPOIS do commit (transacao que falha nao
 *    notifica nem audita);
 *  - o fluxo das lutas (resultado, desfazer, trocas) e puro e vive em tournament-flow.ts; o sorteio e a classificacao, no motor.
 */
@Injectable()
export class TournamentsService {
  private readonly logger = new Logger(TournamentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly unitScope: UnitScopeService,
    private readonly hub: TournamentLiveHub,
    private readonly publicService: TournamentPublicService,
  ) {}

  // ------------------------------------------------------------------------------------------------------------
  // Infra: acesso, transacao, efeitos pos-commit
  // ------------------------------------------------------------------------------------------------------------

  private async actor(organizationId: number, user: AuthenticatedUser, write: boolean): Promise<Actor> {
    const allowed = write ? canWriteTournaments(user.role) : canReadTournaments(user.role);
    if (!allowed) {
      throw new ForbiddenException(
        write
          ? 'Só MESTRE, PROFESSOR ou INSTRUTOR operam o chaveamento do campeonato.'
          : 'Só a equipe do grupo acessa o chaveamento do campeonato.',
      );
    }
    return { organizationId, user, scope: await this.unitScope.resolve(user, organizationId) };
  }

  /** Evento do grupo (e do escopo de unidade do usuario). Id de outro grupo / fora do escopo = 404. */
  private async loadEvent(actor: Actor, eventId: number) {
    const event = await this.prisma.event.findFirst({
      where: { id: eventId, organizationId: actor.organizationId, AND: [groupWideOrUnitFilter(actor.scope)] },
      select: { id: true, type: true, status: true, unitId: true },
    });
    if (!event || !scopeAllows(actor.scope, event.unitId)) {
      throw notFound(Code.EVENT_NOT_FOUND, 'Evento não encontrado.');
    }
    return event;
  }

  /** Executa a transacao e, SO se confirmou e mudou algo, audita e avisa o hub. */
  private async run<T>(actor: Actor, work: (tx: Tx) => Promise<Outcome<T>>): Promise<T> {
    const outcome = await this.prisma.$transaction(work, { maxWait: 10_000, timeout: 30_000 });
    if (outcome.changed) await this.afterCommit(actor, outcome);
    return outcome.value;
  }

  private async afterCommit(actor: Actor, outcome: Outcome<unknown>): Promise<void> {
    try {
      for (const a of outcome.audits ?? []) {
        await this.audit.record({
          organizationId: actor.organizationId,
          userId: actor.user.id,
          action: a.action,
          entity: a.entity,
          entityId: a.entityId,
          meta: a.meta,
        });
      }
    } catch (error) {
      this.logger.error(`Falha na auditoria do chaveamento: ${error instanceof Error ? error.message : String(error)}`);
    }
    try {
      this.publicService.invalidate(outcome.tournamentId);
      if (outcome.close) this.hub.closeAll(outcome.tournamentId, outcome.close);
      else this.hub.notifyChanged(outcome.tournamentId);
    } catch (error) {
      this.logger.error(`Falha ao avisar o telao: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Sobe a revisao do torneio e devolve a nova. */
  private async bump(tx: Tx, tournamentId: number): Promise<number> {
    const t = await tx.tournament.update({ where: { id: tournamentId }, data: { revision: { increment: 1 } }, select: { revision: true } });
    return t.revision;
  }

  /** Trava a linha do TORNEIO (mutacoes de torneio/categoria nova). */
  private async lockTournament(tx: Tx, actor: Actor, eventId: number) {
    const rows = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT t."id" FROM "Tournament" t
      WHERE t."eventId" = ${eventId} AND t."organizationId" = ${actor.organizationId}
      FOR UPDATE`;
    if (!rows[0]) throw notFound(Code.TOURNAMENT_NOT_FOUND, 'Este evento ainda não tem chaveamento.');
    return tx.tournament.findUniqueOrThrow({ where: { id: rows[0].id } });
  }

  /** Trava a linha da CATEGORIA (toda mutacao de atletas/lutas) e devolve a categoria. */
  private async lockCategory(tx: Tx, actor: Actor, eventId: number, categoryId: number): Promise<TournamentCategory> {
    const rows = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT c."id" FROM "TournamentCategory" c
      JOIN "Tournament" t ON t."id" = c."tournamentId"
      WHERE c."id" = ${categoryId} AND c."organizationId" = ${actor.organizationId}
        AND t."eventId" = ${eventId} AND t."organizationId" = ${actor.organizationId}
      FOR UPDATE OF c`;
    if (!rows[0]) throw notFound(Code.CATEGORY_NOT_FOUND, 'Categoria não encontrada.');
    return tx.tournamentCategory.findUniqueOrThrow({ where: { id: categoryId } });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Leitura de dados
  // ------------------------------------------------------------------------------------------------------------

  private async loadCategoryData(db: Db, organizationId: number, categoryId: number): Promise<CategoryData> {
    const category = await db.tournamentCategory.findFirst({ where: { id: categoryId, organizationId } });
    if (!category) throw notFound(Code.CATEGORY_NOT_FOUND, 'Categoria não encontrada.');
    const [competitors, matches] = await Promise.all([
      db.tournamentCompetitor.findMany({
        where: { categoryId, organizationId },
        orderBy: { id: 'asc' },
        include: { student: { select: STUDENT_INFO_SELECT } },
      }),
      db.tournamentMatch.findMany({ where: { categoryId, organizationId }, orderBy: { id: 'asc' } }),
    ]);
    return { category, competitors: competitors.map(({ student, ...row }) => ({ row, student })), matches };
  }

  private async categoryView(db: Db, organizationId: number, categoryId: number) {
    const data = await this.loadCategoryData(db, organizationId, categoryId);
    const t = await db.tournament.findUniqueOrThrow({ where: { id: data.category.tournamentId }, select: { revision: true } });
    return buildOperatorCategory(data, t.revision, new Date());
  }

  private async tournamentSummary(db: Db, organizationId: number, tournamentId: number) {
    const t = await db.tournament.findFirst({ where: { id: tournamentId, organizationId } });
    if (!t) throw notFound(Code.TOURNAMENT_NOT_FOUND, 'Este evento ainda não tem chaveamento.');
    const categories = await db.tournamentCategory.findMany({
      where: { tournamentId, organizationId },
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    const ids = categories.map((c) => c.id);
    const [competitorCounts, matchCounts] = ids.length
      ? await Promise.all([
          db.tournamentCompetitor.groupBy({ by: ['categoryId'], where: { categoryId: { in: ids } }, _count: { _all: true } }),
          db.tournamentMatch.groupBy({ by: ['categoryId', 'status'], where: { categoryId: { in: ids }, isBye: false }, _count: { _all: true } }),
        ])
      : [[], []];
    return {
      id: t.id,
      eventId: t.eventId,
      publicEnabled: t.publicEnabled,
      publicToken: t.publicToken,
      revision: t.revision,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      categories: categories.map((c) => {
        const byStatus = (status: TournamentMatchStatus) =>
          matchCounts.filter((m) => m.categoryId === c.id && m.status === status).reduce((sum, m) => sum + m._count._all, 0);
        const total = matchCounts.filter((m) => m.categoryId === c.id).reduce((sum, m) => sum + m._count._all, 0);
        return {
          id: c.id,
          name: c.name,
          position: c.position,
          format: c.format,
          status: c.status,
          thirdPlace: c.thirdPlace,
          groupCount: c.groupCount,
          advancePerGroup: c.advancePerGroup,
          generatedAt: c.generatedAt,
          competitorsCount: competitorCounts.find((x) => x.categoryId === c.id)?._count._all ?? 0,
          matchesCount: total,
          liveMatchesCount: byStatus('LIVE'),
          finishedMatchesCount: byStatus('FINISHED'),
        };
      }),
    };
  }

  // ------------------------------------------------------------------------------------------------------------
  // Torneio
  // ------------------------------------------------------------------------------------------------------------

  async getTournament(organizationId: number, user: AuthenticatedUser, eventId: number) {
    const actor = await this.actor(organizationId, user, false);
    await this.loadEvent(actor, eventId);
    const t = await this.prisma.tournament.findFirst({ where: { eventId, organizationId }, select: { id: true } });
    if (!t) throw notFound(Code.TOURNAMENT_NOT_FOUND, 'Este evento ainda não tem chaveamento.');
    return this.tournamentSummary(this.prisma, organizationId, t.id);
  }

  async createTournament(organizationId: number, user: AuthenticatedUser, eventId: number) {
    const actor = await this.actor(organizationId, user, true);
    const event = await this.loadEvent(actor, eventId);
    if (event.type !== TOURNAMENT_EVENT_TYPE) {
      throw badRequest(Code.EVENT_NOT_TOURNAMENT, 'O chaveamento só existe para eventos do tipo Campeonato.');
    }
    const exists = () => conflict(Code.TOURNAMENT_EXISTS, 'Este evento já tem um chaveamento.');
    if (await this.prisma.tournament.findFirst({ where: { eventId, organizationId }, select: { id: true } })) throw exists();
    let created;
    try {
      created = await this.prisma.tournament.create({
        data: { organizationId, eventId, publicToken: generatePublicToken(), publicEnabled: false },
        select: { id: true },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw exists();
      throw error;
    }
    this.publicService.invalidate(created.id); // cache negativo de algum token antigo nao pode mascarar o torneio novo
    await this.audit.record({
      organizationId,
      userId: user.id,
      action: AuditAction.TOURNAMENT_CREATE,
      entity: AuditEntity.TOURNAMENT,
      entityId: created.id,
      meta: { eventId },
    });
    return this.tournamentSummary(this.prisma, organizationId, created.id);
  }

  async updateTournament(organizationId: number, user: AuthenticatedUser, eventId: number, publicEnabled: boolean) {
    const actor = await this.actor(organizationId, user, true);
    await this.loadEvent(actor, eventId);
    return this.run(actor, async (tx) => {
      const t = await this.lockTournament(tx, actor, eventId);
      if (t.publicEnabled === publicEnabled) {
        return { value: await this.tournamentSummary(tx, organizationId, t.id), tournamentId: t.id, changed: false };
      }
      await tx.tournament.update({ where: { id: t.id }, data: { publicEnabled } });
      await this.bump(tx, t.id);
      return {
        value: await this.tournamentSummary(tx, organizationId, t.id),
        tournamentId: t.id,
        changed: true,
        close: publicEnabled ? undefined : 'disabled',
        audits: [{ action: AuditAction.TOURNAMENT_PUBLIC_TOGGLE, entity: AuditEntity.TOURNAMENT, entityId: t.id, meta: { publicEnabled } }],
      };
    });
  }

  async rotateToken(organizationId: number, user: AuthenticatedUser, eventId: number) {
    const actor = await this.actor(organizationId, user, true);
    await this.loadEvent(actor, eventId);
    return this.run(actor, async (tx) => {
      const t = await this.lockTournament(tx, actor, eventId);
      await tx.tournament.update({ where: { id: t.id }, data: { publicToken: generatePublicToken() } });
      await this.bump(tx, t.id);
      return {
        value: await this.tournamentSummary(tx, organizationId, t.id),
        tournamentId: t.id,
        changed: true,
        close: 'token-rotated',
        // O token (novo ou antigo) NUNCA vai para a auditoria.
        audits: [{ action: AuditAction.TOURNAMENT_TOKEN_ROTATE, entity: AuditEntity.TOURNAMENT, entityId: t.id }],
      };
    });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Categorias
  // ------------------------------------------------------------------------------------------------------------

  private async assertNameFree(tx: Tx, tournamentId: number, name: string, exceptId?: number): Promise<void> {
    const dup = await tx.tournamentCategory.findFirst({
      where: { tournamentId, name: { equals: name, mode: 'insensitive' }, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (dup) throw conflict(Code.CATEGORY_NAME_TAKEN, 'Já existe uma categoria com esse nome neste campeonato.');
  }

  private mapUnique(error: unknown, code: typeof Code.CATEGORY_NAME_TAKEN | typeof Code.COMPETITOR_EXISTS, message: string): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw conflict(code, message);
    throw error;
  }

  async createCategory(organizationId: number, user: AuthenticatedUser, eventId: number, dto: CreateCategoryDto) {
    const actor = await this.actor(organizationId, user, true);
    await this.loadEvent(actor, eventId);
    const name = cleanText(dto.name);
    if (!name || name.length > L.nameMax) throw badRequest(Code.INVALID_COMPETITOR, `O nome da categoria deve ter de 1 a ${L.nameMax} caracteres.`);
    const config = normalizeCategoryConfig(dto.format, dto);
    if (dto.format === TournamentFormat.GROUPS_KNOCKOUT) {
      const error = groupConfigError(config);
      if (error) throw badRequest(Code.INVALID_GROUP_CONFIG, error);
    }
    return this.run(actor, async (tx) => {
      const t = await this.lockTournament(tx, actor, eventId);
      const [count, last] = await Promise.all([
        tx.tournamentCategory.count({ where: { tournamentId: t.id } }),
        tx.tournamentCategory.aggregate({ where: { tournamentId: t.id }, _max: { position: true } }),
      ]);
      if (count >= L.maxCategories) throw conflict(Code.CATEGORY_LIMIT, `Um campeonato aceita até ${L.maxCategories} categorias.`);
      await this.assertNameFree(tx, t.id, name);
      let created: TournamentCategory;
      try {
        created = await tx.tournamentCategory.create({
          data: {
            organizationId,
            tournamentId: t.id,
            name,
            position: (last._max.position ?? -1) + 1,
            format: dto.format,
            ...config,
          },
        });
      } catch (error) {
        this.mapUnique(error, Code.CATEGORY_NAME_TAKEN, 'Já existe uma categoria com esse nome neste campeonato.');
      }
      await this.bump(tx, t.id);
      return {
        value: await this.categoryView(tx, organizationId, created.id),
        tournamentId: t.id,
        changed: true,
        audits: [
          {
            action: AuditAction.TOURNAMENT_CATEGORY_CREATE,
            entity: AuditEntity.TOURNAMENT_CATEGORY,
            entityId: created.id,
            meta: { eventId, format: dto.format, thirdPlace: config.thirdPlace, groupCount: config.groupCount, advancePerGroup: config.advancePerGroup },
          },
        ],
      };
    });
  }

  async getCategory(organizationId: number, user: AuthenticatedUser, eventId: number, categoryId: number) {
    const actor = await this.actor(organizationId, user, false);
    await this.loadEvent(actor, eventId);
    const owned = await this.prisma.tournamentCategory.findFirst({
      where: { id: categoryId, organizationId, tournament: { eventId, organizationId } },
      select: { id: true },
    });
    if (!owned) throw notFound(Code.CATEGORY_NOT_FOUND, 'Categoria não encontrada.');
    return this.categoryView(this.prisma, organizationId, categoryId);
  }

  async updateCategory(organizationId: number, user: AuthenticatedUser, eventId: number, categoryId: number, dto: UpdateCategoryDto) {
    const actor = await this.actor(organizationId, user, true);
    await this.loadEvent(actor, eventId);
    if (dto.name === null) throw badRequest(Code.INVALID_COMPETITOR, 'O nome da categoria não pode ficar vazio.');
    const newName = dto.name === undefined ? undefined : cleanText(dto.name);
    if (dto.name !== undefined && (!newName || newName.length > L.nameMax)) {
      throw badRequest(Code.INVALID_COMPETITOR, `O nome da categoria deve ter de 1 a ${L.nameMax} caracteres.`);
    }
    return this.run(actor, async (tx) => {
      const category = await this.lockCategory(tx, actor, eventId, categoryId);
      const structural = dto.format !== undefined || dto.thirdPlace !== undefined || dto.groupCount !== undefined || dto.advancePerGroup !== undefined;
      if (structural && category.status !== TournamentCategoryStatus.SETUP) {
        throw conflict(Code.NOT_IN_SETUP, 'Depois de gerada a chave, só o nome da categoria pode mudar.');
      }
      const data: Prisma.TournamentCategoryUpdateInput = {};
      const changedFields: string[] = [];
      if (newName && newName !== category.name) {
        await this.assertNameFree(tx, category.tournamentId, newName, category.id);
        data.name = newName;
        changedFields.push('name');
      }
      if (structural) {
        const format = dto.format ?? category.format;
        const config = normalizeCategoryConfig(format, {
          thirdPlace: dto.thirdPlace ?? category.thirdPlace,
          groupCount: dto.groupCount !== undefined ? dto.groupCount : category.groupCount,
          advancePerGroup: dto.advancePerGroup !== undefined ? dto.advancePerGroup : category.advancePerGroup,
        });
        if (format === TournamentFormat.GROUPS_KNOCKOUT) {
          const error = groupConfigError(config);
          if (error) throw badRequest(Code.INVALID_GROUP_CONFIG, error);
        }
        if (format !== category.format) { data.format = format; changedFields.push('format'); }
        if (config.thirdPlace !== category.thirdPlace) { data.thirdPlace = config.thirdPlace; changedFields.push('thirdPlace'); }
        if (config.groupCount !== category.groupCount) { data.groupCount = config.groupCount; changedFields.push('groupCount'); }
        if (config.advancePerGroup !== category.advancePerGroup) { data.advancePerGroup = config.advancePerGroup; changedFields.push('advancePerGroup'); }
      }
      if (changedFields.length === 0) {
        return { value: await this.categoryView(tx, organizationId, categoryId), tournamentId: category.tournamentId, changed: false };
      }
      try {
        await tx.tournamentCategory.update({ where: { id: categoryId }, data });
      } catch (error) {
        this.mapUnique(error, Code.CATEGORY_NAME_TAKEN, 'Já existe uma categoria com esse nome neste campeonato.');
      }
      await this.bump(tx, category.tournamentId);
      return {
        value: await this.categoryView(tx, organizationId, categoryId),
        tournamentId: category.tournamentId,
        changed: true,
        audits: [{ action: AuditAction.TOURNAMENT_CATEGORY_UPDATE, entity: AuditEntity.TOURNAMENT_CATEGORY, entityId: categoryId, meta: { fields: changedFields } }],
      };
    });
  }

  async deleteCategory(organizationId: number, user: AuthenticatedUser, eventId: number, categoryId: number) {
    const actor = await this.actor(organizationId, user, true);
    await this.loadEvent(actor, eventId);
    return this.run(actor, async (tx) => {
      const category = await this.lockCategory(tx, actor, eventId, categoryId);
      const matches = await tx.tournamentMatch.findMany({ where: { categoryId }, select: { isBye: true, status: true } });
      if (category.status === TournamentCategoryStatus.FINISHED || matches.some((m) => !m.isBye && (m.status === 'LIVE' || m.status === 'FINISHED'))) {
        throw conflict(Code.HAS_RESULTS, 'A categoria já tem lutas em andamento ou terminadas: não pode ser excluída.');
      }
      const competitors = await tx.tournamentCompetitor.count({ where: { categoryId } });
      await tx.tournamentCategory.delete({ where: { id: categoryId } });
      await this.bump(tx, category.tournamentId);
      return {
        value: await this.tournamentSummary(tx, organizationId, category.tournamentId),
        tournamentId: category.tournamentId,
        changed: true,
        audits: [{ action: AuditAction.TOURNAMENT_CATEGORY_DELETE, entity: AuditEntity.TOURNAMENT_CATEGORY, entityId: categoryId, meta: { competitors, matches: matches.length } }],
      };
    });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Atletas
  // ------------------------------------------------------------------------------------------------------------

  private async categoryIdOfCompetitor(actor: Actor, eventId: number, competitorId: number): Promise<number> {
    const row = await this.prisma.tournamentCompetitor.findFirst({
      where: { id: competitorId, organizationId: actor.organizationId, category: { tournament: { eventId, organizationId: actor.organizationId } } },
      select: { categoryId: true },
    });
    if (!row) throw notFound(Code.COMPETITOR_NOT_FOUND, 'Atleta não encontrado.');
    return row.categoryId;
  }

  private async categoryIdOfMatch(actor: Actor, eventId: number, matchId: number): Promise<number> {
    const row = await this.prisma.tournamentMatch.findFirst({
      where: { id: matchId, organizationId: actor.organizationId, category: { tournament: { eventId, organizationId: actor.organizationId } } },
      select: { categoryId: true },
    });
    if (!row) throw notFound(Code.MATCH_NOT_FOUND, 'Luta não encontrada.');
    return row.categoryId;
  }

  private assertSetup(category: TournamentCategory): void {
    if (category.status !== TournamentCategoryStatus.SETUP) {
      throw conflict(Code.NOT_IN_SETUP, 'Os atletas só podem ser alterados antes de gerar a chave.');
    }
  }

  async addCompetitor(organizationId: number, user: AuthenticatedUser, eventId: number, categoryId: number, dto: AddCompetitorDto) {
    const actor = await this.actor(organizationId, user, true);
    await this.loadEvent(actor, eventId);
    const forms = [dto.eventParticipantId, dto.studentId, dto.guest].filter((v) => v !== undefined && v !== null).length;
    if (forms !== 1) {
      throw badRequest(Code.INVALID_COMPETITOR, 'Informe UMA forma: eventParticipantId, studentId ou guest.');
    }
    if (dto.guest && dto.seed !== undefined && dto.seed !== null) {
      throw badRequest(Code.INVALID_COMPETITOR, 'No convidado, informe a semente em guest.seed.');
    }
    const seed = (dto.guest ? dto.guest.seed : dto.seed) ?? null;
    return this.run(actor, async (tx) => {
      const category = await this.lockCategory(tx, actor, eventId, categoryId);
      this.assertSetup(category);
      const count = await tx.tournamentCompetitor.count({ where: { categoryId } });
      if (count >= L.maxCompetitors) throw conflict(Code.CATEGORY_FULL, `Uma categoria aceita até ${L.maxCompetitors} atletas.`);

      const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
      let data: Prisma.TournamentCompetitorUncheckedCreateInput;
      let source: 'student' | 'participant' | 'guest';
      if (seed !== null) {
        const taken = await tx.tournamentCompetitor.findFirst({ where: { categoryId, seed }, select: { id: true } });
        if (taken) throw conflict(Code.SEED_TAKEN, `A semente ${seed} já pertence a outro atleta desta categoria.`);
      }

      if (dto.guest) {
        const g = dto.guest;
        const displayName = cleanText(g.displayName);
        if (!displayName || displayName.length < L.displayNameMin) {
          throw badRequest(Code.INVALID_COMPETITOR, `O nome do atleta deve ter de ${L.displayNameMin} a ${L.displayNameMax} caracteres.`);
        }
        source = 'guest';
        data = {
          organizationId,
          categoryId,
          displayName,
          groupName: cleanText(g.groupName),
          graduationLabel: cleanText(g.graduationLabel),
          ageGroup: g.ageGroup ?? TournamentAgeGroup.UNKNOWN,
          photoUrl: g.photoUrl ? g.photoUrl : null,
          ...(g.photoAuthorized === true ? { photoAuthorized: true, photoAuthorizedById: actor.user.id, photoAuthorizedAt: new Date() } : {}),
        };
      } else if (dto.studentId !== undefined) {
        const student = await tx.student.findFirst({
          where: { id: dto.studentId, organizationId, AND: [unitScopeFilter(actor.scope)] },
          select: { id: true, name: true, anonymizedAt: true },
        });
        if (!student) throw notFound(Code.COMPETITOR_NOT_FOUND, 'Aluno não encontrado.');
        if (student.anonymizedAt) throw badRequest(Code.STUDENT_NOT_ELIGIBLE, 'Este aluno foi anonimizado e não pode entrar na chave.');
        source = 'student';
        data = {
          organizationId,
          categoryId,
          displayName: cleanText(student.name) ?? student.name,
          groupName: org.name.slice(0, L.groupNameMax),
          studentId: student.id,
        };
      } else {
        const participant = await tx.eventParticipant.findFirst({
          where: { id: dto.eventParticipantId, organizationId, eventId },
          include: { student: { select: { id: true, name: true, anonymizedAt: true } }, user: { select: { name: true } } },
        });
        if (!participant) throw notFound(Code.COMPETITOR_NOT_FOUND, 'Participante não encontrado neste evento.');
        if (participant.status === ParticipantStatus.CANCELLED || participant.status === ParticipantStatus.DECLINED) {
          throw badRequest(Code.PARTICIPANT_NOT_ELIGIBLE, 'Esta inscrição foi cancelada ou recusada.');
        }
        if (participant.student?.anonymizedAt) throw badRequest(Code.STUDENT_NOT_ELIGIBLE, 'Este aluno foi anonimizado e não pode entrar na chave.');
        source = 'participant';
        data = this.participantToCompetitor(organizationId, categoryId, org.name, participant);
      }

      if (seed !== null) data.seed = seed;
      const duplicate = await tx.tournamentCompetitor.findFirst({
        where: {
          categoryId,
          OR: [
            ...(data.studentId ? [{ studentId: data.studentId }] : []),
            ...(data.eventParticipantId ? [{ eventParticipantId: data.eventParticipantId }] : []),
          ],
        },
        select: { id: true },
      });
      if (data.studentId || data.eventParticipantId) {
        if (duplicate) throw conflict(Code.COMPETITOR_EXISTS, 'Este atleta já está na categoria.');
      }
      let created;
      try {
        created = await tx.tournamentCompetitor.create({ data, select: { id: true } });
      } catch (error) {
        this.mapUnique(error, Code.COMPETITOR_EXISTS, 'Este atleta já está na categoria.');
      }
      await this.bump(tx, category.tournamentId);
      return {
        value: await this.categoryView(tx, organizationId, categoryId),
        tournamentId: category.tournamentId,
        changed: true,
        audits: [{ action: AuditAction.TOURNAMENT_COMPETITOR_ADD, entity: AuditEntity.TOURNAMENT_COMPETITOR, entityId: created.id, meta: { categoryId, source } }],
      };
    });
  }

  private participantToCompetitor(
    organizationId: number,
    categoryId: number,
    orgName: string,
    participant: {
      id: number;
      studentId: number | null;
      guestName: string | null;
      student: { id: number; name: string } | null;
      user: { name: string } | null;
    },
  ): Prisma.TournamentCompetitorUncheckedCreateInput {
    const rawName = participant.student?.name ?? participant.guestName ?? participant.user?.name ?? 'Participante';
    const cleaned = cleanText(rawName) ?? 'Participante';
    const displayName = (cleaned.length >= L.displayNameMin ? cleaned : `${cleaned} `.padEnd(L.displayNameMin, '.')).slice(0, L.displayNameMax);
    return {
      organizationId,
      categoryId,
      displayName,
      groupName: orgName.slice(0, L.groupNameMax),
      studentId: participant.student?.id ?? null,
      eventParticipantId: participant.id,
    };
  }

  async importFromParticipants(organizationId: number, user: AuthenticatedUser, eventId: number, categoryId: number, dto: ImportParticipantsDto) {
    const actor = await this.actor(organizationId, user, true);
    await this.loadEvent(actor, eventId);
    return this.run(actor, async (tx) => {
      const category = await this.lockCategory(tx, actor, eventId, categoryId);
      this.assertSetup(category);
      const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } });
      const [participants, existing] = await Promise.all([
        tx.eventParticipant.findMany({
          where: { id: { in: dto.eventParticipantIds }, organizationId, eventId },
          include: { student: { select: { id: true, name: true, anonymizedAt: true } }, user: { select: { name: true } } },
          orderBy: { id: 'asc' },
        }),
        tx.tournamentCompetitor.findMany({ where: { categoryId }, select: { studentId: true, eventParticipantId: true } }),
      ]);
      const takenStudents = new Set(existing.map((c) => c.studentId).filter((v): v is number => v !== null));
      const takenParticipants = new Set(existing.map((c) => c.eventParticipantId).filter((v): v is number => v !== null));
      const eligible: Prisma.TournamentCompetitorUncheckedCreateInput[] = [];
      for (const p of participants) {
        if (p.status !== ParticipantStatus.CONFIRMED && p.status !== ParticipantStatus.ATTENDED) continue;
        if (p.student?.anonymizedAt) continue;
        if (takenParticipants.has(p.id) || (p.student && takenStudents.has(p.student.id))) continue;
        takenParticipants.add(p.id);
        if (p.student) takenStudents.add(p.student.id);
        eligible.push(this.participantToCompetitor(organizationId, categoryId, org.name, p));
      }
      if (existing.length + eligible.length > L.maxCompetitors) {
        throw conflict(Code.CATEGORY_FULL, `Uma categoria aceita até ${L.maxCompetitors} atletas.`);
      }
      const added = eligible.length;
      const skipped = dto.eventParticipantIds.length - added;
      if (added === 0) {
        return { value: { added, skipped, category: await this.categoryView(tx, organizationId, categoryId) }, tournamentId: category.tournamentId, changed: false };
      }
      await tx.tournamentCompetitor.createMany({ data: eligible });
      await this.bump(tx, category.tournamentId);
      return {
        value: { added, skipped, category: await this.categoryView(tx, organizationId, categoryId) },
        tournamentId: category.tournamentId,
        changed: true,
        audits: [{ action: AuditAction.TOURNAMENT_COMPETITOR_IMPORT, entity: AuditEntity.TOURNAMENT_CATEGORY, entityId: categoryId, meta: { added, skipped } }],
      };
    });
  }

  async updateCompetitor(organizationId: number, user: AuthenticatedUser, eventId: number, competitorId: number, dto: UpdateCompetitorDto) {
    const actor = await this.actor(organizationId, user, true);
    await this.loadEvent(actor, eventId);
    const categoryId = await this.categoryIdOfCompetitor(actor, eventId, competitorId);
    if (dto.displayName === null || dto.photoAuthorized === null || dto.ageGroup === null) {
      throw badRequest(Code.INVALID_COMPETITOR, 'displayName, photoAuthorized e ageGroup não aceitam null.');
    }
    return this.run(actor, async (tx) => {
      const category = await this.lockCategory(tx, actor, eventId, categoryId);
      const found = await tx.tournamentCompetitor.findFirst({
        where: { id: competitorId, categoryId, organizationId },
        include: { student: { select: STUDENT_INFO_SELECT } },
      });
      if (!found) throw notFound(Code.COMPETITOR_NOT_FOUND, 'Atleta não encontrado.');
      const { student: studentInfo, ...current } = found;
      const derived: CompetitorData = { row: current, student: studentInfo };
      const data: Prisma.TournamentCompetitorUncheckedUpdateInput = {};
      const fields: string[] = [];
      const set = <K extends keyof Prisma.TournamentCompetitorUncheckedUpdateInput>(key: K, value: Prisma.TournamentCompetitorUncheckedUpdateInput[K], previous: unknown) => {
        if (value !== previous) {
          data[key] = value;
          fields.push(String(key));
        }
      };

      if (dto.displayName !== undefined) {
        const name = cleanText(dto.displayName);
        if (!name || name.length < L.displayNameMin || name.length > L.displayNameMax) {
          throw badRequest(Code.INVALID_COMPETITOR, `O nome do atleta deve ter de ${L.displayNameMin} a ${L.displayNameMax} caracteres.`);
        }
        set('displayName', name, current.displayName);
      }
      if (dto.groupName !== undefined) set('groupName', cleanText(dto.groupName), current.groupName);
      if (dto.graduationLabel !== undefined) set('graduationLabel', cleanText(dto.graduationLabel), current.graduationLabel);
      if (dto.seed !== undefined && dto.seed !== current.seed) {
        this.assertSetup(category);
        if (dto.seed !== null) {
          const taken = await tx.tournamentCompetitor.findFirst({ where: { categoryId, seed: dto.seed, id: { not: competitorId } }, select: { id: true } });
          if (taken) throw conflict(Code.SEED_TAKEN, `A semente ${dto.seed} já pertence a outro atleta desta categoria.`);
        }
        set('seed', dto.seed, current.seed);
      }
      // Atleta ligado a aluno: faixa etaria e foto vem do aluno (recalculadas na leitura); so convidado grava. Para aluno,
      // enviar o MESMO valor que o operador ve (devolvido no GET) e ignorado; valor diferente = 400 (nada e ignorado em silencio).
      if (dto.ageGroup !== undefined) {
        if (current.studentId) {
          if (dto.ageGroup !== effectiveAgeGroup(derived, new Date())) {
            throw badRequest(Code.AGE_GROUP_FROM_STUDENT, 'A faixa etária de um atleta ligado a aluno é calculada da data de nascimento do aluno.');
          }
        } else {
          set('ageGroup', dto.ageGroup, current.ageGroup);
        }
      }
      if (dto.photoUrl !== undefined) {
        if (current.studentId) {
          const shown = publicPhotoRef(sourcePhoto(derived));
          const sent = dto.photoUrl === null || dto.photoUrl === '' ? null : dto.photoUrl;
          if (sent !== shown) {
            throw badRequest(Code.INVALID_PHOTO_URL, 'A foto de um atleta ligado a aluno vem do cadastro do aluno.');
          }
        } else {
          set('photoUrl', dto.photoUrl === null || dto.photoUrl === '' ? null : dto.photoUrl, current.photoUrl);
        }
      }
      if (dto.photoAuthorized !== undefined && dto.photoAuthorized !== current.photoAuthorized) {
        data.photoAuthorized = dto.photoAuthorized;
        data.photoAuthorizedById = dto.photoAuthorized ? actor.user.id : null;
        data.photoAuthorizedAt = dto.photoAuthorized ? new Date() : null;
        fields.push('photoAuthorized');
      }
      if (fields.length === 0) {
        return { value: await this.categoryView(tx, organizationId, categoryId), tournamentId: category.tournamentId, changed: false };
      }
      await tx.tournamentCompetitor.update({ where: { id: competitorId }, data });
      await this.bump(tx, category.tournamentId);
      return {
        value: await this.categoryView(tx, organizationId, categoryId),
        tournamentId: category.tournamentId,
        changed: true,
        audits: [{ action: AuditAction.TOURNAMENT_COMPETITOR_UPDATE, entity: AuditEntity.TOURNAMENT_COMPETITOR, entityId: competitorId, meta: { categoryId, fields } }],
      };
    });
  }

  async removeCompetitor(organizationId: number, user: AuthenticatedUser, eventId: number, competitorId: number) {
    const actor = await this.actor(organizationId, user, true);
    await this.loadEvent(actor, eventId);
    const categoryId = await this.categoryIdOfCompetitor(actor, eventId, competitorId);
    return this.run(actor, async (tx) => {
      const category = await this.lockCategory(tx, actor, eventId, categoryId);
      this.assertSetup(category);
      const removed = await tx.tournamentCompetitor.deleteMany({ where: { id: competitorId, categoryId, organizationId } });
      if (removed.count === 0) throw notFound(Code.COMPETITOR_NOT_FOUND, 'Atleta não encontrado.');
      await this.bump(tx, category.tournamentId);
      return {
        value: await this.categoryView(tx, organizationId, categoryId),
        tournamentId: category.tournamentId,
        changed: true,
        audits: [{ action: AuditAction.TOURNAMENT_COMPETITOR_REMOVE, entity: AuditEntity.TOURNAMENT_COMPETITOR, entityId: competitorId, meta: { categoryId } }],
      };
    });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Sorteio / geracao
  // ------------------------------------------------------------------------------------------------------------

  /** Grava as lutas do motor: folga nasce FINISHED (vencedor ja no slot seguinte); PENDING/READY pelos slots. */
  private async insertSpecs(tx: Tx, organizationId: number, categoryId: number, specs: readonly MatchSpec[], now: Date): Promise<void> {
    const work = specs.map((s) => ({ ...s }));
    const byKey = new Map(work.map((s) => [s.key, s]));
    // Defesa: o vencedor de uma folga ja tem de estar no slot da luta seguinte.
    for (const s of work) {
      if (!s.isBye || s.winnerId === null || !s.next) continue;
      const target = byKey.get(s.next.key);
      if (!target) continue;
      if (s.next.slot === 'A' && target.slotA === null) target.slotA = s.winnerId;
      if (s.next.slot === 'B' && target.slotB === null) target.slotB = s.winnerId;
    }
    const ids = new Map<string, number>();
    let pending = work;
    while (pending.length > 0) {
      const layer = pending.filter((s) => [s.next, s.loserNext].every((l) => !l || ids.has(l.key)));
      if (layer.length === 0) throw conflict(Code.INCONSISTENT_STATE, 'O sorteio gerou ligações inválidas entre as lutas.');
      await tx.tournamentMatch.createMany({
        data: layer.map((s) => ({
          organizationId,
          categoryId,
          key: s.key,
          stage: s.stage,
          round: s.round,
          position: s.position,
          groupIndex: s.groupIndex,
          slotAId: s.slotA,
          slotBId: s.slotB,
          nextMatchId: s.next ? ids.get(s.next.key)! : null,
          nextSlot: s.next ? s.next.slot : null,
          loserNextMatchId: s.loserNext ? ids.get(s.loserNext.key)! : null,
          loserNextSlot: s.loserNext ? s.loserNext.slot : null,
          isBye: s.isBye,
          status: s.isBye ? TournamentMatchStatus.FINISHED : statusFromSlots(s.slotA, s.slotB),
          winnerId: s.isBye ? s.winnerId : null,
          finishedAt: s.isBye ? now : null,
        })),
      });
      const created = await tx.tournamentMatch.findMany({
        where: { categoryId, key: { in: layer.map((s) => s.key) } },
        select: { id: true, key: true },
      });
      for (const row of created) ids.set(row.key, row.id);
      const done = new Set(layer.map((s) => s.key));
      pending = pending.filter((s) => !done.has(s.key));
    }
  }

  async generate(organizationId: number, user: AuthenticatedUser, eventId: number, categoryId: number, dto: GenerateDto) {
    const actor = await this.actor(organizationId, user, true);
    await this.loadEvent(actor, eventId);
    return this.run(actor, async (tx) => {
      const category = await this.lockCategory(tx, actor, eventId, categoryId);
      if (category.status === TournamentCategoryStatus.FINISHED) {
        throw conflict(Code.HAS_RESULTS, 'A categoria já terminou: desfaça resultados antes de sortear de novo.');
      }
      const existing = await tx.tournamentMatch.findMany({ where: { categoryId }, select: { id: true, isBye: true, status: true } });
      if (existing.length > 0) {
        if (dto.regenerate !== true) throw conflict(Code.ALREADY_GENERATED, 'A chave já foi gerada. Use regenerate para sortear de novo.');
        if (existing.some((m) => !m.isBye && (m.status === 'LIVE' || m.status === 'FINISHED'))) {
          throw conflict(Code.HAS_RESULTS, 'Há lutas em andamento ou terminadas: não dá para sortear de novo.');
        }
      }
      const competitors = await tx.tournamentCompetitor.findMany({ where: { categoryId }, orderBy: { id: 'asc' } });
      if (competitors.length < L.minCompetitors) {
        throw conflict(Code.NOT_ENOUGH_COMPETITORS, `São necessários pelo menos ${L.minCompetitors} atletas para gerar a chave.`);
      }
      const config = { groupCount: category.groupCount, advancePerGroup: category.advancePerGroup };
      if (category.format === TournamentFormat.GROUPS_KNOCKOUT) {
        const error = groupConfigError(config) ?? groupSizeError(competitors.length, config);
        if (error) throw conflict(Code.INVALID_GROUP_CONFIG, error);
      }

      const now = new Date();
      const rngSeed = newDrawSeed();
      const engineCompetitors: EngineCompetitor[] = competitors.map((c) => ({ id: c.id, seed: c.seed, groupName: c.groupName }));
      let specs: MatchSpec[];
      const poolOf = new Map<number, number>();
      try {
        if (category.format === TournamentFormat.SINGLE_ELIMINATION) {
          specs = generateSingleElimination(engineCompetitors, { seeding: dto.seeding, thirdPlace: category.thirdPlace, rngSeed });
        } else if (category.format === TournamentFormat.ROUND_ROBIN) {
          specs = generateRoundRobin(engineCompetitors, { rngSeed });
        } else {
          const result = generateGroups(engineCompetitors, { groupCount: category.groupCount!, seeding: dto.seeding, rngSeed });
          result.groups.forEach((ids, g) => ids.forEach((id) => poolOf.set(id, g)));
          specs = result.matches;
        }
      } catch (error) {
        this.logger.error(`Motor de chaveamento falhou: ${error instanceof Error ? error.message : String(error)}`);
        throw conflict(Code.INCONSISTENT_STATE, 'Não foi possível sortear a chave com os atletas atuais.');
      }

      if (existing.length > 0) await tx.tournamentMatch.deleteMany({ where: { categoryId } });
      // poolIndex: so GROUPS_KNOCKOUT; as demais categorias limpam (sorteio anterior).
      await tx.tournamentCompetitor.updateMany({ where: { categoryId }, data: { poolIndex: null } });
      for (const [id, g] of poolOf) await tx.tournamentCompetitor.update({ where: { id }, data: { poolIndex: g } });
      await this.insertSpecs(tx, organizationId, categoryId, specs, now);
      await tx.tournamentCategory.update({
        where: { id: categoryId },
        data: { status: TournamentCategoryStatus.RUNNING, drawSeed: rngSeed, generatedAt: now },
      });
      await this.bump(tx, category.tournamentId);
      return {
        value: await this.categoryView(tx, organizationId, categoryId),
        tournamentId: category.tournamentId,
        changed: true,
        audits: [
          {
            action: AuditAction.TOURNAMENT_GENERATE,
            entity: AuditEntity.TOURNAMENT_CATEGORY,
            entityId: categoryId,
            meta: { format: category.format, seeding: dto.seeding, competitors: competitors.length, matches: specs.length, regenerated: existing.length > 0 },
          },
        ],
      };
    });
  }

  // ------------------------------------------------------------------------------------------------------------
  // Lutas
  // ------------------------------------------------------------------------------------------------------------

  private async applyPatchesDb(tx: Tx, organizationId: number, categoryId: number, patches: PatchMap): Promise<void> {
    for (const [id, patch] of patches) {
      const data: Prisma.TournamentMatchUncheckedUpdateManyInput = {};
      for (const [k, v] of Object.entries(patch)) if (v !== undefined) (data as Record<string, unknown>)[k] = v;
      if (Object.keys(data).length === 0) continue;
      const res = await tx.tournamentMatch.updateMany({ where: { id, categoryId, organizationId }, data });
      if (res.count !== 1) throw conflict(Code.INCONSISTENT_STATE, 'A luta mudou durante a operação. Tente de novo.');
    }
  }

  /** Mata-mata do GROUPS_KNOCKOUT: quando o ultimo jogo de grupo termina (e ainda nao ha mata-mata), gera-o na MESMA transacao. */
  private async maybeGenerateKnockout(tx: Tx, organizationId: number, category: TournamentCategory, now: Date): Promise<boolean> {
    if (category.format !== TournamentFormat.GROUPS_KNOCKOUT) return false;
    const matches = await tx.tournamentMatch.findMany({ where: { categoryId: category.id } });
    if (!allGroupMatchesFinished(matches) || matches.some((m) => m.stage !== 'GROUP')) return false;
    if (category.groupCount === null || category.advancePerGroup === null || category.drawSeed === null) {
      throw conflict(Code.INCONSISTENT_STATE, 'A categoria de grupos está sem configuração.');
    }
    const competitors = await tx.tournamentCompetitor.findMany({ where: { categoryId: category.id }, orderBy: { id: 'asc' } });
    const ordered = orderedGroupIds(competitors, matches, category.groupCount).map((ids) => ids.slice(0, category.advancePerGroup!));
    let specs: MatchSpec[];
    try {
      specs = buildKnockoutFromGroups(ordered, { advancePerGroup: category.advancePerGroup, thirdPlace: category.thirdPlace, rngSeed: category.drawSeed });
    } catch (error) {
      this.logger.error(`Motor falhou ao gerar o mata-mata: ${error instanceof Error ? error.message : String(error)}`);
      throw conflict(Code.INCONSISTENT_STATE, 'Não foi possível gerar o mata-mata.');
    }
    await this.insertSpecs(tx, organizationId, category.id, specs, now);
    return true;
  }

  /** Recalcula o status da categoria (RUNNING <-> FINISHED) depois de mexer nas lutas. */
  private async syncCategoryStatus(tx: Tx, category: TournamentCategory): Promise<void> {
    const matches = await tx.tournamentMatch.findMany({ where: { categoryId: category.id } });
    if (matches.length === 0) return;
    const status = deriveCategoryStatus(matches) === 'FINISHED' ? TournamentCategoryStatus.FINISHED : TournamentCategoryStatus.RUNNING;
    if (status !== category.status) await tx.tournamentCategory.update({ where: { id: category.id }, data: { status } });
  }

  private matchNodes(rows: TournamentMatch[]): MatchNode[] {
    return rows;
  }

  async swapSlots(organizationId: number, user: AuthenticatedUser, eventId: number, matchId: number, dto: SwapSlotsDto) {
    const actor = await this.actor(organizationId, user, true);
    await this.loadEvent(actor, eventId);
    const categoryId = await this.categoryIdOfMatch(actor, eventId, matchId);
    if (dto.slotAId === undefined && dto.slotBId === undefined) {
      throw badRequest(Code.INVALID_COMPETITOR, 'Informe slotAId e/ou slotBId.');
    }
    return this.run(actor, async (tx) => {
      const category = await this.lockCategory(tx, actor, eventId, categoryId);
      const [rows, competitors] = await Promise.all([
        tx.tournamentMatch.findMany({ where: { categoryId } }),
        tx.tournamentCompetitor.findMany({ where: { categoryId }, select: { id: true } }),
      ]);
      const plan = planSwap(this.matchNodes(rows), matchId, dto, new Set(competitors.map((c) => c.id)), category.format);
      if (plan.idempotent) {
        return { value: await this.categoryView(tx, organizationId, categoryId), tournamentId: category.tournamentId, changed: false };
      }
      await this.applyPatchesDb(tx, organizationId, categoryId, plan.patches);
      await this.bump(tx, category.tournamentId);
      return {
        value: await this.categoryView(tx, organizationId, categoryId),
        tournamentId: category.tournamentId,
        changed: true,
        audits: [{ action: AuditAction.TOURNAMENT_SLOTS_SWAP, entity: AuditEntity.TOURNAMENT_MATCH, entityId: matchId, meta: { categoryId, matches: plan.patches.size } }],
      };
    });
  }

  async startMatch(organizationId: number, user: AuthenticatedUser, eventId: number, matchId: number) {
    const actor = await this.actor(organizationId, user, true);
    await this.loadEvent(actor, eventId);
    const categoryId = await this.categoryIdOfMatch(actor, eventId, matchId);
    return this.run(actor, async (tx) => {
      const category = await this.lockCategory(tx, actor, eventId, categoryId);
      const rows = await tx.tournamentMatch.findMany({ where: { categoryId } });
      const plan = planStart(this.matchNodes(rows), matchId, new Date());
      if (plan.idempotent) {
        return { value: await this.categoryView(tx, organizationId, categoryId), tournamentId: category.tournamentId, changed: false };
      }
      await this.applyPatchesDb(tx, organizationId, categoryId, plan.patches);
      await this.bump(tx, category.tournamentId);
      return {
        value: await this.categoryView(tx, organizationId, categoryId),
        tournamentId: category.tournamentId,
        changed: true,
        audits: [{ action: AuditAction.TOURNAMENT_MATCH_START, entity: AuditEntity.TOURNAMENT_MATCH, entityId: matchId, meta: { categoryId } }],
      };
    });
  }

  async recordResult(organizationId: number, user: AuthenticatedUser, eventId: number, matchId: number, dto: MatchResultDto) {
    const actor = await this.actor(organizationId, user, true);
    await this.loadEvent(actor, eventId);
    const categoryId = await this.categoryIdOfMatch(actor, eventId, matchId);
    const note = dto.note === undefined || dto.note === null ? null : cleanText(dto.note);
    return this.run(actor, async (tx) => {
      const category = await this.lockCategory(tx, actor, eventId, categoryId);
      const rows = await tx.tournamentMatch.findMany({ where: { categoryId } });
      const now = new Date();
      const plan = planResult(this.matchNodes(rows), matchId, { ...dto, note }, now);
      if (plan.idempotent) {
        return { value: await this.categoryView(tx, organizationId, categoryId), tournamentId: category.tournamentId, changed: false };
      }
      await this.applyPatchesDb(tx, organizationId, categoryId, plan.patches);
      const knockoutGenerated = await this.maybeGenerateKnockout(tx, organizationId, category, now);
      await this.syncCategoryStatus(tx, category);
      await this.bump(tx, category.tournamentId);
      const match = rows.find((m) => m.id === matchId)!;
      return {
        value: await this.categoryView(tx, organizationId, categoryId),
        tournamentId: category.tournamentId,
        changed: true,
        audits: [
          {
            action: AuditAction.TOURNAMENT_MATCH_RESULT,
            entity: AuditEntity.TOURNAMENT_MATCH,
            entityId: matchId,
            meta: { categoryId, stage: match.stage, resultType: dto.resultType ?? 'NORMAL', knockoutGenerated },
          },
        ],
      };
    });
  }

  async undoMatch(organizationId: number, user: AuthenticatedUser, eventId: number, matchId: number) {
    const actor = await this.actor(organizationId, user, true);
    await this.loadEvent(actor, eventId);
    const categoryId = await this.categoryIdOfMatch(actor, eventId, matchId);
    return this.run(actor, async (tx) => {
      const category = await this.lockCategory(tx, actor, eventId, categoryId);
      const rows = await tx.tournamentMatch.findMany({ where: { categoryId } });
      const before = rows.find((m) => m.id === matchId);
      const plan = planUndo(this.matchNodes(rows), matchId);
      await this.applyPatchesDb(tx, organizationId, categoryId, plan.patches);
      if (plan.deleteKnockout) await tx.tournamentMatch.deleteMany({ where: { categoryId, stage: { not: 'GROUP' } } });
      await this.syncCategoryStatus(tx, category);
      await this.bump(tx, category.tournamentId);
      return {
        value: await this.categoryView(tx, organizationId, categoryId),
        tournamentId: category.tournamentId,
        changed: true,
        audits: [
          {
            action: AuditAction.TOURNAMENT_MATCH_UNDO,
            entity: AuditEntity.TOURNAMENT_MATCH,
            entityId: matchId,
            meta: { categoryId, from: before?.status, knockoutDeleted: plan.deleteKnockout },
          },
        ],
      };
    });
  }

  async updateMatch(organizationId: number, user: AuthenticatedUser, eventId: number, matchId: number, dto: UpdateMatchDto) {
    const actor = await this.actor(organizationId, user, true);
    await this.loadEvent(actor, eventId);
    const categoryId = await this.categoryIdOfMatch(actor, eventId, matchId);
    return this.run(actor, async (tx) => {
      const category = await this.lockCategory(tx, actor, eventId, categoryId);
      const match = await tx.tournamentMatch.findFirst({ where: { id: matchId, categoryId, organizationId } });
      if (!match) throw notFound(Code.MATCH_NOT_FOUND, 'Luta não encontrada.');
      const data: Prisma.TournamentMatchUpdateInput = {};
      const fields: string[] = [];
      if (dto.mat !== undefined && dto.mat !== match.mat) { data.mat = dto.mat; fields.push('mat'); }
      if (dto.queueOrder !== undefined && dto.queueOrder !== match.queueOrder) { data.queueOrder = dto.queueOrder; fields.push('queueOrder'); }
      if (fields.length === 0) {
        return { value: await this.categoryView(tx, organizationId, categoryId), tournamentId: category.tournamentId, changed: false };
      }
      await tx.tournamentMatch.update({ where: { id: matchId }, data });
      await this.bump(tx, category.tournamentId);
      return {
        value: await this.categoryView(tx, organizationId, categoryId),
        tournamentId: category.tournamentId,
        changed: true,
        audits: [{ action: AuditAction.TOURNAMENT_MATCH_UPDATE, entity: AuditEntity.TOURNAMENT_MATCH, entityId: matchId, meta: { categoryId, fields } }],
      };
    });
  }
}
