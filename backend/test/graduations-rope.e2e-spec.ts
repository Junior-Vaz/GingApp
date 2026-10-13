import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { GRADUATION_TEMPLATES } from '../src/interface/http/graduations/graduation-templates';
import { ALUNO_EMAIL, createSecondOrg, loginAs, MESTRE_EMAIL, SecondOrg } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Cordas multicoloridas (style SOLID/SPLIT/BRAIDED + colors) e a estrutura do sistema de graduação:
 * validação por estilo no create/update de nível, contrato {id, name, order, color, style, colors} em TODOS os
 * pontos de leitura (systems, systems/:id, histórico do aluno, /passport/me, /certificates/me, relatório),
 * duplicar nível, reordenar (atômico, unique (sistema, ordem)), modelos e criação a partir de modelo.
 * Usa um sistema próprio (prefixo `tag`) no grupo do seed; limpa tudo que cria.
 */
describe('Graduations: cordas multicoloridas, duplicar, reordenar e modelos (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const tag = `rope${Date.now()}`;

  let mestreToken: string;
  let professorToken: string;
  let alunoToken: string;
  let orgId: number;
  let anaId: number;
  let systemId: number;
  let orgB: SecondOrg;
  const levelIds: Record<string, number> = {};
  let graduationId: number;
  let certificateId: number;

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const createLevel = (body: object, token = mestreToken) =>
    api().post(`/api/graduations/systems/${systemId}/levels`).set(auth(token)).send(body);
  const CONTRACT = ['id', 'name', 'order', 'color', 'style', 'colors'];
  const assertContract = (level: Record<string, unknown>, where: string) => {
    for (const key of CONTRACT) assert.ok(key in level, `${where}: falta ${key}`);
    assert.ok(['SOLID', 'SPLIT', 'BRAIDED'].includes(level.style as string), `${where}: style`);
    const colors = level.colors as string[];
    assert.ok(Array.isArray(colors) && colors.length >= 1 && colors.length <= 3, `${where}: colors`);
    assert.ok(colors.every((c) => /^#[0-9A-F]{6}$/.test(c)), `${where}: hex`);
    assert.equal(level.color, colors[0], `${where}: color = colors[0]`);
  };

  before(async () => {
    app = await createTestApp();
    const m = await loginAs(app, MESTRE_EMAIL);
    mestreToken = m.token;
    orgId = m.organizationId;
    professorToken = (await loginAs(app, 'professor@gingabrasil.com.br')).token;
    alunoToken = (await loginAs(app, ALUNO_EMAIL)).token;
    anaId = (await prisma.student.findFirstOrThrow({ where: { organizationId: orgId, user: { email: ALUNO_EMAIL } } })).id;
    orgB = await createSecondOrg(app, prisma, 'rope');
    systemId = (await prisma.graduationSystem.create({ data: { organizationId: orgId, name: `${tag} sistema` } })).id;
  });

  after(async () => {
    const levels = { graduationLevel: { name: { startsWith: tag } } };
    await prisma.certificate.deleteMany({ where: { studentGraduation: levels } });
    await prisma.studentGraduation.deleteMany({ where: levels });
    await prisma.graduationLevel.deleteMany({ where: { name: { startsWith: tag } } });
    await prisma.graduationLevel.deleteMany({ where: { graduationSystem: { name: { startsWith: tag } } } });
    await prisma.graduationSystem.deleteMany({ where: { name: { startsWith: tag } } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  describe('validação por estilo (create/update de nível)', () => {
    it('SOLID com 1 cor, SPLIT e BRAIDED com 2 e 3 cores: 201 e resposta {color, style, colors}', async () => {
      const solid = await createLevel({ name: `${tag} solida`, order: 1, style: 'SOLID', colors: ['#16a34a'] }).expect(201);
      assert.deepEqual([solid.body.style, solid.body.colors, solid.body.color], ['SOLID', ['#16A34A'], '#16A34A']);
      levelIds.solid = solid.body.id;
      const split = await createLevel({ name: `${tag} dividida`, order: 2, style: 'SPLIT', colors: ['#16A34A', '#FACC15'] }).expect(201);
      assert.deepEqual([split.body.style, split.body.colors, split.body.color], ['SPLIT', ['#16A34A', '#FACC15'], '#16A34A']);
      levelIds.split = split.body.id;
      const braided = await createLevel({ name: `${tag} trancada`, order: 3, style: 'BRAIDED', colors: ['#16A34A', '#FACC15', '#2563EB'] }).expect(201);
      assert.deepEqual([braided.body.style, braided.body.colors.length], ['BRAIDED', 3]);
      levelIds.braided = braided.body.id;
      // 2ª via: o que ficou no banco
      const db = await prisma.graduationLevel.findUniqueOrThrow({ where: { id: levelIds.braided } });
      assert.deepEqual([db.style, db.colors, db.color], ['BRAIDED', ['#16A34A', '#FACC15', '#2563EB'], '#16A34A']);
    });

    it('só `color` (legado) vira SOLID; sem cor nenhuma usa o cinza neutro', async () => {
      const legacy = await createLevel({ name: `${tag} legado`, order: 4, color: '#123456' }).expect(201);
      assert.deepEqual([legacy.body.style, legacy.body.colors, legacy.body.color], ['SOLID', ['#123456'], '#123456']);
      levelIds.legacy = legacy.body.id;
      const none = await createLevel({ name: `${tag} sem cor`, order: 5 }).expect(201);
      assert.deepEqual([none.body.style, none.body.colors.length], ['SOLID', 1]);
      assertContract(none.body, 'sem cor');
    });

    it('rejeita (400): SOLID com 2 cores, SPLIT/BRAIDED com 1 ou 4 cores, hex inválido, cores consecutivas iguais, estilo desconhecido', async () => {
      const cases: Array<[string, object]> = [
        ['SOLID 2 cores', { style: 'SOLID', colors: ['#16A34A', '#FACC15'] }],
        ['SPLIT 1 cor', { style: 'SPLIT', colors: ['#16A34A'] }],
        ['BRAIDED 1 cor', { style: 'BRAIDED', colors: ['#16A34A'] }],
        ['SPLIT 4 cores', { style: 'SPLIT', colors: ['#16A34A', '#FACC15', '#2563EB', '#FFFFFF'] }],
        ['hex inválido', { style: 'SOLID', colors: ['verde'] }],
        ['hex curto demais', { style: 'SOLID', colors: ['#12345'] }],
        ['color inválido', { color: 'azul' }],
        ['consecutivas iguais', { style: 'SPLIT', colors: ['#16A34A', '#16a34a'] }],
        ['estilo desconhecido', { style: 'ZEBRA', colors: ['#16A34A'] }],
        ['colors vazio', { style: 'SOLID', colors: [] }],
        ['só style SPLIT + color', { style: 'SPLIT', color: '#16A34A' }],
        ['campo estranho', { style: 'SOLID', colors: ['#16A34A'], tipColor: '#FFFFFF' }],
      ];
      for (const [label, body] of cases) {
        const res = await createLevel({ name: `${tag} x`, order: 20, ...body });
        assert.equal(res.status, 400, `${label}: esperado 400, veio ${res.status}`);
      }
      assert.equal(await prisma.graduationLevel.count({ where: { name: `${tag} x` } }), 0);
    });

    it('PATCH: troca estilo/cores com as mesmas regras; só `color` volta a SOLID; sem tocar na corda mantém tudo', async () => {
      const patch = (id: number, body: object) => api().patch(`/api/graduations/levels/${id}`).set(auth(mestreToken)).send(body);
      // renomear não mexe na corda
      const renamed = await patch(levelIds.braided, { name: `${tag} trancada2` }).expect(200);
      assert.deepEqual([renamed.body.style, renamed.body.colors], ['BRAIDED', ['#16A34A', '#FACC15', '#2563EB']]);
      // SPLIT -> BRAIDED com 2 cores
      const restyled = await patch(levelIds.split, { style: 'BRAIDED', colors: ['#7C3AED', '#FFFFFF'] }).expect(200);
      assert.deepEqual([restyled.body.style, restyled.body.color], ['BRAIDED', '#7C3AED']);
      // só style SOLID com 2 cores atuais: 400
      await patch(levelIds.split, { style: 'SOLID' }).expect(400);
      // só color (legado) vira SOLID
      const legacy = await patch(levelIds.split, { color: '#abcdef' }).expect(200);
      assert.deepEqual([legacy.body.style, legacy.body.colors, legacy.body.color], ['SOLID', ['#ABCDEF'], '#ABCDEF']);
      // volta ao SPLIT para os testes seguintes
      await patch(levelIds.split, { style: 'SPLIT', colors: ['#16A34A', '#FACC15'] }).expect(200);
      await patch(levelIds.braided, { style: 'SPLIT', colors: ['#16A34A', '#16A34A'] }).expect(400);
      await patch(levelIds.braided, { colors: ['#16A34A'] }).expect(400); // BRAIDED atual exige 2 ou 3
    });

    it('RBAC: ALUNO não cria nível (403) e outro grupo não cria no sistema (404)', async () => {
      await createLevel({ name: `${tag} y`, order: 30, color: '#000000' }, alunoToken).expect(403);
      await createLevel({ name: `${tag} y`, order: 30, color: '#000000' }, orgB.token).expect(404);
    });
  });

  describe('contrato de leitura {id, name, order, color, style, colors}', () => {
    before(async () => {
      graduationId = (
        await api().post(`/api/graduations/students/${anaId}`).set(auth(mestreToken)).send({
          graduationLevelId: levelIds.split,
          // Data civil de HOJE em Sao Paulo (o relatorio fecha o periodo em "hoje" SP; new Date() em UTC passava do dia apos 21h).
          graduatedAt: `${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })}T12:00:00.000Z`,
        }).expect(201)
      ).body.id;
      certificateId = (
        await api().post('/api/certificates').set(auth(mestreToken)).send({ studentId: anaId, title: `${tag} certificado`, studentGraduationId: graduationId }).expect(201)
      ).body.id;
    });

    it('POST /students/:id (graduar) já devolve o nível completo', async () => {
      const g = await prisma.studentGraduation.findUniqueOrThrow({ where: { id: graduationId } });
      assert.equal(g.graduationLevelId, levelIds.split);
      const again = await api().get(`/api/graduations/students/${anaId}`).set(auth(mestreToken)).expect(200);
      assertContract(again.body.find((x: { id: number }) => x.id === graduationId).graduationLevel, 'histórico');
    });

    it('GET /graduations/systems, /graduations e /graduations/systems/:id trazem os níveis completos', async () => {
      for (const url of ['/api/graduations/systems', '/api/graduations']) {
        const res = await api().get(url).set(auth(mestreToken)).expect(200);
        const sys = res.body.find((s: { id: number }) => s.id === systemId);
        assert.ok(sys, url);
        assert.ok(sys.levels.length >= 4, url);
        for (const level of sys.levels) assertContract(level, url);
      }
      // sistemas do seed (criados antes das cordas, backfill) também seguem o contrato
      const all = await api().get('/api/graduations/systems').set(auth(mestreToken)).expect(200);
      for (const s of all.body) for (const level of s.levels) assertContract(level, `sistema ${s.id}`);

      const one = await api().get(`/api/graduations/systems/${systemId}`).set(auth(mestreToken)).expect(200);
      assert.equal(one.body.levels.length, 5);
      const split = one.body.levels.find((l: { id: number }) => l.id === levelIds.split);
      assert.deepEqual([split.style, split.colors], ['SPLIT', ['#16A34A', '#FACC15']]);
      await api().get(`/api/graduations/systems/${systemId}`).set(auth(orgB.token)).expect(404);
      await api().get(`/api/graduations/systems/${systemId}`).set(auth(alunoToken)).expect(403);
    });

    it('GET /passport/me (aluno) traz currentGraduation com o nível completo', async () => {
      const res = await api().get('/api/passport/me').set(auth(alunoToken)).expect(200);
      assert.equal(res.body.currentGraduation.id, levelIds.split);
      assert.equal(res.body.currentGraduation.name, `${tag} dividida`);
      assertContract(res.body.currentGraduation, 'passport');
      assert.deepEqual(res.body.currentGraduation.colors, ['#16A34A', '#FACC15']);
    });

    it('GET /certificates/me e /certificates (staff) trazem studentGraduation.graduationLevel completo', async () => {
      const mine = await api().get('/api/certificates/me').set(auth(alunoToken)).expect(200);
      const cert = mine.body.find((c: { id: number }) => c.id === certificateId);
      assert.ok(cert);
      assertContract(cert.studentGraduation.graduationLevel, 'certificates/me');
      const list = await api().get('/api/certificates?limit=100').set(auth(mestreToken)).expect(200);
      const staffCert = (list.body.items ?? list.body).find((c: { id: number }) => c.id === certificateId);
      assertContract(staffCert.studentGraduation.graduationLevel, 'certificates');
      const one = await api().get(`/api/certificates/${certificateId}`).set(auth(mestreToken)).expect(200);
      assertContract(one.body.studentGraduation.graduationLevel, 'certificates/:id');
    });

    it('GET /reports/graduations (byLevel) traz style/colors', async () => {
      const res = await api().get('/api/reports/graduations').set(auth(mestreToken)).expect(200);
      const row = res.body.byLevel.find((l: { levelId: number }) => l.levelId === levelIds.split);
      assert.ok(row, 'nível recém-graduado no relatório');
      assert.deepEqual([row.style, row.colors, row.color], ['SPLIT', ['#16A34A', '#FACC15'], '#16A34A']);
    });

    it('GET /auth/me/export (LGPD) lista a graduação com a corda', async () => {
      const res = await api().get('/api/auth/me/export').set(auth(alunoToken)).expect(200);
      const text = JSON.stringify(res.body);
      assert.ok(text.includes(`${tag} dividida`));
      assert.ok(text.includes('"style":"SPLIT"'));
    });
  });

  describe('duplicar nível', () => {
    it('POST /levels/:id/duplicate cria a cópia no fim da ordem, com a mesma corda', async () => {
      const res = await api().post(`/api/graduations/levels/${levelIds.braided}/duplicate`).set(auth(mestreToken)).expect(201);
      assert.equal(res.body.name, `${tag} trancada2 (cópia)`);
      assert.equal(res.body.order, 6, 'maior ordem do sistema (5) + 1');
      const source = await prisma.graduationLevel.findUniqueOrThrow({ where: { id: levelIds.braided } });
      assert.deepEqual([res.body.style, res.body.colors], [source.style, source.colors]);
      assert.equal(res.body.graduationSystemId, systemId);
      levelIds.copy = res.body.id;
    });

    it('RBAC e isolamento: ALUNO 403; outro grupo 404; nível inexistente 404', async () => {
      await api().post(`/api/graduations/levels/${levelIds.split}/duplicate`).set(auth(alunoToken)).expect(403);
      await api().post(`/api/graduations/levels/${levelIds.split}/duplicate`).set(auth(orgB.token)).expect(404);
      await api().post('/api/graduations/levels/99999999/duplicate').set(auth(mestreToken)).expect(404);
      assert.equal(await prisma.graduationLevel.count({ where: { graduationSystemId: systemId } }), 6);
    });
  });

  describe('reordenar níveis', () => {
    it('PUT /systems/:id/levels/reorder reordena (mais baixo -> mais alto) preservando os valores de order', async () => {
      const before = await prisma.graduationLevel.findMany({ where: { graduationSystemId: systemId }, orderBy: { order: 'asc' } });
      assert.deepEqual(before.map((l) => l.order), [1, 2, 3, 4, 5, 6]);
      const reversed = [...before].reverse().map((l) => l.id);
      const res = await api().put(`/api/graduations/systems/${systemId}/levels/reorder`).set(auth(mestreToken)).send({ order: reversed }).expect(200);
      assert.deepEqual(res.body.levels.map((l: { id: number }) => l.id), reversed);
      assert.deepEqual(res.body.levels.map((l: { order: number }) => l.order), [1, 2, 3, 4, 5, 6]);
      const db = await prisma.graduationLevel.findMany({ where: { graduationSystemId: systemId }, orderBy: { order: 'asc' } });
      assert.deepEqual(db.map((l) => l.id), reversed);
      // a graduação da Ana segue no mesmo nível (a ordem mudou, não o nível)
      const g = await prisma.studentGraduation.findUniqueOrThrow({ where: { id: graduationId } });
      assert.equal(g.graduationLevelId, levelIds.split);
    });

    it('lista incompleta, com repetidos, com id de outro sistema ou vazia: 400 e nada muda', async () => {
      const current = (await prisma.graduationLevel.findMany({ where: { graduationSystemId: systemId }, orderBy: { order: 'asc' } })).map((l) => l.id);
      const put = (order: unknown) => api().put(`/api/graduations/systems/${systemId}/levels/reorder`).set(auth(mestreToken)).send({ order });
      await put(current.slice(1)).expect(400);
      await put([...current.slice(1), current[1]]).expect(400);
      await put([...current.slice(1), 99999999]).expect(400);
      await put([]).expect(400);
      await put('x').expect(400);
      const after = (await prisma.graduationLevel.findMany({ where: { graduationSystemId: systemId }, orderBy: { order: 'asc' } })).map((l) => l.id);
      assert.deepEqual(after, current);
    });

    it('RBAC e isolamento: ALUNO 403; outro grupo 404; PROFESSOR 403 (estrutura so do MESTRE)', async () => {
      const current = (await prisma.graduationLevel.findMany({ where: { graduationSystemId: systemId }, orderBy: { order: 'asc' } })).map((l) => l.id);
      const url = `/api/graduations/systems/${systemId}/levels/reorder`;
      await api().put(url).set(auth(alunoToken)).send({ order: current }).expect(403);
      await api().put(url).set(auth(orgB.token)).send({ order: current }).expect(404);
      await api().put(url).set(auth(professorToken)).send({ order: current }).expect(403);
    });
  });

  describe('limite de níveis por sistema (30)', () => {
    it('create e duplicate recusam o 31º nível (400)', async () => {
      const full = await prisma.graduationSystem.create({ data: { organizationId: orgId, name: `${tag} cheio` } });
      await prisma.graduationLevel.createMany({
        data: Array.from({ length: 30 }, (_, i) => ({
          organizationId: orgId,
          graduationSystemId: full.id,
          name: `${tag} cheio ${i + 1}`,
          order: i + 1,
          color: '#222222',
          colors: ['#222222'],
        })),
      });
      await api().post(`/api/graduations/systems/${full.id}/levels`).set(auth(mestreToken)).send({ name: `${tag} 31`, order: 31, color: '#222222' }).expect(400);
      const first = await prisma.graduationLevel.findFirstOrThrow({ where: { graduationSystemId: full.id } });
      await api().post(`/api/graduations/levels/${first.id}/duplicate`).set(auth(mestreToken)).expect(400);
      assert.equal(await prisma.graduationLevel.count({ where: { graduationSystemId: full.id } }), 30);
    });
  });

  describe('modelos e criação a partir de modelo', () => {
    it('GET /templates devolve os modelos estáticos [{code, name, description, levels:[{name, style, colors}]}]', async () => {
      const res = await api().get('/api/graduations/templates').set(auth(mestreToken)).expect(200);
      assert.equal(res.body.length, GRADUATION_TEMPLATES.length);
      assert.ok(res.body.length >= 5);
      for (const t of res.body) {
        assert.deepEqual(Object.keys(t).sort(), ['code', 'description', 'levels', 'name']);
        assert.ok(t.levels.length > 0);
        for (const l of t.levels) assert.deepEqual(Object.keys(l).sort(), ['colors', 'name', 'style']);
      }
      await request(app.getHttpServer()).get('/api/graduations/templates').expect(401);
    });

    it('POST /systems/from-template cria sistema + níveis (ordem 1..N, style/colors) numa transação', async () => {
      const template = GRADUATION_TEMPLATES.find((t) => t.code === 'cores-classicas-10-graus');
      assert.ok(template);
      const res = await api().post('/api/graduations/systems/from-template').set(auth(mestreToken)).send({ code: template.code, name: `${tag} classico` }).expect(201);
      assert.equal(res.body.name, `${tag} classico`);
      assert.equal(res.body.levels.length, template.levels.length);
      res.body.levels.forEach((l: Record<string, unknown>, i: number) => {
        assertContract(l, 'from-template');
        assert.equal(l.order, i + 1);
        assert.equal(l.name, template.levels[i].name);
        assert.equal(l.style, template.levels[i].style);
        assert.deepEqual(l.colors, template.levels[i].colors);
      });
      const db = await prisma.graduationLevel.count({ where: { graduationSystemId: res.body.id, organizationId: orgId } });
      assert.equal(db, template.levels.length);
      // sem `name`: usa o nome do modelo
      const other = await api().post('/api/graduations/systems/from-template').set(auth(mestreToken)).send({ code: 'infantil-cores' }).expect(201);
      assert.equal(other.body.name, GRADUATION_TEMPLATES.find((t) => t.code === 'infantil-cores')?.name);
      await prisma.graduationLevel.deleteMany({ where: { graduationSystemId: other.body.id } });
      await prisma.graduationSystem.delete({ where: { id: other.body.id } });
    });

    it('modelo inexistente 404; sem code 400; ALUNO 403; nada é criado nesses casos', async () => {
      const systemsBefore = await prisma.graduationSystem.count({ where: { organizationId: orgId } });
      await api().post('/api/graduations/systems/from-template').set(auth(mestreToken)).send({ code: 'nao-existe' }).expect(404);
      await api().post('/api/graduations/systems/from-template').set(auth(mestreToken)).send({}).expect(400);
      await api().post('/api/graduations/systems/from-template').set(auth(alunoToken)).send({ code: 'divididas' }).expect(403);
      assert.equal(await prisma.graduationSystem.count({ where: { organizationId: orgId } }), systemsBefore);
    });
  });
});
