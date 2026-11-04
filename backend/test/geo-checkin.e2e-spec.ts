import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import request from 'supertest';
import { buildCheckinToken } from '../src/shared/checkin/checkin-token';
import { createTestApp } from './utils/test-app';
import { MESTRE_EMAIL, SecondOrg, createSecondOrg, loginAs, todaySaoPaulo } from './utils/list-helpers';
import { MeFixture, createMeFixture } from './utils/me-fixtures';

/**
 * Check-in por LOCALIZACAO (docs/CONTRATO_CHECKIN_GEOLOCALIZACAO.md): opcao da turma (criar/editar/ler/listar/me), rotas do
 * aluno (GET /attendance/geo-checkin/available e POST /attendance/geo-checkin), origem da presenca (QR/GEO/null na chamada),
 * PROVA de privacidade (as coordenadas enviadas nao aparecem em banco, auditoria nem log) e throttle por usuario.
 * Turmas/aulas/unidade proprias, removidas no after().
 */
const METERS_PER_DEGREE = (6371 * 1000 * Math.PI) / 180; // 1 grau de latitude na haversine (R = 6371 km)
const BASE = { latitude: -23.55, longitude: -46.63 }; // local proprio da turma
const UNIT_POINT = { latitude: -22.9, longitude: -43.17 }; // local da unidade (outra cidade)
const northOf = (p: { latitude: number; longitude: number }, meters: number) => ({
  latitude: p.latitude + meters / METERS_PER_DEGREE,
  longitude: p.longitude,
});

