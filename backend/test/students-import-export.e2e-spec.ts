import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { createReportOrg, ReportOrg } from './utils/report-fixtures';
import { createSecondOrg, SecondOrg } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Importação (POST /students/import) e exportação (GET /students/export.csv) de alunos por CSV. Segunda via
 * independente = Prisma direto (contagens e linhas gravadas). Grupo próprio — não toca o seed nem o demo.
 */
describe('Alunos: importação e exportação CSV (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let org: ReportOrg;
  let orgB: SecondOrg;
  const planIds: number[] = [];

  const api = (method: 'get' | 'post', path: string, token?: string) => {
    const req = request(app.getHttpServer())[method](`/api${path}`);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };
  const count = () => prisma.student.count({ where: { organizationId: org.organizationId } });
  const importRows = (rows: unknown[], dryRun: boolean, token = org.mestre.token) =>
    api('post', '/students/import', token).send({ rows, dryRun });

  before(async () => {
    app = await createTestApp();
    org = await createReportOrg(app, prisma, 'import');
    orgB = await createSecondOrg(app, prisma, 'importb');
  });

  after(async () => {
    // Ficha unica: a importacao cria uma Person por aluno (com o CPF cifrado); apaga junto para nao deixar ficha orfa.
    const personIds = (
      await prisma.student.findMany({ where: { organizationId: orgB.organizationId, personId: { not: null } }, select: { personId: true } })
    ).map((s) => s.personId!);
    await prisma.student.deleteMany({ where: { organizationId: orgB.organizationId } });
    await prisma.person.deleteMany({ where: { id: { in: personIds }, students: { none: {} } } });
    await prisma.unit.deleteMany({ where: { organizationId: orgB.organizationId } });
    await orgB.cleanup();
    await org.cleanup();
    await prisma.plan.deleteMany({ where: { id: { in: planIds } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('POST /students/import', () => {
    it('dryRun valida e devolve erros por linha SEM gravar nada; o real grava só as válidas', async () => {
      const rows = [
        { line: 2, name: 'Ana Souza', birthDate: '05/03/2010', email: 'ana@e2e-import.local', phone: '(11) 91234-5678', document: '529.982.247-25', unit: org.unitA.name.toUpperCase(), status: 'Ativo' },
        { line: 3, name: '', birthDate: '2010-01-01' },
        { line: 4, name: 'Beto Data Ruim', birthDate: '31/02/2010', email: 'beto@', document: '111.111.111-11', unit: 'Unidade que não existe' },
        { line: 5, name: 'Caio Sem Unidade', status: 'Suspenso' },
      ];
      const before = await count();
      const dry = await importRows(rows, true).expect(200);
      assert.equal(dry.body.dryRun, true);
      assert.deepEqual([dry.body.total, dry.body.created, dry.body.ignored, dry.body.failed], [4, 2, 0, 2]);
      const byLine = Object.fromEntries(dry.body.items.map((i: { line: number }) => [i.line, i]));
      assert.equal(byLine[3].action, 'ERROR');
      assert.ok(byLine[3].messages.includes('Nome é obrigatório.'));
      assert.equal(byLine[4].action, 'ERROR');
      assert.equal(byLine[4].messages.length, 4); // data, e-mail, CPF, unidade
      assert.equal(await count(), before, 'dryRun não pode gravar');

      const real = await importRows(rows, false).expect(200);
      assert.deepEqual([real.body.created, real.body.failed], [2, 2]);
      assert.equal(await count(), before + 2);
      const ana = await prisma.student.findFirstOrThrow({ where: { organizationId: org.organizationId, name: 'Ana Souza' } });
      assert.equal(ana.unitId, org.unitA.id);
      assert.equal(ana.birthDate?.toISOString(), '2010-03-05T00:00:00.000Z');
      assert.equal(ana.document, '529.982.247-25');
      const caio = await prisma.student.findFirstOrThrow({ where: { organizationId: org.organizationId, name: 'Caio Sem Unidade' } });
      assert.equal(caio.status, 'SUSPENDED');
      assert.equal(caio.unitId, null);
    });

    it('é idempotente: reenviar não duplica (e-mail sem caixa, nome + nascimento, repetido no arquivo)', async () => {
      const before = await count();
      const rows = [
        { name: 'Ana Souza', email: 'ANA@e2e-import.local' }, // mesmo e-mail
        { name: 'ana  souza', birthDate: '2010-03-05' }, // mesmo nome (sem caixa/espaços) + nascimento
        { name: 'Diego Novo', birthDate: '01/01/2000' },
        { name: 'Diego Novo', birthDate: '2000-01-01' }, // repetido no próprio arquivo
      ];
      const res = await importRows(rows, false).expect(200);
      assert.deepEqual([res.body.created, res.body.ignored, res.body.failed], [1, 3, 0]);
      assert.equal(await count(), before + 1);
      const again = await importRows(rows, false).expect(200);
      assert.deepEqual([again.body.created, again.body.ignored], [0, 4]);
      assert.equal(await count(), before + 1);
    });

    it('respeita Plan.maxStudents: só entram as vagas que sobram; o resto vira erro da linha', async () => {
      const active = await prisma.student.count({ where: { organizationId: org.organizationId, status: 'ACTIVE' } });
      const plan = await prisma.plan.create({ data: { name: 'Plano E2E import', code: `e2e-import-${Date.now()}`, maxStudents: active + 1 } });
      planIds.push(plan.id);
      await prisma.subscription.create({ data: { organizationId: org.organizationId, planId: plan.id, status: 'ACTIVE' } });
      const before = await count();
      const res = await importRows([{ name: 'Vaga Um' }, { name: 'Vaga Dois' }, { name: 'Vaga Tres' }], false).expect(200);
      assert.deepEqual([res.body.created, res.body.failed], [1, 2]);
      assert.equal(res.body.plan.availableSlots, 1);
      assert.match(res.body.items[1].messages[0], /Limite de \d+ alunos do plano/);
      assert.equal(await count(), before + 1);
      assert.equal(await prisma.student.count({ where: { organizationId: org.organizationId, name: 'Vaga Dois' } }), 0);
      // Sem assinatura = sem limite: os próximos testes importam livremente.
      await prisma.subscription.deleteMany({ where: { organizationId: org.organizationId } });
    });
  });

  describe('POST /students/import: RBAC, limites e isolamento', () => {
    it('PROFESSOR e ALUNO levam 403, sem token 401; nada é gravado', async () => {
      const before = await count();
      await importRows([{ name: 'Intruso' }], false, org.professor.token).expect(403);
      await importRows([{ name: 'Intruso' }], false, org.aluno.token).expect(403);
      await api('post', '/students/import').send({ rows: [{ name: 'Intruso' }] }).expect(401);
      assert.equal(await count(), before);
    });

    it('rows vazio, mais de 500 linhas e campo desconhecido => 400', async () => {
      await importRows([], false).expect(400);
      await importRows(Array.from({ length: 501 }, (_, i) => ({ name: `L${i}` })), true).expect(400);
      await importRows([{ name: 'Ok', organizationId: 1 }], true).expect(400);
    });

    it('unidade de OUTRO grupo não é aceita por nome; o aluno criado é sempre do grupo do token', async () => {
      const foreign = await prisma.unit.create({ data: { organizationId: orgB.organizationId, name: 'Unidade Só do B' } });
      const res = await importRows([{ name: 'Fulano Cross', unit: foreign.name }], false).expect(200);
      assert.equal(res.body.failed, 1);
      assert.match(res.body.items[0].messages[0], /não encontrada/);
      assert.equal(await prisma.student.count({ where: { name: 'Fulano Cross' } }), 0);
      const ok = await importRows([{ name: 'Gabi Do Grupo' }], false).expect(200);
      assert.equal(ok.body.created, 1);
      const row = await prisma.student.findFirstOrThrow({ where: { name: 'Gabi Do Grupo' } });
      assert.equal(row.organizationId, org.organizationId);
    });
  });

  describe('GET /students/export.csv', () => {
    it('CSV com BOM, ";" e cabeçalho do modelo; respeita o filtro de status; neutraliza fórmula no nome', async () => {
      await prisma.student.create({
        data: { organizationId: org.organizationId, unitId: org.unitA.id, name: '=HYPERLINK("http://x")', phone: '+55 11 91234-5678', status: 'ACTIVE' },
      });
      const res = await api('get', '/students/export.csv', org.mestre.token).expect(200);
      assert.match(res.headers['content-type'], /text\/csv/);
      assert.match(res.headers['content-disposition'], /attachment; filename="alunos-\d{4}-\d{2}-\d{2}\.csv"/);
      assert.equal(res.text.charCodeAt(0), 0xfeff, 'BOM UTF-8');
      const lines = res.text.slice(1).split('\r\n');
      assert.equal(lines[0], 'Nome;Data de nascimento;E-mail;Telefone;CPF;Unidade;Situação;Data de ingresso');
      assert.ok(res.text.includes(`Ana Souza;05/03/2010;ana@e2e-import.local;(11) 91234-5678;529.982.247-25;${org.unitA.name};Ativo;`));
      assert.ok(res.text.includes(`"'=HYPERLINK(""http://x"")";`), 'fórmula neutralizada com apóstrofo');
      assert.ok(res.text.includes(";'+55 11 91234-5678;"));
      assert.equal(res.headers['x-total-count'], String(await count()));

      const suspended = await api('get', '/students/export.csv?status=SUSPENDED', org.mestre.token).expect(200);
      const dataLines = suspended.text.slice(1).split('\r\n').filter(Boolean);
      assert.equal(dataLines.length, 2); // cabeçalho + Caio
      assert.match(dataLines[1], /^Caio Sem Unidade;.*;Suspenso;/);
    });

    it('PROFESSOR restrito à unidade A só exporta alunos de A (e sem unidade); ALUNO 403; outro grupo não vê nada', async () => {
      await prisma.student.create({ data: { organizationId: org.organizationId, unitId: org.unitB.id, name: 'Aluno Da Unidade B' } });
      await prisma.userUnitAccess.create({ data: { organizationId: org.organizationId, userId: org.professor.userId, unitId: org.unitA.id } });
      const prof = await api('get', '/students/export.csv', org.professor.token).expect(200);
      assert.ok(prof.text.includes('Ana Souza'));
      assert.ok(!prof.text.includes('Aluno Da Unidade B'), 'unidade B está fora do escopo do professor');
      const mestre = await api('get', '/students/export.csv', org.mestre.token).expect(200);
      assert.ok(mestre.text.includes('Aluno Da Unidade B'));

      await api('get', '/students/export.csv', org.aluno.token).expect(403);
      await api('get', '/students/export.csv').expect(401);
      const other = await api('get', '/students/export.csv', orgB.token).expect(200);
      assert.ok(!other.text.includes('Ana Souza'));
      assert.equal(other.text.slice(1).split('\r\n').filter(Boolean).length, 1, 'só o cabeçalho');
    });
  });
});
