import { INestApplication } from '@nestjs/common';
import { PrismaClient, StudentStatus } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * Eventos + participantes (src/interface/http/events/events.service.ts e
 * events.controller.ts). Foco especial na autorização de `addParticipant`/`removeParticipant`,
 * CORRIGIDA na Fase 10.9 (PLANO_PROJETO.md §10.9): a rota `POST .../participants` usava
 * `@CanAccess('events','create')`, o que bloqueava qualquer ALUNO comum de se autoinscrever
 * (só MESTRE/PROFESSOR têm essa permissão na matriz) — "Quero participar" nunca funcionava.
 * A correção removeu o `@CanAccess` dessas duas rotas e moveu a autorização fina para dentro
 * do `EventsService` (`isOrgAdmin` + `StudentsService.findMine`). Este spec prova que o
 * comportamento corrigido continua de pé: ALUNO consegue se autoinscrever (201, não 403), mas
 * não consegue inscrever/remover outro aluno que não seja "seu".
 *
 * Reaproveita os usuários do seed (mestre/aluno, prisma/seed.ts) e cria só o que é exclusivo
 * deste teste: o Event e um segundo Student sem vínculo com o usuário ALUNO (para provar o
 * caminho de "não é seu").
 */
const DEV_PASSWORD = 'Dev@12345';
const MESTRE_EMAIL = 'mestre@gingabrasil.com.br';
const ALUNO_EMAIL = 'aluno@gingabrasil.com.br';

interface LoginResult {
  accessToken: string;
  user: { id: number; organizationId: number };
}

async function login(app: INestApplication, email: string): Promise<LoginResult> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: DEV_PASSWORD })
    .expect(200);
  return res.body as LoginResult;
}