describe('Check-in por localização (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  let fx: MeFixture;
  let orgB: SecondOrg;
  let mestreToken: string;
  let unitId: number;
  const apiClassIds: number[] = [];
  const extraClassIds: number[] = [];
  const lessonIds: number[] = [];
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const geo = (token: string, body: Record<string, unknown>) => http().post('/api/attendance/geo-checkin').set(auth(token)).send(body);
  const available = (token: string) => http().get('/api/attendance/geo-checkin/available').set(auth(token));

  const makeLesson = async (classId: number, dayOffset = 0, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') => {
    const l = await prisma.lesson.create({
      data: { organizationId: fx.organizationId, classId, date: new Date(`${todaySaoPaulo(dayOffset)}T00:00:00.000Z`), status },
    });
    lessonIds.push(l.id);
    return l;
  };
  /** Turma extra (fora da fixture) com o aluno "self" matriculado. */
  const makeClass = async (data: Record<string, unknown>) => {
    const c = await prisma.class.create({ data: { organizationId: fx.organizationId, name: `[e2e-geo] ${Date.now()}`, ...data } });
    extraClassIds.push(c.id);
    await prisma.classStudent.create({ data: { organizationId: fx.organizationId, classId: c.id, studentId: fx.self.studentId } });
    return c;
  };
  const attendanceOf = (lessonId: number, studentId: number) =>
    prisma.attendance.findUnique({ where: { lessonId_studentId: { lessonId, studentId } } });

  before(async () => {
    app = await createTestApp();
    fx = await createMeFixture(app, prisma, 'geo');
    orgB = await createSecondOrg(app, prisma, 'geo');
    mestreToken = (await loginAs(app, MESTRE_EMAIL)).token;
    unitId = (
      await prisma.unit.create({ data: { organizationId: fx.organizationId, name: '[e2e-geo] unidade', ...UNIT_POINT } })
    ).id;
    // Turma da fixture (self + dependente matriculados): opcao ligada, local PROPRIO, raio padrao 150.
    await prisma.class.update({ where: { id: fx.classMineId }, data: { ...BASE, geoCheckinEnabled: true } });
    // Turma alheia (so o "stranger"): ligada, para provar que nao-matriculado nao ve nem registra.
    await prisma.class.update({ where: { id: fx.classOtherId }, data: { ...BASE, geoCheckinEnabled: true } });
  });

  after(async () => {
    const classIds = [...apiClassIds, ...extraClassIds];
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { action: { in: ['ATTENDANCE_GEO_CHECKIN', 'LESSON_CHECKIN_SELF'] }, resourceId: { in: lessonIds.map(String) } },
          { resource: 'class', resourceId: { in: classIds.map(String) } },
        ],
      },
    });
    await prisma.attendance.deleteMany({ where: { lessonId: { in: lessonIds } } });
    await prisma.lesson.deleteMany({ where: { id: { in: lessonIds } } });
    await prisma.lesson.deleteMany({ where: { classId: { in: classIds } } });
    await prisma.classStudent.deleteMany({ where: { classId: { in: classIds } } });
    await prisma.class.deleteMany({ where: { id: { in: classIds } } });
    await fx.cleanup();
    await prisma.unit.deleteMany({ where: { id: unitId } });
    await orgB.cleanup();
    await prisma.$disconnect();
    await app.close();
  });

  describe('turma: geoCheckinEnabled / geoCheckinRadiusMeters / geoCheckinLocation', () => {
    const create = (body: Record<string, unknown>) => http().post('/api/classes').set(auth(mestreToken)).send(body);
    const patch = (id: number, body: Record<string, unknown>) => http().patch(`/api/classes/${id}`).set(auth(mestreToken)).send(body);

    it('ligar sem local (nem da turma nem da unidade) = 400 GEO_CHECKIN_NO_LOCATION; nada é criado', async () => {
      const before = await prisma.class.count({ where: { organizationId: fx.organizationId } });
      const res = await create({ name: '[e2e-geo] sem local', geoCheckinEnabled: true }).expect(400);
      assert.equal(res.body.code, 'GEO_CHECKIN_NO_LOCATION');
      assert.equal(res.body.message, 'Defina o local da turma (ou da unidade) antes de ligar o check-in por localização.');
      assert.equal(await prisma.class.count({ where: { organizationId: fx.organizationId } }), before);
    });

    it('padrão desligado/150/null; com local próprio => CLASS; só com o da unidade => UNIT (unit sem coordenadas na resposta)', async () => {
      const plain = await create({ name: '[e2e-geo] padrao' }).expect(201);
      apiClassIds.push(plain.body.id);
      assert.equal(plain.body.geoCheckinEnabled, false);
      assert.equal(plain.body.geoCheckinRadiusMeters, 150);
      assert.equal(plain.body.geoCheckinLocation, null);

      const own = await create({ name: '[e2e-geo] propria', ...BASE, geoCheckinEnabled: true, geoCheckinRadiusMeters: 200 }).expect(201);
      apiClassIds.push(own.body.id);
      assert.equal(own.body.geoCheckinEnabled, true);
      assert.equal(own.body.geoCheckinRadiusMeters, 200);
      assert.equal(own.body.geoCheckinLocation, 'CLASS');

      const viaUnit = await create({ name: '[e2e-geo] da unidade', unitId, geoCheckinEnabled: true }).expect(201);
      apiClassIds.push(viaUnit.body.id);
      assert.equal(viaUnit.body.geoCheckinLocation, 'UNIT');
      assert.deepEqual(viaUnit.body.unit, { id: unitId, name: '[e2e-geo] unidade', photo: null }, 'unit continua {id,name,photo}');

      // ler, listar (paginado) e as "minhas turmas" (/classes/me) trazem os 3 campos
      const one = await http().get(`/api/classes/${viaUnit.body.id}`).set(auth(mestreToken)).expect(200);
      assert.deepEqual([one.body.geoCheckinEnabled, one.body.geoCheckinRadiusMeters, one.body.geoCheckinLocation], [true, 150, 'UNIT']);
      const list = await http().get('/api/classes?q=%5Be2e-geo%5D%20propria').set(auth(mestreToken)).expect(200);
      const item = list.body.find((c: { id: number }) => c.id === own.body.id);
      assert.deepEqual([item.geoCheckinEnabled, item.geoCheckinRadiusMeters, item.geoCheckinLocation], [true, 200, 'CLASS']);
      assert.ok('nextLesson' in item, 'lista continua com nextLesson');
      const mine = await http().get('/api/classes/me').set(auth(fx.self.token)).expect(200);
      const mineItem = mine.body.find((c: { id: number }) => c.id === fx.classMineId);
      assert.deepEqual([mineItem.geoCheckinEnabled, mineItem.geoCheckinRadiusMeters, mineItem.geoCheckinLocation], [true, 150, 'CLASS']);
      console.log('[exemplo] turma:', JSON.stringify(own.body));
    });

    it('raio fora de 50..500 ou não inteiro = 400; null/booleano inválido = 400', async () => {
      for (const geoCheckinRadiusMeters of [49, 501, 150.5, '150']) {
        await create({ name: '[e2e-geo] raio', geoCheckinRadiusMeters }).expect(400);
      }
      await create({ name: '[e2e-geo] liga', geoCheckinEnabled: 'sim' }).expect(400);
      const ok = await create({ name: '[e2e-geo] raio ok', geoCheckinRadiusMeters: 50 }).expect(201);
      apiClassIds.push(ok.body.id);
      await patch(ok.body.id, { geoCheckinRadiusMeters: 500 }).expect(200);
      await patch(ok.body.id, { geoCheckinRadiusMeters: null }).expect(400);
      await patch(ok.body.id, { geoCheckinEnabled: null }).expect(400);
    });

    it('edição: ligar sem local = 400; remover o último local de turma ligada = 400; trocar p/ o da unidade ok; desligar ok', async () => {
      const c = await create({ name: '[e2e-geo] edicao' }).expect(201);
      apiClassIds.push(c.body.id);
      assert.equal((await patch(c.body.id, { geoCheckinEnabled: true }).expect(400)).body.code, 'GEO_CHECKIN_NO_LOCATION');

      const on = await patch(c.body.id, { ...BASE, geoCheckinEnabled: true }).expect(200);
      assert.equal(on.body.geoCheckinLocation, 'CLASS');
      // só renomear a turma ligada: não é barrado
      await patch(c.body.id, { name: '[e2e-geo] edicao 2' }).expect(200);
      // limpar as coordenadas próprias sem unidade => ficaria ligada sem local
      assert.equal((await patch(c.body.id, { latitude: null, longitude: null }).expect(400)).body.code, 'GEO_CHECKIN_NO_LOCATION');
      assert.equal((await prisma.class.findUniqueOrThrow({ where: { id: c.body.id } })).latitude, BASE.latitude, 'nada gravado no 400');
      // com a unidade (que tem local) a remoção passa e o local vem da unidade
      const toUnit = await patch(c.body.id, { latitude: null, longitude: null, unitId }).expect(200);
      assert.equal(toUnit.body.geoCheckinLocation, 'UNIT');
      // tirar a unidade deixaria sem local
      assert.equal((await patch(c.body.id, { unitId: null }).expect(400)).body.code, 'GEO_CHECKIN_NO_LOCATION');
      // desligar e tirar o local na mesma edição: aceito
      const off = await patch(c.body.id, { unitId: null, geoCheckinEnabled: false }).expect(200);
      assert.deepEqual([off.body.geoCheckinEnabled, off.body.geoCheckinLocation], [false, null]);
    });
  });

  describe('aluno: available e geo-checkin', () => {
    it('available: só aula ATIVA na janela, turma ligada com local e matrícula ATIVA; sem coordenadas', async () => {
      const today = await makeLesson(fx.classMineId);
      await makeLesson(fx.classMineId, -3); // fora da janela
      await makeLesson(fx.classMineId, 3); // fora da janela
      await makeLesson(fx.classMineId, 0, 'INACTIVE'); // cancelada
      await makeLesson(fx.classOtherId); // turma em que não está matriculado
      const off = await makeClass({ ...BASE, geoCheckinEnabled: false });
      await makeLesson(off.id);
      const noLoc = await makeClass({ geoCheckinEnabled: true }); // ligada no banco, mas sem local
      await makeLesson(noLoc.id);

      const self = await available(fx.self.token).expect(200);
      assert.equal(self.body.length, 1, JSON.stringify(self.body));
      const [opt] = self.body;
      assert.deepEqual(Object.keys(opt).sort(), [
        'alreadyCheckedIn', 'className', 'closesAt', 'date', 'endTime', 'lessonId', 'opensAt', 'radiusMeters', 'startTime', 'studentId', 'studentName',
      ]);
      assert.equal(opt.lessonId, today.id);
      assert.equal(opt.studentId, fx.self.studentId);
      assert.equal(opt.radiusMeters, 150);
      assert.equal(opt.alreadyCheckedIn, false);
      const text = JSON.stringify(self.body);
      assert.ok(!/latitude|longitude|-23\.55|-46\.63/.test(text), 'nunca devolve coordenadas');
      console.log('[exemplo] available:', text);

      // responsável vê o dependente; órfão (sem aluno) e outro grupo: vazio
      const guardian = await available(fx.guardian.token).expect(200);
      assert.deepEqual(guardian.body.map((o: { studentId: number }) => o.studentId), [fx.guardian.dependentId]);
      assert.deepEqual((await available(fx.orphan.token).expect(200)).body, []);
      assert.deepEqual((await available(orgB.token).expect(200)).body, []);
      await http().get('/api/attendance/geo-checkin/available').expect(401);
    });

    it('dentro do raio: 200 + presença GEO + auditoria só com distância + aviso; repetir é idempotente', async () => {
      const lesson = await makeLesson(fx.classMineId);
      const pos = northOf(BASE, 120);
      const ok = await geo(fx.self.token, { lessonId: lesson.id, ...pos, accuracyMeters: 20 }).expect(200);
      assert.deepEqual(ok.body, { lessonId: lesson.id, studentId: fx.self.studentId, present: true, alreadyCheckedIn: false, distanceMeters: 120 });
      console.log('[exemplo] geo-checkin sucesso:', JSON.stringify(ok.body));
      const row = await attendanceOf(lesson.id, fx.self.studentId);
      assert.equal(row?.present, true);
      assert.equal(row?.checkinSource, 'GEO');
      const audits = await prisma.auditLog.findMany({ where: { action: 'ATTENDANCE_GEO_CHECKIN', resourceId: String(lesson.id) } });
      assert.equal(audits.length, 1);
      assert.equal(audits[0].userId, fx.self.userId);
      assert.equal(audits[0].resource, 'lesson');
      assert.deepEqual(audits[0].metadata, {
        studentId: fx.self.studentId, classId: fx.classMineId, distanceMeters: 120, radiusMeters: 150, hadAbsence: false,
      });
      assert.equal(
        await prisma.notification.count({ where: { userId: fx.self.userId, type: 'ATTENDANCE_PRESENT' } }),
        1,
        'aviso "Presença registrada"',
      );
      const notices = await prisma.attendanceNotice.count({ where: { lessonId: lesson.id, studentId: fx.self.studentId } });
      assert.equal(notices, 1);

      const again = await geo(fx.self.token, { lessonId: lesson.id, ...pos }).expect(200);
      assert.equal(again.body.alreadyCheckedIn, true);
      assert.equal(await prisma.auditLog.count({ where: { action: 'ATTENDANCE_GEO_CHECKIN', resourceId: String(lesson.id) } }), 1);
      assert.equal(await prisma.attendanceNotice.count({ where: { lessonId: lesson.id, studentId: fx.self.studentId } }), 1);
      const avail = (await available(fx.self.token).expect(200)).body.find((o: { lessonId: number }) => o.lessonId === lesson.id);
      assert.equal(avail.alreadyCheckedIn, true);

      // borda: exatamente no raio (150 m) passa
      const edge = await makeLesson(fx.classMineId);
      const res = await geo(fx.guardian.token, { lessonId: edge.id, ...northOf(BASE, 150), studentId: fx.guardian.dependentId }).expect(200);
      assert.equal(res.body.distanceMeters, 150);
    });

    it('fora do raio = 403 GEO_TOO_FAR com distância/raio (sem coordenadas); precisão ruim = 400 GEO_ACCURACY_LOW', async () => {
      const lesson = await makeLesson(fx.classMineId);
      const far = northOf(BASE, 320);
      const res = await geo(fx.guardian.token, { lessonId: lesson.id, ...far, studentId: fx.guardian.dependentId }).expect(403);
      assert.equal(res.body.code, 'GEO_TOO_FAR');
      assert.equal(res.body.distanceMeters, 320);
      assert.equal(res.body.radiusMeters, 150);
      assert.match(res.body.message, /320 m/);
      assert.ok(!res.text.includes(String(far.latitude).slice(0, 8)), 'erro não repete a coordenada');
      console.log('[exemplo] geo-checkin GEO_TOO_FAR:', res.text);
      // 151 m: estrito
      assert.equal((await geo(fx.self.token, { lessonId: lesson.id, ...northOf(BASE, 151) }).expect(403)).body.code, 'GEO_TOO_FAR');
      assert.equal(await attendanceOf(lesson.id, fx.guardian.dependentId), null, 'nada gravado');

      // precisão: max(100, raio=150) = 150 aceita; 151 recusa
      const low = await geo(fx.self.token, { lessonId: lesson.id, ...BASE, accuracyMeters: 151 }).expect(400);
      assert.equal(low.body.code, 'GEO_ACCURACY_LOW');
      assert.equal(low.body.message, 'Sinal de GPS fraco. Vá para um lugar aberto e tente de novo.');
      await geo(fx.self.token, { lessonId: lesson.id, ...BASE, accuracyMeters: 150 }).expect(200);
    });

    it('local só da unidade: a distância é medida até a unidade', async () => {
      const c = await makeClass({ unitId, geoCheckinEnabled: true, geoCheckinRadiusMeters: 300 });
      const lesson = await makeLesson(c.id);
      assert.equal((await geo(fx.self.token, { lessonId: lesson.id, ...BASE }).expect(403)).body.code, 'GEO_TOO_FAR');
      const ok = await geo(fx.self.token, { lessonId: lesson.id, ...northOf(UNIT_POINT, 250) }).expect(200);
      assert.equal(ok.body.distanceMeters, 250);
    });

    it('erros: janela 409, desligada 403, cancelada 409, sem local 409, outro grupo 404, não matriculado/dependente alheio 403, corpo inválido 400', async () => {
      const past = await makeLesson(fx.classMineId, -3);
      const outside = await geo(fx.self.token, { lessonId: past.id, ...BASE }).expect(409);
      assert.equal(outside.body.code, 'OUTSIDE_WINDOW');
      assert.match(outside.body.message, /^O check-in desta aula encerrou em /);

      const off = await makeClass({ ...BASE, geoCheckinEnabled: false });
      assert.equal((await geo(fx.self.token, { lessonId: (await makeLesson(off.id)).id, ...BASE }).expect(403)).body.code, 'GEO_CHECKIN_DISABLED');

      const cancelled = await makeLesson(fx.classMineId, 0, 'INACTIVE');
      assert.equal((await geo(fx.self.token, { lessonId: cancelled.id, ...BASE }).expect(409)).body.code, 'LESSON_CANCELLED');

      const noLoc = await makeClass({ geoCheckinEnabled: true });
      assert.equal((await geo(fx.self.token, { lessonId: (await makeLesson(noLoc.id)).id, ...BASE }).expect(409)).body.code, 'GEO_NO_LOCATION');

      const lesson = await makeLesson(fx.classMineId);
      await geo(orgB.token, { lessonId: lesson.id, ...BASE }).expect(404);
      await geo(fx.self.token, { lessonId: 999999999, ...BASE }).expect(404);

      const other = await makeLesson(fx.classOtherId);
      assert.equal((await geo(fx.self.token, { lessonId: other.id, ...BASE }).expect(403)).body.message, 'Você não está matriculado na turma desta aula.');
      // dependente de OUTRO usuário
      assert.equal(
        (await geo(fx.self.token, { lessonId: lesson.id, ...BASE, studentId: fx.guardian.dependentId }).expect(403)).body.message,
        'Você só pode fazer check-in de si mesmo ou dos seus dependentes.',
      );
      await geo(fx.self.token, { lessonId: lesson.id, ...BASE, studentId: fx.strangerId }).expect(403);

      // validação: campo extra, faixa, ausência — nenhuma mensagem repete o valor enviado
      await geo(fx.self.token, { lessonId: lesson.id, ...BASE, extra: 1 }).expect(400);
      const badLat = await geo(fx.self.token, { lessonId: lesson.id, latitude: 91.123456, longitude: -46.6 }).expect(400);
      assert.ok(!badLat.text.includes('91.123456'), badLat.text);
      await geo(fx.self.token, { lessonId: lesson.id, latitude: -23.5, longitude: 180.5 }).expect(400);
      await geo(fx.self.token, { lessonId: lesson.id, latitude: -23.5 }).expect(400);
      await geo(fx.self.token, { lessonId: lesson.id, ...BASE, accuracyMeters: 100001 }).expect(400);
      await geo(fx.self.token, { lessonId: lesson.id, ...BASE, accuracyMeters: -1 }).expect(400);
      await http().post('/api/attendance/geo-checkin').send({ lessonId: lesson.id, ...BASE }).expect(401);
      assert.equal(await attendanceOf(lesson.id, fx.self.studentId), null);
    });
  });

  describe('origem da presença (checkinSource)', () => {
    it('chamada lê checkinSource; reenviar igual mantém; o professor ajustar zera; GEO de novo converte a falta', async () => {
      const lesson = await makeLesson(fx.classMineId);
      await geo(fx.self.token, { lessonId: lesson.id, ...BASE }).expect(200);
      const roster = async () =>
        (await http().get(`/api/attendance/lessons/${lesson.id}`).set(auth(mestreToken)).expect(200)).body as Array<Record<string, unknown>>;
      const selfRow = (rows: Array<Record<string, unknown>>) => rows.find((r) => r.studentId === fx.self.studentId);
      const rows = await roster();
      const geoRow = selfRow(rows);
      assert.equal(geoRow?.checkinSource, 'GEO');
      const depRow = rows.find((r) => r.studentId === fx.guardian.dependentId);
      assert.deepEqual([depRow?.present, depRow?.checkinSource], [null, null], 'sem registro: checkinSource null');
      console.log('[exemplo] linha da chamada:', JSON.stringify(geoRow));

      // o painel salva todos com decisão: a linha IGUAL mantém a origem
      const mark = (entries: unknown[]) => http().post(`/api/attendance/lessons/${lesson.id}`).set(auth(mestreToken)).send(entries).expect(201);
      await mark([{ studentId: fx.self.studentId, present: true }, { studentId: fx.guardian.dependentId, present: false }]);
      assert.equal((await attendanceOf(lesson.id, fx.self.studentId))?.checkinSource, 'GEO');
      assert.equal((await attendanceOf(lesson.id, fx.guardian.dependentId))?.checkinSource, null);
      // o professor AJUSTA (falta): origem volta a null
      await mark([{ studentId: fx.self.studentId, present: false, justification: 'saiu cedo' }]);
      const adjusted = await attendanceOf(lesson.id, fx.self.studentId);
      assert.deepEqual([adjusted?.present, adjusted?.checkinSource], [false, null]);
      assert.equal(selfRow(await roster())?.checkinSource, null);

      // check-in GEO de novo: vira presença GEO (hadAbsence: true)
      const again = await geo(fx.self.token, { lessonId: lesson.id, ...BASE }).expect(200);
      assert.equal(again.body.alreadyCheckedIn, false);
      const row = await attendanceOf(lesson.id, fx.self.studentId);
      assert.deepEqual([row?.present, row?.checkinSource, row?.justification], [true, 'GEO', null]);
      const audits = await prisma.auditLog.findMany({ where: { action: 'ATTENDANCE_GEO_CHECKIN', resourceId: String(lesson.id) }, orderBy: { id: 'asc' } });
      assert.deepEqual(audits.map((a) => (a.metadata as { hadAbsence: boolean }).hadAbsence), [false, true]);

      // ajustar a justificativa de uma presença GEO também é ajuste
      await mark([{ studentId: fx.self.studentId, present: true, justification: 'ok' }]);
      assert.equal((await attendanceOf(lesson.id, fx.self.studentId))?.checkinSource, null);
    });

    it('QR continua funcionando e grava QR; QR que só confirma uma presença GEO não troca a origem', async () => {
      const lesson = await makeLesson(fx.classMineId);
      const token = buildCheckinToken('L', lesson.id, fx.organizationId);
      const qr = await http().post('/api/attendance/self-checkin').set(auth(fx.self.token)).send({ token }).expect(200);
      assert.deepEqual(qr.body, { lessonId: lesson.id, studentId: fx.self.studentId, present: true, alreadyCheckedIn: false });
      assert.equal((await attendanceOf(lesson.id, fx.self.studentId))?.checkinSource, 'QR');
      const qrAudit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'LESSON_CHECKIN_SELF', resourceId: String(lesson.id) } });
      assert.deepEqual(qrAudit.metadata, { studentId: fx.self.studentId, classId: fx.classMineId, via: 'qr', hadAbsence: false });
      // GEO depois do QR: idempotente, origem fica QR
      assert.equal((await geo(fx.self.token, { lessonId: lesson.id, ...BASE }).expect(200)).body.alreadyCheckedIn, true);
      assert.equal((await attendanceOf(lesson.id, fx.self.studentId))?.checkinSource, 'QR');

      // GEO primeiro, QR depois: continua GEO
      const lesson2 = await makeLesson(fx.classMineId);
      await geo(fx.self.token, { lessonId: lesson2.id, ...BASE }).expect(200);
      const confirm = await http()
        .post('/api/attendance/self-checkin')
        .set(auth(fx.self.token))
        .send({ token: buildCheckinToken('L', lesson2.id, fx.organizationId) })
        .expect(200);
      assert.equal(confirm.body.alreadyCheckedIn, true);
      assert.equal((await attendanceOf(lesson2.id, fx.self.studentId))?.checkinSource, 'GEO');
    });
  });

  describe('privacidade e limite de uso', () => {
    it('PROVA: as coordenadas/precisão enviadas não aparecem em NENHUMA tabela, na auditoria nem no log de requisição', async () => {
      // valores com dígitos distintivos, dentro do raio (~98 m) e fora (~3 km)
      const sent = { latitude: -23.5491234, longitude: -46.6301234, accuracyMeters: 17.4321 };
      const farSent = { latitude: -23.5234567, longitude: -46.6345678, accuracyMeters: 18.8765 };
      const needles = ['23.5491234', '46.6301234', '17.4321', '23.5234567', '46.6345678', '18.8765'];
      const lesson = await makeLesson(fx.classMineId);

      const captured: string[] = [];
      const out = process.stdout.write.bind(process.stdout);
      const err = process.stderr.write.bind(process.stderr);
      const previousLog = process.env.REQUEST_LOG;
      process.env.REQUEST_LOG = 'true';
      process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
        captured.push(String(chunk));
        return (out as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof process.stdout.write;
      process.stderr.write = ((chunk: unknown, ...rest: unknown[]) => {
        captured.push(String(chunk));
        return (err as (...a: unknown[]) => boolean)(chunk, ...rest);
      }) as typeof process.stderr.write;
      let okRes: request.Response;
      let farRes: request.Response;
      try {
        farRes = await geo(fx.self.token, { lessonId: lesson.id, ...farSent }).expect(403);
        okRes = await geo(fx.self.token, { lessonId: lesson.id, ...sent }).expect(200);
      } finally {
        process.stdout.write = out as typeof process.stdout.write;
        process.stderr.write = err as typeof process.stderr.write;
        if (previousLog === undefined) delete process.env.REQUEST_LOG;
        else process.env.REQUEST_LOG = previousLog;
      }
      const logText = captured.join('');
      assert.ok(logText.includes('"route":"/api/attendance/geo-checkin"'), `o log de requisição foi capturado: ${logText.slice(0, 300)}`);
      for (const n of needles) {
        assert.ok(!logText.includes(n), `log contém ${n}`);
        assert.ok(!okRes.text.includes(n) && !farRes.text.includes(n), `resposta repete ${n}`);
      }
      assert.equal(okRes.body.distanceMeters, 98);

      // auditoria: nenhuma linha (de nenhuma ação) tem os valores no metadata
      for (const n of needles) {
        const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
          `SELECT count(*)::bigint AS n FROM "AuditLog" WHERE metadata::text LIKE $1`,
          `%${n}%`,
        );
        assert.equal(Number(rows[0].n), 0, `AuditLog.metadata contém ${n}`);
      }
      // banco inteiro: TODAS as tabelas do schema public, linha a linha como JSON
      const tables = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
      );
      assert.ok(tables.length > 30, `tabelas: ${tables.length}`);
      // controle positivo: a mesma busca ACHA um valor que sabidamente está no banco (o nome da unidade criada aqui)
      const control = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
        `SELECT count(*)::bigint AS n FROM "Unit" t WHERE row_to_json(t)::text LIKE $1`,
        '%[e2e-geo] unidade%',
      );
      assert.equal(Number(control[0].n), 1, 'a varredura por row_to_json encontra o que existe');
      console.log(`[privacidade] ${tables.length} tabelas varridas x ${needles.length} valores: 0 ocorrências`);
      for (const { table_name } of tables) {
        for (const n of needles) {
          const rows = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>(
            `SELECT count(*)::bigint AS n FROM "${table_name}" t WHERE row_to_json(t)::text LIKE $1`,
            `%${n}%`,
          );
          assert.equal(Number(rows[0].n), 0, `${table_name} contém ${n}`);
        }
      }
      // a auditoria desse check-in tem SÓ estas chaves
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'ATTENDANCE_GEO_CHECKIN', resourceId: String(lesson.id) } });
      assert.deepEqual(Object.keys(audit.metadata as object).sort(), ['classId', 'distanceMeters', 'hadAbsence', 'radiusMeters', 'studentId']);
    });

    it('throttle: 429 TOO_MANY_REQUESTS por USUÁRIO (outro usuário do mesmo IP segue livre)', async () => {
      const lesson = await makeLesson(fx.classOtherId); // o órfão não está matriculado: 403 até estourar
      process.env.GEO_CHECKIN_THROTTLE_LIMIT = '2';
      try {
        await geo(fx.orphan.token, { lessonId: lesson.id, ...BASE }).expect(403);
        await geo(fx.orphan.token, { lessonId: lesson.id, ...BASE }).expect(403);
        const limited = await geo(fx.orphan.token, { lessonId: lesson.id, ...BASE }).expect(429);
        assert.equal(limited.body.code, 'TOO_MANY_REQUESTS');
        assert.equal(limited.body.message, 'Muitas tentativas. Aguarde um minuto.');
        // mesmo IP (127.0.0.1), outro usuário: não bloqueado
        await geo(orgB.token, { lessonId: lesson.id, ...BASE }).expect(404);
      } finally {
        process.env.GEO_CHECKIN_THROTTLE_LIMIT = '1000';
      }
    });
  });
});
