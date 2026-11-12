import 'reflect-metadata';
import { HttpStatus, PayloadTooLargeException } from '@nestjs/common';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { after, afterEach, before, describe, it } from 'node:test';
import { lastValueFrom, of, throwError } from 'rxjs';
import sharp from 'sharp';
import {
  tournamentAnonReconcileEnabled,
  tournamentPhotosBootWarnings,
  tournamentPhotosGcMode,
  tournamentPhotosPurgeMode,
} from '../src/jobs/tournament-photos-cron.service';
import {
  assertTournamentPhotosDirSafe,
  deleteTournamentPhotoFiles,
  isTournamentPhotoFile,
  processTournamentPhoto,
  resolveTournamentPhotosDir,
  setTournamentPhotoSharpForTests,
  storeTournamentPhoto,
  TOURNAMENT_PHOTO_CONCURRENCY,
  TOURNAMENT_PHOTO_QUEUE_MAX,
  tournamentPhotoPath,
  tournamentPhotosQuotaBytes,
} from '../src/interface/http/tournaments/tournament-photo-storage';
import { UserThrottlerGuard } from '../src/shared/guards/user-throttler.guard';
import { TournamentsController } from '../src/interface/http/tournaments/tournaments.controller';
import { TournamentPhotoUploadErrorInterceptor } from '../src/interface/http/tournaments/tournament-photo-upload.interceptor';
import { ownPhotoPublicPath } from '../src/interface/http/tournaments/tournament-rules';
import { buildRequestLogLine } from '../src/shared/observability/request-log.middleware';

/**
 * Foto propria do atleta de fora do chaveamento (docs/CONTRATO_FOTO_UPLOAD_CAMERA.md 1), regras PURAS e pipeline de imagem
 * (sem banco, sem HTTP): nome seguro do arquivo, diretorio privado, magic bytes, sharp obrigatorio, EXIF/orientacao, bomba de
 * pixels, semaforo, gravacao 0600/wx, apagar com seguranca, modos dos jobs e o 413 do contrato. O fluxo HTTP e os jobs com
 * banco: tournament-photos.e2e-spec.ts.
 */

const UUID = '3f2b8a52-6c1d-4c6e-9d3a-1b2c3d4e5f60';

describe('nome e caminho do arquivo (sem path traversal)', () => {
  it('só <uuid minúsculo>.webp é nome válido', () => {
    assert.equal(isTournamentPhotoFile(`${UUID}.webp`), true);
    for (const bad of [
      '', 'a.webp', `${UUID}.jpg`, `${UUID}.WEBP`, `${UUID.toUpperCase()}.webp`, `../${UUID}.webp`, `..\\${UUID}.webp`, `/${UUID}.webp`,
      `${UUID}.webp\0`, `${UUID}.webp `, ` ${UUID}.webp`, `${UUID}.webp/..`, `sub/${UUID}.webp`, '../../etc/passwd', `${UUID}.webp.exe`, `${UUID}%2e.webp`,
    ]) {
      assert.equal(isTournamentPhotoFile(bad), false, JSON.stringify(bad));
    }
    assert.equal(isTournamentPhotoFile(undefined), false);
    assert.equal(isTournamentPhotoFile(5), false);
  });

  it('tournamentPhotoPath fica DENTRO do diretório; nome inválido = null', () => {
    const base = path.resolve(os.tmpdir(), 'tp-base');
    const full = tournamentPhotoPath(`${UUID}.webp`, base);
    assert.equal(full, path.join(base, `${UUID}.webp`));
    assert.equal(tournamentPhotoPath(`../${UUID}.webp`, base), null);
    assert.equal(tournamentPhotoPath('..', base), null);
    assert.equal(tournamentPhotoPath(`${UUID}.webp`, base)?.startsWith(base + path.sep), true);
  });

  it('URL pública da foto é montada do token e do nome', () => {
    assert.equal(ownPhotoPublicPath('TOK', `${UUID}.webp`), `/api/public/tournaments/TOK/photos/${UUID}.webp`);
  });
});

