import { Injectable } from '@nestjs/common';
import { FinancialStatus, StudentStatus, UserType } from '@prisma/client';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { civilTodayStart } from '../finance/finance.service';
import {
  groupWideOrUnitFilter,
  lessonScopeFilter,
  UnitScopeService,
  unitScopeFilter,
} from '../../../shared/access/unit-scope';

/**
 * Dashboard administrativo (projeto.txt §30 — "Como está meu grupo?"), sempre isolado por
 * organizationId. Cada número é uma consulta agregada independente; sem cache por enquanto
 * (dataset pequeno no MVP — revisar se ficar lento com mais organizações/dados reais).
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly unitScope: UnitScopeService,
  ) {}

  /**
   * O bloco `finance` só existe para quem tem finance:view na matriz RolePermission (hoje só o
   * MESTRE; PROFESSOR passou a ficar de fora). Sem a permissão a chave é OMITIDA e as agregações
   * financeiras nem são executadas — nenhum valor/contagem financeira vaza pelo dashboard.
   */
  async getSummary(organizationId: number, user: AuthenticatedUser) {
    const canViewFinance = await this.canViewFinance(user);
    const now = new Date();
    // dueDate é data civil: "hoje" é o dia de São Paulo (mesma regra do módulo Financeiro). Antes
    // comparava com o instante `now`, e um lançamento que vence hoje virava "atrasado" aqui mas
    // "a receber" no Financeiro (R$ 169,08 de diferença achada no e2e real).
    const civilToday = civilTodayStart(now);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Escopo por unidade (E08, shared/access/unit-scope.ts): o PROFESSOR com unidades atribuídas vê só os números das
    // suas unidades (alunos, turmas, aulas, frequência, graduações dos seus alunos, eventos do grupo e das unidades).
    // O financeiro é só do Mestre (canViewFinance) e não entra aqui.
    const unitScope = await this.unitScope.resolve(user, organizationId);
    const studentScope = unitScopeFilter(unitScope);
    const lessonScope = lessonScopeFilter(unitScope);

    const emptyAggregate = { _count: 0, _sum: { amountCents: null as number | null } };

    const [
      activeStudents,
      newStudents30d,
      inactiveStudents,
      activeClasses,
      lessonsToday,
      pendingRecords,
      overdueExplicit,
      overduePastDue,
      attendanceLast30d,
      graduationsLast30d,
      upcomingEvents,
    ] = await Promise.all([
      this.prisma.student.count({ where: { organizationId, status: StudentStatus.ACTIVE, ...studentScope } }),
      this.prisma.student.count({
        where: { organizationId, joinedAt: { gte: thirtyDaysAgo }, ...studentScope },
      }),
      this.prisma.student.count({ where: { organizationId, status: StudentStatus.INACTIVE, ...studentScope } }),
      this.prisma.class.count({ where: { organizationId, status: 'ACTIVE', ...studentScope } }),
      this.prisma.lesson.count({
        where: { organizationId, date: { gte: startOfToday, lt: startOfTomorrow }, AND: [lessonScope] },
      }),
      !canViewFinance
        ? emptyAggregate
        : this.prisma.financialRecord.aggregate({
            where: { organizationId, status: FinancialStatus.PENDING, dueDate: { gte: civilToday } },
            _count: true,
            _sum: { amountCents: true },
          }),
      !canViewFinance
        ? emptyAggregate
        : this.prisma.financialRecord.aggregate({
            where: { organizationId, status: FinancialStatus.OVERDUE },
            _count: true,
            _sum: { amountCents: true },
          }),
      !canViewFinance
        ? emptyAggregate
        : this.prisma.financialRecord.aggregate({
            where: { organizationId, status: FinancialStatus.PENDING, dueDate: { lt: civilToday } },
            _count: true,
            _sum: { amountCents: true },
          }),
      this.prisma.attendance.findMany({
        where: { organizationId, createdAt: { gte: thirtyDaysAgo }, lesson: lessonScope },
        select: { present: true },
      }),
      this.prisma.studentGraduation.count({
        where: { organizationId, graduatedAt: { gte: thirtyDaysAgo }, student: studentScope },
      }),
      this.prisma.event.findMany({
        where: { organizationId, date: { gte: now }, status: { in: ['PUBLISHED', 'CLOSED'] }, AND: [groupWideOrUnitFilter(unitScope)] },
        orderBy: { date: 'asc' },
        take: 5,
        select: { id: true, title: true, date: true, location: true },
      }),
    ]);

    const attendanceTotal = attendanceLast30d.length;
    const attendancePresent = attendanceLast30d.filter((a) => a.present).length;

    return {
      students: {
        active: activeStudents,
        new30d: newStudents30d,
        inactive: inactiveStudents,
      },
      classes: { active: activeClasses },
      lessonsToday,
      ...(canViewFinance
        ? {
            finance: {
              pendingCount: pendingRecords._count,
              pendingCents: pendingRecords._sum.amountCents ?? 0,
              // "Atrasado" cobre tanto status=OVERDUE explícito quanto PENDING cujo vencimento já
              // passou — nada transiciona PENDING->OVERDUE automaticamente ainda (sem cron/job no
              // MVP), então somar os dois é o que reflete a realidade para quem olha o dashboard.
              overdueCount: overdueExplicit._count + overduePastDue._count,
              overdueCents: (overdueExplicit._sum.amountCents ?? 0) + (overduePastDue._sum.amountCents ?? 0),
            },
          }
        : {}),
      attendance: {
        last30dPercent: attendanceTotal > 0 ? Math.round((attendancePresent / attendanceTotal) * 100) : null,
      },
      graduations: { last30d: graduationsLast30d },
      upcomingEvents,
    };
  }

  /** PLATFORM/superAdmin têm bypass (igual ao CanAccessGuard); MEMBER consulta a matriz. */
  private async canViewFinance(user: AuthenticatedUser): Promise<boolean> {
    if (user.userType === UserType.PLATFORM || user.isSuperAdmin) return true;
    if (!user.role) return false;
    const permission = await this.prisma.rolePermission.findUnique({
      where: { role_resource: { role: user.role, resource: 'finance' } },
    });
    return permission?.canView ?? false;
  }
}
