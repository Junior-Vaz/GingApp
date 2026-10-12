import { Injectable, NotFoundException } from '@nestjs/common';
import { FinancialStatus, Prisma, RecordStatus, StudentStatus } from '@prisma/client';
import {
  assertUnitAccess,
  lessonScopeFilter,
  UnitScope,
  UnitScopeService,
  unitScopeFilter,
} from '../../../shared/access/unit-scope';
import { buildCsv } from '../../../shared/csv/csv';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { civilTodayStart } from '../finance/finance.service';
import { LEVEL_SELECT, ropeOf } from '../graduations/rope';
import { AttendanceReportQueryDto, ReportPeriodQueryDto } from './dto/report-query.dto';
import {
  addDays,
  AGE_GROUPS,
  ageOn,
  endOfMonth,
  monthsOf,
  percentOf,
  resolvePeriod,
  startOfMonthShift,
  todayCivil,
} from './report-period';

/** Teto de linhas por aluno no relatório de frequência (a lista completa sai no CSV, que usa o mesmo teto). */
export const ATTENDANCE_STUDENT_LIMIT = 2000;

export interface AttendanceCounts {
  records: number;
  present: number;
  absent: number;
  percent: number | null;
}

/**
 * Relatórios do painel (I03). Tudo é AGREGAÇÃO no banco/servidor (nada de listas gigantes no cliente), sempre dentro da
 * organização do token e do ESCOPO DE UNIDADE do usuário (shared/access/unit-scope.ts). O RBAC vem do recurso de
 * cada relatório (attendance/students/graduations/finance — ver reports.controller.ts), não de um recurso novo.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unitScope: UnitScopeService,
  ) {}

  /** Escopo do usuário + checagem do ?unitId= (unidade de outro grupo ou fora do escopo => 404 igual a inexistente). */
  private async scopeAndUnit(
    organizationId: number,
    user: AuthenticatedUser | undefined,
    unitId: number | undefined,
  ): Promise<UnitScope> {
    const scope = await this.unitScope.resolve(user, organizationId);
    if (unitId !== undefined) {
      const unit = await this.prisma.unit.findFirst({ where: { id: unitId, organizationId }, select: { id: true } });
      if (!unit) throw new NotFoundException('Unidade não encontrada.');
      assertUnitAccess(scope, unitId, 'Unidade não encontrada.');
    }
    return scope;
  }

  // ---------------------------------------------------------------------------------------------
  // Frequência
  // ---------------------------------------------------------------------------------------------

  async attendance(
    organizationId: number,
    query: AttendanceReportQueryDto,
    user?: AuthenticatedUser,
    now: Date = new Date(),
  ) {
    const period = resolvePeriod(
      query.from,
      query.to,
      { defaultFrom: (today) => addDays(today, -29), defaultTo: (today) => today, maxDays: 366 },
      now,
    );
    const scope = await this.scopeAndUnit(organizationId, user, query.unitId);

    if (query.classId !== undefined) {
      const klass = await this.prisma.class.findFirst({
        where: { id: query.classId, organizationId, AND: [unitScopeFilter(scope)] },
        select: { id: true },
      });
      if (!klass) throw new NotFoundException('Turma não encontrada.');
    }

    // Aulas ATIVAS do período (data civil), da turma pedida, no escopo do usuário; ?unitId= usa a unidade EFETIVA
    // da aula (a dela, ou a da turma quando a aula não tem).
    const lessonWhere: Prisma.LessonWhereInput = {
      organizationId,
      status: RecordStatus.ACTIVE,
      date: { gte: period.start, lt: period.end },
      ...(query.classId !== undefined ? { classId: query.classId } : {}),
      AND: [
        lessonScopeFilter(scope),
        ...(query.unitId !== undefined
          ? [{ OR: [{ unitId: query.unitId }, { unitId: null, class: { unitId: query.unitId } }] }]
          : []),
      ],
    };

    const [lessons, byLesson, byStudentRaw] = await Promise.all([
      this.prisma.lesson.findMany({ where: lessonWhere, select: { id: true, classId: true, date: true } }),
      this.prisma.attendance.groupBy({
        by: ['lessonId', 'present'],
        where: { organizationId, lesson: lessonWhere },
        _count: { _all: true },
      }),
      this.prisma.attendance.groupBy({
        by: ['studentId', 'present'],
        where: { organizationId, lesson: lessonWhere },
        _count: { _all: true },
      }),
    ]);

    const counts = (present: number, absent: number): AttendanceCounts => ({
      records: present + absent,
      present,
      absent,
      percent: percentOf(present, present + absent),
    });

    // lessonId -> presenças/faltas
    const lessonCounts = new Map<number, { present: number; absent: number }>();
    for (const row of byLesson) {
      const entry = lessonCounts.get(row.lessonId) ?? { present: 0, absent: 0 };
      if (row.present) entry.present += row._count._all;
      else entry.absent += row._count._all;
      lessonCounts.set(row.lessonId, entry);
    }

    const byClassMap = new Map<number, { lessons: number; lessonsWithRecords: number; present: number; absent: number }>();
    const byMonthMap = new Map<string, { present: number; absent: number }>();
    for (const lesson of lessons) {
      const c = lessonCounts.get(lesson.id);
      const klass = byClassMap.get(lesson.classId) ?? { lessons: 0, lessonsWithRecords: 0, present: 0, absent: 0 };
      klass.lessons++;
      if (c) {
        klass.lessonsWithRecords++;
        klass.present += c.present;
        klass.absent += c.absent;
        const month = lesson.date.toISOString().slice(0, 7);
        const m = byMonthMap.get(month) ?? { present: 0, absent: 0 };
        m.present += c.present;
        m.absent += c.absent;
        byMonthMap.set(month, m);
      }
      byClassMap.set(lesson.classId, klass);
    }

    const classes = byClassMap.size
      ? await this.prisma.class.findMany({
          where: { organizationId, id: { in: [...byClassMap.keys()] } },
          select: { id: true, name: true, unitId: true },
        })
      : [];
    const className = new Map(classes.map((c) => [c.id, c]));

    const byClass = [...byClassMap.entries()]
      .map(([classId, v]) => ({
        classId,
        name: className.get(classId)?.name ?? `Turma #${classId}`,
        unitId: className.get(classId)?.unitId ?? null,
        lessons: v.lessons,
        lessonsWithRecords: v.lessonsWithRecords,
        ...counts(v.present, v.absent),
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    const studentMap = new Map<number, { present: number; absent: number }>();
    for (const row of byStudentRaw) {
      const entry = studentMap.get(row.studentId) ?? { present: 0, absent: 0 };
      if (row.present) entry.present += row._count._all;
      else entry.absent += row._count._all;
      studentMap.set(row.studentId, entry);
    }
    const studentRows = studentMap.size
      ? await this.prisma.student.findMany({
          where: { organizationId, id: { in: [...studentMap.keys()] } },
          select: { id: true, name: true },
        })
      : [];
    const studentName = new Map(studentRows.map((s) => [s.id, s.name]));
    const allStudents = [...studentMap.entries()]
      .map(([studentId, v]) => ({ studentId, name: studentName.get(studentId) ?? `Aluno #${studentId}`, ...counts(v.present, v.absent) }))
      // Menor frequência primeiro (quem precisa de atenção), depois por nome.
      .sort((a, b) => (a.percent ?? 101) - (b.percent ?? 101) || a.name.localeCompare(b.name, 'pt-BR'));

    let present = 0;
    let absent = 0;
    for (const v of lessonCounts.values()) {
      present += v.present;
      absent += v.absent;
    }

    return {
      period: { from: period.from, to: period.to },
      filters: { classId: query.classId ?? null, unitId: query.unitId ?? null },
      totals: {
        lessons: lessons.length,
        lessonsWithRecords: lessonCounts.size,
        ...counts(present, absent),
      },
      byClass,
      byMonth: monthsOf(period).map((month) => {
        const v = byMonthMap.get(month) ?? { present: 0, absent: 0 };
        return { month, ...counts(v.present, v.absent) };
      }),
      byStudent: allStudents.slice(0, ATTENDANCE_STUDENT_LIMIT),
      byStudentTotal: allStudents.length,
    };
  }

  /** CSV da frequência por aluno (mesmos filtros e dados do relatório; a Frequência e o Relatório baixam este arquivo). */
  async attendanceCsv(
    organizationId: number,
    query: AttendanceReportQueryDto,
    user?: AuthenticatedUser,
    now: Date = new Date(),
  ): Promise<{ csv: string; total: number }> {
    const report = await this.attendance(organizationId, query, user, now);
    const pct = (p: number | null) => (p === null ? '' : String(p).replace('.', ','));
    const csv = buildCsv(
      ['Aluno', 'Chamadas registradas', 'Presenças', 'Faltas', 'Frequência (%)'],
      report.byStudent.map((s) => [s.name, s.records, s.present, s.absent, pct(s.percent)]),
    );
    return { csv, total: report.byStudentTotal };
  }

  // ---------------------------------------------------------------------------------------------
  // Financeiro (só o MESTRE: recurso finance)
  // ---------------------------------------------------------------------------------------------

  async finance(
    organizationId: number,
    query: ReportPeriodQueryDto,
    user?: AuthenticatedUser,
    now: Date = new Date(),
  ) {
    const period = resolvePeriod(
      query.from,
      query.to,
      { defaultFrom: (today) => startOfMonthShift(today, 5), defaultTo: (today) => endOfMonth(today), maxDays: 800 },
      now,
    );
    const scope = await this.scopeAndUnit(organizationId, user, query.unitId);
    const today = civilTodayStart(now);
    const unitWhere: Prisma.FinancialRecordWhereInput = {
      AND: [unitScopeFilter(scope), ...(query.unitId !== undefined ? [{ unitId: query.unitId }] : [])],
    };

    // Por MÊS DE VENCIMENTO. CANCELLED fora. Status efetivo: PENDING vencido conta como atrasado (mesma regra do
    // financeiro/dashboard). Soma em JS de linhas já filtradas (cada mês tem poucas centenas de lançamentos).
    const [records, paidInPeriod] = await Promise.all([
      this.prisma.financialRecord.findMany({
        where: {
          organizationId,
          status: { not: FinancialStatus.CANCELLED },
          dueDate: { gte: period.start, lt: period.end },
          ...unitWhere,
        },
        select: { amountCents: true, paidCents: true, status: true, dueDate: true },
      }),
      // Receita recebida NO período (por data de pagamento), independente do vencimento.
      this.prisma.financialRecord.findMany({
        where: {
          organizationId,
          status: FinancialStatus.PAID,
          paidAt: { gte: period.start, lt: period.end },
          ...unitWhere,
        },
        select: { amountCents: true, paidCents: true },
      }),
    ]);

    const months = new Map(
      monthsOf(period).map((month) => [
        month,
        { month, count: 0, expectedCents: 0, receivedCents: 0, pendingCents: 0, overdueCents: 0, overdueCount: 0 },
      ]),
    );
    for (const r of records) {
      const row = months.get(r.dueDate.toISOString().slice(0, 7));
      if (!row) continue;
      row.count++;
      row.expectedCents += r.amountCents;
      if (r.status === FinancialStatus.PAID) row.receivedCents += r.paidCents ?? r.amountCents;
      else if (r.status === FinancialStatus.OVERDUE || r.dueDate < today) {
        row.overdueCents += r.amountCents;
        row.overdueCount++;
      } else row.pendingCents += r.amountCents;
    }
    const byMonth = [...months.values()].map((m) => ({
      ...m,
      // Inadimplência = atrasado / previsto do mês (null quando não há lançamento).
      overdueRatePercent: percentOf(m.overdueCents, m.expectedCents),
    }));
    const sum = (pick: (m: (typeof byMonth)[number]) => number) => byMonth.reduce((acc, m) => acc + pick(m), 0);
    const expectedCents = sum((m) => m.expectedCents);
    const overdueCents = sum((m) => m.overdueCents);

    return {
      period: { from: period.from, to: period.to },
      filters: { unitId: query.unitId ?? null },
      basis: 'Por mês de vencimento; lançamentos cancelados ficam fora.',
      totals: {
        count: sum((m) => m.count),
        expectedCents,
        receivedCents: sum((m) => m.receivedCents),
        pendingCents: sum((m) => m.pendingCents),
        overdueCents,
        overdueCount: sum((m) => m.overdueCount),
        overdueRatePercent: percentOf(overdueCents, expectedCents),
        receivedInPeriodCents: paidInPeriod.reduce((acc, r) => acc + (r.paidCents ?? r.amountCents), 0),
      },
      byMonth,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Alunos
  // ---------------------------------------------------------------------------------------------

  async students(
    organizationId: number,
    query: ReportPeriodQueryDto,
    user?: AuthenticatedUser,
    now: Date = new Date(),
  ) {
    const period = resolvePeriod(
      query.from,
      query.to,
      { defaultFrom: (today) => startOfMonthShift(today, 11), defaultTo: (today) => today, maxDays: 800 },
      now,
    );
    const scope = await this.scopeAndUnit(organizationId, user, query.unitId);
    const where: Prisma.StudentWhereInput = {
      organizationId,
      AND: [unitScopeFilter(scope), ...(query.unitId !== undefined ? [{ unitId: query.unitId }] : [])],
    };
    const today = todayCivil(now);

    const [byStatusUnit, newRows, activeBirths] = await Promise.all([
      this.prisma.student.groupBy({ by: ['unitId', 'status'], where, _count: { _all: true } }),
      // "Novo" = ingressou no período (joinedAt) ou, sem data de ingresso, foi cadastrado nele.
      this.prisma.student.findMany({
        where: {
          AND: [
            where,
            {
              OR: [
                { joinedAt: { gte: period.start, lt: period.end } },
                { joinedAt: null, createdAt: { gte: period.startInstant, lt: period.endInstant } },
              ],
            },
          ],
        },
        select: { joinedAt: true, createdAt: true },
      }),
      this.prisma.student.findMany({
        where: { AND: [where, { status: StudentStatus.ACTIVE }] },
        select: { birthDate: true },
      }),
    ]);

    const totals = { total: 0, active: 0, inactive: 0, suspended: 0, former: 0, newInPeriod: newRows.length };
    const unitMap = new Map<number | null, { active: number; inactive: number; total: number }>();
    for (const row of byStatusUnit) {
      const n = row._count._all;
      totals.total += n;
      const u = unitMap.get(row.unitId) ?? { active: 0, inactive: 0, total: 0 };
      u.total += n;
      if (row.status === StudentStatus.ACTIVE) {
        totals.active += n;
        u.active += n;
      } else {
        u.inactive += n; // inativo, suspenso ou ex-aluno = "não ativo" na quebra por unidade
        if (row.status === StudentStatus.INACTIVE) totals.inactive += n;
        else if (row.status === StudentStatus.SUSPENDED) totals.suspended += n;
        else totals.former += n;
      }
      unitMap.set(row.unitId, u);
    }

    const unitIds = [...unitMap.keys()].filter((id): id is number => id !== null);
    const unitRows = unitIds.length
      ? await this.prisma.unit.findMany({ where: { organizationId, id: { in: unitIds } }, select: { id: true, name: true } })
      : [];
    const unitName = new Map(unitRows.map((u) => [u.id, u.name]));
    const byUnit = [...unitMap.entries()]
      .map(([unitId, v]) => ({
        unitId,
        unitName: unitId === null ? 'Sem unidade' : (unitName.get(unitId) ?? `Unidade #${unitId}`),
        ...v,
      }))
      .sort((a, b) => b.active - a.active || a.unitName.localeCompare(b.unitName, 'pt-BR'));

    const monthCount = new Map(monthsOf(period).map((m) => [m, 0]));
    for (const s of newRows) {
      // joinedAt é data civil (UTC); createdAt é instante: recua 3h para o dia de São Paulo.
      const key = (s.joinedAt ?? new Date(s.createdAt.getTime() - 3 * 60 * 60 * 1000)).toISOString().slice(0, 7);
      if (monthCount.has(key)) monthCount.set(key, (monthCount.get(key) ?? 0) + 1);
    }

    const ageCount = new Map<string, number>(AGE_GROUPS.map((g) => [g.key, 0]));
    let withoutBirth = 0;
    for (const s of activeBirths) {
      if (!s.birthDate) {
        withoutBirth++;
        continue;
      }
      const age = ageOn(s.birthDate, today);
      const group = AGE_GROUPS.find((g) => age >= g.min && age <= g.max);
      if (group) ageCount.set(group.key, (ageCount.get(group.key) ?? 0) + 1);
    }

    return {
      period: { from: period.from, to: period.to },
      filters: { unitId: query.unitId ?? null },
      totals,
      byMonth: [...monthCount.entries()].map(([month, newStudents]) => ({ month, newStudents })),
      byUnit,
      byAgeGroup: [
        ...AGE_GROUPS.map((g) => ({ key: g.key, label: g.label, count: ageCount.get(g.key) ?? 0 })),
        { key: 'semData', label: 'Sem data de nascimento', count: withoutBirth },
      ],
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Graduações
  // ---------------------------------------------------------------------------------------------

  async graduations(
    organizationId: number,
    query: ReportPeriodQueryDto,
    user?: AuthenticatedUser,
    now: Date = new Date(),
  ) {
    const period = resolvePeriod(
      query.from,
      query.to,
      { defaultFrom: (today) => startOfMonthShift(today, 11), defaultTo: (today) => today, maxDays: 800 },
      now,
    );
    const scope = await this.scopeAndUnit(organizationId, user, query.unitId);
    const where: Prisma.StudentGraduationWhereInput = {
      organizationId,
      graduatedAt: { gte: period.start, lt: period.end },
      student: { AND: [unitScopeFilter(scope), ...(query.unitId !== undefined ? [{ unitId: query.unitId }] : [])] },
    };

    const rows = await this.prisma.studentGraduation.findMany({
      where,
      select: { graduatedAt: true, graduationLevelId: true, studentId: true },
    });

    const levelCount = new Map<number, number>();
    const monthCount = new Map(monthsOf(period).map((m) => [m, 0]));
    const students = new Set<number>();
    for (const r of rows) {
      levelCount.set(r.graduationLevelId, (levelCount.get(r.graduationLevelId) ?? 0) + 1);
      const key = r.graduatedAt.toISOString().slice(0, 7);
      if (monthCount.has(key)) monthCount.set(key, (monthCount.get(key) ?? 0) + 1);
      students.add(r.studentId);
    }

    const levels = levelCount.size
      ? await this.prisma.graduationLevel.findMany({
          where: { organizationId, id: { in: [...levelCount.keys()] } },
          select: { ...LEVEL_SELECT, graduationSystem: { select: { name: true } } },
        })
      : [];
    const byLevel = levels
      .map((l) => ({
        levelId: l.id,
        levelName: l.name,
        systemName: l.graduationSystem.name,
        order: l.order,
        ...ropeOf(l),
        count: levelCount.get(l.id) ?? 0,
      }))
      .sort((a, b) => a.systemName.localeCompare(b.systemName, 'pt-BR') || a.order - b.order);

    return {
      period: { from: period.from, to: period.to },
      filters: { unitId: query.unitId ?? null },
      totals: { graduations: rows.length, students: students.size },
      byMonth: [...monthCount.entries()].map(([month, count]) => ({ month, count })),
      byLevel,
    };
  }
}
