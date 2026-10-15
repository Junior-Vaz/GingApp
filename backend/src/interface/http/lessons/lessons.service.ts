import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { civilDateRange } from '../../../shared/dates/date-range';
import { formatCivilDateBR } from '../../../shared/dates/format-br';
import { assertActiveTeacher } from '../../../shared/access/teacher-membership';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import {
  assertUnitTarget,
  isRestricted,
  lessonScopeFilter,
  UnitScope,
  UnitScopeService,
  unitScopeFilter,
} from '../../../shared/access/unit-scope';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';
import { NotificationsService, type NotificationPayload } from '../notifications/notifications.service';
import { civilTodayStart } from '../finance/finance.service';

/** Quanto tempo uma aula cancelada continua aparecendo para o aluno (2 dias). */
const CANCELLED_VISIBLE_MS = 2 * 24 * 60 * 60 * 1000;
import { ListLessonsQueryDto } from './dto/list-lessons-query.dto';
import { ListMyLessonsQueryDto } from './dto/list-my-lessons-query.dto';
import { ClassesService } from '../classes/classes.service';
import { StudentsService } from '../students/students.service';
import { requireLinkedStudent } from '../../../shared/access/linked-student';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';
import { ReactivateLessonsDto } from './dto/reactivate-lessons.dto';
import { BulkDeleteLessonsDto } from './dto/bulk-delete-lessons.dto';
import { RankingService } from '../ranking/ranking.service';

/** Teto de aulas reativadas por chamada de POST /lessons/reactivate (acima disso: 400, reduza o periodo). */
export const MAX_REACTIVATE_LESSONS = 500;

/** Teto de aulas apagadas por chamada de POST /lessons/bulk-delete. */
export const MAX_BULK_DELETE_LESSONS = 500;

const REF_SELECT = { id: true, name: true, photo: true } as const;

/** Relações que montam o contrato de leitura (turma, unidade e professor da aula, com os da turma como reserva). */
const LESSON_INCLUDE = {
  class: { select: { ...REF_SELECT, unit: { select: REF_SELECT }, teacher: { select: REF_SELECT } } },
  unit: { select: REF_SELECT },
  teacher: { select: REF_SELECT },
} satisfies Prisma.LessonInclude;

type LessonWithRelations = Prisma.LessonGetPayload<{ include: typeof LESSON_INCLUDE }>;
type Ref = { id: number; name: string; photo: string | null };

/**
 * Aula como a API devolve: todas as colunas (inclusive unitId/teacherUserId) + `class:{id,name,photo}` +
 * `unit:{id,name,photo}|null` (unidade da aula ou, na falta, a da turma) + `teacher:{id,name,photo}|null`
 * (professor da aula ou, na falta, o da turma). Só nome e foto — o mesmo que já é público dentro do grupo.
 */
export type LessonView = Omit<LessonWithRelations, 'class' | 'unit' | 'teacher'> & {
  class: Ref;
  unit: Ref | null;
  teacher: Ref | null;
};

export function toLessonView(lesson: LessonWithRelations): LessonView {
  const { class: klass, unit, teacher, ...rest } = lesson;
  return {
    ...rest,
    class: { id: klass.id, name: klass.name, photo: klass.photo },
    unit: unit ?? klass.unit ?? null,
    teacher: teacher ?? klass.teacher ?? null,
  };
}