describe('diretório e cota', () => {
  const backup = { ...process.env };
  afterEach(() => {
    for (const k of ['TOURNAMENT_PHOTOS_DIR', 'PRIVATE_UPLOADS_DIR', 'UPLOADS_DIR', 'TOURNAMENT_PHOTOS_QUOTA_MB']) {
      if (backup[k] === undefined) delete process.env[k];
      else process.env[k] = backup[k];
    }
  });

  it('padrão = <PRIVATE_UPLOADS_DIR>/tournament-photos; TOURNAMENT_PHOTOS_DIR sobrescreve', () => {
    const env = { PRIVATE_UPLOADS_DIR: path.join(os.tmpdir(), 'priv') } as NodeJS.ProcessEnv;
    assert.equal(resolveTournamentPhotosDir(env), path.join(path.resolve(os.tmpdir(), 'priv'), 'tournament-photos'));
    assert.equal(resolveTournamentPhotosDir({ ...env, TOURNAMENT_PHOTOS_DIR: path.join(os.tmpdir(), 'fotos') }), path.resolve(os.tmpdir(), 'fotos'));
  });

  it('o boot recusa diretório dentro de UPLOADS_DIR, igual ao privado dos formulários ou numa pasta org-<n>', () => {
    const uploads = path.join(os.tmpdir(), 'tp-uploads');
    const priv = path.join(os.tmpdir(), 'tp-private');
    process.env.UPLOADS_DIR = uploads;
    assert.throws(() => assertTournamentPhotosDirSafe({ ...process.env, PRIVATE_UPLOADS_DIR: priv, TOURNAMENT_PHOTOS_DIR: path.join(uploads, 'fotos') }), /UPLOADS_DIR/);
    assert.throws(() => assertTournamentPhotosDirSafe({ ...process.env, PRIVATE_UPLOADS_DIR: priv, TOURNAMENT_PHOTOS_DIR: uploads }), /UPLOADS_DIR/);
    assert.throws(() => assertTournamentPhotosDirSafe({ ...process.env, PRIVATE_UPLOADS_DIR: priv, TOURNAMENT_PHOTOS_DIR: priv }), /PRIVATE_UPLOADS_DIR/);
    assert.throws(() => assertTournamentPhotosDirSafe({ ...process.env, PRIVATE_UPLOADS_DIR: priv, TOURNAMENT_PHOTOS_DIR: path.join(priv, 'org-7') }), /PRIVATE_UPLOADS_DIR/);
    assert.doesNotThrow(() => assertTournamentPhotosDirSafe({ ...process.env, PRIVATE_UPLOADS_DIR: priv, TOURNAMENT_PHOTOS_DIR: undefined }));
    assert.doesNotThrow(() => assertTournamentPhotosDirSafe({ ...process.env, PRIVATE_UPLOADS_DIR: priv, TOURNAMENT_PHOTOS_DIR: path.join(priv, 'tournament-photos') }));
  });

  it('o boot também recusa diretório igual, ancestral ou descendente de FEED_MEDIA_DIR', () => {
    const priv = path.join(os.tmpdir(), 'tp-private2');
    const feed = path.join(os.tmpdir(), 'tp-feed');
    const base = { ...process.env, PRIVATE_UPLOADS_DIR: priv, FEED_MEDIA_DIR: feed } as NodeJS.ProcessEnv;
    assert.throws(() => assertTournamentPhotosDirSafe({ ...base, TOURNAMENT_PHOTOS_DIR: feed }), /FEED_MEDIA_DIR/);
    assert.throws(() => assertTournamentPhotosDirSafe({ ...base, TOURNAMENT_PHOTOS_DIR: os.tmpdir() }), /FEED_MEDIA_DIR/);
    assert.throws(() => assertTournamentPhotosDirSafe({ ...base, TOURNAMENT_PHOTOS_DIR: path.join(feed, 'fotos') }), /FEED_MEDIA_DIR/);
    assert.doesNotThrow(() => assertTournamentPhotosDirSafe({ ...base, TOURNAMENT_PHOTOS_DIR: path.join(priv, 'tournament-photos') }));
  });

  it('cota: padrão 200 MB; valor inválido ou <= 0 cai no padrão; fração vale', () => {
    const MB = 1024 * 1024;
    assert.equal(tournamentPhotosQuotaBytes({}), 200 * MB);
    assert.equal(tournamentPhotosQuotaBytes({ TOURNAMENT_PHOTOS_QUOTA_MB: '50' }), 50 * MB);
    assert.equal(tournamentPhotosQuotaBytes({ TOURNAMENT_PHOTOS_QUOTA_MB: '0.01' }), Math.floor(0.01 * MB));
    for (const v of ['0', '-3', 'abc', '']) assert.equal(tournamentPhotosQuotaBytes({ TOURNAMENT_PHOTOS_QUOTA_MB: v }), 200 * MB, v);
  });
});

