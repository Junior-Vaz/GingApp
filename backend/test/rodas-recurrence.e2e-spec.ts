import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { MESTRE_EMAIL, SecondOrg, createSecondOrg, loginAs } from './utils/list-helpers';

/**
 * Rodas recorrentes ("roda mensal"): POST /rodas/:id/generate-occurrences cria as próximas ocorrências como rodas
 * filhas, de forma idempotente. Rodas criadas direto no banco (a criação pela API faria broadcast de "Nova roda").
 */
describe('Rodas: recorrência e geração de ocorrências (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestre: { token: string; organizationId: number };
  let orgB: SecondOrg;
  const parentIds: number[] = [];
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });

  before(async () => {
    app = await createTestApp();
    mestre = await loginAs(app, MESTRE_EMAIL);
    orgB = await createSecondOrg(app, prisma, 'rrec');
  });

  after(async () => {
    await prisma.auditLog.deleteMany({ where: { action: 'RODA_GENERATE_OCCURRENCES', resourceId: { in: parentIds.map(String) } } });
    await prisma.roda.deleteMany({ where: { parentRodaId: { in: parentIds } } });
    await prisma.roda.deleteMany({ where: { id: { in: parentIds } } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  const makeRoda = async (data: Record<string, unknown>) => {
    const r = await prisma.roda.create({
      data: { organizationId: mestre.organizationId, title: `[e2e-rrec] ${Date.now()}`, date: new Date(Date.now() + 86_400_000), ...data },
    });
    parentIds.push(r.id);
    return r;
  };

  it('feliz: gera 3 ocorrências mensais ("toda Nª dia da semana"), repetir não duplica e aumentar o count completa', async () => {
    const base = await makeRoda({ recurrence: 'MONTHLY_WEEKDAY' });
    const first = await request(app.getHttpServer())
      .post(`/api/rodas/${base.id}/generate-occurrences`)
      .set(auth(mestre.token))
      .send({})
      .expect(200);
    assert.equal(first.body.created, 3);
    assert.equal(first.body.occurrences.length, 3);
    assert.match(first.body.rule, /^toda \dª .+ do mês$/);
    const dates = first.body.occurrences.map((o: { date: string }) => new Date(o.date).getTime());
    assert.deepEqual([...dates].sort((a, b) => a - b), dates, 'em ordem cronológica');
    assert.ok(first.body.occurrences.every((o: { parentRodaId: number }) => o.parentRodaId === base.id));

    const second = await request(app.getHttpServer()).post(`/api/rodas/${base.id}/generate-occurrences`).set(auth(mestre.token)).send({}).expect(200);
    assert.equal(second.body.created, 0);
    assert.equal(await prisma.roda.count({ where: { parentRodaId: base.id } }), 3);

    const more = await request(app.getHttpServer())
      .post(`/api/rodas/${base.id}/generate-occurrences`)
      .set(auth(mestre.token))
      .send({ count: 5 })
      .expect(200);
    assert.equal(more.body.created, 2);
    assert.equal(await prisma.roda.count({ where: { parentRodaId: base.id } }), 5);

    // apagar a série leva as filhas junto
    const del = await request(app.getHttpServer()).delete(`/api/rodas/${base.id}?series=true`).set(auth(mestre.token)).expect(200);
    assert.equal(del.body.removed, 6);
    assert.equal(await prisma.roda.count({ where: { parentRodaId: base.id } }), 0);
  });

  it('erros: roda sem recorrência 400; ocorrência gerada 400; roda de outro grupo 404; count fora do limite 400', async () => {
    const plain = await makeRoda({});
    await request(app.getHttpServer()).post(`/api/rodas/${plain.id}/generate-occurrences`).set(auth(mestre.token)).send({}).expect(400);

    const base = await makeRoda({ recurrence: 'WEEKLY', recurrenceUntil: new Date(Date.now() + 10 * 86_400_000) });
    const gen = await request(app.getHttpServer()).post(`/api/rodas/${base.id}/generate-occurrences`).set(auth(mestre.token)).send({ count: 12 }).expect(200);
    assert.ok(gen.body.created >= 1 && gen.body.created <= 2, `"until" limita a série (criadas: ${gen.body.created})`);
    const child = gen.body.occurrences[0];
    await request(app.getHttpServer()).post(`/api/rodas/${child.id}/generate-occurrences`).set(auth(mestre.token)).send({}).expect(400);

    await request(app.getHttpServer()).post(`/api/rodas/${base.id}/generate-occurrences`).set(auth(orgB.token)).send({}).expect(404);
    await request(app.getHttpServer()).post(`/api/rodas/${base.id}/generate-occurrences`).set(auth(mestre.token)).send({ count: 50 }).expect(400);
  });
});
