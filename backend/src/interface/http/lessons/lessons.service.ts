import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Lesson, Prisma } from '@prisma/client';
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
import { NotificationsService, type NotificationPayload } from '../notifications/notifications.service';
import { civilTodayStart } from '../finance/finance.service';
import { ListLessonsQueryDto } from './dto/list-lessons-query.dto';
import { ListMyLessonsQueryDto } from './dto/list-my-lessons-query.dto';
import { ClassesService } from '../classes/classes.service';
import { StudentsService } from '../students/students.service';
import { requireLinkedStudent } from '../../../shared/access/linked-student';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';

/** Aulas do grupo — CRUD completo, sempre isolado por organizationId. */
@Injectable()
export class LessonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classesService: ClassesService,
    private readonly studentsService: StudentsService,
    private readonly notifications: NotificationsService,
    private readonly unitScope: UnitScopeService,
  ) {}

  /**
   * Escopo por unidade (E08, shared/access/unit-scope.ts): o PROFESSOR com unidades atribuídas só lista/lê/edita
   * aulas da sua unidade — a unidade efetiva da aula é a dela (Lesson.unitId) ou, se nula, a da turma. Lista e
   * contagem usam o mesmo where; `user` omitido = sem restrição. /lessons/me (findMine) não passa por aqui.
   */
  async findAll(organizationId: number, query: ListLessonsQueryDto = {}, user?: AuthenticatedUser): Promise<Page<Lesson>> {
    const where: Prisma.LessonWhereInput = { organizationId }; // organizationId SEMPRE no where (findMany e count)
    where.AND = [lessonScopeFilter(await this.unitScope.resolve(user, organizationId))];
    if (query.classId !== undefined) where.classId = query.classId;
    if (query.status) where.status = query.status;
    const date = civilDateRange(query.from, query.to);
    if (date) where.date = date;
    const q = query.q?.trim();
    if (q) where.notes = { contains: q, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      this.prisma.lesson.findMany({ where, orderBy: { id: 'desc' }, ...pageArgs(query) }),
      this.prisma.lesson.count({ where }),
    ]);
    return { items, total };
  }

  /** "Minhas aulas" — aulas das turmas em que os alunos ligados ao usuário autenticado estão
   * matriculados (mesmo padrão de ClassesService.findMine/FinanceService.findMine). Padrão: data
   * crescente (a "próxima aula" fica no topo); `order=desc` inverte. Paginado (limit/offset, total
   * em X-Total-Count) e filtrável por from/to (data da aula) e status — assim o app busca "a partir
   * de hoje" e "anteriores" separadamente, sem depender de uma lista truncada. */
  async findMine(organizationId: number, userId: number, query: ListMyLessonsQueryDto = {}): Promise<Page<Lesson>> {
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

    const dir = query.order ?? 'asc';
    const [items, total] = await Promise.all([
      this.prisma.lesson.findMany({ where, orderBy: [{ date: dir }, { id: dir }], ...pageArgs(query) }),
      this.prisma.lesson.count({ where }),
    ]);
    return { items, total };
  }

  async findOne(organizationId: number, id: number, user?: AuthenticatedUser) {
    const scope = await this.unitScope.resolve(user, organizationId);
    const lesson = await this.prisma.lesson.findFirst({
      where: { id, organizationId, AND: [lessonScopeFilter(scope)] },
    });
    if (!lesson) {
      throw new NotFoundException('Aula não encontrada.');
    }
    return lesson;
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
    });
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
      },
    });
    await this.notifyLessonChange(organizationId, current, updated);
    return updated;
  }

  /**
   * "Remover" uma aula nunca apaga o registro — o histórico não deve ser apagado quando a
   * aula fica cancelada (mesmo padrão de Students/Teachers: PLANO_PROJETO.md §10.5). Marca
   * status = INACTIVE (= "cancelada" para Lesson).
   */
  async remove(organizationId: number, id: number, user?: AuthenticatedUser) {
    const current = await this.findOne(organizationId, id, user);
    const updated = await this.prisma.lesson.update({ where: { id }, data: { status: 'INACTIVE' } });
    await this.notifyLessonChange(organizationId, current, updated);
    return updated;
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
  private async notifyLessonChange(organizationId: number, before: Lesson, after: Lesson): Promise<void> {
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
