import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import {
  countEntities,
  DEMO_DEV_PASSWORD,
  DemoConfigError,
  DemoLogger,
  DemoResult,
  demoEmail,
  resolveDemoPassword,
  runDemo,
} from '../prisma/demo';
import { createTestApp } from './utils/test-app';

/**
 * Grupo DEMO (prisma/demo.ts). O spec usa o MESMO banco de dev, mas com um slug e um domínio de
 * e-mail PRÓPRIOS ("demo-e2e" / demo-e2e.gingapp.com.br), para nunca tocar no grupo demo "de verdade"
 * (slug "demo") que pode estar no banco — e o after() remove só o que este spec criou.
 *
 * Prova: senha ausente/fraca recusada (função e CLI), criação completa, idempotência (2ª execução cria
 * ZERO registros e as contagens não mudam), isolamento (contagens de todos os outros grupos idênticas
 * antes/depois), coerência dos dados (regras de negócio) e login real + listas pela API HTTP.
 */
const SLUG = 'demo-e2e';
const DOMAIN = 'demo-e2e.gingapp.com.br';
const PASSWORD = 'Demo-E2e#Capoeira2026';
const DAY = 86_400_000;
const BACKEND_DIR = `${__dirname}/..`;

const silent: DemoLogger = { info: () => undefined, warn: () => undefined, error: () => undefined };
const opts = { password: PASSWORD, slug: SLUG, emailDomain: DOMAIN };

/** Apaga SÓ o grupo/usuários deste spec, na ordem das FKs. Recusa qualquer outro slug. */
async function removeE2eGroup(prisma: PrismaClient): Promise<void> {
  assert.equal(SLUG, 'demo-e2e');
  const org = await prisma.organization.findUnique({ where: { slug: SLUG } });
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `@${DOMAIN}` } },
    select: { id: true },
  });
  const userIds = users.map((u) => u.id);
  if (org) {
    const organizationId = org.id;
    const subscriptions = await prisma.subscription.findMany({ where: { organizationId }, select: { id: true } });
    await prisma.notification.deleteMany({ where: { OR: [{ organizationId }, { userId: { in: userIds } }] } });
    await prisma.certificate.deleteMany({ where: { organizationId } });
    await prisma.publicProfile.deleteMany({ where: { OR: [{ organizationId }, { userId: { in: userIds } }] } });
    await prisma.rodaParticipant.deleteMany({ where: { OR: [{ roda: { organizationId } }, { userId: { in: userIds } }] } });
    await prisma.roda.deleteMany({ where: { organizationId } });
    await prisma.eventParticipant.deleteMany({ where: { organizationId } });
    await prisma.event.deleteMany({ where: { organizationId } });
    await prisma.announcement.deleteMany({ where: { organizationId } });
    await prisma.attendance.deleteMany({ where: { organizationId } });
    await prisma.lesson.deleteMany({ where: { organizationId } });
    await prisma.classStudent.deleteMany({ where: { organizationId } });
    await prisma.class.deleteMany({ where: { organizationId } });
    await prisma.studentGraduation.deleteMany({ where: { organizationId } });
    await prisma.graduationLevel.deleteMany({ where: { organizationId } });
    await prisma.graduationSystem.deleteMany({ where: { organizationId } });
    await prisma.financialRecord.deleteMany({ where: { organizationId } });
    await prisma.studentGuardian.deleteMany({ where: { organizationId } });
    await prisma.student.deleteMany({ where: { organizationId } });
    await prisma.userUnitAccess.deleteMany({ where: { organizationId } });
    await prisma.unit.deleteMany({ where: { organizationId } });
    await prisma.subscriptionEvent.deleteMany({ where: { subscriptionId: { in: subscriptions.map((s) => s.id) } } });
    await prisma.subscription.deleteMany({ where: { organizationId } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId }, { userId: { in: userIds } }] } });
    await prisma.organizationUser.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
  if (userIds.length > 0) {
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
}

/** Grupos que o isolamento protege: o do seed (ginga-brasil) e o demo "de verdade" (slug demo), se existir. */
const TRACKED_SLUGS = ['ginga-brasil', 'demo'];

