// Seed de desenvolvimento do GingApp.
//
// Cria dados minimos para testar login de ponta a ponta nos 3 frontends (painel, app, admin)
// contra o backend real: 1 usuario PLATFORM (SaaS Admin), 1 organizacao piloto com 1 plano/
// assinatura, 1 unidade (matriz), os 4 papeis de membro (mestre/professor/aluno/responsavel),
// 1 sistema de graduacao com 2 niveis, 1 turma com o aluno matriculado, a matriz de
// RolePermission (perfis de projeto.txt §18) e um pedaco de comunidade (estado/cidade/roda)
// para exercitar os endpoints publicos.
//
// Uso: npx prisma db seed  (ou `npm run prisma:seed`)
// Idempotente: pode rodar mais de uma vez sem duplicar dados.

import {
  OrganizationType,
  OrgRole,
  ParticipantStatus,
  PrismaClient,
  RecordStatus,
  SubscriptionStatus,
  UserType,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

/** Senha unica para TODOS os usuarios de seed. Uso estritamente local/dev — nunca usar em
 * staging/producao. Documentada de proposito (nao e segredo real, e um fixture). */
const DEV_PASSWORD = 'Dev@12345';

async function hashPassword(): Promise<string> {
  return bcrypt.hash(DEV_PASSWORD, 10);
}

async function main() {
  const passwordHash = await hashPassword();
  console.log('Seeding GingApp dev data...\n');

  // ---------------------------------------------------------------------
  // 1. Plataforma: usuario PLATFORM (equipe interna GingApp, super admin)
  // ---------------------------------------------------------------------
  const owner = await prisma.user.upsert({
    where: { email: 'owner@gingapp.com.br' },
    update: {},
    create: {
      email: 'owner@gingapp.com.br',
      passwordHash,
      name: 'GingApp Owner',
      userType: UserType.PLATFORM,
      isSuperAdmin: true,
      status: 'ACTIVE',
    },
  });
  console.log(`✔ PLATFORM user: ${owner.email}`);

  // ---------------------------------------------------------------------
  // 2. Plano unico (modelo comercial inicial — projeto.txt §5: "uma assinatura,
  //    acesso a plataforma", preco a definir)
  // ---------------------------------------------------------------------
  const plan = await prisma.plan.upsert({
    where: { code: 'UNICO' },
    update: {},
    create: {
      name: 'Plano Único',
      code: 'UNICO',
      priceCents: 0,
      billingPeriod: 'MONTHLY',
      features: {},
      isActive: true,
    },
  });
  console.log(`✔ Plan: ${plan.name}`);

  // ---------------------------------------------------------------------
  // 3. Organizacao piloto (grupo de capoeira) + assinatura
  // ---------------------------------------------------------------------
  const org = await prisma.organization.upsert({
    where: { slug: 'ginga-brasil' },
    update: {},
    create: {
      name: 'Grupo Ginga Brasil',
      slug: 'ginga-brasil',
      type: OrganizationType.GROUP,
      status: RecordStatus.ACTIVE,
      email: 'contato@gingabrasil.com.br',
    },
  });
  console.log(`✔ Organization: ${org.name} (slug=${org.slug})`);

  const existingSubscription = await prisma.subscription.findFirst({
    where: { organizationId: org.id },
  });
  if (!existingSubscription) {
    await prisma.subscription.create({
      data: {
        organizationId: org.id,
        planId: plan.id,
        status: SubscriptionStatus.ACTIVE,
        currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });
    console.log('✔ Subscription: ACTIVE');
  }

  // ---------------------------------------------------------------------
  // 4. Unidade (matriz)
  // ---------------------------------------------------------------------
  let unit = await prisma.unit.findFirst({ where: { organizationId: org.id, isMain: true } });
  if (!unit) {
    unit = await prisma.unit.create({
      data: {
        organizationId: org.id,
        name: 'Matriz — Goiânia',
        city: 'Goiânia',
        state: 'GO',
        isMain: true,
        status: RecordStatus.ACTIVE,
      },
    });
  }
  console.log(`✔ Unit: ${unit.name}`);

  // ---------------------------------------------------------------------
  // 5. Usuarios MEMBER — os 4 papeis de projeto.txt §18
  // ---------------------------------------------------------------------
  async function upsertMember(email: string, name: string, role: OrgRole) {
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: { email, passwordHash, name, userType: UserType.MEMBER, status: 'ACTIVE' },
    });
    await prisma.organizationUser.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
      update: {},
      create: { organizationId: org.id, userId: user.id, role, status: 'ACTIVE' },
    });
    console.log(`✔ MEMBER user: ${email} (${role})`);
    return user;
  }

  const mestre = await upsertMember('mestre@gingabrasil.com.br', 'Mestre João', OrgRole.MESTRE);
  await upsertMember('professor@gingabrasil.com.br', 'Professor Pedro', OrgRole.PROFESSOR);
  const alunoUser = await upsertMember('aluno@gingabrasil.com.br', 'Ana Capoeirista', OrgRole.ALUNO);
  const responsavelUser = await upsertMember(
    'responsavel@gingabrasil.com.br',
    'Carla Responsável',
    OrgRole.RESPONSAVEL,
  );

  // Professor autorizado a atuar na matriz (PLANO_PROJETO.md §3.2 item 5)
  const professorMembership = await prisma.organizationUser.findFirst({
    where: { organizationId: org.id, role: OrgRole.PROFESSOR },
  });
  if (professorMembership) {
    await prisma.userUnitAccess.upsert({
      where: { userId_unitId: { userId: professorMembership.userId, unitId: unit.id } },
      update: {},
      create: { organizationId: org.id, userId: professorMembership.userId, unitId: unit.id },
    });
  }

  // ---------------------------------------------------------------------
  // 6. Aluno (Student) vinculado ao usuario ALUNO + responsavel (StudentGuardian)
  // ---------------------------------------------------------------------
  const student = await prisma.student.upsert({
    where: { userId: alunoUser.id },
    update: {},
    create: {
      organizationId: org.id,
      unitId: unit.id,
      userId: alunoUser.id,
      name: alunoUser.name,
      birthDate: new Date('2014-03-20'), // menor de idade — exercita a regra de §3.4
      status: 'ACTIVE',
      joinedAt: new Date('2024-02-01'),
    },
  });
  console.log(`✔ Student: ${student.name}`);

  const existingGuardian = await prisma.studentGuardian.findFirst({
    where: { studentId: student.id, userId: responsavelUser.id },
  });
  if (!existingGuardian) {
    await prisma.studentGuardian.create({
      data: {
        organizationId: org.id,
        studentId: student.id,
        userId: responsavelUser.id,
        name: responsavelUser.name,
        relationship: 'Mãe',
        consentPublicProfile: false,
      },
    });
    console.log('✔ StudentGuardian vinculado (sem consentimento de perfil público, por padrão)');
  }

  // ---------------------------------------------------------------------
  // 7. Sistema de graduacao configuravel por grupo (projeto.txt §26) + 1 graduacao registrada
  // ---------------------------------------------------------------------
  let graduationSystem = await prisma.graduationSystem.findFirst({
    where: { organizationId: org.id, name: 'Cordas Ginga Brasil' },
  });
  if (!graduationSystem) {
    graduationSystem = await prisma.graduationSystem.create({
      data: { organizationId: org.id, name: 'Cordas Ginga Brasil', isActive: true },
    });
  }

  const levelCrua = await prisma.graduationLevel.upsert({
    where: { graduationSystemId_order: { graduationSystemId: graduationSystem.id, order: 1 } },
    update: {},
    create: {
      organizationId: org.id,
      graduationSystemId: graduationSystem.id,
      name: 'Crua',
      order: 1,
      color: '#e5e5e5',
    },
  });
  await prisma.graduationLevel.upsert({
    where: { graduationSystemId_order: { graduationSystemId: graduationSystem.id, order: 2 } },
    update: {},
    create: {
      organizationId: org.id,
      graduationSystemId: graduationSystem.id,
      name: 'Verde',
      order: 2,
      color: '#22c55e',
    },
  });
  console.log(`✔ GraduationSystem: ${graduationSystem.name} (2 níveis)`);

  const existingGraduation = await prisma.studentGraduation.findFirst({
    where: { studentId: student.id },
  });
  if (!existingGraduation) {
    await prisma.studentGraduation.create({
      data: {
        organizationId: org.id,
        studentId: student.id,
        graduationLevelId: levelCrua.id,
        graduatedAt: new Date('2024-06-15'),
      },
    });
    console.log('✔ StudentGraduation: Ana → Crua (2024-06-15)');
  }

  // ---------------------------------------------------------------------
  // 8. Turma + matricula do aluno
  // ---------------------------------------------------------------------
  let turma = await prisma.class.findFirst({ where: { organizationId: org.id, name: 'Adulto — Quinta 19h' } });
  if (!turma) {
    turma = await prisma.class.create({
      data: {
        organizationId: org.id,
        unitId: unit.id,
        name: 'Adulto — Quinta 19h',
        weekday: 4,
        startTime: '19:00',
        endTime: '20:30',
        status: RecordStatus.ACTIVE,
      },
    });
  }
  await prisma.classStudent.upsert({
    where: { classId_studentId: { classId: turma.id, studentId: student.id } },
    update: {},
    create: { organizationId: org.id, classId: turma.id, studentId: student.id, status: RecordStatus.ACTIVE },
  });
  console.log(`✔ Class: ${turma.name} (Ana matriculada)`);

  // ---------------------------------------------------------------------
  // 9. RolePermission — matriz inicial (perfis de projeto.txt §18). Guard @CanAccess ainda
  //    nao esta implementado (pendencia registrada em PLANO_PROJETO.md §10.1.3), mas os dados
  //    ja ficam prontos para quando ele for construido.
  // ---------------------------------------------------------------------
  const RESOURCES = ['students', 'classes', 'lessons', 'attendance', 'graduations', 'finance', 'events', 'rodas', 'announcements'];
  const MATRIX: Record<OrgRole, { view: boolean; create: boolean; edit: boolean; delete: boolean }> = {
    [OrgRole.MESTRE]: { view: true, create: true, edit: true, delete: true },
    [OrgRole.PROFESSOR]: { view: true, create: true, edit: true, delete: false },
    [OrgRole.ALUNO]: { view: true, create: false, edit: false, delete: false },
    [OrgRole.RESPONSAVEL]: { view: true, create: false, edit: false, delete: false },
  };
  for (const role of Object.values(OrgRole)) {
    for (const resource of RESOURCES) {
      const perms = MATRIX[role];
      await prisma.rolePermission.upsert({
        where: { role_resource: { role, resource } },
        update: {},
        create: {
          role,
          resource,
          canView: perms.view,
          canCreate: perms.create,
          canEdit: perms.edit,
          canDelete: perms.delete,
        },
      });
    }
  }
  console.log(`✔ RolePermission: matriz ${Object.values(OrgRole).length} papéis × ${RESOURCES.length} recursos`);

  // ---------------------------------------------------------------------
  // 10. Comunidade — estado/cidade/comunidade + 1 roda pública (dado nao vinculado a org)
  // ---------------------------------------------------------------------
  const state = await prisma.state.upsert({
    where: { uf: 'GO' },
    update: {},
    create: { name: 'Goiás', uf: 'GO' },
  });

  let city = await prisma.city.findFirst({ where: { stateId: state.id, name: 'Goiânia' } });
  if (!city) {
    city = await prisma.city.create({ data: { stateId: state.id, name: 'Goiânia' } });
  }

  let community = await prisma.community.findFirst({ where: { stateId: state.id, name: 'Comunidade Goiás' } });
  if (!community) {
    community = await prisma.community.create({
      data: { stateId: state.id, name: 'Comunidade Goiás', description: 'Rodas e eventos de capoeira em Goiás.' },
    });
  }

  const existingRoda = await prisma.roda.findFirst({ where: { title: 'Roda Mensal — Valparaíso' } });
  if (!existingRoda) {
    const roda = await prisma.roda.create({
      data: {
        communityId: community.id,
        stateId: state.id,
        cityId: city.id,
        title: 'Roda Mensal — Valparaíso',
        description: 'Roda aberta, entrada gratuita.',
        date: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        location: 'Praça Central, Valparaíso de Goiás',
      },
    });
    await prisma.rodaParticipant.create({
      data: { rodaId: roda.id, userId: mestre.id, status: ParticipantStatus.CONFIRMED },
    });
    console.log(`✔ Roda: ${roda.title}`);
  }

  console.log('\n--- Seed concluído ---');
  console.log('Credenciais de dev (senha única para todos):', DEV_PASSWORD);
  console.log('  PLATFORM  → POST /api/auth/platform-login  → owner@gingapp.com.br');
  console.log('  MEMBER    → POST /api/auth/login            → mestre@gingabrasil.com.br (MESTRE)');
  console.log('                                                professor@gingabrasil.com.br (PROFESSOR)');
  console.log('                                                aluno@gingabrasil.com.br (ALUNO)');
  console.log('                                                responsavel@gingabrasil.com.br (RESPONSAVEL)');
}

main()
  .catch((err) => {
    console.error('Seed falhou:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