describe('pipeline de imagem (sharp obrigatório)', () => {
  afterEach(() => setTournamentPhotoSharpForTests(undefined));

  const jpeg = (w: number, h: number, extra: sharp.JpegOptions = {}) =>
    sharp({ create: { width: w, height: h, channels: 3, background: '#3a6' } }).jpeg(extra).toBuffer();

  it('JPEG grande vira WebP com lado maior 800', async () => {
    const r = await processTournamentPhoto(await jpeg(2400, 1200));
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const meta = await sharp(r.data).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(Math.max(meta.width!, meta.height!), 800);
    assert.equal(meta.width, 800);
    assert.equal(meta.height, 400);
  });

  it('imagem pequena não é ampliada; PNG e WebP entram', async () => {
    const png = await sharp({ create: { width: 120, height: 90, channels: 4, background: { r: 200, g: 0, b: 0, alpha: 1 } } }).png().toBuffer();
    const webp = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#036' } }).webp().toBuffer();
    for (const input of [png, webp]) {
      const r = await processTournamentPhoto(input);
      assert.equal(r.ok, true);
      if (r.ok) assert.ok(r.width <= 120);
    }
  });

  it('EXIF/GPS saem do arquivo e a orientação é aplicada (rotate)', async () => {
    const withExif = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#a36' } })
      .jpeg()
      .withExif({ IFD0: { Copyright: 'SENTINELA-EXIF' } })
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const meta = await sharp(withExif).metadata();
    assert.ok(meta.exif, 'a entrada TEM EXIF');
    const r = await processTournamentPhoto(withExif);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    const out = await sharp(r.data).metadata();
    assert.equal(out.exif, undefined, 'sem EXIF');
    assert.equal(out.icc, undefined, 'sem ICC');
    assert.equal(out.xmp, undefined, 'sem XMP');
    assert.ok(!r.data.includes(Buffer.from('SENTINELA-EXIF')));
    assert.equal(out.width, 200, 'orientacao 6 (90 graus): 400x200 vira 200x400');
    assert.equal(out.height, 400);
  });

  it('o que não é JPEG/PNG/WebP é recusado pelos magic bytes (HEIC, GIF, SVG, HTML renomeado, vazio)', async () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypheic'), Buffer.alloc(40)]);
    const gif = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(40, 1)]);
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>');
    const html = Buffer.from('<!doctype html><html><body><script>alert(1)</script></body></html>');
    for (const [name, buf] of Object.entries({ heic, gif, svg, html, tiny: Buffer.from('abc'), empty: Buffer.alloc(0) })) {
      const r = await processTournamentPhoto(buf);
      assert.deepEqual(r, { ok: false, reason: 'TYPE' }, name);
    }
  });

  it('magic bytes certos mas imagem ilegível (cortada / lixo) = DECODE', async () => {
    const good = await jpeg(300, 300);
    const truncated = good.subarray(0, Math.floor(good.length / 3));
    assert.deepEqual(await processTournamentPhoto(truncated), { ok: false, reason: 'DECODE' });
    const junk = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
    assert.deepEqual(await processTournamentPhoto(junk), { ok: false, reason: 'DECODE' });
  });

  it('bomba de pixels (> 25 MP) é recusada antes de decodificar', async () => {
    const bomb = await sharp({ create: { width: 5200, height: 5000, channels: 3, background: '#fff' } }).png({ compressionLevel: 9 }).toBuffer();
    assert.ok(bomb.length < 1024 * 1024, 'a bomba cabe em menos de 1 MB (e passaria no limite de bytes)');
    assert.deepEqual(await processTournamentPhoto(bomb), { ok: false, reason: 'DECODE' });
  });

  it('sharp indisponível = UNAVAILABLE (nunca devolve o original)', async () => {
    setTournamentPhotoSharpForTests(null);
    assert.deepEqual(await processTournamentPhoto(await jpeg(100, 100)), { ok: false, reason: 'UNAVAILABLE' });
    // magic bytes continuam vindo primeiro
    assert.deepEqual(await processTournamentPhoto(Buffer.from('GIF89a----------------')), { ok: false, reason: 'TYPE' });
  });

  it('semáforo: cliente que desiste (abort) sai da fila sem ocupar vaga e o excedente continua sendo BUSY', async () => {
    const img = await jpeg(1200, 1200);
    const ac = new AbortController();
    const total = TOURNAMENT_PHOTO_CONCURRENCY + TOURNAMENT_PHOTO_QUEUE_MAX;
    const jobs = Array.from({ length: total }, (_, i) => processTournamentPhoto(img, i >= TOURNAMENT_PHOTO_CONCURRENCY ? ac.signal : undefined));
    // fila cheia: o proximo e BUSY; abortando os da fila, a vaga na fila volta na hora
    assert.deepEqual(await processTournamentPhoto(img), { ok: false, reason: 'BUSY' });
    ac.abort();
    const results = await Promise.all(jobs);
    assert.equal(results.filter((r) => r.ok).length, TOURNAMENT_PHOTO_CONCURRENCY);
    assert.equal(results.filter((r) => !r.ok && r.reason === 'ABORTED').length, TOURNAMENT_PHOTO_QUEUE_MAX);
    assert.deepEqual(await processTournamentPhoto(img, ac.signal), { ok: false, reason: 'ABORTED' }, 'sinal ja abortado nem processa');
    assert.equal((await processTournamentPhoto(img)).ok, true, 'o semaforo voltou ao normal');
  });

  it('semáforo: só CONCURRENCY processam, QUEUE_MAX esperam e o excedente recebe BUSY', async () => {
    const img = await jpeg(1200, 1200);
    const total = TOURNAMENT_PHOTO_CONCURRENCY + TOURNAMENT_PHOTO_QUEUE_MAX + 6;
    const results = await Promise.all(Array.from({ length: total }, () => processTournamentPhoto(img)));
    assert.equal(results.filter((r) => !r.ok && r.reason === 'BUSY').length, 6);
    assert.equal(results.filter((r) => r.ok).length, total - 6);
    // e o semaforo volta ao normal
    assert.equal((await processTournamentPhoto(img)).ok, true);
  });
});

