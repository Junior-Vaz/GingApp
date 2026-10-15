import { INestApplication, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer } from '@nestjs/core';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { DEV_PASSWORD, loginAs } from './utils/list-helpers';

/**
 * Auditoria adversarial de privacidade (LGPD, menor privilégio) para ALUNO e RESPONSAVEL.
 *
 * Achado original: a matriz RolePermission dava view=true a ALUNO/RESPONSAVEL em tudo e os
 * services não filtram — GET /students devolvia TODOS os alunos (documento, telefone, e-mail,
 * nascimento, inclusive de menores), /attendance, /lessons, /classes, /graduations/students/:id
 * de qualquer aluno, nomes de participantes de eventos e rodas (rodas sem nem precisar de
 * token). Correção: matriz (seed + migration 20261009030000), vínculo no service em
 * /graduations/students/:id e anonimização de terceiros nas listas de participantes.
 *
 * Este spec:
 *  1. DESCOBRE todas as rotas GET do AppModule (ModulesContainer + metadata do Nest — uma rota
 *     nova entra na varredura sozinha) e as chama com tokens de ALUNO (Ana), RESPONSAVEL
 *     (Carla, responsável pela Ana) e de um ALUNO de OUTRA organização (Bia), substituindo os
 *     parâmetros por ids "alheios" (aluno sem vínculo "Zeca", aula/evento/certificado/financeiro
 *     dele, ids da outra organização). Nenhuma resposta (de qualquer status) pode conter
 *     marcadores de terceiros (nome, documento, telefone, e-mail, nascimento, responsável) e
 *     só as rotas da ALLOWLIST abaixo podem responder 2xx.
 *  2. Prova que o app do capoeirista continua funcionando (cada endpoint que
 *     app.gingapp.com.br/src/lib/queries.ts chama responde 200 com o próprio/dependente).
 *  3. Prova que MESTRE/PROFESSOR continuam vendo tudo (painel).
 *
 * O rate limit global é desligado SÓ neste app de teste (são centenas de requisições).
 */

/**
 * Rotas GET que ALUNO/RESPONSAVEL podem receber 2xx — cada uma com o motivo. Qualquer rota
 * GET fora daqui tem que responder 401/403/404 (ou 400) para eles. O conteúdo de TODAS (inclusive
 * as daqui) é verificado contra os marcadores de terceiros.
 */
