import { INestApplication } from '@nestjs/common';
import { OrganizationType, OrgRole, PrismaClient, RecordStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import sharp from 'sharp';
import request from 'supertest';
import { AnonymizationService } from '../src/interface/http/data-deletion-requests/anonymization.service';
import { TournamentsService } from '../src/interface/http/tournaments/tournaments.service';
import { createTestApp } from './utils/test-app';

/**
 * Revisao ADVERSARIAL das fotos do chaveamento: reproducoes. Teste que FALHA = bug confirmado.
 * Banco de dev + diretorio temporario de fotos; dados ficticios; limpa tudo no fim.
 */
const TAG = '[e2e-tphoto-adv]';
const PASSWORD = 'Dev@12345';
const DAY = 86_400_000;

describe('Fotos do chaveamento - revisao adversarial (e2e)', () => {
  let app: INestApplication;
  const prisma = new PrismaClient();
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const envBackup = { ...process.env };
  const orgIds: number[] = [];
  const userIds: number[] = [];
  const eventIds: number[] = [];
  let photosDir = '';
  let orgA = 0;
  let mestreToken = '';
  let mestreUserId = 0;

  const server = () => app.getHttpServer();
  const auth = () => ({ Authorization: `Bearer ${mestreToken}` });
  const post = (p: string, body?: object) => request(server()).post(`/api${p}`).set(auth()).send(body ?? {});
  const patch = (p: string, body: object) => request(server()).patch(`/api${p}`).set(auth()).send(body);
  const del = (p: string) => request(server()).delete(`/api${p}`).set(auth());
  const upload = (base: string, cid: number, id: number, buf: Buffer, filename = 'foto.jpg') =>
    request(server()).post(`/api${base}/categories/${cid}/competitors/${id}/photo`).set(auth()).attach('file', buf, { filename, contentType: 'image/jpeg' });

  const mkUser = async (orgId: number, role: OrgRole, label: string) => {
    const email = `${label}-${stamp}@e2e-tphoto-adv.local`;
    const user = await prisma.user.create({
      data: { email, passwordHash: await bcrypt.hash(PASSWORD, 4), name: `${TAG} ${label} Silva`, userType: 'MEMBER', status: 'ACTIVE' },
    });
    userIds.push(user.id);
    await prisma.organizationUser.create({ data: { organizationId: orgId, userId: user.id, role, status: 'ACTIVE' } });
    return user;
  };
  const login = async (email: string) => (await request(server()).post('/api/auth/login').send({ email, password: PASSWORD }).expect(200)).body.accessToken as string;

  const newTournament = async () => {
    const event = await prisma.event.create({
      data: { organizationId: orgA, title: `${TAG} campeonato ${stamp}`, type: 'CAMPEONATO', date: new Date(Date.now() + DAY), status: 'PUBLISHED' },
    });
    eventIds.push(event.id);
    const t = (await post(`/events/${event.id}/tournament`).expect(201)).body;
    const base = `/events/${event.id}/tournament`;
    const cat = (await post(`${base}/categories`, { name: `Cat ${Math.random().toString(36).slice(2, 8)}`, format: 'ROUND_ROBIN' }).expect(201)).body;
    return { eventId: event.id, base, tournamentId: t.id as number, token: t.publicToken as string, cid: cat.id as number };
  };
  const jpeg = (w = 200, h = 160) => sharp({ create: { width: w, height: h, channels: 3, background: '#a33' } }).jpeg().toBuffer();

  before(async () => {
    photosDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tphoto-adv-'));
    process.env.TOURNAMENT_PHOTOS_DIR = photosDir;
    app = await createTestApp({ disableThrottle: true });
    const org = await prisma.organization.create({
      data: { name: `${TAG} Grupo ${stamp}`, slug: `e2e-tphoto-adv-${stamp}`, type: OrganizationType.GROUP, status: RecordStatus.ACTIVE },
    });
    orgIds.push(org.id);
    orgA = org.id;
    const mestre = await mkUser(orgA, OrgRole.MESTRE, 'mestre');
    mestreUserId = mestre.id;
    mestreToken = await login(mestre.email);
    // segundo mestre: a anonimizacao nunca bloqueia por "ultimo mestre"
    await mkUser(orgA, OrgRole.MESTRE, 'mestre2');
  });

  after(async () => {
    process.env = { ...envBackup };
    await app.close();
    await prisma.dataDeletionRequest.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: { in: orgIds } }, { userId: { in: userIds } }] } });
    await prisma.eventParticipant.deleteMany({ where: { eventId: { in: eventIds } } });
    await prisma.event.deleteMany({ where: { id: { in: eventIds } } });
    await prisma.student.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.organizationUser.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
    fs.rmSync(photosDir, { recursive: true, force: true });
  });

  it('pipeline: JPEG com EXIF (GPS/copyright) e ICC -> arquivo gravado SEM exif/icc/xmp, webp <= 800', async () => {
    const t = await newTournament();
    const id = (await post(`${t.base}/categories/${t.cid}/competitors`, { guest: { displayName: 'Atleta Exif', ageGroup: 'ADULT' } }).expect(201)).body.competitors.at(-1).id;
    const src = await sharp({ create: { width: 1600, height: 1200, channels: 3, background: '#3a6' } })
      .withMetadata({ orientation: 6, exif: { IFD0: { Copyright: 'menor-gps', Artist: 'Fulano' }, IFD3: { GPSLatitudeRef: 'S', GPSLatitude: '23/1 32/1 0/1' } } })
      .withIccProfile('p3')
      .jpeg()
      .toBuffer();
    const srcMeta = await sharp(src).metadata();
    assert.ok(srcMeta.exif && srcMeta.icc, 'pre-condicao: a origem tem exif e icc');
    await upload(t.base, t.cid, id, src).expect(200);
    const row = await prisma.tournamentCompetitor.findUniqueOrThrow({ where: { id } });
    const stored = fs.readFileSync(path.join(photosDir, row.photoFile!));
    const meta = await sharp(stored).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.exif, undefined, 'EXIF nao pode sobrar');
    assert.equal(meta.icc, undefined, 'ICC nao pode sobrar');
    assert.equal(meta.xmp, undefined, 'XMP nao pode sobrar');
    assert.ok(Math.max(meta.width!, meta.height!) <= 800);
    // orientacao 6 aplicada: 1600x1200 vira retrato
    assert.ok(meta.height! > meta.width!, 'rotate() pela orientacao EXIF');
    assert.ok(!stored.includes(Buffer.from('menor-gps')));
  });

  it('pipeline: imagem 6000x6000 (36 MP) pequena em bytes -> 415 PHOTO_UNREADABLE e nada gravado', async () => {
    const t = await newTournament();
    const id = (await post(`${t.base}/categories/${t.cid}/competitors`, { guest: { displayName: 'Atleta Bomba', ageGroup: 'ADULT' } }).expect(201)).body.competitors.at(-1).id;
    const bomb = await sharp({ create: { width: 6000, height: 6000, channels: 3, background: '#fff' } }).png({ compressionLevel: 9 }).toBuffer();
    assert.ok(bomb.length < 5 * 1024 * 1024);
    const before = fs.readdirSync(photosDir).length;
    const res = await upload(t.base, t.cid, id, bomb, 'x.png');
    assert.equal(res.status, 415);
    assert.equal(res.body.code, 'PHOTO_UNREADABLE');
    assert.equal(fs.readdirSync(photosDir).length, before);
  });

  it('rota publica da foto: o 404 tem os mesmos cabecalhos de cache (no-store) que o 404 do snapshot', async () => {
    const t = await newTournament();
    await patch(t.base, { publicEnabled: true }).expect(200);
    const a = await request(server()).get(`/api/public/tournaments/${t.token}/photos/00000000-0000-4000-8000-000000000000.webp`);
    const b = await request(server()).get(`/api/public/tournaments/${'x'.repeat(32)}`);
    assert.equal(a.status, 404);
    assert.equal(b.status, 404);
    assert.equal(a.headers['cache-control'], 'no-store');
    assert.deepEqual(a.body, b.body);
  });

  /**
   * LGPD: participante do evento que e um USUARIO (EventParticipant.userId, sem aluno e sem inscricao de formulario) vira atleta
   * com o NOME do usuario (participantToCompetitor usa participant.user.name) e pode ter foto propria. O pedido de exclusao do
   * titular so repassa ao chaveamento `studentIds` e os `eventParticipantIds` vindos de INSCRICOES de formulario: este atleta
   * fica com nome e foto.
   */
  it('BUG LGPD: anonimizar o titular NAO anonimiza o atleta ligado a EventParticipant.userId (nome e foto ficam)', async () => {
    const t = await newTournament();
    const subject = await mkUser(orgA, OrgRole.ALUNO, 'titular');
    const participant = await prisma.eventParticipant.create({ data: { organizationId: orgA, eventId: t.eventId, userId: subject.id, status: 'CONFIRMED' } });
    const cat = (await post(`${t.base}/categories/${t.cid}/competitors`, { eventParticipantId: participant.id }).expect(201)).body;
    const comp = cat.competitors.find((c: any) => c.eventParticipantId === participant.id);
    assert.ok(comp.displayName.includes('titular'), 'pre-condicao: o atleta nasceu com o nome do usuario');
    await upload(t.base, t.cid, comp.id, await jpeg()).expect(200);
    const file = (await prisma.tournamentCompetitor.findUniqueOrThrow({ where: { id: comp.id } })).photoFile!;
    const req = await prisma.dataDeletionRequest.create({ data: { userId: subject.id, organizationId: orgA } });
    await app.get(AnonymizationService, { strict: false }).anonymizeRequest(req.id, mestreUserId);
    const after = await prisma.tournamentCompetitor.findUniqueOrThrow({ where: { id: comp.id } });
    const stillOnDisk = fs.existsSync(path.join(photosDir, file));
    // limpeza do arquivo mesmo se falhar
    if (stillOnDisk) fs.rmSync(path.join(photosDir, file), { force: true });
    assert.equal(after.displayName, 'Atleta removido', `nome do titular continua no chaveamento: "${after.displayName}"`);
    assert.equal(after.photoFile, null, 'foto propria do titular continua ligada');
    assert.equal(stillOnDisk, false, 'arquivo da foto do titular continua no disco');
  });

  /**
   * O atleta cancela a propria inscricao no evento (DELETE participante, hard delete) DEPOIS de entrar na chave: a FK
   * TournamentCompetitor.eventParticipantId e SetNull; o atleta continua no chaveamento com nome/foto e nenhum fluxo de
   * anonimizacao por participante o alcanca mais.
   */
  it('BUG LGPD: participante removido do evento -> atleta perde o vinculo e anonymizeCompetitors(eventParticipantIds) nao o acha', async () => {
    const t = await newTournament();
    const participant = await prisma.eventParticipant.create({ data: { organizationId: orgA, eventId: t.eventId, guestName: 'Convidado Fulano de Tal', status: 'CONFIRMED' } });
    const cat = (await post(`${t.base}/categories/${t.cid}/competitors`, { eventParticipantId: participant.id }).expect(201)).body;
    const comp = cat.competitors.find((c: any) => c.eventParticipantId === participant.id);
    await upload(t.base, t.cid, comp.id, await jpeg()).expect(200);
    const file = (await prisma.tournamentCompetitor.findUniqueOrThrow({ where: { id: comp.id } })).photoFile!;
    await del(`/events/${t.eventId}/participants/${participant.id}`).expect((r) => assert.ok(r.status < 300, `remove participante: ${r.status}`));
    // CORRECAO: antes de apagar a inscricao o atleta e tratado (categoria em SETUP = removido da chave junto com a foto;
    // categoria ja sorteada = anonimizado, ver tournament-photos.e2e-spec.ts). Nao pode sobrar atleta sem vinculo com nome/foto.
    const row = await prisma.tournamentCompetitor.findUnique({ where: { id: comp.id } });
    if (row?.photoFile) fs.rmSync(path.join(photosDir, row.photoFile), { force: true });
    assert.ok(row === null || (row.displayName === 'Atleta removido' && row.photoFile === null), `atleta sem vinculo continua com nome/foto: nome="${row?.displayName}"`);
    assert.equal(row, null, 'categoria em SETUP: o atleta sai da chave');
    assert.equal(fs.readdirSync(photosDir).filter((f) => f === file).length, 0, 'o arquivo da foto saiu do disco');
    const r = await app.get(TournamentsService).anonymizeCompetitors({ eventParticipantIds: [participant.id] });
    assert.equal(r.competitors, 0);
  });
});
