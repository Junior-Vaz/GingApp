import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Class, Prisma } from '@prisma/client';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { ListClassesQueryDto } from './dto/list-classes-query.dto';
import { StudentsService } from '../students/students.service';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';
import { isTimeOfDay, isValidTimeRange } from '../../../shared/dates/time-of-day';
import { assertActiveTeacher } from '../../../shared/access/teacher-membership';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import {
  assertUnitUpdate,
  resolveWriteUnit,
  UnitScopeService,
  unitScopeFilter,
} from '../../../shared/access/unit-scope';
import { GenerateLessonsDto } from './dto/generate-lessons.dto';
import { AuditAction, AuditEntity } from '../../../shared/audit/audit-actions';
import { AuditService } from '../../../shared/audit/audit.service';

const DAY_MS = 86_400_000;
/** Maior intervalo aceito por POST /classes/:id/generate-lessons (to - from, em dias). */
export const MAX_GENERATE_LESSONS_SPAN_DAYS = 90;
/** Namespace do advisory lock de geração (par com o id da turma): serializa gerações concorrentes da MESMA turma. */
export const GENERATE_LESSONS_LOCK_NS = 7106;

/** "YYYY-MM-DD" -> meia-noite UTC do dia (mesma convenção das datas de aula). 400 se o dia não existe (ex.: 30/02). */
function parseCivilDate(value: string, field: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${field} não é uma data válida (use YYYY-MM-DD).`);
  }
  return date;
}

export interface GenerateLessonsResult {
  classId: number;
  from: string;
  to: string;
  /** Quantas datas do intervalo caem no dia da semana da turma. */
  occurrences: number;
  /** Aulas criadas agora. */
  created: number;
  /** Ocorrências ignoradas porque já existe aula (qualquer status, inclusive cancelada) da turma naquela data. */
  ignored: number;
  createdDates: string[];
  ignoredDates: string[];
}

/** Turmas do grupo — CRUD completo, sempre isolado por organizationId. */
@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentsService: StudentsService,
    private readonly unitScope: UnitScopeService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Escopo por unidade (E08, shared/access/unit-scope.ts): o PROFESSOR com unidades atribuídas só lista/lê/edita
   * turmas das suas unidades (lista e contagem usam o mesmo where); `user` omitido = sem restrição. As rotas
   * /me (findMine) NÃO passam por aqui: o escopo delas é o vínculo do aluno.
   */
  async findAll(organizationId: number, query: ListClassesQueryDto = {}, user?: AuthenticatedUser): Promise<Page<Class>> {
    const where: Prisma.ClassWhereInput = { organizationId }; // organizationId SEMPRE no where (findMany e count)
    where.AND = [unitScopeFilter(await this.unitScope.resolve(user, organizationId))];
    if (query.status) where.status = query.status;
    if (query.unitId !== undefined) where.unitId = query.unitId;
    const q = query.q?.trim();
    if (q) where.name = { contains: q, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      this.prisma.class.findMany({ where, orderBy: { id: 'desc' }, ...pageArgs(query) }),
      this.prisma.class.count({ where }),
    ]);
    return { items, total };
  }

  /** "Minhas turmas" — as turmas em que os alunos ligados ao usuário autenticado estão
   * matriculados (mesmo padrão de FinanceService.findMine). */
  async findMine(organizationId: number, userId: number) {
    const students = await this.studentsService.findMine(organizationId, userId);
    if (students.length === 0) return [];

    const enrollments = await this.prisma.classStudent.findMany({
      where: { organizationId, studentId: { in: students.map((s) => s.id) }, status: 'ACTIVE' },
      select: { classId: true },
    });
    const classIds = [...new Set(enrollments.map((e) => e.classId))];
    if (classIds.length === 0) return [];

    return this.prisma.class.findMany({ where: { id: { in: classIds } } });
  }

  async findOne(organizationId: number, id: number, user?: AuthenticatedUser) {
    const scope = await this.unitScope.resolve(user, organizationId);
    const classItem = await this.prisma.class.findFirst({ where: { id, organizationId, ...unitScopeFilter(scope) } });
    if (!classItem) {
      throw new NotFoundException('Turma não encontrada.');
    }
    return classItem;
  }

  async create(organizationId: number, dto: CreateClassDto, user?: AuthenticatedUser) {
    const unitId = resolveWriteUnit(await this.unitScope.resolve(user, organizationId), dto.unitId);
    if (unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, unitId);
    }
    if (dto.teacherUserId) {
      await assertActiveTeacher(this.prisma, organizationId, dto.teacherUserId);
    }

    const created = await this.prisma.class.create({
      data: {
        organizationId,
        unitId,
        teacherUserId: dto.teacherUserId,
        name: dto.name,
        description: dto.description,
        weekday: dto.weekday,
        startTime: dto.startTime,
        endTime: dto.endTime,
      },
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.CLASS_CREATE,
      entity: AuditEntity.CLASS,
      entityId: created.id,
      meta: { name: created.name, unitId: created.unitId },
    });
    return created;
  }

  async update(organizationId: number, id: number, dto: UpdateClassDto, user?: AuthenticatedUser) {
    const current = await this.findOne(organizationId, id, user); // 404 se não existir, for de outra organização ou de unidade fora do escopo
    assertUnitUpdate(await this.unitScope.resolve(user, organizationId), dto.unitId); // 403: não move para fora do escopo

    // Update parcial: se só um dos horários vem no payload, compara com o valor já gravado
    // (o DTO só consegue comparar quando os dois vêm juntos). null limpa o campo -> sem comparação.
    const start = dto.startTime === undefined ? current.startTime : dto.startTime;
    const end = dto.endTime === undefined ? current.endTime : dto.endTime;
    if (start && end && isTimeOfDay(start) && isTimeOfDay(end) && !isValidTimeRange(start, end)) {
      throw new BadRequestException('endTime deve ser posterior a startTime.');
    }

    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }
    if (dto.teacherUserId) {
      await assertActiveTeacher(this.prisma, organizationId, dto.teacherUserId);
    }

    const updated = await this.prisma.class.update({
      where: { id },
      data: {
        unitId: dto.unitId,
        teacherUserId: dto.teacherUserId,
        name: dto.name,
        description: dto.description,
        weekday: dto.weekday,
        startTime: dto.startTime,
        endTime: dto.endTime,
        status: dto.status,
      },
    });
    await this.audit.record({
      organizationId,
      action: dto.status === 'INACTIVE' ? AuditAction.CLASS_INACTIVATE : AuditAction.CLASS_UPDATE,
      entity: AuditEntity.CLASS,
      entityId: id,
      meta: {
        fields: Object.entries(dto)
          .filter(([, value]) => value !== undefined)
          .map(([key]) => key),
        status: updated.status,
      },
    });
    return updated;
  }

  /**
   * "Remover" uma turma nunca apaga o registro — o histórico não deve ser apagado quando a
   * turma fica inativa (mesmo padrão do StudentsService). Marca status = INACTIVE.
   */
  async remove(organizationId: number, id: number, user?: AuthenticatedUser) {
    await this.findOne(organizationId, id, user);
    const updated = await this.prisma.class.update({ where: { id }, data: { status: 'INACTIVE' } });
    await this.audit.record({
      organizationId,
      action: AuditAction.CLASS_INACTIVATE,
      entity: AuditEntity.CLASS,
      entityId: id,
    });
    return updated;
  }

  /**
   * Gera as aulas da turma no período: uma Lesson para cada data de [from, to] (inclusivas, datas
   * civis UTC — mesma convenção de Lesson.date: meia-noite UTC) cujo dia da semana é o `weekday`
   * da turma. Copia unidade, professor responsável e horário da turma.
   * - Só turma ATIVA e com dia da semana definido; to - from <= 90 dias; from <= to.
   * - Nunca cria antes de `from`.
   * - Idempotente: data que já tem aula da turma (qualquer status — uma aula cancelada NÃO é
   *   recriada) é ignorada e contada em `ignored`. Gerações concorrentes da mesma turma são
   *   serializadas por advisory lock transacional (Lesson não tem unique por turma+data).
   */
  async generateLessons(
    organizationId: number,
    classId: number,
    dto: GenerateLessonsDto,
    user?: AuthenticatedUser,
  ): Promise<GenerateLessonsResult> {
    const klass = await this.findOne(organizationId, classId, user); // 404 se não existir ou for de outra organização
    if (klass.status !== 'ACTIVE') {
      throw new BadRequestException('Turma inativa: reative a turma antes de gerar aulas.');
    }
    if (klass.weekday === null) {
      throw new BadRequestException('A turma não tem dia da semana definido: informe o dia para gerar aulas.');
    }

    const from = parseCivilDate(dto.from, 'from');
    const to = parseCivilDate(dto.to, 'to');
    if (to.getTime() < from.getTime()) {
      throw new BadRequestException('to deve ser igual ou posterior a from.');
    }
    if ((to.getTime() - from.getTime()) / DAY_MS > MAX_GENERATE_LESSONS_SPAN_DAYS) {
      throw new BadRequestException(`O período não pode passar de ${MAX_GENERATE_LESSONS_SPAN_DAYS} dias.`);
    }

    const days: string[] = [];
    for (let t = from.getTime(); t <= to.getTime(); t += DAY_MS) {
      const day = new Date(t);
      if (day.getUTCDay() === klass.weekday) days.push(day.toISOString().slice(0, 10));
    }

    const base = { classId, from: dto.from, to: dto.to, occurrences: days.length };
    if (days.length === 0) {
      return { ...base, created: 0, ignored: 0, createdDates: [], ignoredDates: [] };
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${GENERATE_LESSONS_LOCK_NS}::int, ${classId}::int)`;

      // Intervalo (e não "date IN (...)"): uma aula criada à mão com horário no timestamp também conta
      // como existente naquele dia civil UTC.
      const existing = await tx.lesson.findMany({
        where: {
          organizationId,
          classId,
          date: { gte: from, lte: new Date(to.getTime() + DAY_MS - 1) },
        },
        select: { date: true },
      });
      const taken = new Set(existing.map((l) => l.date.toISOString().slice(0, 10)));
      const createdDates = days.filter((d) => !taken.has(d));
      const ignoredDates = days.filter((d) => taken.has(d));

      if (createdDates.length > 0) {
        await tx.lesson.createMany({
          data: createdDates.map((d) => ({
            organizationId,
            classId,
            unitId: klass.unitId,
            teacherUserId: klass.teacherUserId,
            date: new Date(`${d}T00:00:00.000Z`),
            startTime: klass.startTime,
            endTime: klass.endTime,
          })),
        });
      }
      return { ...base, created: createdDates.length, ignored: ignoredDates.length, createdDates, ignoredDates };
    });
  }

  /** Alunos matriculados (ativos) na turma, com os dados básicos do aluno. */
  async listStudents(organizationId: number, classId: number, user?: AuthenticatedUser) {
    await this.findOne(organizationId, classId, user);
    const enrollments = await this.prisma.classStudent.findMany({
      where: { organizationId, classId, status: 'ACTIVE' },
      include: { student: { select: { id: true, name: true, status: true } } },
      orderBy: { student: { name: 'asc' } },
    });
    return enrollments.map((e) => ({
      id: e.id,
      studentId: e.studentId,
      name: e.student.name,
      studentStatus: e.student.status,
      enrolledAt: e.enrolledAt,
    }));
  }

  /** Matricula um aluno na turma (idempotente: reativa uma matrícula inativa, repetir não duplica). */
  async enrollStudent(organizationId: number, classId: number, studentId: number, user?: AuthenticatedUser) {
    await this.findOne(organizationId, classId, user);
    // Aluno de unidade fora do escopo do professor = o MESMO 400 de aluno inexistente/de outro grupo.
    const scope = await this.unitScope.resolve(user, organizationId);
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, organizationId, ...unitScopeFilter(scope) },
    });
    if (!student) {
      throw new BadRequestException('Aluno inválido para esta organização.');
    }
    return this.prisma.classStudent.upsert({
      where: { classId_studentId: { classId, studentId } },
      create: { organizationId, classId, studentId },
      update: { status: 'ACTIVE' },
    });
  }

  /** Desmatricula: mantém o registro (histórico de frequência) e marca INACTIVE. */
  async unenrollStudent(organizationId: number, classId: number, studentId: number, user?: AuthenticatedUser) {
    await this.findOne(organizationId, classId, user);
    const enrollment = await this.prisma.classStudent.findFirst({
      where: { organizationId, classId, studentId },
    });
    if (!enrollment) {
      throw new NotFoundException('Matrícula não encontrada.');
    }
    return this.prisma.classStudent.update({ where: { id: enrollment.id }, data: { status: 'INACTIVE' } });
  }

  /** Nunca confiar em unitId vindo do corpo da requisição sem confirmar que pertence à
   * organização do usuário autenticado (PLANO_PROJETO.md §3.2 item 4). */
  private async assertUnitBelongsToOrganization(organizationId: number, unitId: number): Promise<void> {
    const unit = await this.prisma.unit.findFirst({ where: { id: unitId, organizationId } });
    if (!unit) {
      throw new BadRequestException('Unidade inválida para esta organização.');
    }
  }
}
