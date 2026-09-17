import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';

/**
 * CRUD de FinancialRecord (finance.service.ts). Diferente dos demais módulos (que fazem
 * soft-delete/inativação), aqui DELETE é HARD delete de verdade — não existe conceito de
 * "registro financeiro inativo" com sentido de negócio (ver comentário no service).
 * ALUNO não pode listar /finance (organização inteira, §10.7) mas pode ver /finance/me.
 */
const DEV_PASSWORD = 'Dev@12345';
const MESTRE_EMAIL = 'mestre@gingabrasil.com.br';
const ALUNO_EMAIL = 'aluno@gingabrasil.com.br';

async function login(app: INestApplication, email: string) {
  const res = await request(app.getHttpServer())
    .post('/api/auth/login')
    .send({ email, password: DEV_PASSWORD })
    .expect(200);
  return res.body as { accessToken: string; user: { id: number; organizationId: number } };
}

function futureIsoDate(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

describe('Finance (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();

  let mestreToken: string;
  let alunoToken: string;
  let organizationId: number;
  let anaStudentId: number;

  let recordId: number; // usado nos testes de update + hard delete
  let record2Id: number; // criado separadamente para sobreviver até o teste de /finance/me

  before(async () => {
    app = await createTestApp();

    const mestreLogin = await login(app, MESTRE_EMAIL);
    mestreToken = mestreLogin.accessToken;
    organizationId = mestreLogin.user.organizationId;

    const alunoLogin = await login(app, ALUNO_EMAIL);
    alunoToken = alunoLogin.accessToken;

    const ana = await prisma.student.findFirstOrThrow({
      where: { organizationId, user: { email: ALUNO_EMAIL } },
    });
    anaStudentId = ana.id;
  });

  after(async () => {
    // recordId já foi hard-deletado pelo próprio teste; record2Id precisa ser limpo aqui.
    // Guarda contra undefined (ex.: se um teste anterior falhar e o último it() não rodar) —
    // um where com id undefined faria o Prisma ignorar o filtro e apagar a tabela inteira.
    if (record2Id) {
      await prisma.financialRecord.deleteMany({ where: { id: record2Id } });
    }
    await prisma.$disconnect();
    await app.close();
  });

  it('POST /finance cria um lançamento vinculado à Ana — 201, e existe de verdade no banco', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/finance')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({
        description: 'Mensalidade — teste e2e',
        amountCents: 15000,
        dueDate: futureIsoDate(10),
        studentId: anaStudentId,
        type: 'MENSALIDADE',
      })
      .expect(201);

    recordId = res.body.id;

    const persisted = await prisma.financialRecord.findUnique({ where: { id: recordId } });
    assert.ok(persisted !== null);
    assert.equal(persisted?.studentId, anaStudentId);
    assert.equal(persisted?.amountCents, 15000);
    assert.equal(persisted?.status, 'PENDING');
  });

  it('PATCH /finance/:id com status=PAID sem paidAt — preenche paidAt automaticamente com a data atual', async () => {
    await request(app.getHttpServer())
      .patch(`/api/finance/${recordId}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({ status: 'PAID' })
      .expect(200);

    const persisted = await prisma.financialRecord.findUniqueOrThrow({ where: { id: recordId } });
    assert.equal(persisted.status, 'PAID');
    assert.ok(persisted.paidAt !== null, 'paidAt deveria ter sido preenchido automaticamente');
    assert.ok(
      Date.now() - persisted.paidAt!.getTime() < 10000,
      'paidAt deveria ser um timestamp recente (preenchido agora pelo service)',
    );
  });

  it('DELETE /finance/:id é HARD delete de verdade — depois, findUnique via Prisma retorna null', async () => {
    await request(app.getHttpServer())
      .delete(`/api/finance/${recordId}`)
      .set('Authorization', `Bearer ${mestreToken}`)
      .expect(200);

    const persisted = await prisma.financialRecord.findUnique({ where: { id: recordId } });
    assert.equal(persisted, null);
  });

  it('ALUNO não pode listar GET /finance (organização inteira, restrição de privacidade §10.7) — 403', async () => {
    await request(app.getHttpServer())
      .get('/api/finance')
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(403);
  });

  it('ALUNO logado em GET /finance/me — 200, e vê o próprio lançamento (escopado por aluno, não pela organização)', async () => {
    // Lançamento próprio para este teste — o da Ana criado acima já foi hard-deletado.
    const created = await request(app.getHttpServer())
      .post('/api/finance')
      .set('Authorization', `Bearer ${mestreToken}`)
      .send({
        description: 'Mensalidade — teste e2e (finance/me)',
        amountCents: 20000,
        dueDate: futureIsoDate(15),
        studentId: anaStudentId,
      })
      .expect(201);
    record2Id = created.body.id;

    const res = await request(app.getHttpServer())
      .get('/api/finance/me')
      .set('Authorization', `Bearer ${alunoToken}`)
      .expect(200);

    const entry = res.body.find((r: { id: number }) => r.id === record2Id);
    assert.ok(entry, 'o lançamento da Ana deveria aparecer em /finance/me para o próprio aluno');
  });
});
