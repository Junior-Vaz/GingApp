import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DEV_PASSWORD, loginAs } from './list-helpers';

/**
 * Fixture dos e2e de importação/exportação CSV e relatórios: cria um GRUPO PRÓPRIO (nunca toca o seed ginga-brasil
 * nem o demo) com MESTRE, PROFESSOR e ALUNO logáveis e duas unidades. `cleanup()` apaga tudo que depende do grupo, na
 * ordem das FKs (inclusive o que os specs criarem por Prisma ou pela API).
 */
export interface ReportOrg {
  organizationId: number;
  unitA: { id: number; name: string };
  unitB: { id: number; name: string };
  mestre: { userId: number; token: string; email: string };
  professor: { userId: number; token: string; email: string };
  aluno: { userId: number; token: string };
  cleanup: () => Promise<void>;
}

export async function createReportOrg(app: INestApplication, prisma: PrismaClient, tag: string): Promise<ReportOrg> {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const org = await prisma.organization.create({
    data: {
      name: `E2E ${tag} ${stamp}`,
      slug: `e2e-${tag}-${stamp}`,
      type: OrganizationType.GROUP,
      status: RecordStatus.ACTIVE,
    },
  });
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 4);
  const userIds: number[] = [];
  const makeUser = async (kind: string, role: OrgRole) => {
    const email = `${kind}-${tag}-${stamp}@e2e-reports.local`;
    const user = await prisma.user.create({
      data: { email, passwordHash, name: `E2E ${tag} ${kind}`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    userIds.push(user.id);
    await prisma.organizationUser.create({
      data: { organizationId: org.id, userId: user.id, role, status: 'ACTIVE' },
    });
    const { token } = await loginAs(app, email);
    return { userId: user.id, token, email };
  };
  const mestre = await makeUser('mestre', OrgRole.MESTRE);
  const professor = await makeUser('professor', OrgRole.PROFESSOR);
  const aluno = await makeUser('aluno', OrgRole.ALUNO);

  const unitA = await prisma.unit.create({ data: { organizationId: org.id, name: `Unidade A ${stamp}`, isMain: true } });
  const unitB = await prisma.unit.create({ data: { organizationId: org.id, name: `Unidade B ${stamp}` } });

  return {
    organizationId: org.id,
    unitA: { id: unitA.id, name: unitA.name },
    unitB: { id: unitB.id, name: unitB.name },
    mestre,
    professor,
    aluno: { userId: aluno.userId, token: aluno.token },
    cleanup: async () => {
      const where = { organizationId: org.id };
      const plans = await prisma.subscription.findMany({ where, select: { planId: true } });
      await prisma.attendance.deleteMany({ where });
      await prisma.lesson.deleteMany({ where });
      await prisma.classStudent.deleteMany({ where });
      await prisma.class.deleteMany({ where });
      await prisma.financialRecord.deleteMany({ where });
      await prisma.studentBilling.deleteMany({ where });
      await prisma.studentGraduation.deleteMany({ where });
      await prisma.graduationLevel.deleteMany({ where });
      await prisma.graduationSystem.deleteMany({ where });
      await prisma.studentGuardian.deleteMany({ where });
      await prisma.certificate.deleteMany({ where });
      await prisma.notification.deleteMany({ where });
      // Ficha unica: alunos criados pela API ganham uma Person; apaga as que ficarem sem nenhuma matricula.
      const personIds = (await prisma.student.findMany({ where: { ...where, personId: { not: null } }, select: { personId: true } })).map(
        (s) => s.personId!,
      );
      await prisma.student.deleteMany({ where });
      await prisma.person.deleteMany({ where: { id: { in: personIds }, students: { none: {} }, mergedFrom: { none: {} } } });
      await prisma.userUnitAccess.deleteMany({ where });
      await prisma.unit.deleteMany({ where });
      await prisma.subscription.deleteMany({ where });
      await prisma.plan.deleteMany({ where: { id: { in: plans.map((p) => p.planId) }, code: { startsWith: 'e2e-' } } });
      await prisma.auditLog.deleteMany({ where });
      await prisma.organizationUser.deleteMany({ where });
      await prisma.organization.delete({ where: { id: org.id } });
      await prisma.auditLog.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    },
  };
}
