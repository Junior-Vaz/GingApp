import { Injectable } from '@nestjs/common';
import { LEGAL_VERSION } from '../../../shared/legal/legal-documents';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { LEVEL_SELECT } from '../graduations/rope';
import { maskPersonDocument } from '../../../shared/security/person-document';
import { toFinanceRecordView } from '../finance/finance-record.view';

export const EXPORT_FORMAT_VERSION = 1;

/**
 * Exportação dos dados do PRÓPRIO usuário (GET /auth/me/export - LGPD art. 18: acesso e portabilidade).
 *
 * Escopo = o que o titular pode ver de si mesmo: a conta (SEM hash de senha, segredo 2FA nem controle de
 * sessão), os vínculos com grupos, notificações, participações, a ficha de aluno quando ele é o próprio aluno,
 * e - se for responsável - a ficha e o histórico dos dependentes pelos quais responde (apenas o SEU registro
 * de responsável; contatos de outros responsáveis do mesmo aluno não saem). Equipe: turmas que leciona e
 * comunicados que publicou. Nunca devolve dados de terceiros nem de outros grupos.
 */
@Injectable()
export class AccountExportService {
  constructor(private readonly prisma: PrismaService) {}

  async export(actor: AuthenticatedUser): Promise<Record<string, unknown>> {
    const userId = actor.id;

    const [
      account,
      memberships,
      unitAccess,
      notifications,
      deletionRequests,
      eventParticipations,
      rodaParticipations,
      publicProfile,
      acceptanceLog,
      taughtClasses,
      taughtLessons,
      announcements,
      ownStudents,
      guardianLinks,
    ] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          name: true,
          email: true,
          phone: true,
          photo: true,
          userType: true,
          isSuperAdmin: true,
          status: true,
          mustChangePassword: true,
          acceptedTermsVersion: true,
          acceptedTermsAt: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.organizationUser.findMany({
        where: { userId },
        orderBy: { id: 'asc' },
        select: {
          role: true,
          status: true,
          createdAt: true,
          organization: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.userUnitAccess.findMany({ where: { userId }, select: { organizationId: true, unitId: true } }),
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { id: 'asc' },
        select: { id: true, organizationId: true, title: true, body: true, type: true, readAt: true, createdAt: true },
      }),
      this.prisma.dataDeletionRequest.findMany({
        where: { userId },
        orderBy: { id: 'asc' },
        select: { id: true, status: true, reason: true, requestedAt: true, resolvedAt: true },
      }),
      this.prisma.eventParticipant.findMany({
        where: { userId },
        include: { event: { select: { id: true, title: true, date: true } } },
      }),
      this.prisma.rodaParticipant.findMany({
        where: { userId },
        include: { roda: { select: { id: true, title: true, date: true } } },
      }),
      this.prisma.publicProfile.findUnique({ where: { userId } }),
      this.prisma.auditLog.findMany({
        where: { userId, action: 'ACCEPT_TERMS' },
        orderBy: { id: 'asc' },
        select: { createdAt: true, resourceId: true, ipAddress: true },
      }),
      this.prisma.class.findMany({
        where: { teacherUserId: userId },
        select: { id: true, organizationId: true, name: true, weekday: true, startTime: true, endTime: true, status: true },
      }),
      this.prisma.lesson.count({ where: { teacherUserId: userId } }),
      this.prisma.announcement.findMany({
        where: { createdByUserId: userId },
        select: { id: true, organizationId: true, title: true, createdAt: true },
      }),
      this.prisma.student.findMany({ where: { userId }, select: { id: true } }),
      this.prisma.studentGuardian.findMany({ where: { userId }, select: { id: true, studentId: true } }),
    ]);

    const students = await this.loadStudentBundles(
      ownStudents.map((s) => s.id),
      guardianLinks,
    );

    const people = await this.loadPeople(userId, [...ownStudents.map((s) => s.id), ...guardianLinks.map((g) => g.studentId)]);