/** Aulas do grupo — CRUD completo, sempre isolado por organizationId. */
@Injectable()
export class LessonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classesService: ClassesService,
    private readonly studentsService: StudentsService,
    private readonly notifications: NotificationsService,
    private readonly unitScope: UnitScopeService,
    private readonly audit: AuditService,
    private readonly ranking: RankingService,
  ) {}

  /**
   * Escopo por unidade (E08, shared/access/unit-scope.ts): o PROFESSOR com unidades atribuídas só lista/lê/edita
   * aulas da sua unidade — a unidade efetiva da aula é a dela (Lesson.unitId) ou, se nula, a da turma. Lista e
   * contagem usam o mesmo where; `user` omitido = sem restrição. /lessons/me (findMine) não passa por aqui.
   */
  async findAll(organizationId: number, query: ListLessonsQueryDto = {}, user?: AuthenticatedUser): Promise<Page<LessonView>> {
    const where: Prisma.LessonWhereInput = { organizationId }; // organizationId SEMPRE no where (findMany e count)
    where.AND = [lessonScopeFilter(await this.unitScope.resolve(user, organizationId))];
    if (query.classId !== undefined) where.classId = query.classId;
    if (query.status) where.status = query.status;
    const date = civilDateRange(query.from, query.to);
    if (date) where.date = date;
    const q = query.q?.trim();
    if (q) where.notes = { contains: q, mode: 'insensitive' };

    if (query.order === 'nearest') return this.findAllNearest(where, query);
    const orderBy: Prisma.LessonOrderByWithRelationInput[] =
      query.order === 'asc' || query.order === 'desc' ? [{ date: query.order }, { id: query.order }] : [{ id: 'desc' }];
    const [items, total] = await Promise.all([
      this.prisma.lesson.findMany({ where, include: LESSON_INCLUDE, orderBy, ...pageArgs(query) }),
      this.prisma.lesson.count({ where }),
    ]);
    return { items: items.map(toLessonView), total };
  }

  /** order=nearest: hoje e futuras (data crescente) primeiro; depois as passadas (da mais recente para a mais antiga). */
  private async findAllNearest(base: Prisma.LessonWhereInput, query: ListLessonsQueryDto): Promise<Page<LessonView>> {
    const today = civilTodayStart();
    const upcomingWhere: Prisma.LessonWhereInput = { AND: [base, { date: { gte: today } }] };
    const pastWhere: Prisma.LessonWhereInput = { AND: [base, { date: { lt: today } }] };
    const { take, skip } = pageArgs(query);
    const [upcomingTotal, pastTotal] = await Promise.all([this.prisma.lesson.count({ where: upcomingWhere }), this.prisma.lesson.count({ where: pastWhere })]);
    const upcomingTake = Math.max(0, Math.min(take, upcomingTotal - skip));
    const upcoming =
      upcomingTake > 0
        ? await this.prisma.lesson.findMany({ where: upcomingWhere, include: LESSON_INCLUDE, orderBy: [{ date: 'asc' }, { id: 'asc' }], take: upcomingTake, skip })
        : [];
    const pastTake = take - upcoming.length;
    const pastSkip = Math.max(0, skip - upcomingTotal);
    const past =
      pastTake > 0
        ? await this.prisma.lesson.findMany({ where: pastWhere, include: LESSON_INCLUDE, orderBy: [{ date: 'desc' }, { id: 'desc' }], take: pastTake, skip: pastSkip })
        : [];
    return { items: [...upcoming, ...past].map(toLessonView), total: upcomingTotal + pastTotal };
  }

  /** "Minhas aulas" — aulas das turmas em que os alunos ligados ao usuário autenticado estão
   * matriculados (mesmo padrão de ClassesService.findMine/FinanceService.findMine). Padrão: data
   * crescente (a "próxima aula" fica no topo); `order=desc` inverte. Paginado (limit/offset, total
   * em X-Total-Count) e filtrável por from/to (data da aula) e status — assim o app busca "a partir
   * de hoje" e "anteriores" separadamente, sem depender de uma lista truncada. */
  async findMine(organizationId: number, userId: number, query: ListMyLessonsQueryDto = {}): Promise<Page<LessonView>> {
    let classIds: number[];
    if (query.studentId !== undefined) {
      // Seletor de dependente: só as turmas (matrícula ACTIVE, mesma regra de ClassesService.findMine)
      // DESTE aluno, depois de conferir o vínculo por resolveLink (404 igual para sem vínculo/inexistente).
      await requireLinkedStudent(this.studentsService, organizationId, userId, query.studentId);
      const enrollments = await this.prisma.classStudent.findMany({
        where: { organizationId, studentId: query.studentId, status: 'ACTIVE' },
        select: { classId: true },
      });
      classIds = [...new Set(enrollments.map((e) => e.classId))];
    } else {
      classIds = (await this.classesService.findMine(organizationId, userId)).map((c) => c.id);
    }
    if (classIds.length === 0) return { items: [], total: 0 };

    const where: Prisma.LessonWhereInput = { organizationId, classId: { in: classIds } };
    if (query.status) where.status = query.status;
    const date = civilDateRange(query.from, query.to);
    if (date) where.date = date;
    // Aula CANCELADA não fica mais de 2 dias na lista do aluno: some 2 dias depois do cancelamento
    // (cancelledAt) ou 2 dias depois da data da própria aula, o que vier primeiro. O painel (equipe)
    // continua vendo o histórico completo em /lessons.
    const cutoff = new Date(Date.now() - CANCELLED_VISIBLE_MS);
    const dateCutoff = new Date(civilTodayStart().getTime() - CANCELLED_VISIBLE_MS);
    // Regra POSITIVA (evita o NOT com NULL do SQL, que descartaria canceladas sem cancelledAt): ativa sempre
    // aparece; cancelada só se o cancelamento é recente (ou sem data) E a data da aula não passou de 2 dias.
    where.AND = [
      {
        OR: [
          { status: 'ACTIVE' },
          {
            status: 'INACTIVE',
            AND: [{ OR: [{ cancelledAt: null }, { cancelledAt: { gte: cutoff } }] }, { date: { gte: dateCutoff } }],
          },
        ],
      },
    ];

    const dir = query.order ?? 'asc';
    const [items, total] = await Promise.all([
      this.prisma.lesson.findMany({ where, include: LESSON_INCLUDE, orderBy: [{ date: dir }, { id: dir }], ...pageArgs(query) }),
      this.prisma.lesson.count({ where }),
    ]);
    return { items: items.map(toLessonView), total };
  }

  async findOne(organizationId: number, id: number, user?: AuthenticatedUser): Promise<LessonView> {
    const scope = await this.unitScope.resolve(user, organizationId);
    const lesson = await this.prisma.lesson.findFirst({
      where: { id, organizationId, AND: [lessonScopeFilter(scope)] },
      include: LESSON_INCLUDE,
    });
    if (!lesson) {
      throw new NotFoundException('Aula não encontrada.');
    }
    return toLessonView(lesson);
  }

  async create(organizationId: number, dto: CreateLessonDto, user?: AuthenticatedUser) {
    const scope = await this.unitScope.resolve(user, organizationId);
    await this.assertClassBelongsToOrganization(organizationId, dto.classId, scope);
    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }
    await this.assertEffectiveUnit(organizationId, scope, dto.classId, dto.unitId);
    if (dto.teacherUserId) {
      await this.assertTeacherBelongsToOrganization(organizationId, dto.teacherUserId);
    }

    return this.prisma.lesson.create({
      data: {
        organizationId,
        classId: dto.classId,
        unitId: dto.unitId,
        teacherUserId: dto.teacherUserId,
        date: new Date(dto.date),
        startTime: dto.startTime,
        endTime: dto.endTime,
        notes: dto.notes,
      },
      include: LESSON_INCLUDE,
    }).then(toLessonView);
  }

  async update(organizationId: number, id: number, dto: UpdateLessonDto, user?: AuthenticatedUser) {
    const current = await this.findOne(organizationId, id, user); // 404 se não existir, for de outra organização ou de unidade fora do escopo
    const scope = await this.unitScope.resolve(user, organizationId);

    if (dto.classId) {
      await this.assertClassBelongsToOrganization(organizationId, dto.classId, scope);
    }
    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }
    // 403 se o resultado da edição (turma/unidade) deixaria a aula fora do escopo do professor.
    await this.assertEffectiveUnit(
      organizationId,
      scope,
      dto.classId ?? current.classId,
      dto.unitId === undefined ? current.unitId : dto.unitId,
    );
    if (dto.teacherUserId) {
      await this.assertTeacherBelongsToOrganization(organizationId, dto.teacherUserId);
    }

    const updated = await this.prisma.lesson.update({
      where: { id },
      data: {
        classId: dto.classId,
        unitId: dto.unitId,
        teacherUserId: dto.teacherUserId,
        date: dto.date ? new Date(dto.date) : undefined, // date e obrigatoria: null ja barrado no DTO
        startTime: dto.startTime,
        endTime: dto.endTime,
        notes: dto.notes,
        status: dto.status,
        // Marca o momento do cancelamento (ACTIVE -> INACTIVE) e limpa ao reativar.
        cancelledAt:
          dto.status === 'INACTIVE' && current.status !== 'INACTIVE' ? new Date() : dto.status === 'ACTIVE' ? null : undefined,
      },
      include: LESSON_INCLUDE,
    });
    const view = toLessonView(updated);
    await this.notifyLessonChange(organizationId, current, view);
    return view;
  }

  /** Impacto de apagar a aula (para o diálogo de confirmação do painel): quantas presenças seriam apagadas junto. */
  async deleteImpact(organizationId: number, id: number, user?: AuthenticatedUser): Promise<{ attendances: number }> {
    await this.findOne(organizationId, id, user); // 404 se não existir / outro grupo / unidade fora do escopo
    return { attendances: await this.prisma.attendance.count({ where: { organizationId, lessonId: id } }) };
  }

  /**
   * APAGA DE VERDADE a aula (hard delete). Cancelar continua sendo PATCH { status: 'INACTIVE' } (o histórico fica).
   * Se a aula tem presenças (Attendance), exige `confirm`: sem ele => 409 `{ attendances: N }` e nada é apagado.
   * Tudo numa transação: presenças e a aula (AttendanceNotice cai em cascata). Os pontos do Ginga Rank (PointEvent) são
   * DERIVADOS das presenças (RankingService.doSync remove os "órfãos"), então depois do commit agendamos o recálculo dos
   * alunos afetados (fire-and-forget) — nada é decrementado à mão. Audita LESSON_DELETE (turma, data, contagens).
   */
  async destroy(organizationId: number, id: number, confirm: boolean, user?: AuthenticatedUser): Promise<{ deleted: true; attendances: number }> {
    const lesson = await this.findOne(organizationId, id, user);
    const attendances = await this.prisma.attendance.findMany({
      where: { organizationId, lessonId: id },
      select: { studentId: true },
    });
    if (attendances.length > 0 && !confirm) throw this.confirmRequired({ attendances: attendances.length });

    await this.prisma.$transaction(async (tx) => {
      await tx.attendance.deleteMany({ where: { organizationId, lessonId: id } });
      await tx.lesson.delete({ where: { id } });
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.LESSON_DELETE,
      entity: AuditEntity.LESSON,
      entityId: id,
      meta: { classId: lesson.classId, date: lesson.date, status: lesson.status, attendances: attendances.length },
    });
    this.ranking.queueSync(attendances.map((a) => a.studentId));
    return { deleted: true, attendances: attendances.length };
  }

  /**
   * Apaga EM LOTE aulas CANCELADAS (INACTIVE): `onlyCancelled: true` (+ `classId`) ou `ids`. Só do grupo e do escopo de
   * unidade do usuário (aula fora do escopo nem entra na conta). Aula NÃO cancelada nunca é apagada por aqui (em `ids`,
   * vira `skipped`). Máx. MAX_BULK_DELETE_LESSONS por chamada (acima: 400, nada é apagado). `dryRun` só conta.
   * Com presenças em alguma aula exige `confirm` (409 com `{ lessons, attendances }`). Transação única; audita
   * LESSON_DELETE_BULK; recalcula o Ginga Rank dos alunos afetados (ver `destroy`).
   */
  async bulkDelete(
    organizationId: number,
    dto: BulkDeleteLessonsDto,
    user?: AuthenticatedUser,
  ): Promise<{ lessons: number; attendances: number; skipped: number; deleted: boolean }> {
    const hasIds = dto.ids !== undefined;
    if (!hasIds && dto.onlyCancelled !== true) {
      throw new BadRequestException('Informe onlyCancelled: true (apagar as canceladas) ou a lista de ids.');
    }
    if (hasIds && dto.onlyCancelled === true) {
      throw new BadRequestException('Informe onlyCancelled OU ids, não os dois.');
    }
    const scope = await this.unitScope.resolve(user, organizationId);
    if (dto.classId !== undefined) await this.assertClassBelongsToOrganization(organizationId, dto.classId, scope);

    const base: Prisma.LessonWhereInput = {
      organizationId,
      ...(dto.classId !== undefined ? { classId: dto.classId } : {}),
      ...(hasIds ? { id: { in: dto.ids } } : {}),
      AND: [lessonScopeFilter(scope)],
    };
    const targets = await this.prisma.lesson.findMany({
      where: { ...base, status: 'INACTIVE' },
      select: { id: true, classId: true },
      take: MAX_BULK_DELETE_LESSONS + 1,
    });
    if (targets.length > MAX_BULK_DELETE_LESSONS) {
      throw new BadRequestException(
        `Mais de ${MAX_BULK_DELETE_LESSONS} aulas canceladas: apague por turma ou em partes menores.`,
      );
    }
    const skipped = hasIds ? (dto.ids as number[]).length - targets.length : 0;
    const lessonIds = targets.map((t) => t.id);
    const attendances = lessonIds.length
      ? await this.prisma.attendance.findMany({ where: { organizationId, lessonId: { in: lessonIds } }, select: { studentId: true } })
      : [];
    const summary = { lessons: targets.length, attendances: attendances.length, skipped };
    if (dto.dryRun === true) return { ...summary, deleted: false };
    if (targets.length === 0) return { ...summary, deleted: false };
    if (attendances.length > 0 && dto.confirm !== true) throw this.confirmRequired({ lessons: targets.length, attendances: attendances.length });

    // `status: 'INACTIVE'` de novo no DELETE: aula reativada por outra pessoa entre a leitura e a escrita não é apagada.
    const result = await this.prisma.$transaction(async (tx) => {
      const still = await tx.lesson.findMany({
        where: { organizationId, status: 'INACTIVE', id: { in: lessonIds } },
        select: { id: true },
      });
      const ids = still.map((l) => l.id);
      await tx.attendance.deleteMany({ where: { organizationId, lessonId: { in: ids } } });
      const del = await tx.lesson.deleteMany({ where: { organizationId, id: { in: ids } } });
      return del.count;
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.LESSON_DELETE_BULK,
      entity: AuditEntity.LESSON,
      meta: { count: result, attendances: attendances.length, classId: dto.classId ?? null, mode: hasIds ? 'ids' : 'onlyCancelled' },
    });
    this.ranking.queueSync(attendances.map((a) => a.studentId));
    return { ...summary, lessons: result, deleted: true };
  }

  /** 409 de "confirme": a contagem do que seria apagado vai no corpo, para o painel montar o aviso forte. */
  private confirmRequired(counts: Record<string, number>): ConflictException {
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: 'CONFIRM_REQUIRED',
      message: 'Esta ação apaga presenças registradas. Confirme para continuar (confirm=true).',
      ...counts,
    });
  }

  /**
   * Reativa EM MASSA as aulas canceladas (INACTIVE) do intervalo [from, to] (datas civis inclusivas, mesma regra de
   * GET /lessons), opcionalmente de uma turma. Respeita o grupo e o escopo de unidade do usuario (aula fora do escopo
   * nem entra na conta). No maximo MAX_REACTIVATE_LESSONS por chamada: acima disso 400 (nada e alterado) pedindo um
   * periodo menor. Limpa cancelledAt, audita LESSON_REACTIVATE_BULK (contagem/periodo/turma) e, so com `notify: true`,
   * avisa cada turma com o gatilho "Aula reativada" (padrao: silencioso, para nao gerar spam).
   */
  async reactivate(
    organizationId: number,
    dto: ReactivateLessonsDto,
    user?: AuthenticatedUser,
  ): Promise<{ reactivated: number }> {
    const date = civilDateRange(dto.from, dto.to);
    if (date?.gte && date.lte && date.gte.getTime() > date.lte.getTime()) {
      throw new BadRequestException('to deve ser igual ou posterior a from.');
    }
    const scope = await this.unitScope.resolve(user, organizationId);
    if (dto.classId !== undefined) await this.assertClassBelongsToOrganization(organizationId, dto.classId, scope);

    const where: Prisma.LessonWhereInput = {
      organizationId,
      status: 'INACTIVE',
      ...(date ? { date } : {}),
      ...(dto.classId !== undefined ? { classId: dto.classId } : {}),
      AND: [lessonScopeFilter(scope)],
    };
    const cancelled = await this.prisma.lesson.findMany({
      where,
      select: { id: true, classId: true, date: true, startTime: true, endTime: true },
      orderBy: [{ date: 'asc' }, { id: 'asc' }],
      take: MAX_REACTIVATE_LESSONS + 1,
    });
    if (cancelled.length > MAX_REACTIVATE_LESSONS) {
      throw new BadRequestException(
        `Mais de ${MAX_REACTIVATE_LESSONS} aulas canceladas nesse período: escolha um período ou uma turma menor.`,
      );
    }
    if (cancelled.length === 0) return { reactivated: 0 };

    // `status: 'INACTIVE'` de novo no UPDATE: uma aula reativada por outra pessoa entre a leitura e a escrita nao conta.
    const result = await this.prisma.lesson.updateMany({
      where: { organizationId, status: 'INACTIVE', id: { in: cancelled.map((l) => l.id) } },
      data: { status: 'ACTIVE', cancelledAt: null },
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.LESSON_REACTIVATE_BULK,
      entity: AuditEntity.LESSON,
      meta: { count: result.count, classId: dto.classId ?? null, from: dto.from, to: dto.to, notify: dto.notify === true },
    });
    if (dto.notify === true) {
      for (const lesson of cancelled) {
        await this.notifyLessonChange(
          organizationId,
          { ...lesson, status: 'INACTIVE' },
          { ...lesson, status: 'ACTIVE' },
        );
      }
    }
    return { reactivated: result.count };
  }

  /**
   * Gatilho de notificação (E09): avisa os alunos matriculados (ACTIVE) na turma da aula — e os
   * responsáveis com login — quando a aula é CANCELADA (ACTIVE -> INACTIVE), REATIVADA
   * (INACTIVE -> ACTIVE) ou tem DIA/HORÁRIO alterados. Não notifica:
   * - edição que não mexe em status/dia/horário (ex.: observações, professor);
   * - aula que continua cancelada (nada a avisar);
   * - aula cujo dia novo já passou (dia civil de America/Sao_Paulo, mesmo "hoje" do financeiro).
   * Falha ao notificar nunca derruba o PATCH/DELETE (NotificationsService.safely).
   */
  private async notifyLessonChange(
    organizationId: number,
    before: Pick<LessonView, 'status' | 'date' | 'startTime' | 'endTime' | 'classId'>,
    after: Pick<LessonView, 'status' | 'date' | 'startTime' | 'endTime' | 'classId'>,
  ): Promise<void> {
    const cancelled = before.status === 'ACTIVE' && after.status === 'INACTIVE';
    const reactivated = before.status === 'INACTIVE' && after.status === 'ACTIVE';
    const rescheduled =
      after.status === 'ACTIVE' &&
      !reactivated &&
      (before.date.getTime() !== after.date.getTime() ||
        before.startTime !== after.startTime ||
        before.endTime !== after.endTime);
    if (!cancelled && !reactivated && !rescheduled) return;
    if (after.date.getTime() < civilTodayStart().getTime()) return;

    const klass = await this.prisma.class.findFirst({
      where: { id: after.classId, organizationId },
      select: { name: true },
    });
    const className = klass?.name ?? 'sua turma';
    const when = `${formatCivilDateBR(after.date)}${after.startTime ? ` às ${after.startTime}` : ''}`;

    let payload: NotificationPayload;
    if (cancelled) {
      payload = {
        title: 'Aula cancelada',
        body: `A aula de ${className} de ${when} foi cancelada.`,
        type: 'LESSON_CANCELLED',
      };
    } else if (reactivated) {
      payload = {
        title: 'Aula reativada',
        body: `A aula de ${className} de ${when} voltou a acontecer.`,
        type: 'LESSON_CHANGED',
      };
    } else {
      const was = `${formatCivilDateBR(before.date)}${before.startTime ? ` às ${before.startTime}` : ''}`;
      payload = {
        title: 'Aula alterada',
        body: `A aula de ${className} marcada para ${was} foi alterada para ${when}.`,
        type: 'LESSON_CHANGED',
      };
    }
    await this.notifications.notifyClassStudents(organizationId, after.classId, payload);
  }

  /** Nunca confiar em classId vindo do corpo da requisição sem confirmar que pertence à
   * organização do usuário autenticado (mesmo padrão de unitId em StudentsService). */
  private async assertClassBelongsToOrganization(
    organizationId: number,
    classId: number,
    scope: UnitScope = 'ALL',
  ): Promise<void> {
    // Turma de unidade fora do escopo do professor = o MESMO 400 de turma inexistente/de outro grupo.
    const klass = await this.prisma.class.findFirst({
      where: { id: classId, organizationId, ...unitScopeFilter(scope) },
    });
    if (!klass) {
      throw new BadRequestException('Turma inválida para esta organização.');
    }
  }

  /** Professor restrito: a unidade efetiva da aula (a informada ou, na falta, a da turma) tem de estar no escopo (403). */
  private async assertEffectiveUnit(
    organizationId: number,
    scope: UnitScope,
    classId: number,
    unitId: number | null | undefined,
  ): Promise<void> {
    if (!isRestricted(scope)) return;
    let effective = unitId ?? null;
    if (effective === null) {
      const klass = await this.prisma.class.findFirst({
        where: { id: classId, organizationId },
        select: { unitId: true },
      });
      effective = klass?.unitId ?? null;
    }
    assertUnitTarget(scope, effective);
  }

  /** Nunca confiar em unitId vindo do corpo da requisição sem confirmar que pertence à
   * organização do usuário autenticado (PLANO_PROJETO.md §3.2 item 4). */
  private async assertUnitBelongsToOrganization(organizationId: number, unitId: number): Promise<void> {
    const unit = await this.prisma.unit.findFirst({ where: { id: unitId, organizationId } });
    if (!unit) {
      throw new BadRequestException('Unidade inválida para esta organização.');
    }
  }

  /** teacherUserId não é uma FK Prisma direta para um model Teacher (não existe): é o User.id
   * de um membro ATIVO da organização com role MESTRE ou PROFESSOR — SSOT em
   * shared/access/teacher-membership.ts (a mesma regra vale para o professor responsável da turma). */
  private assertTeacherBelongsToOrganization(organizationId: number, teacherUserId: number): Promise<void> {
    return assertActiveTeacher(this.prisma, organizationId, teacherUserId);
  }
}
