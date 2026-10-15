import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RecordStatus } from '@prisma/client';
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
import { resolveCoordinatesInput } from '../../../shared/geo/coordinates';
import { GeocodingService } from '../../../shared/geo/geocoding.service';
import { civilTodayStart } from '../finance/finance.service';
import {
  DAY_MS,
  GENERATE_LESSONS_LOCK_NS,
  GenerateLessonsResult,
  generateLessonsInRange,
  MAX_GENERATE_LESSONS_SPAN_DAYS,
} from './class-lessons-generator';
import { ClassLessonsRollingService, lessonsHorizonDays, lessonsHorizonEnd } from './class-lessons-rolling.service';
import { RankingService } from '../ranking/ranking.service';
import { LEVEL_SELECT, withRope } from '../graduations/rope';

// Reexporta: specs e outros módulos importam estes nomes daqui desde antes do gerador virar um arquivo próprio.
export { GENERATE_LESSONS_LOCK_NS, MAX_GENERATE_LESSONS_SPAN_DAYS };
export type { GenerateLessonsResult };

/** Foto e nome da unidade / do professor responsável que acompanham cada turma (contrato de leitura). */
const CLASS_INCLUDE = {
  unit: { select: { id: true, name: true, photo: true } },
  teacher: { select: { id: true, name: true, photo: true } },
} satisfies Prisma.ClassInclude;

/** Turma como a API devolve: colunas + `photo` + `unit:{id,name,photo}|null` + `teacher:{id,name,photo}|null`. */
export type ClassView = Prisma.ClassGetPayload<{ include: typeof CLASS_INCLUDE }>;

/**
 * Turma na LISTA (GET /classes): o ClassView + diagnóstico das aulas à frente (hoje em diante, dia civil de São Paulo):
 *  - `nextLesson`: a aula mais próxima de QUALQUER status ({ date, status }) ou null;
 *  - `nextActiveLesson`: a mais próxima ATIVA ({ date }) ou null — turma com aulas contínuas ligadas e null aqui precisa de atenção.
 * Calculado em lote (um groupBy para a página inteira, sem N+1). Só a lista traz estes campos.
 */
export type ClassListItem = ClassView & {
  nextLesson: { date: Date; status: RecordStatus } | null;
  nextActiveLesson: { date: Date } | null;
};

/** Resposta de POST /classes/:id/generate-lessons. */
export interface GenerateLessonsResponse extends GenerateLessonsResult {
  /** true = modo contínuo (sem `to`): ligou autoGenerateLessons e gerou até o horizonte. */
  continuous: boolean;
  autoGenerateLessons: boolean;
  /** Só no modo contínuo: LESSONS_HORIZON_DAYS efetivo. */
  horizonDays?: number;
}

/** "YYYY-MM-DD" -> meia-noite UTC do dia (mesma convenção das datas de aula). 400 se o dia não existe (ex.: 30/02). */
function parseCivilDate(value: string, field: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new BadRequestException(`${field} não é uma data válida (use YYYY-MM-DD).`);
  }
  return date;
}

/** A turma tem local do treino PROPRIO (qualquer campo preenchido)? Senão herda endereço/posição da unidade. */
export function hasOwnLocation(c: {
  locationLabel: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
}): boolean {
  return [c.locationLabel, c.address, c.city, c.state, c.latitude, c.longitude].some((value) => value !== null);
}

/** Janela (dias) da frequência na lista de alunos da turma (presences/ttendanceRate). */
export const ATTENDANCE_PERIOD_DAYS = 90;