describe('gravar e apagar com segurança', () => {
  let dir = '';
  const backup = process.env.TOURNAMENT_PHOTOS_DIR;
  before(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tp-store-'));
    process.env.TOURNAMENT_PHOTOS_DIR = dir;
  });
  after(async () => {
    if (backup === undefined) delete process.env.TOURNAMENT_PHOTOS_DIR;
    else process.env.TOURNAMENT_PHOTOS_DIR = backup;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('grava <uuid>.webp novo (wx: nunca sobrescreve) e apaga; apagar inválido/inexistente não lança nem sai do diretório', async () => {
    const a = await storeTournamentPhoto(Buffer.from('um'));
    const b = await storeTournamentPhoto(Buffer.from('dois'));
    assert.notEqual(a.file, b.file);
    assert.equal(isTournamentPhotoFile(a.file), true);
    assert.equal(a.bytes, 2);
    assert.deepEqual((await fs.readdir(dir)).sort(), [a.file, b.file].sort());
    if (process.platform !== 'win32') assert.equal((await fs.stat(path.join(dir, a.file))).mode & 0o777, 0o600);

    const outside = path.join(path.dirname(dir), `fora-${UUID}.webp`);
    await fs.writeFile(outside, 'x');
    const traversal = `../${path.basename(outside)}`;
    const deleted = await deleteTournamentPhotoFiles([a.file, null, undefined, '', traversal, `${UUID}.webp`, 'qualquer.txt']);
    assert.equal(deleted, 1, 'so o arquivo valido e existente');
    assert.equal(await fs.stat(outside).then(() => true, () => false), true, 'nada fora do diretorio foi tocado');
    await fs.rm(outside);
    assert.deepEqual(await fs.readdir(dir), [b.file]);
    assert.equal(await deleteTournamentPhotoFiles([b.file, b.file]), 1, 'repetido conta uma vez');
  });
});

describe('aviso do boot e reconciliação (env)', () => {
  it('dry-run de GC/PURGE gera aviso no boot; ligar ou desligar cala; reconciliação padrão LIGADA', () => {
    assert.equal(tournamentPhotosBootWarnings({}).length, 2);
    assert.match(tournamentPhotosBootWarnings({ TOURNAMENT_PHOTOS_GC: 'true' })[0], /TOURNAMENT_PHOTOS_PURGE=dry-run.*menores/);
    assert.deepEqual(tournamentPhotosBootWarnings({ TOURNAMENT_PHOTOS_GC: 'true', TOURNAMENT_PHOTOS_PURGE: 'true' }), []);
    assert.deepEqual(tournamentPhotosBootWarnings({ TOURNAMENT_PHOTOS_GC: 'false', TOURNAMENT_PHOTOS_PURGE: 'false' }), []);
    assert.equal(tournamentAnonReconcileEnabled({}), true);
    assert.equal(tournamentAnonReconcileEnabled({ TOURNAMENT_ANON_RECONCILE: 'true' }), true);
    assert.equal(tournamentAnonReconcileEnabled({ TOURNAMENT_ANON_RECONCILE: 'false' }), false);
    assert.equal(tournamentAnonReconcileEnabled({ TOURNAMENT_ANON_RECONCILE: 'lixo' }), true);
  });
});

describe('modos dos jobs (TOURNAMENT_PHOTOS_GC / TOURNAMENT_PHOTOS_PURGE)', () => {
  it('padrão dry-run; true liga; false desliga; lixo cai no padrão SEGURO (dry-run)', () => {
    assert.equal(tournamentPhotosGcMode({}), 'dry-run');
    assert.equal(tournamentPhotosPurgeMode({}), 'dry-run');
    assert.equal(tournamentPhotosGcMode({ TOURNAMENT_PHOTOS_GC: 'true' }), 'on');
    assert.equal(tournamentPhotosGcMode({ TOURNAMENT_PHOTOS_GC: ' ON ' }), 'on');
    assert.equal(tournamentPhotosGcMode({ TOURNAMENT_PHOTOS_GC: 'false' }), 'off');
    assert.equal(tournamentPhotosPurgeMode({ TOURNAMENT_PHOTOS_PURGE: '0' }), 'off');
    assert.equal(tournamentPhotosPurgeMode({ TOURNAMENT_PHOTOS_PURGE: 'dry-run' }), 'dry-run');
    assert.equal(tournamentPhotosPurgeMode({ TOURNAMENT_PHOTOS_PURGE: 'talvez' }), 'dry-run');
    assert.equal(tournamentPhotosGcMode({ TOURNAMENT_PHOTOS_PURGE: 'true' }), 'dry-run', 'cada job le a PROPRIA env');
  });
});

describe('413 do contrato (interceptor)', () => {
  const run = (error: unknown) =>
    lastValueFrom(new TournamentPhotoUploadErrorInterceptor().intercept({} as never, { handle: () => throwError(() => error) }));

  it('o 413 generico do multer vira PHOTO_TOO_LARGE com {statusCode, message, code}', async () => {
    await assert.rejects(run(new PayloadTooLargeException('File too large')), (e: any) => {
      assert.equal(e.getStatus(), HttpStatus.PAYLOAD_TOO_LARGE);
      assert.deepEqual(Object.keys(e.getResponse()).sort(), ['code', 'message', 'statusCode']);
      assert.equal(e.getResponse().code, 'PHOTO_TOO_LARGE');
      return true;
    });
  });

  it('outros erros e o 413 que já tem code passam intactos; resposta de sucesso passa', async () => {
    const other = new Error('boom');
    await assert.rejects(run(other), (e) => e === other);
    const coded = new PayloadTooLargeException({ statusCode: 413, message: 'x', code: 'OUTRO' });
    await assert.rejects(run(coded), (e) => e === coded);
    assert.equal(await lastValueFrom(new TournamentPhotoUploadErrorInterceptor().intercept({} as never, { handle: () => of('ok') })), 'ok');
  });
});

describe('log de requisição da rota pública da foto', () => {
  it('sai só com o PADRÃO da rota, sem token, sem nome do arquivo, sem usuário e sem IP', () => {
    const token = 'tok_SECRETO_AAAAAAAAAAAAAAAAAAAAAAAAAA';
    const req = {
      method: 'GET',
      baseUrl: '/api',
      originalUrl: `/api/public/tournaments/${token}/photos/${UUID}.webp`,
      route: { path: '/public/tournaments/:token/photos/:file' },
      ip: '203.0.113.9',
      user: { id: 5 },
    } as never;
    const line = buildRequestLogLine(req, { statusCode: 200 } as never, 'req-12345678', 3);
    const raw = JSON.stringify(line);
    assert.equal(line.route, '/api/public/tournaments/:token/photos/:file');
    assert.equal(line.userId, null);
    assert.equal(line.ip, null);
    assert.ok(!raw.includes('SECRETO') && !raw.includes(UUID) && !raw.includes('203.0.113.9'));
  });
});

describe('limite de envio da foto (20/min por usuário e por IP)', () => {
  const handler = TournamentsController.prototype.setPhoto;
  const backup = process.env.TOURNAMENT_PHOTO_THROTTLE_LIMIT;
  afterEach(() => {
    if (backup === undefined) delete process.env.TOURNAMENT_PHOTO_THROTTLE_LIMIT;
    else process.env.TOURNAMENT_PHOTO_THROTTLE_LIMIT = backup;
  });

  it('a rota de envio tem o UserThrottlerGuard e o @Throttle de 60 s com limite lido a cada pedido (padrão 20)', () => {
    const guards = Reflect.getMetadata('__guards__', handler) as unknown[];
    assert.ok(guards.includes(UserThrottlerGuard));
    const limit = Reflect.getMetadata('THROTTLER:LIMITdefault', handler) as () => number;
    assert.equal(Reflect.getMetadata('THROTTLER:TTLdefault', handler), 60_000);
    delete process.env.TOURNAMENT_PHOTO_THROTTLE_LIMIT;
    assert.equal(limit(), 20);
    process.env.TOURNAMENT_PHOTO_THROTTLE_LIMIT = '3';
    assert.equal(limit(), 3);
    process.env.TOURNAMENT_PHOTO_THROTTLE_LIMIT = 'lixo';
    assert.equal(limit(), 20);
  });
});