const MEMBER_ALLOWLIST = new Map<string, string>([
  ['/api/health', 'pública, sem dado pessoal'],
  ['/api/auth/capabilities', 'pública: só { passwordResetByEmail: boolean } (e-mail transacional ligado?), sem dado pessoal'],
  ['/api/legal', 'pública: versão vigente dos textos legais (E10), sem dado pessoal'],
  ['/api/legal/terms', 'pública: Termos de Uso (texto estático versionado no repositório)'],
  ['/api/legal/privacy', 'pública: Política de Privacidade (texto estático versionado no repositório)'],
  ['/api/auth/me', 'perfil da PRÓPRIA conta (req.user) + estado do aceite dos termos; sem dado de terceiros'],
  ['/api/auth/me/export', 'exportação LGPD dos dados do PRÓPRIO usuário (próprio aluno e dependentes; só o seu registro de responsável)'],
  ['/api/organizations', 'MEMBER vê só a própria organização (dados institucionais)'],
  ['/api/units', 'unidades do próprio grupo (endereço institucional, sem dado de aluno)'],
  ['/api/units/:id', 'idem /units, escopo organizationId'],
  ['/api/students/me', 'só o próprio Student e dependentes (StudentsService.findMine)'],
  ['/api/people/me/ficha', 'ficha única da PRÓPRIA pessoa (ou do dependente via ?studentId= conferido por resolveLink); CPF só mascarado'],
  ['/api/people/me/transfers', 'pedidos de transferência da PRÓPRIA ficha e dos dependentes (StudentGuardian.userId do token); sem financeiro nem dados de terceiros'],
  ['/api/people/me/occurrences', 'ocorrências registradas sobre a PRÓPRIA ficha e os dependentes (o titular vê o motivo para contestar); nunca de terceiros'],
  ['/api/people/me/code', 'código GingApp + QR da PRÓPRIA ficha (ou do dependente via ?studentId= conferido por resolveLink)'],
  ['/api/classes/me', 'turmas em que o próprio/dependente está matriculado'],
  ['/api/lessons/me', 'aulas das turmas do próprio/dependente'],
  ['/api/attendance/me', 'presenças do próprio/dependente'],
  ['/api/finance/me', 'financeiro do próprio/dependente'],
  ['/api/finance/me/summary', 'resumo financeiro do próprio/dependente (escopo por vínculo, FinanceService)'],
  ['/api/certificates/me', 'certificados do próprio/dependente'],
  ['/api/passport/me', 'passaporte do próprio/dependente'],
  ['/api/graduations/students/:studentId', 'só com vínculo (próprio/dependente); sem vínculo = 404'],
  ['/api/graduations/hierarchy', 'Jornada: hierarquia do PRÓPRIO grupo — só alunos ATIVOS (nome curto/apelido + foto do aluno, como o ranking de grupo), mestres/professores (nome e foto públicos); sem e-mail/telefone/documento/nascimento; ?studentId= conferido por resolveLink (sem vínculo = 404)'],
  ['/api/graduations/templates', 'modelos estáticos de sistema de graduação (cores/estilos de corda), sem dado pessoal nem de grupo'],
  ['/api/events', 'agenda do grupo (sem dado pessoal; agregados participantsCount/myParticipation)'],
  ['/api/events/:id', 'evento do grupo (escopo organizationId)'],
  ['/api/events/:eventId/participants', 'terceiros anonimizados; só a própria inscrição identificada'],
  ['/api/announcements', 'comunicados GERAIS + da(s) unidade(s) do próprio vínculo, sem createdByUserId (AnnouncementsService.memberScope)'],
  ['/api/announcements/:id', 'idem; comunicado fora do vínculo = 404 igual ao inexistente'],
  ['/api/notifications', 'notificações do próprio usuário'],
  ['/api/notifications/unread-count', 'contador do próprio usuário'],
  ['/api/platform-announcements/mine', 'avisos da plataforma para a própria organização'],
  // '/api/subscriptions/me' SAIU da allowlist: plano/preço/ids do gateway = financeiro do grupo,
  // agora exige finance.view (só MESTRE) — ALUNO/RESPONSAVEL/PROFESSOR recebem 403.
  ['/api/calendar', 'pública: rodas + eventos isPublic, sem participantes'],
  ['/api/map/config', 'mapa da comunidade: só { enabled, apiKey de navegador (pública), mapId, geocodingEnabled }'],
  ['/api/map/places', 'mapa da comunidade: unidades/treinos/eventos públicos/rodas de grupos visíveis; sem pessoas (nenhum aluno, professor, e-mail ou telefone)'],
  ['/api/push/config', 'config pública do Web Push: só { enabled, publicKey VAPID (pública) }'],
  ['/api/push/preferences', 'preferências de aviso do PRÓPRIO usuário (escopo do token)'],
  ['/api/ranking/students', 'Ginga Rank: GROUP = só alunos ATIVOS do próprio grupo (nome curto/apelido + avatar); CITY/STATE/COUNTRY só opt-in (menor só com consentimento do responsável)'],
  ['/api/ranking/groups', 'Ginga Rank: agregado por grupo (média de pontos), sem dado de pessoa'],
  ['/api/ranking/me', 'Ginga Rank: progresso do PRÓPRIO aluno/dependente (vínculo conferido por resolveLink)'],
  ['/api/ranking/seasons', 'Ginga Rank: campeões de temporadas fechadas (Brasil só com opt-in vigente; e do próprio grupo)'],
  ['/api/ranking/hall-of-fame', 'Ginga Rank: alias de /ranking/students com season=ALL (mesmas regras de privacidade)'],
  // '/api/ranking/group-overview' NÃO entra: é da equipe (students.view) — ALUNO/RESPONSAVEL recebem 403.
  ['/api/rodas', 'pública (comunidade): sem participantes; agregados de contagem'],
  ['/api/rodas/:id', 'pública (comunidade)'],
  ['/api/rodas/reference/states', 'dado de referência público'],
  ['/api/rodas/reference/cities', 'dado de referência público'],
  ['/api/rodas/:id/participants', 'pública, mas terceiros anonimizados para quem não organiza'],
  ['/api/public/certificates/:code', 'pública por código secreto (quem tem o código pode verificar)'],
  ['/api/public/passport/:code', 'pública por código de passaporte PUBLICADO'],
]);