/** Turmas do grupo — CRUD completo, sempre isolado por organizationId. */
@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentsService: StudentsService,
    private readonly unitScope: UnitScopeService,
    private readonly audit: AuditService,
    private readonly rolling: ClassLessonsRollingService,
    private readonly ranking: RankingService,
    private readonly geocoding: GeocodingService,
  ) {}

  /**
   * Escopo por unidade (E08, shared/access/unit-scope.ts): o PROFESSOR com unidades atribuídas só lista/lê/edita
   * turmas das suas unidades (lista e contagem usam o mesmo where); `user` omitido = sem restrição. As rotas
   * /me (findMine) NÃO passam por aqui: o escopo delas é o vínculo do aluno.
   */
  async findAll(organizationId: number, query: ListClassesQueryDto = {}, user?: AuthenticatedUser): Promise<Page<ClassListItem>> {
    const where: Prisma.ClassWhereInput = { organizationId }; // organizationId SEMPRE no where (findMany e count)
    where.AND = [unitScopeFilter(await this.unitScope.resolve(user, organizationId))];
    if (query.status) where.status = query.status;
    if (query.unitId !== undefined) where.unitId = query.unitId;
    const q = query.q?.trim();
    if (q) where.name = { contains: q, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      this.prisma.class.findMany({ where, include: CLASS_INCLUDE, orderBy: { id: 'desc' }, ...pageArgs(query) }),
      this.prisma.class.count({ where }),
    ]);
    return { items: await this.withNextLessons(organizationId, items), total };
  }

  /** Acrescenta nextLesson/nextActiveLesson a cada turma da página com UMA agregação (min(date) por turma+status). */
  private async withNextLessons(organizationId: number, items: ClassView[]): Promise<ClassListItem[]> {
    if (items.length === 0) return [];
    const upcoming = await this.prisma.lesson.groupBy({
      by: ['classId', 'status'],
      where: { organizationId, classId: { in: items.map((c) => c.id) }, date: { gte: civilTodayStart() } },
      _min: { date: true },
    });
    const nearest = new Map<number, { date: Date; status: RecordStatus }>();
    const nearestActive = new Map<number, Date>();
    for (const row of upcoming) {
      const date = row._min.date;
      if (!date) continue;
      const current = nearest.get(row.classId);
      // Empate de data entre ativa e cancelada: a ativa vence.
      if (!current || date < current.date || (date.getTime() === current.date.getTime() && row.status === 'ACTIVE')) {
        nearest.set(row.classId, { date, status: row.status });
      }
      if (row.status === 'ACTIVE') nearestActive.set(row.classId, date);
    }
    return items.map((c) => ({
      ...c,
      nextLesson: nearest.get(c.id) ?? null,
      nextActiveLesson: nearestActive.has(c.id) ? { date: nearestActive.get(c.id) as Date } : null,
    }));
  }

  /** "Minhas turmas" — as turmas em que os alunos ligados ao usuário autenticado estão
   * matriculados (mesmo padrão de FinanceService.findMine). */
  async findMine(organizationId: number, userId: number): Promise<ClassView[]> {
    const students = await this.studentsService.findMine(organizationId, userId);
    if (students.length === 0) return [];

    const enrollments = await this.prisma.classStudent.findMany({
      where: { organizationId, studentId: { in: students.map((s) => s.id) }, status: 'ACTIVE' },
      select: { classId: true },
    });
    const classIds = [...new Set(enrollments.map((e) => e.classId))];
    if (classIds.length === 0) return [];

    return this.prisma.class.findMany({ where: { id: { in: classIds }, organizationId }, include: CLASS_INCLUDE });
  }

  async findOne(organizationId: number, id: number, user?: AuthenticatedUser): Promise<ClassView> {
    const scope = await this.unitScope.resolve(user, organizationId);
    const classItem = await this.prisma.class.findFirst({
      where: { id, organizationId, ...unitScopeFilter(scope) },
      include: CLASS_INCLUDE,
    });
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

    // Local do treino proprio: coordenadas do corpo, ou geocodificadas (so' com chave do Google; falha = sem coordenadas,
    // a turma e' salva igual e herda a posicao da unidade no mapa).
    const coordinates = await this.geocoding.forCreate(dto, this.locationParts(dto));

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
        photo: dto.photo,
        autoGenerateLessons: dto.autoGenerateLessons,
        locationLabel: dto.locationLabel,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        latitude: coordinates.latitude,
        longitude: coordinates.longitude,
      },
      include: CLASS_INCLUDE,
    });
    await this.audit.record({
      organizationId,
      action: AuditAction.CLASS_CREATE,
      entity: AuditEntity.CLASS,
      entityId: created.id,
      meta: { name: created.name, unitId: created.unitId, ownLocation: hasOwnLocation(created) },
    });
    // Aulas continuas: turma nova com dia da semana ganha as aulas ate o horizonte (fire-and-forget; silencioso).
    if (created.weekday !== null && created.autoGenerateLessons) this.rolling.queueEnsureHorizon(created.id);
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

    const coordinates = await this.coordinatesForUpdate(current, dto);

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
        photo: dto.photo,
        autoGenerateLessons: dto.autoGenerateLessons,
        status: dto.status,
        locationLabel: dto.locationLabel,
        address: dto.address,
        city: dto.city,
        state: dto.state,
        latitude: coordinates?.latitude,
        longitude: coordinates?.longitude,
      },
      include: CLASS_INCLUDE,
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
    // Aulas ja geradas copiam professor/horario/unidade da turma: ao mudar a turma, as aulas FUTURAS ATIVAS que ainda
    // carregam o valor antigo acompanham (aula editada a mao com outro valor fica como esta; nada e apagado).
    await this.syncFutureLessons(organizationId, current, updated);
    // Aulas continuas: mexeu em dia/horario/status/autoGenerateLessons => garante o horizonte (nao apaga nada; turma
    // inativa ou com autoGenerateLessons=false simplesmente nao gera).
    const touchesHorizon = [dto.weekday, dto.startTime, dto.endTime, dto.status, dto.autoGenerateLessons].some(
      (value) => value !== undefined,
    );
    if (touchesHorizon && updated.status === 'ACTIVE' && updated.weekday !== null && updated.autoGenerateLessons) {
      this.rolling.queueEnsureHorizon(id);
    }
    return updated;
  }

  /** Partes do endereco do treino para geocodificar (sem endereco, o rotulo — ex.: "Praca X" — ancora a busca). */
  private locationParts(input: { locationLabel?: string | null; address?: string | null; city?: string | null; state?: string | null }) {
    return [input.address ?? input.locationLabel, input.city, input.state];
  }

  /**
   * Coordenadas do local do treino a gravar no PATCH (undefined = nao mexer): as do corpo (as duas juntas; null/null
   * limpa); senao, se address/city/state/locationLabel mudaram, geocodifica o texto novo (so' com chave do Google).
   * Diferente da Unidade: se o texto mudou e NAO ha como geocodificar, as coordenadas antigas (do endereco antigo) sao
   * LIMPAS — a turma volta a herdar a posicao da unidade em vez de ficar com um pino no lugar errado.
   */
  private async coordinatesForUpdate(
    current: Pick<ClassView, 'locationLabel' | 'address' | 'city' | 'state' | 'latitude' | 'longitude'>,
    dto: UpdateClassDto,
  ): Promise<{ latitude: number | null; longitude: number | null } | undefined> {
    const given = resolveCoordinatesInput(dto); // 400 se so' uma das duas veio
    if (given) return given;
    const touched = [dto.locationLabel, dto.address, dto.city, dto.state].some((value) => value !== undefined);
    if (!touched) return undefined;
    const next = {
      locationLabel: dto.locationLabel === undefined ? current.locationLabel : dto.locationLabel,
      address: dto.address === undefined ? current.address : dto.address,
      city: dto.city === undefined ? current.city : dto.city,
      state: dto.state === undefined ? current.state : dto.state,
    };
    const textChanged =
      next.locationLabel !== current.locationLabel ||
      next.address !== current.address ||
      next.city !== current.city ||
      next.state !== current.state;
    if (!textChanged) return undefined;
    const found = await this.geocoding.forUpdate(dto, true, this.locationParts(next));
    if (found) return found;
    if (current.latitude === null && current.longitude === null) return undefined;
    return { latitude: null, longitude: null };
  }

  /**
   * Repassa a mudanca de professor responsavel, horario (inicio/fim) e unidade da turma para as aulas FUTURAS (hoje em
   * diante, dia civil de Sao Paulo) ATIVAS que ainda tem o valor ANTIGO copiado da turma. Valor antigo nulo = a aula ja
   * herda da turma (nada a fazer). Nao mexe em aula cancelada, passada, nem em aula cujo valor foi editado a mao.
   * (Mudar o DIA DA SEMANA nao move/apaga aulas ja geradas: ver PLANO_PROJETO.md.)
   */
  private async syncFutureLessons(
    organizationId: number,
    before: Pick<ClassView, 'id' | 'teacherUserId' | 'startTime' | 'endTime' | 'unitId'>,
    after: Pick<ClassView, 'teacherUserId' | 'startTime' | 'endTime' | 'unitId'>,
  ): Promise<void> {
    const fields = ['teacherUserId', 'startTime', 'endTime', 'unitId'] as const;
    for (const field of fields) {
      const oldValue = before[field];
      if (oldValue === null || oldValue === after[field]) continue;
      await this.prisma.lesson.updateMany({
        where: {
          organizationId,
          classId: before.id,
          status: 'ACTIVE',
          date: { gte: civilTodayStart() },
          [field]: oldValue,
        },
        data: { [field]: after[field] },
      });
    }
  }

  /** Impacto de apagar a turma (para o diálogo de confirmação do painel): aulas, presenças e matrículas que seriam apagadas. */
  async deleteImpact(
    organizationId: number,
    id: number,
    user?: AuthenticatedUser,
  ): Promise<{ class: { id: number; name: string }; lessons: number; attendances: number; students: number }> {
    const klass = await this.findOne(organizationId, id, user); // 404 se não existir / outro grupo / unidade fora do escopo
    const [lessons, attendances, students] = await Promise.all([
      this.prisma.lesson.count({ where: { organizationId, classId: id } }),
      this.prisma.attendance.count({ where: { organizationId, lesson: { classId: id } } }),
      this.prisma.classStudent.count({ where: { organizationId, classId: id } }),
    ]);
    return { class: { id: klass.id, name: klass.name }, lessons, attendances, students };
  }

  /**
   * APAGA DE VERDADE a turma (hard delete). Inativar continua sendo PATCH { status: 'INACTIVE' } (o histórico fica).
   * Com aulas ou presenças exige `confirm` (sem ele: 409 com `{ lessons, attendances, students }`; nada é apagado).
   * Numa transação: presenças e aulas da turma (AttendanceNotice cai em cascata), vínculos aluno-turma (ClassStudent)
   * e a turma; comunicados que apontavam para a turma ficam sem turma (alcance volta a ser o do grupo). A Pessoa, o
   * Aluno e a matrícula dele no grupo NÃO são tocados. Os pontos do Ginga Rank são derivados das presenças: depois do
   * commit o recálculo dos alunos afetados é agendado (fire-and-forget), que remove os pontos órfãos. Audita CLASS_DELETE.
   */
  async destroy(organizationId: number, id: number, confirm: boolean, user?: AuthenticatedUser) {
    const impact = await this.deleteImpact(organizationId, id, user);
    if ((impact.lessons > 0 || impact.attendances > 0) && !confirm) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'CONFIRM_REQUIRED',
        message: 'Apagar a turma apaga também as aulas e presenças dela. Confirme para continuar (confirm=true).',
        lessons: impact.lessons,
        attendances: impact.attendances,
        students: impact.students,
      });
    }
    const affected = await this.prisma.attendance.findMany({
      where: { organizationId, lesson: { classId: id } },
      distinct: ['studentId'],
      select: { studentId: true },
    });
    await this.prisma.$transaction(
      async (tx) => {
        await tx.attendance.deleteMany({ where: { organizationId, lesson: { classId: id } } });
        await tx.lesson.deleteMany({ where: { organizationId, classId: id } });
        await tx.classStudent.deleteMany({ where: { organizationId, classId: id } });
        await tx.announcement.updateMany({ where: { organizationId, classId: id }, data: { classId: null } });
        await tx.class.delete({ where: { id } });
      },
      { timeout: 30_000 },
    );
    await this.audit.record({
      organizationId,
      action: AuditAction.CLASS_DELETE,
      entity: AuditEntity.CLASS,
      entityId: id,
      meta: { name: impact.class.name, lessons: impact.lessons, attendances: impact.attendances, students: impact.students },
    });
    this.ranking.queueSync(affected.map((a) => a.studentId));
    return { deleted: true, lessons: impact.lessons, attendances: impact.attendances, students: impact.students };
  }
  /**
   * Gera as aulas da turma (gerador único: class-lessons-generator.ts). Só turma ATIVA e com dia da semana definido.
   *  - PERÍODO: `from` e `to` explícitos (to - from <= 90 dias, from <= to). Não mexe em autoGenerateLessons.
   *  - CONTÍNUO: sem `to` (ou `continuous: true`): liga autoGenerateLessons e gera de `from` (padrão hoje) até
   *    LESSONS_HORIZON_DAYS a frente; o job diário (ClassLessonsRollingService) mantém o horizonte depois.
   * Nunca cria antes de `from`. Idempotente: data que já tem aula da turma (qualquer status — uma aula cancelada NÃO
   * é recriada) é ignorada e contada em `ignored`. Gerações concorrentes da mesma turma são serializadas por advisory
   * lock transacional. Aula gerada não notifica ninguém.
   */
  async generateLessons(
    organizationId: number,
    classId: number,
    dto: GenerateLessonsDto,
    user?: AuthenticatedUser,
  ): Promise<GenerateLessonsResponse> {
    const klass = await this.findOne(organizationId, classId, user); // 404 se não existir ou for de outra organização
    if (klass.status !== 'ACTIVE') {
      throw new BadRequestException('Turma inativa: reative a turma antes de gerar aulas.');
    }
    if (klass.weekday === null) {
      throw new BadRequestException('A turma não tem dia da semana definido: informe o dia para gerar aulas.');
    }

    const hasTo = dto.to !== undefined;
    if (hasTo && dto.continuous === true) {
      throw new BadRequestException('Informe `to` (gerar por período) OU continuous: true (sem data final), não os dois.');
    }
    if (!hasTo && dto.continuous === false) {
      throw new BadRequestException('Informe `to` para gerar por período, ou omita `to` (continuous: true) para aulas contínuas.');
    }

    if (hasTo) {
      if (dto.from === undefined) {
        throw new BadRequestException('Informe `from` junto com `to` para gerar por período.');
      }
      const from = parseCivilDate(dto.from, 'from');
      const to = parseCivilDate(dto.to as string, 'to');
      if (to.getTime() < from.getTime()) {
        throw new BadRequestException('to deve ser igual ou posterior a from.');
      }
      if ((to.getTime() - from.getTime()) / DAY_MS > MAX_GENERATE_LESSONS_SPAN_DAYS) {
        throw new BadRequestException(`O período não pode passar de ${MAX_GENERATE_LESSONS_SPAN_DAYS} dias.`);
      }
      const generated = await generateLessonsInRange(this.prisma, klass, from, to);
      return { ...generated, continuous: false, autoGenerateLessons: klass.autoGenerateLessons };
    }

    // Contínuo: de `from` (padrão hoje) até o horizonte rolante.
    const today = civilTodayStart();
    const from = dto.from === undefined ? today : parseCivilDate(dto.from, 'from');
    const horizonDays = lessonsHorizonDays();
    const to = lessonsHorizonEnd(new Date(), horizonDays);
    if (from.getTime() > to.getTime()) {
      throw new BadRequestException(`from está além do horizonte de ${horizonDays} dias das aulas contínuas.`);
    }
    if ((today.getTime() - from.getTime()) / DAY_MS > MAX_GENERATE_LESSONS_SPAN_DAYS) {
      throw new BadRequestException(`from não pode ser mais de ${MAX_GENERATE_LESSONS_SPAN_DAYS} dias no passado.`);
    }
    const generated = await generateLessonsInRange(this.prisma, klass, from, to);
    if (!klass.autoGenerateLessons) {
      await this.prisma.class.update({ where: { id: classId }, data: { autoGenerateLessons: true } });
      await this.audit.record({
        organizationId,
        action: AuditAction.CLASS_UPDATE,
        entity: AuditEntity.CLASS,
        entityId: classId,
        meta: { fields: ['autoGenerateLessons'], source: 'generate-lessons', status: klass.status },
      });
    }
    return { ...generated, continuous: true, autoGenerateLessons: true, horizonDays };
  }

  /**
   * Alunos matriculados (ativos) na turma, com os dados básicos do aluno + `nickname` (apelido da ficha), `currentCord`
   * (corda da graduação mais recente, ou null) e a frequência NA TURMA nos últimos ATTENDANCE_PERIOD_DAYS dias:
   * `presences` (presenças), `lessonsInPeriod` (aulas ativas já realizadas no período) e `attendanceRate` (% inteiro,
   * null sem aulas no período), mais `presencesTotal` (desde sempre). Tudo em lote (3 consultas, sem N+1).
   */
  async listStudents(organizationId: number, classId: number, user?: AuthenticatedUser) {
    await this.findOne(organizationId, classId, user);
    const enrollments = await this.prisma.classStudent.findMany({
      where: { organizationId, classId, status: 'ACTIVE' },
      include: { student: { select: { id: true, name: true, status: true, photo: true, person: { select: { nickname: true } } } } },
      orderBy: { student: { name: 'asc' } },
    });
    if (enrollments.length === 0) return [];
    const studentIds = enrollments.map((e) => e.studentId);
    const today = civilTodayStart();
    const from = new Date(today.getTime() - ATTENDANCE_PERIOD_DAYS * DAY_MS);
    const lessonWhere = { organizationId, classId, status: 'ACTIVE' as const };
    const [gradRows, periodRows, totalRows, lessonsInPeriod] = await Promise.all([
      this.prisma.studentGraduation.findMany({
        where: { studentId: { in: studentIds } },
        distinct: ['studentId'],
        orderBy: [{ graduatedAt: 'desc' }, { id: 'desc' }],
        select: { studentId: true, graduationLevel: { select: LEVEL_SELECT } },
      }),
      this.prisma.attendance.groupBy({
        by: ['studentId'],
        where: { organizationId, studentId: { in: studentIds }, present: true, lesson: { ...lessonWhere, date: { gte: from, lte: today } } },
        _count: { _all: true },
      }),
      this.prisma.attendance.groupBy({
        by: ['studentId'],
        where: { organizationId, studentId: { in: studentIds }, present: true, lesson: lessonWhere },
        _count: { _all: true },
      }),
      this.prisma.lesson.count({ where: { ...lessonWhere, date: { gte: from, lte: today } } }),
    ]);
    const cords = new Map(
      gradRows.map((g) => {
        const rope = withRope(g.graduationLevel);
        return [g.studentId, { name: g.graduationLevel.name, style: rope.style, colors: rope.colors, tipStart: rope.tipStart, tipEnd: rope.tipEnd }] as const;
      }),
    );
    const period = new Map(periodRows.map((r) => [r.studentId, r._count._all]));
    const total = new Map(totalRows.map((r) => [r.studentId, r._count._all]));
    return enrollments.map((e) => {
      const presences = period.get(e.studentId) ?? 0;
      return {
        id: e.id,
        studentId: e.studentId,
        name: e.student.name,
        nickname: e.student.person?.nickname ?? null,
        studentStatus: e.student.status,
        photo: e.student.photo,
        enrolledAt: e.enrolledAt,
        currentCord: cords.get(e.studentId) ?? null,
        presences,
        presencesTotal: total.get(e.studentId) ?? 0,
        lessonsInPeriod,
        attendanceRate: lessonsInPeriod > 0 ? Math.min(100, Math.round((presences / lessonsInPeriod) * 100)) : null,
      };
    });
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