    return {
      formatVersion: EXPORT_FORMAT_VERSION,
      exportedAt: new Date().toISOString(),
      legalVersion: LEGAL_VERSION,
      account,
      memberships,
      unitAccess,
      termsAcceptances: acceptanceLog,
      notifications,
      deletionRequests,
      eventParticipations,
      rodaParticipations,
      publicProfile,
      teaching: { classes: taughtClasses, lessonsCount: taughtLessons },
      publishedAnnouncements: announcements,
      student: students.own,
      dependents: students.dependents,
      // Ficha unica (Person): a do proprio usuario e a dos dependentes, com os pedidos de transferencia. CPF so mascarado
      // (a ficha guarda o CPF cifrado; nao ha decifragem para resposta de API).
      people,
    };
  }

  private async loadPeople(userId: number, studentIds: number[]): Promise<unknown[]> {
    const students = studentIds.length
      ? await this.prisma.student.findMany({ where: { id: { in: studentIds }, personId: { not: null } }, select: { personId: true } })
      : [];
    const ids = [...new Set(students.map((s) => s.personId!))];
    const rows = await this.prisma.person.findMany({
      where: { OR: [{ userId }, { id: { in: ids } }] },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        gingappCode: true,
        name: true,
        nickname: true,
        birthDate: true,
        photo: true,
        gender: true,
        email: true,
        phone: true,
        documentKind: true,
        documentLast4: true,
        createdAt: true,
        updatedAt: true,
        transfers: {
          orderBy: { id: 'asc' },
          select: {
            id: true,
            status: true,
            fromOrganizationId: true,
            toOrganizationId: true,
            requestedAt: true,
            decidedAt: true,
            contests: { select: { reason: true, note: true, createdAt: true } },
          },
        },
      },
    });
    return rows.map(({ documentLast4, ...p }) => ({ ...p, documentMasked: maskPersonDocument(documentLast4) }));
  }

  /**
   * Fichas completas: `own` = o aluno ligado a este usuário (Student.userId); `dependents` = alunos de quem ele
   * é responsável (StudentGuardian.userId), cada um só com o registro de responsável DESTE usuário.
   */
  private async loadStudentBundles(
    ownIds: number[],
    guardianLinks: { id: number; studentId: number }[],
  ): Promise<{ own: unknown[]; dependents: unknown[] }> {
    const allIds = [...new Set([...ownIds, ...guardianLinks.map((g) => g.studentId)])];
    if (allIds.length === 0) return { own: [], dependents: [] };

    const rows = await this.prisma.student.findMany({
      where: { id: { in: allIds } },
      orderBy: { id: 'asc' },
      include: {
        organization: { select: { id: true, name: true, slug: true } },
        guardians: true,
        classStudents: { include: { class: { select: { id: true, name: true } } } },
        attendances: { include: { lesson: { select: { id: true, date: true } } }, orderBy: { id: 'asc' } },
        graduations: { include: { graduationLevel: { select: LEVEL_SELECT } }, orderBy: { id: 'asc' } },
        financialRecords: { orderBy: { id: 'asc' } },
        eventParticipations: { include: { event: { select: { id: true, title: true, date: true } } } },
        rodaParticipations: { include: { roda: { select: { id: true, title: true, date: true } } } },
        certificates: { orderBy: { id: 'asc' } },
        publicProfile: true,
      },
    });

    const myGuardianIds = new Set(guardianLinks.map((g) => g.id));
    const own: unknown[] = [];
    const dependents: unknown[] = [];
    for (const raw of rows) {
      // Lançamentos pela forma PÚBLICA (sem QR/copia-e-cola/ids do provedor de pagamento - mesma view da API).
      const row = { ...raw, financialRecords: raw.financialRecords.map((r) => toFinanceRecordView(r)) };
      if (ownIds.includes(row.id)) {
        own.push(row);
        continue;
      }
      // Dependente: só o registro de responsável do próprio usuário (sem contatos de outros responsáveis).
      dependents.push({ ...row, guardians: row.guardians.filter((g) => myGuardianIds.has(g.id)) });
    }
    return { own, dependents };
  }
}