/** Foto dos grupos protegidos (contagens por entidade, nome, status, nº de usuários) + o plano PROFISSIONAL
 * (linha inteira) + as chaves de RolePermission (o demo nunca remove nem altera linhas existentes). */
async function snapshotOthers(prisma: PrismaClient): Promise<Record<string, unknown>> {
  const orgs = await prisma.organization.findMany({ where: { slug: { in: TRACKED_SLUGS } }, orderBy: { id: 'asc' } });
  const perOrg: Record<string, unknown> = {};
  for (const org of orgs) {
    perOrg[org.slug] = {
      status: org.status,
      name: org.name,
      updatedAt: org.updatedAt,
      counts: await countEntities(prisma, org.id),
      users: await prisma.user.count({ where: { memberships: { some: { organizationId: org.id } } } }),
    };
  }
  const permissions = await prisma.rolePermission.findMany({ orderBy: [{ role: 'asc' }, { resource: 'asc' }] });
  return {
    perOrg,
    plan: await prisma.plan.findUnique({ where: { code: 'PROFISSIONAL' } }),
    permissions: permissions.map((p) => `${p.role}/${p.resource}:${p.canView}${p.canCreate}${p.canEdit}${p.canDelete}`),
  };
}

/**
 * O banco de dev é COMPARTILHADO: outro processo pode mexer em ginga-brasil/permissões no meio da janela
 * e produzir uma diferença que não é do demo. `action` roda até 3 vezes (ele sempre começa do zero) e o
 * isolamento só é reprovado se a foto antes/depois diferir em TODAS as tentativas — um vazamento real do
 * demo é determinístico e aparece sempre; ruído de outro processo não se repete.
 */
async function assertIsolated(prisma: PrismaClient, action: () => Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const before = await snapshotOthers(prisma);
    await action();
    const after = await snapshotOthers(prisma);
    try {
      assert.deepEqual(after, before);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function login(app: INestApplication, local: string) {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email: demoEmail(local, DOMAIN), password: PASSWORD })
    .expect(200);
  return { token: res.body.accessToken as string, user: res.body.user };
}

async function get(app: INestApplication, path: string, token: string) {
  const res = await request(app.getHttpServer()).get(`/api/${path}`).set('Authorization', `Bearer ${token}`);
  return { status: res.status, body: res.body, total: Number(res.headers['x-total-count']) };
}

