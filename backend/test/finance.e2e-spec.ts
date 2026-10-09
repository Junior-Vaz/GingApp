import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createTestApp } from './utils/test-app';
import { ALUNO_EMAIL as ALUNO, MESTRE_EMAIL as MESTRE, SecondOrg, createSecondOrg, loginAs, todaySaoPaulo } from './utils/list-helpers';

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

/**
 * Paginação + filtros no servidor, limpar campos no PATCH e GET /finance/summary.
 * Todos os registros desta suíte levam TAG na descrição (filtrável por `q`) e são apagados no fim.
 */
describe('Finance — lista paginada, limpar campos e resumo (e2e)', () => {
  const TAG = `B2FIN${Date.now()}`;
  let app: INestApplication;
  const prisma = new PrismaClient();
  let mestre: Awaited<ReturnType<typeof loginAs>>;
  let aluno: Awaited<ReturnType<typeof loginAs>>;
  let professor: Awaited<ReturnType<typeof loginAs>>;
  let orgB: SecondOrg;
  let anaId: number;
  const get = (path: string, token = mestre.token) =>
    request(app.getHttpServer()).get(`/api${path}`).set('Authorization', `Bearer ${token}`);
  const patch = (id: number, body: object) =>
    request(app.getHttpServer()).patch(`/api/finance/${id}`).set('Authorization', `Bearer ${mestre.token}`).send(body);

  before(async () => {
    app = await createTestApp();
    mestre = await loginAs(app, MESTRE);
    aluno = await loginAs(app, ALUNO);
    professor = await loginAs(app, 'professor@gingabrasil.com.br');
    orgB = await createSecondOrg(app, prisma, 'fin');
    anaId = (await prisma.student.findFirstOrThrow({ where: { organizationId: mestre.organizationId, user: { email: ALUNO } } })).id;

    // 55 lançamentos na org A: status cicla PENDING/PAID/OVERDUE/CANCELLED; vencimento alterna
    // -30d / +30d; valores distintos. Os 3 primeiros levam studentId=Ana e type=MENSALIDADE.
    const statuses = ['PENDING', 'PAID', 'OVERDUE', 'CANCELLED'] as const;
    await prisma.financialRecord.createMany({
      data: Array.from({ length: 55 }, (_, i) => ({
        organizationId: mestre.organizationId,
        description: `${TAG} lanc ${i}`,
        amountCents: 1000 + i * 7,
        dueDate: new Date(`${todaySaoPaulo(i % 2 === 0 ? -30 : 30)}T00:00:00.000Z`),
        status: statuses[i % 4],
        paidAt: statuses[i % 4] === 'PAID' ? new Date() : null,
        studentId: i < 3 ? anaId : null,
        type: i < 3 ? 'MENSALIDADE' : i === 3 ? 'Camiseta' : null,
      })),
    });
    // Org B: mesmo TAG, para provar que o total da org A não a inclui.
    await prisma.financialRecord.createMany({
      data: Array.from({ length: 3 }, (_, i) => ({
        organizationId: orgB.organizationId,
        description: `${TAG} orgB ${i}`,
        amountCents: 999999,
        dueDate: new Date(`${todaySaoPaulo(-5)}T00:00:00.000Z`),
        status: 'PENDING' as const,
      })),
    });
  });

  after(async () => {
    await prisma.financialRecord.deleteMany({ where: { description: { startsWith: TAG } } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  it('sem limit: corpo é array de 50 e X-Total-Count = total real da organização', async () => {
    const res = await get('/finance').expect(200);
    assert.ok(Array.isArray(res.body));
    assert.equal(res.body.length, 50);
    const total = await prisma.financialRecord.count({ where: { organizationId: mestre.organizationId } });
    assert.equal(res.headers['x-total-count'], String(total));
    assert.ok(total >= 55);
  });

  it('limit/offset: fatia e total corretos, mesma ordem (id desc)', async () => {
    const all = await prisma.financialRecord.findMany({
      where: { organizationId: mestre.organizationId, description: { startsWith: TAG } },
      orderBy: { id: 'desc' },
    });
    assert.equal(all.length, 55);
    const res = await get(`/finance?q=${TAG}&limit=10&offset=50`).expect(200);
    assert.equal(res.headers['x-total-count'], '55');
    assert.deepEqual(res.body.map((r: { id: number }) => r.id), all.slice(50, 60).map((r) => r.id));
    const first = await get(`/finance?q=${TAG}&limit=20`).expect(200);
    assert.deepEqual(first.body.map((r: { id: number }) => r.id), all.slice(0, 20).map((r) => r.id));
    const beyond = await get(`/finance?q=${TAG}&offset=500`).expect(200);
    assert.equal(beyond.body.length, 0);
    assert.equal(beyond.headers['x-total-count'], '55');
  });

  it('parâmetros inválidos: limit=201, limit=0, offset=-1, status inválido e parâmetro desconhecido => 400', async () => {
    for (const qs of ['limit=201', 'limit=0', 'offset=-1', 'status=XYZ', 'studentId=abc', 'from=ontem', 'foo=1']) {
      await get(`/finance?${qs}`).expect(400);
    }
    await get('/finance?limit=200').expect(200);
  });

  it('total NÃO inclui outra organização (org A vê 55, org B vê só os 3 dela)', async () => {
    const a = await get(`/finance?q=${TAG}`).expect(200);
    assert.equal(a.headers['x-total-count'], '55');
    assert.ok(a.body.every((r: { organizationId: number }) => r.organizationId === mestre.organizationId));
    const b = await get(`/finance?q=${TAG}`, orgB.token).expect(200);
    assert.equal(b.headers['x-total-count'], '3');
  });

  it('filtros: studentId, type (q), from/to inclusivos e status EFETIVO (PENDING vencido conta como OVERDUE)', async () => {
    const byStudent = await get(`/finance?q=${TAG}&studentId=${anaId}`).expect(200);
    assert.equal(byStudent.headers['x-total-count'], '3');

    const byType = await get(`/finance?q=camiseta`).expect(200); // q casa no tipo, insensível a caixa
    assert.ok(byType.body.length >= 1 && byType.body.every((r: { type: string | null }) => /camiseta/i.test(r.type ?? '')));
    const byDesc = await get(`/finance?q=${TAG.toLowerCase()}%20lanc%205`).expect(200); // "lanc 5" + 50..54 não casam: "lanc 5" só 5
    assert.deepEqual(byDesc.body.map((r: { description: string }) => r.description).sort(), [`${TAG} lanc 5`, ...Array.from({ length: 5 }, (_, k) => `${TAG} lanc ${50 + k}`)].sort());

    const past = todaySaoPaulo(-30);
    const fromTo = await get(`/finance?q=${TAG}&from=${past}&to=${past}`).expect(200); // um único dia, inclusivo
    assert.equal(fromTo.headers['x-total-count'], '28'); // i par: 0..54 => 28
    const future = await get(`/finance?q=${TAG}&from=${todaySaoPaulo(1)}`).expect(200);
    assert.equal(future.headers['x-total-count'], '27');

    const all = await prisma.financialRecord.findMany({ where: { description: { startsWith: TAG }, organizationId: mestre.organizationId } });
    const today = todaySaoPaulo();
    const effective = (r: (typeof all)[number]) =>
      r.status === 'PENDING' && r.dueDate.toISOString().slice(0, 10) < today ? 'OVERDUE' : r.status;
    for (const status of ['PENDING', 'PAID', 'OVERDUE', 'CANCELLED']) {
      const res = await get(`/finance?q=${TAG}&status=${status}`).expect(200);
      assert.equal(res.headers['x-total-count'], String(all.filter((r) => effective(r) === status).length), status);
    }
  });

  it('PATCH null limpa campos nulláveis (type, studentId, paidAt) — confirmado por 2ª via (Prisma)', async () => {
    const rec = await prisma.financialRecord.create({
      data: { organizationId: mestre.organizationId, description: `${TAG} clear`, amountCents: 5000, dueDate: new Date(), type: 'X', studentId: anaId, paidAt: new Date(), status: 'PAID' },
    });
    await patch(rec.id, { type: null, studentId: null, paidAt: null }).expect(200);
    const db = await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } });
    assert.equal(db.type, null);
    assert.equal(db.studentId, null);
    assert.equal(db.paidAt, null);
    assert.equal(db.status, 'PAID'); // limpar paidAt não mexe no status
  });

  it('voltar PAID -> PENDING limpa paidAt sozinho; PAID sem paidAt usa agora; paidAt explícito é respeitado', async () => {
    const rec = await prisma.financialRecord.create({
      data: { organizationId: mestre.organizationId, description: `${TAG} paid`, amountCents: 100, dueDate: new Date(), status: 'PENDING' },
    });
    await patch(rec.id, { status: 'PAID' }).expect(200);
    assert.ok((await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } })).paidAt);
    await patch(rec.id, { status: 'PENDING' }).expect(200);
    assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } })).paidAt, null);
    await patch(rec.id, { status: 'PAID', paidAt: '2026-01-15' }).expect(200);
    assert.equal((await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } })).paidAt?.toISOString().slice(0, 10), '2026-01-15');
  });

  it('null em campo OBRIGATÓRIO => 400 (description, amountCents, dueDate, status) e nada muda', async () => {
    const rec = await prisma.financialRecord.create({
      data: { organizationId: mestre.organizationId, description: `${TAG} req`, amountCents: 100, dueDate: new Date() },
    });
    for (const body of [{ description: null }, { amountCents: null }, { dueDate: null }, { status: null }]) {
      await patch(rec.id, body).expect(400);
    }
    const db = await prisma.financialRecord.findUniqueOrThrow({ where: { id: rec.id } });
    assert.equal(db.description, `${TAG} req`);
    assert.equal(db.amountCents, 100);
  });

  it('GET /finance/summary: totais batem com a soma via Prisma (>50 lançamentos), cancelados fora, atrasado inclui PENDING vencido', async () => {
    const res = await get(`/finance/summary?q=${TAG}`).expect(200);
    const rows = await prisma.financialRecord.findMany({ where: { organizationId: mestre.organizationId, description: { startsWith: TAG } } });
    const today = todaySaoPaulo();
    const exp = { paid: 0, pending: 0, overdue: 0, count: 0, paidCount: 0, pendingCount: 0, overdueCount: 0 };
    for (const r of rows) {
      const late = r.status === 'OVERDUE' || (r.status === 'PENDING' && r.dueDate.toISOString().slice(0, 10) < today);
      if (r.status === 'PAID') { exp.paid += r.amountCents; exp.paidCount++; }
      else if (late) { exp.overdue += r.amountCents; exp.overdueCount++; }
      else if (r.status === 'PENDING') { exp.pending += r.amountCents; exp.pendingCount++; }
    }
    exp.count = exp.paidCount + exp.pendingCount + exp.overdueCount;
    assert.deepEqual(res.body, exp);
    assert.ok(rows.length > 50 && exp.overdue > 0 && exp.pending > 0 && exp.paid > 0);
    assert.ok(exp.count < rows.length); // CANCELLED ficou de fora
  });

  it('summary respeita os filtros da lista (status, studentId, from/to, q) e é consistente com o total da lista', async () => {
    const byStudent = await get(`/finance/summary?q=${TAG}&studentId=${anaId}`).expect(200);
    const rows = await prisma.financialRecord.findMany({ where: { organizationId: mestre.organizationId, studentId: anaId, description: { startsWith: TAG } } });
    assert.equal(rows.length, 3);
    assert.equal(byStudent.body.paid + byStudent.body.pending + byStudent.body.overdue, rows.filter((r) => r.status !== 'CANCELLED').reduce((s, r) => s + r.amountCents, 0));

    for (const status of ['PENDING', 'PAID', 'OVERDUE', 'CANCELLED']) {
      const sum = await get(`/finance/summary?q=${TAG}&status=${status}`).expect(200);
      const list = await get(`/finance?q=${TAG}&status=${status}`).expect(200);
      const key = { PENDING: 'pendingCount', PAID: 'paidCount', OVERDUE: 'overdueCount', CANCELLED: null }[status];
      if (key) assert.equal(String(sum.body[key]), list.headers['x-total-count'], status);
      else assert.deepEqual(sum.body, { paid: 0, pending: 0, overdue: 0, count: 0, paidCount: 0, pendingCount: 0, overdueCount: 0 });
      // só o bucket do próprio status pode ter valor
      for (const other of ['paid', 'pending', 'overdue'].filter((k) => k !== status.toLowerCase())) assert.equal(sum.body[other], 0, `${status}/${other}`);
    }

    const range = await get(`/finance/summary?q=${TAG}&from=${todaySaoPaulo(1)}`).expect(200);
    assert.equal(range.body.overdue, 0); // só vencimentos futuros
    assert.equal(range.body.paid > 0, true);
    await get('/finance/summary?status=XYZ').expect(400);
    await get('/finance/summary?foo=1').expect(400);
  });

  it('summary: borda do vencimento — vence HOJE (SP) NÃO é atrasado; ontem é', async () => {
    const edgeTag = `${TAG}EDGE`;
    await prisma.financialRecord.createMany({
      data: [
        { organizationId: mestre.organizationId, description: `${edgeTag} hoje`, amountCents: 111, dueDate: new Date(`${todaySaoPaulo(0)}T00:00:00.000Z`), status: 'PENDING' },
        { organizationId: mestre.organizationId, description: `${edgeTag} ontem`, amountCents: 222, dueDate: new Date(`${todaySaoPaulo(-1)}T00:00:00.000Z`), status: 'PENDING' },
        { organizationId: mestre.organizationId, description: `${edgeTag} amanha`, amountCents: 444, dueDate: new Date(`${todaySaoPaulo(1)}T00:00:00.000Z`), status: 'PENDING' },
      ],
    });
    const res = await get(`/finance/summary?q=${edgeTag}`).expect(200);
    assert.deepEqual(res.body, { paid: 0, pending: 111 + 444, overdue: 222, count: 3, paidCount: 0, pendingCount: 2, overdueCount: 1 });
    // a lista concorda: status=OVERDUE traz só o de ontem; status=PENDING traz hoje e amanhã
    const od = await get(`/finance?q=${edgeTag}&status=OVERDUE`).expect(200);
    assert.deepEqual(od.body.map((r: { description: string }) => r.description), [`${edgeTag} ontem`]);
    const pd = await get(`/finance?q=${edgeTag}&status=PENDING`).expect(200);
    assert.equal(pd.body.length, 2);
  });

  it('summary: isolamento multi-tenant (org B só vê o dela; a org A não soma o 999999 da B)', async () => {
    const a = await get(`/finance/summary?q=${TAG}`).expect(200);
    assert.ok(a.body.overdue < 999999 * 3);
    const b = await get(`/finance/summary?q=${TAG}`, orgB.token).expect(200);
    assert.deepEqual(b.body, { paid: 0, pending: 0, overdue: 999999 * 3, count: 3, paidCount: 0, pendingCount: 0, overdueCount: 3 });
  });

  it('RBAC inalterado: ALUNO recebe 403 em /finance e /finance/summary; sem token 401; ALUNO ainda vê /finance/me', async () => {
    await get('/finance', aluno.token).expect(403);
    await get('/finance/summary', aluno.token).expect(403);
    await request(app.getHttpServer()).get('/api/finance/summary').expect(401);
    await get('/finance/me', aluno.token).expect(200);
  });

  it('GET /finance inclui student { id, name } | null por item (join, sem N+1) e mantém os campos existentes', async () => {
    const res = await get(`/finance?q=${encodeURIComponent(`${TAG} lanc`)}&limit=100`).expect(200); // só os 55 do before (outros testes criam mais com a mesma TAG)
    assert.equal(res.body.length, 55);
    const ana = await prisma.student.findUniqueOrThrow({ where: { id: anaId } });
    const withStudent = res.body.filter((r: { studentId: number | null }) => r.studentId !== null);
    assert.equal(withStudent.length, 3);
    for (const r of withStudent) {
      assert.deepEqual(r.student, { id: anaId, name: ana.name });
    }
    for (const r of res.body.filter((x: { studentId: number | null }) => x.studentId === null)) {
      assert.equal(r.student, null);
    }
    // campos existentes intactos
    const one = res.body[0];
    for (const k of ['id', 'organizationId', 'studentId', 'unitId', 'description', 'amountCents', 'type', 'dueDate', 'paidAt', 'status', 'createdAt', 'updatedAt']) {
      assert.ok(k in one, `campo ${k} sumiu`);
    }
    // o filtro por aluno continua funcionando e traz o aluno
    const byStudent = await get(`/finance?q=${encodeURIComponent(`${TAG} lanc`)}&studentId=${anaId}`).expect(200);
    assert.equal(byStudent.body.length, 3);
    assert.ok(byStudent.body.every((r: { student: { id: number } }) => r.student.id === anaId));
  });

  it('PROFESSOR (financeiro é só do MESTRE): 403 em GET /finance, /finance/summary, /finance/:id e POST/PATCH/DELETE — e nada é gravado/alterado', async () => {
    const mine = await prisma.financialRecord.findFirstOrThrow({
      where: { organizationId: mestre.organizationId, description: { startsWith: TAG } },
    });
    const countBefore = await prisma.financialRecord.count({ where: { organizationId: mestre.organizationId } });
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${professor.token}`);
    const api = () => request(app.getHttpServer());

    await get('/finance', professor.token).expect(403);
    await get('/finance/summary', professor.token).expect(403);
    await get(`/finance/${mine.id}`, professor.token).expect(403);
    await auth(api().post('/api/finance'))
      .send({ description: `${TAG} professor`, amountCents: 100, dueDate: new Date().toISOString() })
      .expect(403);
    await auth(api().patch(`/api/finance/${mine.id}`)).send({ amountCents: 1 }).expect(403);
    await auth(api().delete(`/api/finance/${mine.id}`)).expect(403);

    // 2ª via independente (Prisma): nada criado, valor intacto, registro ainda existe
    assert.equal(await prisma.financialRecord.count({ where: { organizationId: mestre.organizationId } }), countBefore);
    const after = await prisma.financialRecord.findUniqueOrThrow({ where: { id: mine.id } });
    assert.equal(after.amountCents, mine.amountCents);

    // a matriz no banco é a fonte: PROFESSOR/finance tudo false
    const perm = await prisma.rolePermission.findUniqueOrThrow({ where: { role_resource: { role: 'PROFESSOR', resource: 'finance' } } });
    assert.deepEqual([perm.canView, perm.canCreate, perm.canEdit, perm.canDelete], [false, false, false, false]);

    // MESTRE segue com acesso total
    await get('/finance').expect(200);
    await get('/finance/summary').expect(200);
    await get(`/finance/${mine.id}`).expect(200);
  });
});