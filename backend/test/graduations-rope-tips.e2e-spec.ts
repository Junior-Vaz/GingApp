import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { GRADUATION_TEMPLATES } from '../src/interface/http/graduations/graduation-templates';
import { ALUNO_EMAIL, loginAs, MESTRE_EMAIL } from './utils/list-helpers';
import { createTestApp } from './utils/test-app';

/**
 * Corda COM PONTAS: GraduationLevel.tipStart/tipEnd (hex #RRGGBB ou null). Valida create/PATCH (hex, limpar com
 * null/'', PATCH parcial), leitura nos pontos do contrato (systems, historico, passaporte, certificados, relatorio,
 * hierarquia, export LGPD), duplicar, GET /templates e from-template. Usa sistema proprio (prefixo `tag`) e limpa
 * tudo o que cria; nao toca no demo.
 */
describe('Graduations: cordas com pontas (tipStart/tipEnd) (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const tag = `tips${Date.now()}`;

  let mestreToken: string;
  let alunoToken: string;
  let orgId: number;
  let anaId: number;
  let systemId: number;
  let graduationId: number;
  let certificateId: number;
  const ids: Record<string, number> = {};

  const api = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const createLevel = (body: object) => api().post(`/api/graduations/systems/${systemId}/levels`).set(auth(mestreToken)).send(body);
  const patch = (id: number, body: object) => api().patch(`/api/graduations/levels/${id}`).set(auth(mestreToken)).send(body);
  const tips = (l: { tipStart?: unknown; tipEnd?: unknown }) => [l.tipStart, l.tipEnd];

  before(async () => {
    app = await createTestApp();
    const m = await loginAs(app, MESTRE_EMAIL);
    mestreToken = m.token;
    orgId = m.organizationId;
    alunoToken = (await loginAs(app, ALUNO_EMAIL)).token;
    anaId = (await prisma.student.findFirstOrThrow({ where: { organizationId: orgId, user: { email: ALUNO_EMAIL } } })).id;
    systemId = (await prisma.graduationSystem.create({ data: { organizationId: orgId, name: `${tag} sistema` } })).id;
  });

  after(async () => {
    const levels = { graduationLevel: { name: { startsWith: tag } } };
    await prisma.certificate.deleteMany({ where: { studentGraduation: levels } });
    await prisma.studentGraduation.deleteMany({ where: levels });
    await prisma.graduationLevel.deleteMany({ where: { graduationSystem: { name: { startsWith: tag } } } });
    await prisma.graduationSystem.deleteMany({ where: { name: { startsWith: tag } } });
    await prisma.$disconnect();
    await app.close();
  });

  describe('create/PATCH de nivel', () => {
    it('cria com as duas pontas (normaliza #RGB e minusculo) e grava no banco', async () => {
      const res = await createLevel({ name: `${tag} cinza`, order: 1, style: 'SOLID', colors: ['#9ca3af'], tipStart: '#fa0', tipEnd: '#2563eb' }).expect(201);
      assert.deepEqual(tips(res.body), ['#FFAA00', '#2563EB']);
      assert.deepEqual([res.body.style, res.body.colors], ['SOLID', ['#9CA3AF']]);
      ids.both = res.body.id;
      const db = await prisma.graduationLevel.findUniqueOrThrow({ where: { id: ids.both } });
      assert.deepEqual([db.tipStart, db.tipEnd], ['#FFAA00', '#2563EB']);
    });

    it('as pontas sao independentes (so uma) e opcionais (null/ausente = sem ponta)', async () => {
      const onlyStart = await createLevel({ name: `${tag} so cima`, order: 2, color: '#E8DFC8', tipStart: '#16A34A' }).expect(201);
      assert.deepEqual(tips(onlyStart.body), ['#16A34A', null]);
      ids.onlyStart = onlyStart.body.id;
      const onlyEnd = await createLevel({ name: `${tag} so baixo`, order: 3, color: '#E8DFC8', tipEnd: '#FACC15', tipStart: null }).expect(201);
      assert.deepEqual(tips(onlyEnd.body), [null, '#FACC15']);
      const none = await createLevel({ name: `${tag} sem pontas`, order: 4, color: '#E8DFC8', tipStart: '', tipEnd: '' }).expect(201);
      assert.deepEqual(tips(none.body), [null, null]);
      ids.none = none.body.id;
      const db = await prisma.graduationLevel.findUniqueOrThrow({ where: { id: ids.none } });
      assert.deepEqual([db.tipStart, db.tipEnd], [null, null]);
    });

    it('rejeita (400) hex invalido e tipo errado nas pontas; nada e criado', async () => {
      const cases: Array<[string, object]> = [
        ['nome de cor', { tipStart: 'verde' }],
        ['hex curto demais', { tipEnd: '#12345' }],
        ['sem #', { tipStart: '16A34A' }],
        ['hex longo demais', { tipEnd: '#1234567' }],
        ['numero', { tipStart: 123 }],
        ['objeto', { tipEnd: { cor: '#FFFFFF' } }],
      ];
      for (const [label, body] of cases) {
        const res = await createLevel({ name: `${tag} ruim`, order: 20, color: '#E8DFC8', ...body });
        assert.equal(res.status, 400, `${label}: esperado 400, veio ${res.status}`);
      }
      assert.equal(await prisma.graduationLevel.count({ where: { name: `${tag} ruim` } }), 0);
    });

    it('PATCH parcial: mudar o corpo/nome mantem as pontas; mudar uma ponta mantem o resto; null/vazio limpa', async () => {
      const renamed = await patch(ids.both, { name: `${tag} cinza2` }).expect(200);
      assert.deepEqual(tips(renamed.body), ['#FFAA00', '#2563EB']);
      const body = await patch(ids.both, { style: 'SPLIT', colors: ['#111111', '#EEEEEE'] }).expect(200);
      assert.deepEqual([body.body.style, ...tips(body.body)], ['SPLIT', '#FFAA00', '#2563EB']);
      const oneTip = await patch(ids.both, { tipEnd: '#16a34a' }).expect(200);
      assert.deepEqual([oneTip.body.style, oneTip.body.colors, ...tips(oneTip.body)], ['SPLIT', ['#111111', '#EEEEEE'], '#FFAA00', '#16A34A']);
      const cleared = await patch(ids.both, { tipStart: null }).expect(200);
      assert.deepEqual(tips(cleared.body), [null, '#16A34A']);
      const cleared2 = await patch(ids.both, { tipEnd: '' }).expect(200);
      assert.deepEqual(tips(cleared2.body), [null, null]);
      await patch(ids.both, { tipStart: 'azul' }).expect(400);
      const db = await prisma.graduationLevel.findUniqueOrThrow({ where: { id: ids.both } });
      assert.deepEqual([db.tipStart, db.tipEnd], [null, null]);
      // volta com as duas pontas para os testes seguintes
      await patch(ids.both, { tipStart: '#FACC15', tipEnd: '#2563EB' }).expect(200);
    });

    it('RBAC: ALUNO nao altera pontas (403)', async () => {
      await api().patch(`/api/graduations/levels/${ids.both}`).set(auth(alunoToken)).send({ tipStart: '#000000' }).expect(403);
    });
  });

  describe('leitura nos pontos do contrato', () => {
    before(async () => {
      graduationId = (
        await api().post(`/api/graduations/students/${anaId}`).set(auth(mestreToken)).send({
          graduationLevelId: ids.both,
          graduatedAt: `${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })}T12:00:00.000Z`,
        }).expect(201)
      ).body.id;
      certificateId = (
        await api().post('/api/certificates').set(auth(mestreToken)).send({ studentId: anaId, title: `${tag} certificado`, studentGraduationId: graduationId }).expect(201)
      ).body.id;
    });

    it('systems, /graduations e systems/:id trazem tipStart/tipEnd em todos os niveis (null quando nao ha)', async () => {
      for (const url of ['/api/graduations/systems', '/api/graduations']) {
        const res = await api().get(url).set(auth(mestreToken)).expect(200);
        for (const s of res.body) for (const l of s.levels) assert.ok('tipStart' in l && 'tipEnd' in l, `${url}: nivel ${l.id} sem chaves das pontas`);
        const sys = res.body.find((s: { id: number }) => s.id === systemId);
        const both = sys.levels.find((l: { id: number }) => l.id === ids.both);
        assert.deepEqual(tips(both), ['#FACC15', '#2563EB']);
        assert.deepEqual(tips(sys.levels.find((l: { id: number }) => l.id === ids.none)), [null, null]);
      }
      const one = await api().get(`/api/graduations/systems/${systemId}`).set(auth(mestreToken)).expect(200);
      assert.deepEqual(tips(one.body.levels.find((l: { id: number }) => l.id === ids.onlyStart)), ['#16A34A', null]);
    });

    it('historico do aluno, passaporte e certificados trazem as pontas', async () => {
      const hist = await api().get(`/api/graduations/students/${anaId}`).set(auth(mestreToken)).expect(200);
      assert.deepEqual(tips(hist.body.find((x: { id: number }) => x.id === graduationId).graduationLevel), ['#FACC15', '#2563EB']);
      const passport = await api().get('/api/passport/me').set(auth(alunoToken)).expect(200);
      assert.deepEqual(tips(passport.body.currentGraduation), ['#FACC15', '#2563EB']);
      const mine = await api().get('/api/certificates/me').set(auth(alunoToken)).expect(200);
      const cert = mine.body.find((c: { id: number }) => c.id === certificateId);
      assert.deepEqual(tips(cert.studentGraduation.graduationLevel), ['#FACC15', '#2563EB']);
      const staff = await api().get(`/api/certificates/${certificateId}`).set(auth(mestreToken)).expect(200);
      assert.deepEqual(tips(staff.body.studentGraduation.graduationLevel), ['#FACC15', '#2563EB']);
    });

    it('relatorio byLevel, hierarquia e exportacao LGPD trazem as pontas', async () => {
      const report = await api().get('/api/reports/graduations').set(auth(mestreToken)).expect(200);
      const row = report.body.byLevel.find((l: { levelId: number }) => l.levelId === ids.both);
      assert.ok(row, 'nivel recem-graduado no relatorio');
      assert.deepEqual(tips(row), ['#FACC15', '#2563EB']);
      const hierarchy = await api().get('/api/graduations/hierarchy').set(auth(mestreToken)).expect(200);
      const text = JSON.stringify(hierarchy.body);
      assert.ok(text.includes('"tipStart"') && text.includes('"tipEnd"'), 'hierarquia sem as chaves das pontas');
      const exported = await api().get('/api/auth/me/export').set(auth(alunoToken)).expect(200);
      assert.ok(JSON.stringify(exported.body).includes('"tipStart":"#FACC15"'), 'export LGPD sem tipStart');
    });
  });

  describe('duplicar nivel', () => {
    it('a copia leva as duas pontas (e uma ponta so continua so uma)', async () => {
      const copy = await api().post(`/api/graduations/levels/${ids.both}/duplicate`).set(auth(mestreToken)).expect(201);
      assert.deepEqual(tips(copy.body), ['#FACC15', '#2563EB']);
      const db = await prisma.graduationLevel.findUniqueOrThrow({ where: { id: copy.body.id } });
      assert.deepEqual([db.tipStart, db.tipEnd], ['#FACC15', '#2563EB']);
      const copy2 = await api().post(`/api/graduations/levels/${ids.onlyStart}/duplicate`).set(auth(mestreToken)).expect(201);
      assert.deepEqual(tips(copy2.body), ['#16A34A', null]);
    });
  });

  describe('modelos com pontas', () => {
    it('GET /templates traz tipStart/tipEnd em todo nivel e inclui os 2 modelos novos', async () => {
      const res = await api().get('/api/graduations/templates').set(auth(mestreToken)).expect(200);
      assert.equal(res.body.length, GRADUATION_TEMPLATES.length);
      for (const t of res.body) for (const l of t.levels) assert.deepEqual(Object.keys(l).sort(), ['colors', 'name', 'style', 'tipEnd', 'tipStart']);
      const classic = res.body.find((t: { code: string }) => t.code === 'cordas-com-pontas-classicas');
      const byGrade = res.body.find((t: { code: string }) => t.code === 'pontas-por-graduacao');
      assert.equal(classic?.name, 'Cordas com pontas (cores clássicas)');
      assert.equal(byGrade?.name, 'Pontas por graduação');
      assert.ok(classic.levels.every((l: { tipStart: unknown; tipEnd: unknown }) => l.tipStart || l.tipEnd));
      // modelos antigos seguem sem pontas
      const simple = res.body.find((t: { code: string }) => t.code === 'infantil-cores');
      assert.ok(simple.levels.every((l: { tipStart: unknown; tipEnd: unknown }) => l.tipStart === null && l.tipEnd === null));
    });

    it('POST /systems/from-template grava as pontas do modelo (resposta e banco)', async () => {
      const template = GRADUATION_TEMPLATES.find((t) => t.code === 'pontas-por-graduacao');
      assert.ok(template);
      const res = await api().post('/api/graduations/systems/from-template').set(auth(mestreToken)).send({ code: template.code, name: `${tag} modelo pontas` }).expect(201);
      assert.equal(res.body.levels.length, template.levels.length);
      res.body.levels.forEach((l: { tipStart: unknown; tipEnd: unknown; name: string; order: number }, i: number) => {
        assert.equal(l.order, i + 1);
        assert.deepEqual(tips(l), [template.levels[i].tipStart ?? null, template.levels[i].tipEnd ?? null], l.name);
      });
      const db = await prisma.graduationLevel.findMany({ where: { graduationSystemId: res.body.id }, orderBy: { order: 'asc' } });
      assert.deepEqual(
        db.map((l) => [l.tipStart, l.tipEnd]),
        template.levels.map((l) => [l.tipStart ?? null, l.tipEnd ?? null]),
      );
    });
  });
});