describe('Grupo demo (prisma/demo.ts) (e2e)', () => {
  const prisma = new PrismaClient();
  let app: INestApplication;
  let first: DemoResult;
  let second: DemoResult;
  let orgId: number;

  before(async () => {
    await removeE2eGroup(prisma); // sobra de uma execução anterior interrompida
    app = await createTestApp({ disableThrottle: true });
  });

  after(async () => {
    await removeE2eGroup(prisma);
    const leftovers = await prisma.organization.count({ where: { slug: SLUG } });
    const leftoverUsers = await prisma.user.count({ where: { email: { endsWith: `@${DOMAIN}` } } });
    await prisma.$disconnect();
    await app.close();
    assert.equal(leftovers, 0, 'o grupo demo-e2e deve ser removido ao final');
    assert.equal(leftoverUsers, 0, 'os usuários demo-e2e devem ser removidos ao final');
  });

  describe('senha obrigatória e forte', () => {
    it('produção sem DEMO_PASSWORD é recusada; em dev usa a senha padrão (que passa na política)', () => {
      assert.throws(() => resolveDemoPassword({ NODE_ENV: 'production' }), (e: unknown) => {
        assert.ok(e instanceof DemoConfigError);
        assert.match((e as Error).message, /DEMO_PASSWORD é obrigatória/);
        return true;
      });
      assert.throws(() => resolveDemoPassword({ NODE_ENV: 'production', DEMO_PASSWORD: '   ' }), DemoConfigError);
      assert.equal(resolveDemoPassword({ NODE_ENV: 'development' }), DEMO_DEV_PASSWORD);
      assert.equal(resolveDemoPassword({}), DEMO_DEV_PASSWORD);
      assert.equal(resolveDemoPassword({ NODE_ENV: 'production', DEMO_PASSWORD: PASSWORD }), PASSWORD);
    });

    it('senhas fracas (curta, trivial, "senha", dev@12345, com o e-mail) são recusadas sem a senha na mensagem', () => {
      for (const weak of ['curta1A!', 'tudominusculo12345', 'Senha@Forte2026x', 'Dev@12345Dev@12345', 'Zmestre#2026Axe!', ' Demo@Capoeira2026! ']) {
        assert.throws(
          () => resolveDemoPassword({ NODE_ENV: 'production', DEMO_PASSWORD: weak }),
          (e: unknown) => {
            assert.ok(e instanceof DemoConfigError, `esperava DemoConfigError para ${weak}`);
            assert.ok(!(e as Error).message.includes(weak.trim()) || weak.trim().length < 3);
            return true;
          },
        );
      }
    });

    it('runDemo com senha fraca falha ANTES de gravar qualquer coisa', async () => {
      await assert.rejects(runDemo(prisma, { ...opts, password: 'fraca' }, silent), DemoConfigError);
      assert.equal(await prisma.organization.count({ where: { slug: SLUG } }), 0);
      assert.equal(await prisma.user.count({ where: { email: { endsWith: `@${DOMAIN}` } } }), 0);
    });

    it('CLI (ts-node prisma/demo.ts) em produção sem senha / com senha fraca sai com código 1, sem gravar e sem ecoar a senha', () => {
      const run = (extra: Record<string, string>) =>
        spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', 'prisma/demo.ts'], {
          cwd: BACKEND_DIR,
          encoding: 'utf8',
          env: { ...process.env, TS_NODE_COMPILER_OPTIONS: '{"rootDir":"."}', NODE_ENV: 'production', DEMO_PASSWORD: '', ...extra },
        });
      const absent = run({});
      assert.equal(absent.status, 1, absent.stdout + absent.stderr);
      assert.match(absent.stderr, /DEMO_PASSWORD é obrigatória/);
      assert.match(absent.stderr, /Nada foi gravado/);

      const weak = run({ DEMO_PASSWORD: 'SenhaFraca123' });
      assert.equal(weak.status, 1, weak.stdout + weak.stderr);
      assert.match(weak.stderr, /DEMO_PASSWORD recusada/);
      assert.ok(!(weak.stdout + weak.stderr).includes('SenhaFraca123'), 'a senha não pode aparecer no log');
    });
  });

  describe('criação, idempotência e isolamento', () => {
    it('1ª execução cria o grupo completo SEM alterar nenhum outro grupo (ginga-brasil, demo real, plano, permissões)', async () => {
      const gb = await prisma.organization.findUnique({ where: { slug: 'ginga-brasil' } });
      assert.ok(gb, 'o grupo ginga-brasil do seed deve existir para a comparação ser significativa');
      await assertIsolated(prisma, async () => {
        await removeE2eGroup(prisma); // sempre parte do zero: a criação inteira fica dentro da janela comparada
        first = await runDemo(prisma, opts, silent);
      });
      orgId = first.organizationId;
      assert.ok(first.created.organizations === 1 && first.created.students === 30);
      const c = first.counts;
      assert.equal(c.units, 3);
      assert.equal(c.members, 8);
      assert.equal(c.students, 30);
      assert.equal(c.classes, 6);
      assert.equal(c.graduationLevels, 8);
      assert.ok(c.guardians >= 13 && c.lessons >= 40 && c.attendances >= 150);
      assert.ok(c.finance >= 100 && c.events >= 6 && c.rodas >= 3 && c.announcements >= 5);
      assert.ok(c.notifications > 0 && c.certificates > 0 && c.publicProfiles >= 5 && c.graduations >= 50);
    });

    it('2ª execução não cria NADA (contagens idênticas, created vazio)', async () => {
      second = await runDemo(prisma, opts, silent);
      assert.equal(second.organizationId, first.organizationId);
      assert.deepEqual(second.created, {}, `criou de novo: ${JSON.stringify(second.created)}`);
      assert.deepEqual(second.counts, first.counts);
      // 2ª via independente: contagem direta, fora do helper do próprio demo.
      assert.equal(await prisma.student.count({ where: { organizationId: orgId } }), 30);
      assert.equal(await prisma.organization.count({ where: { slug: SLUG } }), 1);
      assert.equal(await prisma.user.count({ where: { email: { endsWith: `@${DOMAIN}` } } }), 8);
      assert.equal(await prisma.subscription.count({ where: { organizationId: orgId } }), 1);
    });

    it('rodar de novo com OUTRA senha atualiza só a senha das contas demo (sem duplicar)', async () => {
      const other = 'Capoeira-Nova#Roda2027';
      const third = await runDemo(prisma, { ...opts, password: other }, silent);
      assert.deepEqual(third.created, {});
      const res = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: demoEmail('mestre', DOMAIN), password: other });
      assert.equal(res.status, 200);
      const old = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: demoEmail('mestre', DOMAIN), password: PASSWORD });
      assert.equal(old.status, 401);
      await runDemo(prisma, opts, silent); // volta para a senha do spec
      const back = await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: demoEmail('mestre', DOMAIN), password: PASSWORD });
      assert.equal(back.status, 200);
    });

    it('isolamento na re-execução: nenhum outro grupo, plano ou permissão mudou', async () => {
      await assertIsolated(prisma, async () => {
        await runDemo(prisma, opts, silent);
      });
    });

    it('todo dado do demo pertence ao grupo demo (usuários só têm vínculo com ele)', async () => {
      const users = await prisma.user.findMany({
        where: { email: { endsWith: `@${DOMAIN}` } },
        include: { memberships: true },
      });
      assert.equal(users.length, 8);
      for (const user of users) {
        assert.equal(user.memberships.length, 1);
        assert.equal(user.memberships[0].organizationId, orgId);
        assert.equal(user.userType, 'MEMBER');
      }
    });

    it('recusa o slug de OUTRO grupo e e-mail demo que pertence a outro grupo, sem gravar nada', async () => {
      await assertIsolated(prisma, async () => {
        await assert.rejects(
          runDemo(prisma, { ...opts, slug: 'ginga-brasil' }, silent),
          (e: unknown) => e instanceof DemoConfigError && /já pertence a outro grupo/.test((e as Error).message),
        );
      });
      const gb = await prisma.organization.findUniqueOrThrow({ where: { slug: 'ginga-brasil' } });
      assert.equal(gb.name, 'Grupo Ginga Brasil');
    });
  });

  describe('coerência dos dados (regras de negócio)', () => {
    it('plano PROFISSIONAL comporta os alunos; assinatura ACTIVE por ~1 ano', async () => {
      const sub = await prisma.subscription.findFirstOrThrow({ where: { organizationId: orgId }, include: { plan: true } });
      assert.equal(sub.status, 'ACTIVE');
      assert.equal(sub.plan.code, 'PROFISSIONAL');
      const active = await prisma.student.count({ where: { organizationId: orgId, status: 'ACTIVE' } });
      assert.ok(sub.plan.maxStudents === null || active <= sub.plan.maxStudents);
      const units = await prisma.unit.count({ where: { organizationId: orgId } });
      assert.ok(sub.plan.maxUnits === null || units <= sub.plan.maxUnits);
      const days = (sub.currentPeriodEnd!.getTime() - Date.now()) / DAY;
      assert.ok(days > 360 && days < 366, `período de ${days} dias`);
    });

    it('alunos: mistura de idades, inativos, cidades diferentes; menores SEMPRE com responsável vinculado', async () => {
      const students = await prisma.student.findMany({ where: { organizationId: orgId }, include: { guardians: true } });
      const ageOf = (d: Date) => (Date.now() - d.getTime()) / (365.25 * DAY);
      const minors = students.filter((s) => ageOf(s.birthDate!) < 18);
      const adults = students.filter((s) => ageOf(s.birthDate!) >= 18);
      assert.ok(minors.length >= 10 && adults.length >= 15);
      assert.ok(students.some((s) => ageOf(s.birthDate!) < 13) && students.some((s) => ageOf(s.birthDate!) >= 13 && ageOf(s.birthDate!) < 18));
      for (const minor of minors) assert.ok(minor.guardians.length >= 1, `${minor.name} (menor) sem responsável`);
      assert.ok(students.filter((s) => s.status !== 'ACTIVE').length >= 3);
      assert.ok(students.every((s) => s.joinedAt && s.joinedAt <= new Date()));
      assert.equal(students.filter((s) => s.userId !== null).length, 3); // aluno1..3 (aluno4 é responsável)
      const units = await prisma.unit.findMany({ where: { organizationId: orgId } });
      assert.equal(new Set(units.map((u) => u.city)).size, 3);
      assert.equal(units.filter((u) => u.isMain).length, 1);
      // e-mails fictícios no domínio demo
      assert.ok(students.every((s) => s.email === null || s.email.endsWith(`@${DOMAIN}`)));
    });

    it('graduações: cordas em sequência 1..N, datas crescentes e nunca no futuro; cores reais', async () => {
      const levels = await prisma.graduationLevel.findMany({ where: { organizationId: orgId }, orderBy: { order: 'asc' } });
      assert.deepEqual(levels.map((l) => l.order), [1, 2, 3, 4, 5, 6, 7, 8]);
      assert.ok(levels.every((l) => /^#[0-9A-F]{6}$/i.test(l.color ?? '')));
      const grads = await prisma.studentGraduation.findMany({
        where: { organizationId: orgId },
        include: { graduationLevel: true },
        orderBy: [{ studentId: 'asc' }, { graduatedAt: 'asc' }],
      });
      const byStudent = new Map<number, typeof grads>();
      for (const g of grads) byStudent.set(g.studentId, [...(byStudent.get(g.studentId) ?? []), g]);
      assert.ok(byStudent.size >= 25);
      for (const list of byStudent.values()) {
        list.forEach((g, i) => {
          assert.equal(g.graduationLevel.order, i + 1, 'degraus em sequência a partir da corda 1');
          assert.ok(g.graduatedAt <= new Date());
          if (i > 0) assert.ok(g.graduatedAt > list[i - 1].graduatedAt, 'datas estritamente crescentes');
        });
      }
      const recent = grads.filter((g) => Date.now() - g.graduatedAt.getTime() <= 30 * DAY);
      assert.ok(recent.length >= 2, 'precisa de graduações nos últimos 30 dias para o dashboard');
    });

    it('aulas/frequência: janela relativa a hoje, passadas e futuras; ~75% de presença; chamada só em aula passada', async () => {
      const lessons = await prisma.lesson.findMany({ where: { organizationId: orgId }, include: { attendances: true, class: true } });
      const now = Date.now();
      assert.ok(lessons.every((l) => l.date.getTime() >= now - 61 * DAY && l.date.getTime() <= now + 15 * DAY));
      assert.ok(lessons.some((l) => l.date.getTime() > now) && lessons.some((l) => l.date.getTime() < now - 30 * DAY));
      for (const l of lessons) {
        assert.equal(l.date.getUTCDay(), l.class.weekday, 'aula no dia da semana da turma');
        if (l.date.getTime() >= now - DAY) assert.equal(l.attendances.length, 0, 'sem chamada em aula de hoje/futura');
      }
      const all = lessons.flatMap((l) => l.attendances);
      const rate = all.filter((a) => a.present).length / all.length;
      assert.ok(rate > 0.65 && rate < 0.85, `presença ${(rate * 100).toFixed(1)}%`);
      assert.ok(all.some((a) => !a.present && a.justification));
      // aluno só tem chamada em turma onde está matriculado
      const enrolled = new Set(
        (await prisma.classStudent.findMany({ where: { organizationId: orgId } })).map((e) => `${e.classId}:${e.studentId}`),
      );
      const byLesson = new Map(lessons.map((l) => [l.id, l.classId]));
      assert.ok(all.every((a) => enrolled.has(`${byLesson.get(a.lessonId)}:${a.studentId}`)));
    });

    it('financeiro: mensalidades pagas/pendentes/vencidas, despesas, valores positivos e sem duplicata', async () => {
      const recs = await prisma.financialRecord.findMany({ where: { organizationId: orgId } });
      assert.ok(recs.every((r) => r.amountCents > 0));
      const fees = recs.filter((r) => r.type === 'MENSALIDADE');
      assert.ok(fees.filter((r) => r.status === 'PAID').length >= 40);
      assert.ok(fees.filter((r) => r.status === 'PENDING').length >= 3);
      const overdue = fees.filter((r) => r.status === 'OVERDUE');
      assert.ok(overdue.length >= 3 && overdue.length <= 5 && overdue.every((r) => r.dueDate < new Date() && !r.paidAt));
      assert.ok(recs.filter((r) => r.type === 'DESPESA').length >= 5 && recs.filter((r) => r.type === 'DESPESA').every((r) => r.studentId === null));
      assert.ok(recs.filter((r) => r.status === 'PAID').every((r) => r.paidAt && r.paidAt <= new Date()));
      assert.ok(recs.filter((r) => r.status !== 'PAID').every((r) => !r.paidAt));
      const keys = recs.map((r) => `${r.studentId}|${r.type}|${r.description}|${r.dueDate.toISOString()}`);
      assert.equal(new Set(keys).size, keys.length);
    });

    it('eventos: passados e futuros com participantes; rodas; comunicados e notificações; unidades válidas', async () => {
      const events = await prisma.event.findMany({ where: { organizationId: orgId }, include: { participants: true } });
      const now = Date.now();
      assert.ok(events.some((e) => e.date.getTime() < now) && events.filter((e) => e.date.getTime() > now).length >= 3);
      assert.ok(events.some((e) => e.type === 'BATIZADO') && events.some((e) => e.type === 'WORKSHOP'));
      assert.ok(events.every((e) => e.participants.length > 0));
      const past = events.filter((e) => e.date.getTime() < now);
      assert.ok(past.every((e) => e.participants.every((p) => ['ATTENDED', 'DECLINED', 'CANCELLED'].includes(p.status))));
      const rodas = await prisma.roda.findMany({ where: { organizationId: orgId }, include: { participants: true } });
      assert.ok(rodas.length >= 3 && rodas.some((r) => r.date.getTime() > now) && rodas.some((r) => r.date.getTime() < now));
      const announcements = await prisma.announcement.findMany({ where: { organizationId: orgId } });
      assert.ok(announcements.some((a) => a.unitId !== null) && announcements.some((a) => a.unitId === null));
      assert.ok(announcements.every((a) => a.publishedAt));
    });

    it('Passaporte/certificados: menor só tem perfil público com consentimento do responsável; códigos únicos', async () => {
      const profiles = await prisma.publicProfile.findMany({
        where: { organizationId: orgId },
        include: { student: true, consentByGuardian: true },
      });
      assert.ok(profiles.length >= 5 && profiles.some((p) => p.isPublished) && profiles.some((p) => !p.isPublished));
      let minorPublished = 0;
      for (const p of profiles) {
        const age = (Date.now() - p.student!.birthDate!.getTime()) / (365.25 * DAY);
        if (age < 18) {
          assert.ok(p.consentByGuardianId && p.consentByGuardian?.consentPublicProfile, `${p.displayName}: menor sem consentimento`);
          assert.equal(p.consentByGuardian?.studentId, p.studentId);
          if (p.isPublished) minorPublished += 1;
        }
      }
      assert.ok(minorPublished >= 1, 'deve haver um menor com Passaporte publicado COM consentimento');
      assert.equal(new Set(profiles.map((p) => p.publicCode)).size, profiles.length);
      const certs = await prisma.certificate.findMany({ where: { organizationId: orgId }, include: { studentGraduation: true } });
      assert.ok(certs.length >= 10);
      assert.equal(new Set(certs.map((c) => c.verificationCode)).size, certs.length);
      assert.ok(certs.every((c) => c.issuedAt && c.issuedAt <= new Date()));
      assert.ok(certs.filter((c) => c.studentGraduationId).every((c) => c.studentGraduation!.studentId === c.studentId));
    });
  });

  describe('login real e listas pela API HTTP', () => {
    it('credenciais erradas continuam recusadas', async () => {
      await request(app.getHttpServer())
        .post('/api/auth/login')
        .send({ email: demoEmail('mestre', DOMAIN), password: 'Errada#Errada2026' })
        .expect(401);
    });

    it('MESTRE: students, classes, finance, events, graduations, dashboard e demais listas voltam populadas', async () => {
      const { token, user } = await login(app, 'mestre');
      assert.equal(user.role, 'MESTRE');
      assert.equal(user.organizationSlug, SLUG);
      assert.equal(user.organizationId, orgId);

      const students = await get(app, 'students?limit=100', token);
      assert.equal(students.status, 200);
      assert.equal(students.total, 30);
      assert.equal(students.body.length, 30);
      assert.ok(students.body.every((s: { organizationId: number }) => s.organizationId === orgId));

      const classes = await get(app, 'classes', token);
      assert.equal(classes.total, 6);
      const lessons = await get(app, 'lessons?limit=200', token);
      assert.ok(lessons.total >= 40);
      const units = await get(app, 'units', token);
      assert.equal(units.body.length, 3);
      const teachers = await get(app, 'teachers', token);
      assert.equal(teachers.total, 4);

      const finance = await get(app, 'finance?limit=200', token);
      assert.equal(finance.status, 200);
      assert.ok(finance.total >= 100);
      const summary = await get(app, 'finance/summary', token);
      assert.ok(summary.body.paid > 0 && summary.body.pending > 0 && summary.body.overdue > 0);
      assert.equal(summary.body.count, summary.body.paidCount + summary.body.pendingCount + summary.body.overdueCount);

      const events = await get(app, 'events?limit=100', token);
      assert.ok(events.total >= 6);
      assert.ok(events.body.every((e: { participantsCount: number }) => e.participantsCount > 0));

      const graduations = await get(app, 'graduations', token);
      assert.equal(graduations.status, 200);
      assert.equal(graduations.body.length, 1);
      assert.equal(graduations.body[0].levels.length, 8);

      const announcements = await get(app, 'announcements', token);
      assert.ok(announcements.total >= 5);
      const certificates = await get(app, 'certificates?limit=100', token);
      assert.ok(certificates.total >= 10);

      const dash = await get(app, 'dashboard', token);
      assert.equal(dash.status, 200);
      assert.equal(dash.body.students.active, 26);
      assert.equal(dash.body.students.inactive, 2);
      assert.ok(dash.body.students.new30d >= 3);
      assert.equal(dash.body.classes.active, 6);
      assert.ok(dash.body.finance.pendingCount > 0 && dash.body.finance.overdueCount >= 3);
      assert.ok(dash.body.attendance.last30dPercent > 50 && dash.body.attendance.last30dPercent <= 100);
      assert.ok(dash.body.graduations.last30d >= 2);
      assert.ok(dash.body.upcomingEvents.length >= 3);

      const sub = await get(app, 'subscriptions/me', token);
      assert.equal(sub.body.status, 'ACTIVE');
      assert.equal(sub.body.plan.code, 'PROFISSIONAL');
    });

    it('PROFESSOR: opera a turma (students/classes) mas não vê o financeiro (matriz de permissões)', async () => {
      const { token, user } = await login(app, 'professor1');
      assert.equal(user.role, 'PROFESSOR');
      assert.equal((await get(app, 'students', token)).status, 200);
      assert.equal((await get(app, 'classes', token)).total, 6);
      assert.equal((await get(app, 'finance', token)).status, 403);
    });

    it('ALUNO (aluno1): app do capoeirista — vínculo, turmas, aulas, frequência, financeiro, Passaporte, notificações', async () => {
      const { token, user } = await login(app, 'aluno1');
      assert.equal(user.role, 'ALUNO');
      const me = await get(app, 'students/me', token);
      assert.equal(me.body.length, 1);
      assert.equal(me.body[0].name, 'Rafael Oliveira');
      assert.equal((await get(app, 'finance', token)).status, 403); // lista administrativa é vetada a aluno
      assert.equal((await get(app, 'students', token)).status, 403);

      const classes = await get(app, 'classes/me', token);
      assert.equal(classes.body.length, 2);
      const lessons = await get(app, 'lessons/me?limit=100', token);
      assert.ok(lessons.total >= 10);
      const today = new Date().toISOString().slice(0, 10);
      const upcoming = await get(app, `lessons/me?from=${today}&limit=50`, token);
      assert.ok(upcoming.total >= 2, 'precisa de aulas futuras');

      const att = await get(app, 'attendance/me?limit=100', token);
      assert.ok(att.total > 10, `total de presenças: ${att.total}`);
      assert.ok(att.body.records.length > 10);
      assert.ok(typeof att.body.last30dPercent === 'number');
      const fin = await get(app, 'finance/me?limit=50', token);
      assert.ok(fin.total >= 3);
      const finSum = await get(app, 'finance/me/summary', token);
      assert.ok(finSum.body.paidCount >= 3);

      const passport = await get(app, 'passport/me', token);
      assert.equal(passport.status, 200);
      assert.equal(passport.body.currentGraduation.name, 'Azul');
      assert.ok(passport.body.stats.aulas > 10 && passport.body.stats.graduacoes === 4 && passport.body.stats.certificados >= 1);
      assert.equal(passport.body.publicProfile.isPublished, true);
      const pub = await request(app.getHttpServer()).get(`/api/public/passport/${passport.body.publicProfile.publicCode}`);
      assert.equal(pub.status, 200);
      assert.equal(pub.body.student.name, 'Rafael Oliveira');

      const unread = await get(app, 'notifications/unread-count', token);
      assert.ok(unread.body.count > 0);
      const certs = await get(app, 'certificates/me', token);
      assert.ok(certs.body.length >= 1);
      const verify = await request(app.getHttpServer()).get(`/api/public/certificates/${certs.body[0].verificationCode}`);
      assert.equal(verify.status, 200);
      assert.equal(verify.body.organizationName, 'Grupo Axé Demo');
    });

    it('RESPONSÁVEL (aluno4): 2 dependentes (seletor), dados por dependente e consentimento do menor', async () => {
      const { token, user } = await login(app, 'aluno4');
      assert.equal(user.role, 'RESPONSAVEL');
      const me = await get(app, 'students/me', token);
      assert.deepEqual(me.body.map((s: { name: string }) => s.name).sort(), ['Gabriel Souza', 'Maria Clara Souza']);
      const maria = me.body.find((s: { name: string }) => s.name === 'Maria Clara Souza');
      const gabriel = me.body.find((s: { name: string }) => s.name === 'Gabriel Souza');

      const finAll = await get(app, 'finance/me?limit=100', token);
      const finMaria = await get(app, `finance/me?studentId=${maria.id}&limit=100`, token);
      const finGabriel = await get(app, `finance/me?studentId=${gabriel.id}&limit=100`, token);
      assert.ok(finMaria.total >= 3 && finGabriel.total >= 3);
      assert.equal(finAll.total, finMaria.total + finGabriel.total);

      const pMaria = await get(app, `passport/me?studentId=${maria.id}`, token);
      assert.equal(pMaria.body.viewer.isGuardian, true);
      assert.equal(pMaria.body.viewer.isMinor, true);
      assert.equal(pMaria.body.viewer.hasConsent, true);
      assert.equal(pMaria.body.viewer.canPublish, true);
      assert.equal(pMaria.body.publicProfile.isPublished, true);
      const pubMaria = await request(app.getHttpServer()).get(`/api/public/passport/${pMaria.body.publicProfile.publicCode}`);
      assert.equal(pubMaria.status, 200);

      const pGabriel = await get(app, `passport/me?studentId=${gabriel.id}`, token);
      assert.equal(pGabriel.body.publicProfile.isPublished, false);
      const pubGabriel = await request(app.getHttpServer()).get(`/api/public/passport/${pGabriel.body.publicProfile.publicCode}`);
      assert.equal(pubGabriel.status, 404); // perfil criado, mas não publicado

      const lessonsMaria = await get(app, `lessons/me?studentId=${maria.id}&limit=100`, token);
      assert.ok(lessonsMaria.total >= 8);
      // aluno de OUTRO responsável: mesmo 404 de aluno inexistente (sem vínculo)
      const stranger = await prisma.student.findFirstOrThrow({ where: { organizationId: orgId, name: 'Davi Lucca Ribeiro' } });
      assert.equal((await get(app, `finance/me?studentId=${stranger.id}`, token)).status, 404);
    });
  });
});