function toArray(value: unknown): string[] {
  if (value === undefined || value === null) return [''];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

/** Conta `@Get(` nos controllers de src/ (ignorando linhas de comentário). */
function countGetDecoratorsInSource(): number {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? walk(join(dir, entry.name)) : entry.name.endsWith('.controller.ts') ? [join(dir, entry.name)] : [],
    );
  return walk(join(__dirname, '..', 'src'))
    .flatMap((file) => readFileSync(file, 'utf8').split('\n'))
    .filter((line) => /^\s*@Get\(/.test(line)).length;
}

/** Todas as rotas GET registradas no AppModule, com o prefixo global /api. */
function discoverGetRoutes(app: INestApplication): string[] {
  const routes = new Set<string>();
  for (const moduleRef of app.get(ModulesContainer).values()) {
    for (const wrapper of moduleRef.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: unknown[]) => unknown) | null;
      if (!controller) continue;
      const basePaths = toArray(Reflect.getMetadata(PATH_METADATA, controller));
      const proto = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) !== RequestMethod.GET) continue;
        for (const base of basePaths) {
          for (const sub of toArray(Reflect.getMetadata(PATH_METADATA, handler))) {
            const path = `/api/${base}/${sub}`.replace(/\/+/g, '/').replace(/\/$/, '');
            routes.add(path);
          }
        }
      }
    }
  }
  return [...routes].sort();
}

