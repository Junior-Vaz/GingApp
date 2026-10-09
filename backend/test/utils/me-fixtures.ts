import { INestApplication } from '@nestjs/common';
import { OrgRole, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { DEV_PASSWORD, MESTRE_EMAIL, loginAs } from './list-helpers';

/**
 * Fixtures dos e2e das rotas "/me" (finance, attendance, lessons, notifications). Cria, na
 * organização do seed, usuários PRÓPRIOS (e-mail único por execução) — assim os números esperados
 * são exatos e independentes dos dados do seed e de outras suítes:
 *
 *  - self:     ALUNO com Student próprio (userId);
 *  - guardian: RESPONSAVEL SEM aluno próprio, ligado por StudentGuardian a um dependente;
 *  - orphan:   ALUNO sem Student e sem dependente (sem vínculo: nada pode vir);
 *  - stranger: Student alheio (sem login) — seus dados nunca podem aparecer para os outros;
 *  - classMine (self + dependente matriculados) e classOther (só o stranger) para as aulas.
 *
 * `cleanup()` apaga TUDO que depende dessas entidades, na ordem das FKs.
 */
export interface MeLogin {
  userId: number;
  token: string;
}

export interface MeFixture {
  organizationId: number;
  self: MeLogin & { studentId: number };
  guardian: MeLogin & { dependentId: number };
  orphan: MeLogin;
  strangerId: number;
  classMineId: number;
  classOtherId: number;
  cleanup: () => Promise<void>;
}

export async function createMeFixture(app: INestApplication, prisma: PrismaClient, tag: string): Promise<MeFixture> {
  const organizationId = (await loginAs(app, MESTRE_EMAIL)).organizationId;
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const passwordHash = await bcrypt.hash(DEV_PASSWORD, 4);

  const makeUser = async (kind: string, role: OrgRole) => {
    const email = `${tag}-${kind}-${stamp}@e2e-me.local`;
    const user = await prisma.user.create({
      data: { email, passwordHash, name: `E2E ${tag} ${kind}`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    await prisma.organizationUser.create({ data: { organizationId, userId: user.id, role, status: 'ACTIVE' } });
    const { token } = await loginAs(app, email);
    return { userId: user.id, token };
  };

  const self = await makeUser('self', OrgRole.ALUNO);
  const guardian = await makeUser('guardian', OrgRole.RESPONSAVEL);
  const orphan = await makeUser('orphan', OrgRole.ALUNO);

  const selfStudent = await prisma.student.create({
    data: { organizationId, userId: self.userId, name: `E2E ${tag} aluno` },
  });
  const dependent = await prisma.student.create({ data: { organizationId, name: `E2E ${tag} dependente` } });
  await prisma.studentGuardian.create({
    data: { organizationId, studentId: dependent.id, userId: guardian.userId, name: `E2E ${tag} responsavel` },
  });
  const stranger = await prisma.student.create({ data: { organizationId, name: `E2E ${tag} alheio` } });

  const classMine = await prisma.class.create({ data: { organizationId, name: `E2E ${tag} turma minha` } });
  const classOther = await prisma.class.create({ data: { organizationId, name: `E2E ${tag} turma alheia` } });
  await prisma.classStudent.createMany({
    data: [
      { organizationId, classId: classMine.id, studentId: selfStudent.id },
      { organizationId, classId: classMine.id, studentId: dependent.id },
      { organizationId, classId: classOther.id, studentId: stranger.id },
    ],
  });

  const studentIds = [selfStudent.id, dependent.id, stranger.id];
  const userIds = [self.userId, guardian.userId, orphan.userId];
  const classIds = [classMine.id, classOther.id];

  return {
    organizationId,
    self: { ...self, studentId: selfStudent.id },
    guardian: { ...guardian, dependentId: dependent.id },
    orphan,
    strangerId: stranger.id,
    classMineId: classMine.id,
    classOtherId: classOther.id,
    cleanup: async () => {
      await prisma.attendance.deleteMany({ where: { studentId: { in: studentIds } } });
      await prisma.lesson.deleteMany({ where: { classId: { in: classIds } } });
      await prisma.classStudent.deleteMany({ where: { classId: { in: classIds } } });
      await prisma.class.deleteMany({ where: { id: { in: classIds } } });
      await prisma.financialRecord.deleteMany({ where: { studentId: { in: studentIds } } });
      await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.studentGuardian.deleteMany({ where: { studentId: { in: studentIds } } });
      await prisma.student.deleteMany({ where: { id: { in: studentIds } } });
      await prisma.organizationUser.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    },
  };
}