describe('Eventos e participantes (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let mestreToken: string;
  let alunoToken: string;
  let organizationId: number;
  let alunoUserId: number;

  let eventId: number;
  let anaStudentId: number;
  let anaParticipantId: number;
  let secondStudentId: number;
  let secondParticipantId: number;

  // Título único (com timestamp) para nunca colidir com dados de outras suítes/execuções
  // rodando contra o mesmo Postgres compartilhado, e para permitir limpeza robusta no after().
  const EVENT_TITLE = `[e2e-test] Evento participantes ${Date.now()}`;

  before(async () => {
    app = await createTestApp();

    const mestreLogin = await login(app, MESTRE_EMAIL);
    mestreToken = mestreLogin.accessToken;
    organizationId = mestreLogin.user.organizationId;

    const alunoLogin = await login(app, ALUNO_EMAIL);
    alunoToken = alunoLogin.accessToken;
    alunoUserId = alunoLogin.user.id;

    // Aluno do seed (Ana), vinculado ao usuário ALUNO — usado no caminho de autoinscrição.
    const anaStudent = await prisma.student.findFirstOrThrow({
      where: { organizationId, userId: alunoUserId },
    });
    anaStudentId = anaStudent.id;

    // Segundo aluno, criado direto via Prisma, SEM vínculo com nenhum usuário — usado para
    // provar que ALUNO não pode inscrever/remover quem não é "seu".
    const secondStudent = await prisma.student.create({
      data: {
        organizationId,
        name: '[e2e-test] Aluno sem vínculo de usuário',
        status: StudentStatus.ACTIVE,
      },
    });
    secondStudentId = secondStudent.id;
  });

  after(async () => {
    // Rede de segurança: o fluxo normal do teste já remove o evento (cascata) e a inscrição
    // da Ana, mas isto cobre a hipótese de uma falha no meio do caminho deixar sobras.
    await prisma.eventParticipant.deleteMany({ where: { event: { title: EVENT_TITLE } } });
    await prisma.event.deleteMany({ where: { title: EVENT_TITLE } });
    await prisma.student.deleteMany({ where: { id: secondStudentId } });
    await prisma.$disconnect();
    await app.close();
  });

  it('POST /events (mestre) cria um evento — confirmado via Prisma', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/events')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({
        title: EVENT_TITLE,
        date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        location: 'Ginásio da Matriz',
      })
      .expect(201);

    eventId = res.body.id;
    assert.equal(typeof eventId, 'number');

    const persisted = await prisma.event.findUnique({ where: { id: eventId } });
    assert.ok(persisted !== null);
    assert.equal(persisted?.title, EVENT_TITLE);
    assert.equal(persisted?.organizationId, organizationId);
  });

  it('POST /events/:id/participants como ALUNO com o próprio studentId → 201 (bug da Fase 10.9 continua corrigido, não deve dar 403)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/events/${eventId}/participants`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .send({ studentId: anaStudentId })
      .expect(201);

    anaParticipantId = res.body.id;
    assert.equal(res.body.studentId, anaStudentId);

    const persisted = await prisma.eventParticipant.findUnique({ where: { id: anaParticipantId } });
    assert.ok(persisted !== null);
    assert.equal(persisted?.studentId, anaStudentId);
    assert.equal(persisted?.eventId, eventId);
  });

  it('POST /events/:id/participants como ALUNO tentando inscrever OUTRO aluno (sem vínculo) → 403', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/events/${eventId}/participants`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .send({ studentId: secondStudentId })
      .expect(403);

    assert.equal(res.body.message, 'Você só pode inscrever a si mesmo ou seus dependentes.');

    const persisted = await prisma.eventParticipant.findFirst({
      where: { eventId, studentId: secondStudentId },
    });
    assert.equal(persisted, null);
  });

  it('POST /events/:id/participants como MESTRE inscrevendo o mesmo segundo aluno → 201 (admin pode inscrever qualquer um)', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/events/${eventId}/participants`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ studentId: secondStudentId })
      .expect(201);

    secondParticipantId = res.body.id;

    const persisted = await prisma.eventParticipant.findUnique({ where: { id: secondParticipantId } });
    assert.ok(persisted !== null);
    assert.equal(persisted?.studentId, secondStudentId);
  });

  it('DELETE .../participants/:id como ALUNO tentando remover inscrição que não é dela (a do segundo aluno, feita pelo MESTRE) → 403', async () => {
    const res = await request(app.getHttpServer())
      .delete(`/api/events/${eventId}/participants/${secondParticipantId}`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(403);

    assert.equal(res.body.message, 'Você só pode cancelar a própria inscrição.');

    const stillThere = await prisma.eventParticipant.findUnique({ where: { id: secondParticipantId } });
    assert.ok(stillThere !== null);
  });

  it('DELETE .../participants/:id como ALUNO removendo a PRÓPRIA inscrição → 200, confirmado via Prisma', async () => {
    await request(app.getHttpServer())
      .delete(`/api/events/${eventId}/participants/${anaParticipantId}`)
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);

    const gone = await prisma.eventParticipant.findUnique({ where: { id: anaParticipantId } });
    assert.equal(gone, null);
  });

  it('POST /events/:id/participants com studentId E guestName juntos → 400', async () => {
    const res = await request(app.getHttpServer())
      .post(`/api/events/${eventId}/participants`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ studentId: secondStudentId, guestName: 'Convidado Duplicado' })
      .expect(400);

    assert.equal(res.body.message, 'Informe studentId ou guestName.');
  });

  it('DELETE /events/:id (mestre) é hard delete em cascata: evento E os EventParticipant restantes somem', async () => {
    // Antes de apagar: o participante do segundo aluno (inscrito pelo mestre) ainda existe —
    // é essa a sobra que a cascata precisa levar junto.
    const beforeDelete = await prisma.eventParticipant.findUnique({ where: { id: secondParticipantId } });
    assert.ok(beforeDelete !== null);

    await request(app.getHttpServer())
      .delete(`/api/events/${eventId}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);

    const eventGone = await prisma.event.findUnique({ where: { id: eventId } });
    assert.equal(eventGone, null);

    const participantGone = await prisma.eventParticipant.findUnique({ where: { id: secondParticipantId } });
    assert.equal(participantGone, null);
  });
});
