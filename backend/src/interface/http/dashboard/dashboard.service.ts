import { Injectable } from '@nestjs/common';
import { FinancialStatus, StudentStatus } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';

/**
 * Dashboard administrativo (projeto.txt §30 — "Como está meu grupo?"), sempre isolado por
 * organizationId. Cada número é uma consulta agregada independente; sem cache por enquanto
 * (dataset pequeno no MVP — revisar se ficar lento com mais organizações/dados reais).
 */
@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getSummary(organizationId: number) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

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
      this.prisma.student.count({ where: { organizationId, status: StudentStatus.ACTIVE } }),
      this.prisma.student.count({
        where: { organizationId, joinedAt: { gte: thirtyDaysAgo } },
      }),
      this.prisma.student.count({ where: { organizationId, status: StudentStatus.INACTIVE } }),
      this.prisma.class.count({ where: { organizationId, status: 'ACTIVE' } }),
      this.prisma.lesson.count({
        where: { organizationId, date: { gte: startOfToday, lt: startOfTomorrow } },
      }),
      this.prisma.financialRecord.aggregate({
        where: { organizationId, status: FinancialStatus.PENDING, dueDate: { gte: now } },
        _count: true,
        _sum: { amountCents: true },
      }),
      this.prisma.financialRecord.aggregate({
        where: { organizationId, status: FinancialStatus.OVERDUE },
        _count: true,
        _sum: { amountCents: true },
      }),
      this.prisma.financialRecord.aggregate({
        where: { organizationId, status: FinancialStatus.PENDING, dueDate: { lt: now } },
        _count: true,
        _sum: { amountCents: true },
      }),
      this.prisma.attendance.findMany({
        where: { organizationId, createdAt: { gte: thirtyDaysAgo } },
        select: { present: true },
      }),
      this.prisma.studentGraduation.count({
        where: { organizationId, graduatedAt: { gte: thirtyDaysAgo } },
      }),
      this.prisma.event.findMany({
        where: { organizationId, date: { gte: now } },
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
      finance: {
        pendingCount: pendingRecords._count,
        pendingCents: pendingRecords._sum.amountCents ?? 0,
        // "Atrasado" cobre tanto status=OVERDUE explícito quanto PENDING cujo vencimento já
        // passou — nada transiciona PENDING->OVERDUE automaticamente ainda (sem cron/job no
        // MVP), então somar os dois é o que reflete a realidade para quem olha o dashboard.
        overdueCount: overdueExplicit._count + overduePastDue._count,
        overdueCents: (overdueExplicit._sum.amountCents ?? 0) + (overduePastDue._sum.amountCents ?? 0),
      },
      attendance: {
        last30dPercent: attendanceTotal > 0 ? Math.round((attendancePresent / attendanceTotal) * 100) : null,
      },
      graduations: { last30d: graduationsLast30d },
      upcomingEvents,
    };
  }
}