describe('Privacidade de ALUNO/RESPONSAVEL — varredura de rotas GET + fluxo do app (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const tag = `${Date.now()}`;

  // Marcadores únicos de terceiros (nunca podem aparecer para quem não tem vínculo).
  const ZECA = {
    name: `Zeca Sentinela ${tag}`,
    document: `DOC-ZECA-${tag}`,
    phone: `+55 61 9${tag.slice(-8)}`,
    email: `zeca-${tag}@sentinela.local`,
    birthDate: '1903-03-03',
    guardianName: `Guardiao Zeca ${tag}`,
    guardianPhone: `+55 61 8${tag.slice(-8)}`,
    userName: `Zeca Usuario ${tag}`,
    justification: `Justificativa sigilosa Zeca ${tag}`,
    financeDescription: `Mensalidade sigilosa Zeca ${tag}`,
    certificateTitle: `Certificado sigiloso Zeca ${tag}`,
    graduationNotes: `Nota sigilosa Zeca ${tag}`,
    // Comunicado de OUTRA unidade do mesmo grupo (ninguém de Ana/Carla pertence a ela).
    announcementOtherUnit: `Aviso sigiloso de outra unidade ${tag}`,
  };
  const BIA = { name: `Bia Outra Org ${tag}`, document: `DOC-BIA-${tag}`, email: `bia-${tag}@outra-org.local` };
  const ANA_NAME = 'Ana Capoeirista'; // seed (ALUNO da org piloto, menor de idade)
  const ANA_BIRTH = '2014-03-20';

  let orgAId: number;
  let alunoToken: string;
  let alunoUserId: number;
  let responsavelToken: string;
  let mestreToken: string;
  let professorToken: string;
  let biaToken: string;
  let anaStudentId: number;

  let zecaStudentId: number;
  let zecaUserId: number;
  let zecaLessonId: number;
  let zecaCertificateId: number;
  let zecaFinanceId: number;
  let eventId: number;
  let event2Id: number;
  let rodaId: number;
  let orgBId: number;
  let biaUserId: number;
  let biaStudentId: number;
  let eventBId: number;
  let zecaEventParticipantId: number;
  let otherUnitId: number;
  let generalAnnouncementId: number;
  let otherUnitAnnouncementId: number;

  before(async () => {
    app = await createTestApp({ disableThrottle: true });

    const mestre = await loginAs(app, 'mestre@gingabrasil.com.br');
    mestreToken = mestre.token;
    orgAId = mestre.organizationId;
    const professor = await loginAs(app, 'professor@gingabrasil.com.br');
    professorToken = professor.token;
    const aluno = await loginAs(app, 'aluno@gingabrasil.com.br');
    alunoToken = aluno.token;
    alunoUserId = aluno.userId;
    responsavelToken = (await loginAs(app, 'responsavel@gingabrasil.com.br')).token;
    anaStudentId = (await prisma.student.findFirstOrThrow({ where: { organizationId: orgAId, userId: alunoUserId } })).id;

    // --- Org A: "Zeca", aluno SEM vínculo com Ana/Carla, na MESMA turma da Ana ---
    const passwordHash = await bcrypt.hash(DEV_PASSWORD, 4);
    const zecaUser = await prisma.user.create({
      data: { email: `zeca-user-${tag}@sentinela.local`, passwordHash, name: ZECA.userName, userType: 'MEMBER', status: 'ACTIVE' },
    });
    zecaUserId = zecaUser.id;
    const zeca = await prisma.student.create({
      data: {
        organizationId: orgAId,
        name: ZECA.name,
        document: ZECA.document,
        phone: ZECA.phone,
        email: ZECA.email,
        birthDate: new Date(`${ZECA.birthDate}T00:00:00.000Z`),
        status: 'ACTIVE',
      },
    });
    zecaStudentId = zeca.id;
    await prisma.studentGuardian.create({
      data: { organizationId: orgAId, studentId: zeca.id, name: ZECA.guardianName, phone: ZECA.guardianPhone },
    });
    const anaClass = await prisma.classStudent.findFirstOrThrow({ where: { organizationId: orgAId, studentId: anaStudentId } });
    await prisma.classStudent.create({ data: { organizationId: orgAId, classId: anaClass.classId, studentId: zeca.id } });
    const lesson = await prisma.lesson.create({
      data: { organizationId: orgAId, classId: anaClass.classId, date: new Date(), notes: `[e2e-privacy] ${tag}`, teacherUserId: professor.userId }, // atribuida ao professor: ele so le a chamada das aulas dele
    });
    zecaLessonId = lesson.id;
    await prisma.attendance.create({
      data: { organizationId: orgAId, lessonId: lesson.id, studentId: zeca.id, present: false, justification: ZECA.justification },
    });
    const level = await prisma.graduationLevel.findFirstOrThrow({ where: { organizationId: orgAId } });
    await prisma.studentGraduation.create({
      data: { organizationId: orgAId, studentId: zeca.id, graduationLevelId: level.id, graduatedAt: new Date(), notes: ZECA.graduationNotes },
    });
    zecaCertificateId = (
      await prisma.certificate.create({ data: { organizationId: orgAId, studentId: zeca.id, title: ZECA.certificateTitle } })
    ).id;
    zecaFinanceId = (
      await prisma.financialRecord.create({
        data: { organizationId: orgAId, studentId: zeca.id, description: ZECA.financeDescription, amountCents: 1234, dueDate: new Date() },
      })
    ).id;

    // Eventos da org A: Zeca inscrito no 1º (Ana se inscreve pelo app no teste); 2º sem ninguém.
    const future = new Date(Date.now() + 10 * 86_400_000);
    eventId = (await prisma.event.create({ data: { organizationId: orgAId, title: `[e2e-privacy] Evento ${tag}`, date: future } })).id;
    event2Id = (await prisma.event.create({ data: { organizationId: orgAId, title: `[e2e-privacy] Evento 2 ${tag}`, date: future } })).id;
    zecaEventParticipantId = (
      await prisma.eventParticipant.create({ data: { organizationId: orgAId, eventId, studentId: zeca.id } })
    ).id;

    // Roda organizada pela org A, com Zeca (usuário) confirmado.
    rodaId = (await prisma.roda.create({ data: { organizationId: orgAId, title: `[e2e-privacy] Roda ${tag}`, date: future } })).id;
    await prisma.rodaParticipant.create({ data: { rodaId, userId: zecaUserId } });

    // Comunicados da org A: um GERAL (todos veem; garante lista não vazia p/ as asserções sobre
    // campos) e um de OUTRA unidade (nenhum dos vínculos de Ana/Carla pertence a ela).
    otherUnitId = (await prisma.unit.create({ data: { organizationId: orgAId, name: `[e2e-privacy] Unidade ${tag}` } })).id;
    generalAnnouncementId = (
      await prisma.announcement.create({
        data: { organizationId: orgAId, createdByUserId: mestre.userId, title: `[e2e-privacy] Aviso geral ${tag}`, body: 'corpo geral' },
      })
    ).id;
    otherUnitAnnouncementId = (
      await prisma.announcement.create({
        data: { organizationId: orgAId, unitId: otherUnitId, createdByUserId: mestre.userId, title: ZECA.announcementOtherUnit, body: 'corpo sigiloso' },
      })
    ).id;

    // --- Org B: "Bia", ALUNO de OUTRA organização ---
    const orgB = await prisma.organization.create({
      data: { name: `E2E privacy Org B ${tag}`, slug: `e2e-privacy-org-b-${tag}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE },
    });
    orgBId = orgB.id;
    const biaEmail = `bia-user-${tag}@outra-org.local`;
    const biaUser = await prisma.user.create({
      data: { email: biaEmail, passwordHash, name: BIA.name, userType: 'MEMBER', status: 'ACTIVE' },
    });
    biaUserId = biaUser.id;
    await prisma.organizationUser.create({ data: { organizationId: orgB.id, userId: biaUser.id, role: OrgRole.ALUNO, status: 'ACTIVE' } });
    biaStudentId = (
      await prisma.student.create({
        data: { organizationId: orgB.id, userId: biaUser.id, name: BIA.name, document: BIA.document, email: BIA.email, status: 'ACTIVE' },
      })
    ).id;
    eventBId = (await prisma.event.create({ data: { organizationId: orgB.id, title: `[e2e-privacy] Evento B ${tag}`, date: future } })).id;
    await prisma.eventParticipant.create({ data: { organizationId: orgB.id, eventId: eventBId, studentId: biaStudentId } });
    await prisma.rodaParticipant.create({ data: { rodaId, userId: biaUser.id } }); // Bia confirmada na roda da org A
    biaToken = (await loginAs(app, biaEmail)).token;
  });

  after(async () => {
    await prisma.announcement.deleteMany({ where: { id: { in: [generalAnnouncementId, otherUnitAnnouncementId].filter((id) => id !== undefined) } } });
    if (otherUnitId) await prisma.unit.delete({ where: { id: otherUnitId } });
    const eventIds = [eventId, event2Id, eventBId].filter((id) => id !== undefined);
    await prisma.eventParticipant.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    if (rodaId) {
      await prisma.rodaParticipant.deleteMany({ where: { rodaId } });
      await prisma.roda.delete({ where: { id: rodaId } });
    }
    if (zecaStudentId) {
      await prisma.attendance.deleteMany({ where: { studentId: zecaStudentId } });
      if (zecaLessonId) await prisma.lesson.delete({ where: { id: zecaLessonId } });
      await prisma.classStudent.deleteMany({ where: { studentId: zecaStudentId } });
      await prisma.certificate.deleteMany({ where: { studentId: zecaStudentId } });
      await prisma.studentGraduation.deleteMany({ where: { studentId: zecaStudentId } });
      await prisma.financialRecord.deleteMany({ where: { studentId: zecaStudentId } });
      await prisma.studentGuardian.deleteMany({ where: { studentId: zecaStudentId } });
      await prisma.student.delete({ where: { id: zecaStudentId } });
    }
    if (zecaUserId) await prisma.user.delete({ where: { id: zecaUserId } });
    if (orgBId) {
      await prisma.student.deleteMany({ where: { organizationId: orgBId } });
      await prisma.organizationUser.deleteMany({ where: { organizationId: orgBId } });
      await prisma.notification.deleteMany({ where: { userId: biaUserId } });
      await prisma.user.delete({ where: { id: biaUserId } });
      await prisma.organization.delete({ where: { id: orgBId } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  const get = (url: string, token?: string) => {
    const req = request(app.getHttpServer()).get(url);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  // ---------------------------------------------------------------------------------------
  // 0. Matriz
  // ---------------------------------------------------------------------------------------
  it('matriz: ALUNO/RESPONSAVEL sem nenhum recurso administrativo; events/announcements só view; MESTRE/PROFESSOR intactos', async () => {
    const rows = await prisma.rolePermission.findMany();
    const perm = (role: OrgRole, resource: string) => {
      const row = rows.find((r) => r.role === role && r.resource === resource);
      assert.ok(row, `linha ausente ${role}/${resource}`);
      return [row.canView, row.canCreate, row.canEdit, row.canDelete].join(',');
    };
    for (const role of [OrgRole.ALUNO, OrgRole.RESPONSAVEL]) {
      for (const resource of ['students', 'classes', 'lessons', 'attendance', 'graduations', 'finance', 'teachers', 'dashboard', 'certificates']) {
        assert.equal(perm(role, resource), 'false,false,false,false', `${role}/${resource}`);
      }
      for (const resource of ['events', 'announcements', 'rodas']) {
        assert.equal(perm(role, resource), 'true,false,false,false', `${role}/${resource}`);
      }
    }
    assert.equal(perm(OrgRole.MESTRE, 'students'), 'true,true,true,true');
    assert.equal(perm(OrgRole.MESTRE, 'finance'), 'true,true,true,true');
    assert.equal(perm(OrgRole.PROFESSOR, 'students'), 'true,true,true,false');
    assert.equal(perm(OrgRole.PROFESSOR, 'graduations'), 'true,true,true,false');
    assert.equal(perm(OrgRole.PROFESSOR, 'finance'), 'false,false,false,false');
  });

  // ---------------------------------------------------------------------------------------
  // 1. Varredura adversarial de TODAS as rotas GET
  // ---------------------------------------------------------------------------------------
  it('varredura: nenhuma rota GET devolve dado de aluno sem vínculo nem campos pessoais de terceiros', async () => {
    const routes = discoverGetRoutes(app);
    // Sanidade da descoberta por uma 2ª via independente (sem isto o teste poderia passar
    // "vazio"): o número de rotas descobertas em runtime = o de decorators @Get( no código-fonte.
    assert.equal(routes.length, countGetDecoratorsInSource(), `rotas descobertas: ${routes.join(', ')}`);
    for (const known of ['/api/students', '/api/students/:id', '/api/attendance/lessons/:lessonId', '/api/rodas/:id/participants']) {
      assert.ok(routes.includes(known), `rota ${known} não descoberta`);
    }

    const zecaMarkers = Object.values(ZECA);
    const callers = [
      { who: 'ALUNO(Ana)', token: alunoToken, forbidden: [...zecaMarkers, BIA.name, BIA.document, BIA.email] },
      { who: 'RESPONSAVEL(Carla)', token: responsavelToken, forbidden: [...zecaMarkers, BIA.name, BIA.document, BIA.email] },
      { who: 'ALUNO-outra-org(Bia)', token: biaToken, forbidden: [...zecaMarkers, ANA_NAME, ANA_BIRTH, 'Carla Responsável'] },
    ];
    const foreignIds = [
      zecaStudentId, zecaLessonId, zecaCertificateId, zecaFinanceId, eventId, rodaId, zecaEventParticipantId,
      orgAId, orgBId, eventBId, biaStudentId, otherUnitAnnouncementId,
    ].map(String);
    const urlsFor = (route: string): string[] => {
      if (!route.includes(':')) return [route, `${route}?q=${encodeURIComponent('Zeca Sentinela')}`, `${route}?q=${encodeURIComponent('Bia Outra')}`];
      if (route.includes(':code')) return [route.replace(':code', `nao-existe-${tag}`)];
      if (route.includes(':key')) return [route.replace(':key', 'nao-existe')];
      return foreignIds.map((id) => route.replace(/:\w+/g, id));
    };

    const failures: string[] = [];
    let requests = 0;
    for (const caller of callers) {
      for (const route of routes) {
        for (const url of urlsFor(route)) {
          const res = await get(url, caller.token);
          requests++;
          const text = res.text ?? '';
          for (const marker of caller.forbidden) {
            if (text.includes(marker)) failures.push(`${caller.who} GET ${url} -> ${res.status} VAZOU "${marker}"`);
          }
          if (res.status >= 500) failures.push(`${caller.who} GET ${url} -> ${res.status} (erro de servidor)`);
          if (res.status >= 200 && res.status < 300 && !MEMBER_ALLOWLIST.has(route)) {
            failures.push(`${caller.who} GET ${url} -> ${res.status} (rota fora da allowlist respondeu 2xx)`);
          }
        }
      }
    }
    assert.ok(requests > 500, `poucas requisições na varredura: ${requests}`);
    assert.deepEqual(failures, [], `\n${failures.join('\n')}`);
  });

  it('anônimo: lista pública de participantes de roda e GET /rodas não expõem nomes/ids pessoais', async () => {
    const anonymous = await get(`/api/rodas/${rodaId}/participants`).expect(200);
    assert.equal(anonymous.body.length, 2);
    for (const p of anonymous.body) {
      assert.equal(p.userId, null);
      assert.equal(p.user, null);
      assert.equal(p.student, null);
    }
    assert.ok(!anonymous.text.includes(ZECA.userName) && !anonymous.text.includes(BIA.name));

    // Token inválido em rota pública não vira 401: segue anônimo.
    await get(`/api/rodas/${rodaId}/participants`, 'token-invalido').expect(200);

    const list = await get(`/api/rodas?q=${encodeURIComponent(`[e2e-privacy] Roda ${tag}`)}`).expect(200);
    const roda = list.body.find((r: { id: number }) => r.id === rodaId);
    assert.equal(roda.participantsCount, 2);
    assert.equal(roda.myParticipation, null);
  });

  // ---------------------------------------------------------------------------------------
  // 2. O app do capoeirista continua funcionando (endpoints de app.gingapp.com.br/src/lib/queries.ts)
  // ---------------------------------------------------------------------------------------
  for (const who of ['ALUNO', 'RESPONSAVEL'] as const) {
    it(`app (${who}): todos os endpoints do app respondem 200 com o próprio/dependente; Zeca nunca aparece`, async () => {
      const token = who === 'ALUNO' ? alunoToken : responsavelToken;

      const mine = await get('/api/students/me', token).expect(200);
      assert.deepEqual(mine.body.map((s: { id: number }) => s.id), [anaStudentId]);

      const grads = await get(`/api/graduations/students/${anaStudentId}`, token).expect(200);
      assert.ok(Array.isArray(grads.body) && grads.body.length >= 1, 'graduações da Ana');
      assert.ok(grads.body.every((g: { studentId: number }) => g.studentId === anaStudentId));

      for (const path of [
        '/api/attendance/me', '/api/lessons/me', '/api/classes/me', '/api/finance/me', '/api/certificates/me',
        '/api/passport/me', '/api/notifications', '/api/announcements', '/api/calendar', '/api/rodas',
        '/api/rodas/reference/states', '/api/events', '/api/graduations/hierarchy', '/api/graduations/templates',
      ]) {
        const res = await get(path, token);
        assert.equal(res.status, 200, `${who} ${path} -> ${res.status} ${res.text}`);
        for (const marker of Object.values(ZECA)) assert.ok(!res.text.includes(marker), `${who} ${path} vazou ${marker}`);
      }

      // Comunicados: nunca expõem o id interno do autor a quem não publica.
      const announcements = await get('/api/announcements?limit=200', token).expect(200);
      assert.ok(announcements.body.some((a: { id: number }) => a.id === generalAnnouncementId), 'comunicado geral deve aparecer');
      assert.ok(announcements.body.every((a: { id: number }) => a.id !== otherUnitAnnouncementId), 'comunicado de outra unidade vazou');
      assert.ok(announcements.body.every((a: object) => !('createdByUserId' in a)), `${who} recebeu createdByUserId`);

      // Rotas administrativas: fechadas.
      for (const path of ['/api/subscriptions/me', '/api/students', `/api/students/${zecaStudentId}`, `/api/students/${anaStudentId}`, '/api/attendance',
        `/api/attendance/lessons/${zecaLessonId}`, '/api/lessons', '/api/classes', '/api/graduations', '/api/graduations/systems']) {
        await get(path, token).expect(403);
      }
    });
  }

  it('graduações: aluno sem vínculo dá o MESMO 404 de aluno inexistente (não vaza existência)', async () => {
    for (const token of [alunoToken, responsavelToken, biaToken]) {
      const zeca = await get(`/api/graduations/students/${zecaStudentId}`, token).expect(404);
      const ghost = await get('/api/graduations/students/2147483000', token).expect(404);
      assert.deepEqual(zeca.body, ghost.body);
    }
    // Staff continua vendo qualquer aluno da organização.
    for (const token of [mestreToken, professorToken]) {
      const res = await get(`/api/graduations/students/${zecaStudentId}`, token).expect(200);
      assert.ok(res.text.includes(ZECA.graduationNotes));
    }
  });

  it('eventos (ALUNO): inscrição própria + agregados no GET /events; lista de participantes anonimiza terceiros', async () => {
    const joined = await request(app.getHttpServer())
      .post(`/api/events/${eventId}/participants`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .send({ studentId: anaStudentId })
      .expect(201);

    const list = await get('/api/events?limit=200', alunoToken).expect(200);
    const ev = list.body.find((e: { id: number }) => e.id === eventId);
    const ev2 = list.body.find((e: { id: number }) => e.id === event2Id);
    assert.equal(ev.participantsCount, 2);
    assert.deepEqual(ev.myParticipation, { id: joined.body.id, studentId: anaStudentId, status: 'CONFIRMED' });
    assert.equal(ev2.participantsCount, 0);
    assert.equal(ev2.myParticipation, null);
    // Campos existentes preservados (contrato do painel/admin).
    for (const field of ['id', 'organizationId', 'title', 'type', 'date', 'isPublic', 'imageUrl', 'createdAt']) {
      assert.ok(field in ev, `campo ${field} sumiu de GET /events`);
    }

    // RESPONSAVEL vê a inscrição do dependente como "sua".
    const forGuardian = await get('/api/events?limit=200', responsavelToken).expect(200);
    assert.deepEqual(forGuardian.body.find((e: { id: number }) => e.id === eventId).myParticipation, {
      id: joined.body.id, studentId: anaStudentId, status: 'CONFIRMED',
    });

    for (const token of [alunoToken, responsavelToken]) {
      const participants = await get(`/api/events/${eventId}/participants`, token).expect(200);
      assert.equal(participants.body.length, 2);
      const own = participants.body.find((p: { id: number }) => p.id === joined.body.id);
      assert.equal(own.studentId, anaStudentId);
      assert.equal(own.student.name, ANA_NAME);
      const other = participants.body.find((p: { id: number }) => p.id === zecaEventParticipantId);
      assert.equal(other.studentId, null);
      assert.equal(other.student, null);
      assert.equal(other.guestName, null);
      assert.ok(!participants.text.includes(ZECA.name));
    }

    // Painel (MESTRE/PROFESSOR): lista completa, identificada.
    for (const token of [mestreToken, professorToken]) {
      const full = await get(`/api/events/${eventId}/participants`, token).expect(200);
      assert.ok(full.text.includes(ZECA.name) && full.text.includes(ANA_NAME));
    }

    // Cancelar a própria inscrição continua funcionando; a de terceiro, não.
    await request(app.getHttpServer())
      .delete(`/api/events/${eventId}/participants/${zecaEventParticipantId}`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/events/${eventId}/participants/${joined.body.id}`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);
    const afterLeave = await get('/api/events?limit=200', alunoToken).expect(200);
    const evAfter = afterLeave.body.find((e: { id: number }) => e.id === eventId);
    assert.equal(evAfter.participantsCount, 1);
    assert.equal(evAfter.myParticipation, null);
  });

  it('rodas (ALUNO): participação própria + agregados no GET /rodas; organizador vê nomes, demais não', async () => {
    const joined = await request(app.getHttpServer())
      .post(`/api/rodas/${rodaId}/participants`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(201);

    const list = await get(`/api/rodas?q=${encodeURIComponent(`[e2e-privacy] Roda ${tag}`)}`, alunoToken).expect(200);
    const roda = list.body.find((r: { id: number }) => r.id === rodaId);
    assert.equal(roda.participantsCount, 3);
    assert.deepEqual(roda.myParticipation, { id: joined.body.id, studentId: null, status: 'CONFIRMED' });

    const forAluno = await get(`/api/rodas/${rodaId}/participants`, alunoToken).expect(200);
    assert.equal(forAluno.body.length, 3);
    const own = forAluno.body.find((p: { id: number }) => p.id === joined.body.id);
    assert.equal(own.userId, alunoUserId);
    assert.equal(own.user.name, ANA_NAME);
    assert.ok(!forAluno.text.includes(ZECA.userName) && !forAluno.text.includes(BIA.name));

    // Bia (outra organização) também não vê nomes da roda da org A — só a própria participação.
    const forBia = await get(`/api/rodas/${rodaId}/participants`, biaToken).expect(200);
    assert.ok(forBia.text.includes(BIA.name));
    assert.ok(!forBia.text.includes(ZECA.userName) && !forBia.text.includes(ANA_NAME));

    // Organizador (MESTRE/PROFESSOR da org A): nomes de todos (painel rodas-participants-dialog).
    for (const token of [mestreToken, professorToken]) {
      const full = await get(`/api/rodas/${rodaId}/participants`, token).expect(200);
      assert.ok(full.text.includes(ZECA.userName) && full.text.includes(BIA.name) && full.text.includes(ANA_NAME));
    }

    await request(app.getHttpServer())
      .delete(`/api/rodas/${rodaId}/participants/${joined.body.id}`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);
    const afterLeave = await get(`/api/rodas?q=${encodeURIComponent(`[e2e-privacy] Roda ${tag}`)}`, alunoToken).expect(200);
    const rodaAfter = afterLeave.body.find((r: { id: number }) => r.id === rodaId);
    assert.equal(rodaAfter.participantsCount, 2);
    assert.equal(rodaAfter.myParticipation, null);
  });

  // ---------------------------------------------------------------------------------------
  // 3. Painel (MESTRE/PROFESSOR) intacto
  // ---------------------------------------------------------------------------------------
  it('painel: MESTRE e PROFESSOR continuam lendo alunos, aulas, presenças e turmas do grupo', async () => {
    for (const token of [mestreToken, professorToken]) {
      const students = await get(`/api/students?q=${encodeURIComponent(ZECA.name)}`, token).expect(200);
      // Ficha unica, Fase 2: o documento legado sai MASCARADO tambem para a equipe ('***' + 2 ultimos caracteres).
      assert.ok(students.text.includes(ZECA.name));
      assert.ok(students.text.includes(`"document":"***${ZECA.document.slice(-2)}"`));
      assert.ok(!students.text.includes(ZECA.document));
      await get(`/api/students/${zecaStudentId}`, token).expect(200);
      const roster = await get(`/api/attendance/lessons/${zecaLessonId}`, token).expect(200);
      assert.ok(roster.text.includes(ZECA.name));
      await get('/api/lessons', token).expect(200);
      await get('/api/classes', token).expect(200);
      await get('/api/attendance', token).expect(200);
      await get('/api/graduations', token).expect(200);
    }
  });
});
