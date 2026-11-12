import { ValidationPipe } from '@nestjs/common';
import type { TournamentCategory, TournamentCompetitor } from '@prisma/client';
import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { etagMatches } from '../src/interface/http/tournaments/public-tournaments.controller';
import { generateRoundRobin, generateSingleElimination, MatchSpec } from '../src/interface/http/tournaments/engine';
import { AddCompetitorDto, CreateCategoryDto, MatchResultDto, UpdateCompetitorDto } from '../src/interface/http/tournaments/dto/tournament.dto';
import {
  MatchNode,
  planResult,
  planStart,
  planSwap,
  planUndo,
  applyPatches,
  deriveCategoryStatus,
  statusFromSlots,
} from '../src/interface/http/tournaments/tournament-flow';
import { DEFAULT_MAX_VIEWERS, maxViewersPerTournament, TournamentLiveHub } from '../src/interface/http/tournaments/tournament-live-hub';
import { negativeTtlMs, PublicEntry, snapshotTtlMs, TournamentPublicService } from '../src/interface/http/tournaments/tournament-public.service';
import {
  ageGroupFromBirthDates,
  cleanText,
  generatePublicToken,
  groupConfigError,
  groupSizeError,
  isAllowedPhotoRef,
  isPublicViewAllowed,
  isWellFormedPublicToken,
  normalizeCategoryConfig,
  photoVisibleOnPublic,
  publicPhotoRef,
  PUBLIC_VIEW_DAYS_AFTER_EVENT,
} from '../src/interface/http/tournaments/tournament-rules';
import {
  buildOperatorCategory,
  buildPublicSnapshotBody,
  CategoryData,
  composeSnapshotJson,
  PUBLIC_SNAPSHOT_KEYS,
  publicPhotoFor,
  serializePublicBody,
} from '../src/interface/http/tournaments/tournament-snapshot';
import { bufferLimitFor, frameFor, streamTimings, writeWithLimit } from '../src/interface/http/tournaments/tournament-stream';

/**
 * Regras PURAS do servico de chaveamento (sem banco): privacidade da foto, validacao de DTOs e de URLs, faixa etaria,
 * janela publica, fluxo das lutas (resultado/desfazer/troca) sobre chaves do motor, montagem do snapshot a partir de dados
 * em memoria, hub SSE e memoizacao do snapshot (corrida com invalidacao). O fluxo HTTP e o SSE real: tournaments.e2e-spec.ts.
 */

const NOW = new Date('2026-11-20T15:00:00.000Z');
const PHOTO = '/api/uploads/aaaaaaaa-aaaa-4aaa-8aaa-000000000001.webp';
const DAY = 86_400_000;
const TOKEN = 'tok_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OWN_FILE = (n: number) => `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}.webp`;
const OWN_URL = (n: number) => `/api/public/tournaments/${TOKEN}/photos/${OWN_FILE(n)}`;

// ---------------------------------------------------------------------------------------------------------------
describe('URL de foto', () => {
  it('aceita só /api/uploads/<uuid>.<ext> e https válido', () => {
    assert.equal(isAllowedPhotoRef(PHOTO), true);
    assert.equal(isAllowedPhotoRef('https://cdn.exemplo.com/a/b.png?x=1'), true);
    for (const bad of [
      'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'data:image/png;base64,AAAA', 'http://exemplo.com/a.png', '//exemplo.com/a.png',
      '/api/uploads/../../etc/passwd', '/api/uploads/x.png', '/api/uploads/aaaaaaaa-aaaa-4aaa-8aaa-000000000001.svg', '/outro/a.png',
      'https://u:p@exemplo.com/a.png', 'https://exemplo.com/a b.png', 'https://', '', ' ', 'ftp://exemplo.com/a.png', `https://${'a'.repeat(600)}.com/x`,
      'https://exemplo.com/\u0000', 'https:\\\\exemplo.com',
    ]) {
      assert.equal(isAllowedPhotoRef(bad), false, JSON.stringify(bad));
    }
    assert.equal(isAllowedPhotoRef(null), false);
    assert.equal(isAllowedPhotoRef(42), false);
  });

  it('publicPhotoRef reavalia na saída: URL absoluta do próprio upload vira caminho; lixo vira null', () => {
    assert.equal(publicPhotoRef(PHOTO), PHOTO);
    assert.equal(publicPhotoRef(`https://api.gingapp.com.br${PHOTO}`), PHOTO);
    assert.equal(publicPhotoRef('https://cdn.exemplo.com/f.jpg'), 'https://cdn.exemplo.com/f.jpg');
    assert.equal(publicPhotoRef('javascript:alert(1)'), null);
    assert.equal(publicPhotoRef('http://exemplo.com/f.jpg'), null);
    assert.equal(publicPhotoRef(null), null);
    assert.equal(publicPhotoRef(undefined), null);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('faixa etária e regra da foto', () => {
  const born = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  it('recalcula da data de nascimento; sem data = UNKNOWN; qualquer data de menor = MINOR (conservador)', () => {
    assert.equal(ageGroupFromBirthDates([null, null], NOW), 'UNKNOWN');
    assert.equal(ageGroupFromBirthDates([], NOW), 'UNKNOWN');
    assert.equal(ageGroupFromBirthDates([born('1990-01-01')], NOW), 'ADULT');
    assert.equal(ageGroupFromBirthDates([born('2015-03-04')], NOW), 'MINOR');
    assert.equal(ageGroupFromBirthDates([born('1990-01-01'), born('2015-03-04')], NOW), 'MINOR');
    assert.equal(ageGroupFromBirthDates([null, born('1990-01-01')], NOW), 'ADULT');
  });

  it('o aluno que faz 18 anos passa a ser ADULT sem ninguém tocar (fronteira do dia do aniversário)', () => {
    const birth = born('2008-11-20');
    assert.equal(ageGroupFromBirthDates([birth], new Date('2026-11-19T12:00:00.000Z')), 'MINOR');
    assert.equal(ageGroupFromBirthDates([birth], new Date('2026-11-20T12:00:00.000Z')), 'ADULT');
    assert.equal(ageGroupFromBirthDates([birth], new Date('2027-01-01T12:00:00.000Z')), 'ADULT');
  });

  it('foto pública só para ADULT ou com autorização', () => {
    assert.equal(photoVisibleOnPublic('ADULT', false), true);
    assert.equal(photoVisibleOnPublic('MINOR', false), false);
    assert.equal(photoVisibleOnPublic('UNKNOWN', false), false);
    assert.equal(photoVisibleOnPublic('MINOR', true), true);
    assert.equal(photoVisibleOnPublic('UNKNOWN', true), true);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('janela pública, token e configuração de grupos', () => {
  const base = { publicEnabled: true, eventStatus: 'PUBLISHED', eventDate: NOW };
  it('visível: ligado + evento publicado/encerrado + até 30 dias depois', () => {
    assert.equal(isPublicViewAllowed(base, NOW), true);
    assert.equal(isPublicViewAllowed({ ...base, eventStatus: 'CLOSED' }, NOW), true);
    assert.equal(isPublicViewAllowed({ ...base, publicEnabled: false }, NOW), false);
    assert.equal(isPublicViewAllowed({ ...base, eventStatus: 'DRAFT' }, NOW), false);
    assert.equal(isPublicViewAllowed({ ...base, eventStatus: 'CANCELLED' }, NOW), false);
    const at = (days: number) => new Date(NOW.getTime() + days * DAY);
    assert.equal(isPublicViewAllowed(base, at(PUBLIC_VIEW_DAYS_AFTER_EVENT)), true, 'exatamente 30 dias ainda vale');
    assert.equal(isPublicViewAllowed(base, new Date(at(PUBLIC_VIEW_DAYS_AFTER_EVENT).getTime() + 1)), false);
    assert.equal(isPublicViewAllowed({ ...base, eventDate: at(10) }, NOW), true, 'evento futuro');
  });

  it('token: 32 caracteres URL-safe, únicos, e validação de formato', () => {
    const tokens = new Set(Array.from({ length: 500 }, () => generatePublicToken()));
    assert.equal(tokens.size, 500);
    for (const t of tokens) {
      assert.match(t, /^[A-Za-z0-9_-]{32}$/);
      assert.equal(isWellFormedPublicToken(t), true);
    }
    for (const bad of ['', 'curto', 'x'.repeat(65), `${'a'.repeat(23)}!`, `${'a'.repeat(30)}/..`, null, undefined, 5]) {
      assert.equal(isWellFormedPublicToken(bad), false, String(bad));
    }
  });

  it('grupos: 2..16, 1..4, produto >= 2; tamanho mínimo dos grupos', () => {
    assert.equal(groupConfigError({ groupCount: 2, advancePerGroup: 2 }), null);
    assert.equal(groupConfigError({ groupCount: 2, advancePerGroup: 1 }), null);
    assert.ok(groupConfigError({ groupCount: 1, advancePerGroup: 4 }));
    assert.ok(groupConfigError({ groupCount: 17, advancePerGroup: 1 }));
    assert.ok(groupConfigError({ groupCount: 2, advancePerGroup: 5 }));
    assert.ok(groupConfigError({ groupCount: null, advancePerGroup: 2 }));
    assert.equal(groupSizeError(8, { groupCount: 2, advancePerGroup: 2 }), null);
    assert.ok(groupSizeError(3, { groupCount: 2, advancePerGroup: 1 }), 'grupo de 1 atleta');
    assert.ok(groupSizeError(5, { groupCount: 2, advancePerGroup: 3 }), 'menor grupo tem 2: nao classifica 3');
  });

  it('config por formato: só GROUPS_KNOCKOUT guarda grupos; todos contra todos não tem 3º lugar', () => {
    assert.deepEqual(normalizeCategoryConfig('SINGLE_ELIMINATION', { thirdPlace: true, groupCount: 4, advancePerGroup: 2 }), { thirdPlace: true, groupCount: null, advancePerGroup: null });
    assert.deepEqual(normalizeCategoryConfig('ROUND_ROBIN', { thirdPlace: true }), { thirdPlace: false, groupCount: null, advancePerGroup: null });
    assert.deepEqual(normalizeCategoryConfig('GROUPS_KNOCKOUT', { thirdPlace: true, groupCount: 4, advancePerGroup: 2 }), { thirdPlace: true, groupCount: 4, advancePerGroup: 2 });
  });

  it('cleanText remove controles/espaços e vazio vira null', () => {
    assert.equal(cleanText('  Fulano\u0000   de\tTal \n'), 'Fulano de Tal');
    assert.equal(cleanText('   '), null);
    assert.equal(cleanText(null), null);
    assert.equal(cleanText(5), null);
  });

  it('If-None-Match: lista, fraco e *', () => {
    assert.equal(etagMatches('"1-abc"', '"1-abc"'), true);
    assert.equal(etagMatches('W/"1-abc"', '"1-abc"'), true);
    assert.equal(etagMatches('"0-x", "1-abc"', '"1-abc"'), true);
    assert.equal(etagMatches('*', '"1-abc"'), true);
    assert.equal(etagMatches('"2-abc"', '"1-abc"'), false);
    assert.equal(etagMatches(undefined, '"1-abc"'), false);
  });

  it('envs lidas a cada uso', () => {
    const env = { TOURNAMENT_MAX_VIEWERS: '2', TOURNAMENT_SNAPSHOT_TTL_MS: '0', TOURNAMENT_SSE_PING_MS: '50' } as unknown as NodeJS.ProcessEnv;
    assert.equal(maxViewersPerTournament(env), 2);
    assert.equal(maxViewersPerTournament({} as NodeJS.ProcessEnv), DEFAULT_MAX_VIEWERS);
    assert.equal(maxViewersPerTournament({ TOURNAMENT_MAX_VIEWERS: 'x' } as unknown as NodeJS.ProcessEnv), 300);
    assert.equal(snapshotTtlMs(env), 0);
    assert.equal(snapshotTtlMs({} as NodeJS.ProcessEnv), 10_000);
    assert.deepEqual(streamTimings(env), { pingMs: 50, maxDurationMs: 6 * 3_600_000 });
    assert.deepEqual(streamTimings({} as NodeJS.ProcessEnv), { pingMs: 20_000, maxDurationMs: 21_600_000 });
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('DTOs (ValidationPipe do projeto: whitelist + forbidNonWhitelisted + transform)', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const run = async (metatype: new () => object, body: object): Promise<{ ok: boolean; value?: any; message?: string }> => {
    try {
      return { ok: true, value: await pipe.transform(body, { type: 'body', metatype }) };
    } catch (error) {
      return { ok: false, message: JSON.stringify((error as { getResponse?: () => unknown }).getResponse?.()) };
    }
  };

  it('categoria: nome 1..80 (com trim), formato, grupos e campo extra', async () => {
    assert.equal((await run(CreateCategoryDto, { name: ' Peso leve ', format: 'ROUND_ROBIN' })).value.name, 'Peso leve');
    for (const body of [
      { name: '', format: 'ROUND_ROBIN' }, { name: '   ', format: 'ROUND_ROBIN' }, { name: 'x'.repeat(81), format: 'ROUND_ROBIN' },
      { name: 'A', format: 'DUPLA' }, { name: 'A' }, { name: 'A', format: 'ROUND_ROBIN', organizationId: 9 },
      { name: 'A', format: 'GROUPS_KNOCKOUT', groupCount: 1, advancePerGroup: 2 }, { name: 'A', format: 'GROUPS_KNOCKOUT', groupCount: 2, advancePerGroup: 5 },
      { name: 'A', format: 'GROUPS_KNOCKOUT', groupCount: '2', advancePerGroup: 2 }, { name: 'A', format: 'GROUPS_KNOCKOUT', groupCount: 2.5, advancePerGroup: 2 },
    ]) {
      assert.equal((await run(CreateCategoryDto, body)).ok, false, JSON.stringify(body));
    }
    assert.equal((await run(CreateCategoryDto, { name: 'A', format: 'GROUPS_KNOCKOUT', groupCount: 16, advancePerGroup: 4 })).ok, true);
  });

  it('atleta: nome 2..80, faixa etária enum e campos extras; photoUrl passa pelo DTO (o service recusa com PHOTO_URL_NOT_ALLOWED)', async () => {
    const ok = (guest: object) => run(AddCompetitorDto, { guest });
    assert.equal((await ok({ displayName: 'Fulano' })).ok, true);
    assert.equal((await ok({ displayName: 'Fulano', photoUrl: PHOTO, ageGroup: 'MINOR', groupName: 'Acad', graduationLabel: 'Azul' })).ok, true);
    for (const guest of [
      { displayName: 'F' }, { displayName: 'x'.repeat(81) },
      { displayName: 'Fulano', ageGroup: 'TEEN' }, { displayName: 'Fulano', studentId: 3 }, { displayName: 'Fulano', groupName: 'x'.repeat(81) },
      { displayName: 'Fulano', graduationLabel: 'x'.repeat(61) },
    ]) {
      assert.equal((await ok(guest)).ok, false, JSON.stringify(guest));
    }
    assert.equal((await run(AddCompetitorDto, { studentId: 0 })).ok, false);
    assert.equal((await run(AddCompetitorDto, { studentId: '5' })).ok, false);
    assert.equal((await run(AddCompetitorDto, { eventParticipantId: 5, foo: 1 })).ok, false);
    assert.equal((await run(UpdateCompetitorDto, { seed: 129 })).ok, false);
    assert.equal((await run(UpdateCompetitorDto, { seed: null, photoUrl: null, groupName: null })).ok, true);
    // photoUrl chega ao service em QUALQUER forma (inclusive lixo): quem recusa, com o codigo do contrato, e o service.
    assert.equal((await run(UpdateCompetitorDto, { photoUrl: 'javascript:alert(1)' })).ok, true);
    assert.equal((await ok({ displayName: 'Fulano', photoUrl: 'https://cdn.exemplo.com/a.png' })).ok, true);
    assert.equal((await run(UpdateCompetitorDto, { photoAuthorized: 'sim' })).ok, false);
  });

  it('resultado: placares 0..999 inteiros, tipo enum, nota até 200', async () => {
    assert.equal((await run(MatchResultDto, { winnerId: 1, scoreA: 0, scoreB: 999, resultType: 'WALKOVER', note: 'ok' })).ok, true);
    for (const body of [{ scoreA: -1 }, { scoreA: 1000 }, { scoreA: 1.5 }, { resultType: 'X' }, { note: 'x'.repeat(201) }, { winnerId: 0 }, { winnerId: 'a' }, { extra: 1 }]) {
      assert.equal((await run(MatchResultDto, body)).ok, false, JSON.stringify(body));
    }
  });
});

// ---------------------------------------------------------------------------------------------------------------
/** Transforma as MatchSpec do motor em lutas "do banco" (ids sequenciais), como o service grava. */
function nodesFrom(specs: MatchSpec[]): MatchNode[] {
  const idByKey = new Map(specs.map((s, i) => [s.key, i + 1]));
  const work = specs.map((s) => ({ ...s }));
  for (const s of work) {
    if (!s.isBye || s.winnerId === null || !s.next) continue;
    const t = work.find((x) => x.key === s.next!.key)!;
    if (s.next.slot === 'A' && t.slotA === null) t.slotA = s.winnerId;
    if (s.next.slot === 'B' && t.slotB === null) t.slotB = s.winnerId;
  }
  return work.map((s) => ({
    id: idByKey.get(s.key)!,
    key: s.key,
    stage: s.stage,
    round: s.round,
    position: s.position,
    groupIndex: s.groupIndex,
    slotAId: s.slotA,
    slotBId: s.slotB,
    nextMatchId: s.next ? idByKey.get(s.next.key)! : null,
    nextSlot: s.next?.slot ?? null,
    loserNextMatchId: s.loserNext ? idByKey.get(s.loserNext.key)! : null,
    loserNextSlot: s.loserNext?.slot ?? null,
    isBye: s.isBye,
    status: s.isBye ? 'FINISHED' : statusFromSlots(s.slotA, s.slotB),
    winnerId: s.isBye ? s.winnerId : null,
    scoreA: null,
    scoreB: null,
    resultType: null,
  }));
}
const comps = (n: number) => Array.from({ length: n }, (_v, i) => ({ id: i + 1, seed: null, groupName: null }));
const codeOf = (fn: () => unknown): string | undefined => {
  try {
    fn();
  } catch (error) {
    return (error as { getResponse: () => { code: string } }).getResponse().code;
  }
  return undefined;
};

describe('fluxo das lutas (sobre chaves do motor)', () => {
  it('propaga vencedor e perdedor (semifinal -> final e 3º lugar) e recalcula PENDING/READY', () => {
    let nodes = nodesFrom(generateSingleElimination(comps(4), { seeding: 'RANDOM', thirdPlace: true, rngSeed: 7 }));
    const semi = nodes.find((m) => m.round === 1 && m.stage === 'MAIN')!;
    const plan = planResult(nodes, semi.id, { winnerId: semi.slotAId, scoreA: 3, scoreB: 1 }, NOW);
    nodes = applyPatches(nodes, plan.patches);
    const final = nodes.find((m) => m.id === semi.nextMatchId)!;
    const third = nodes.find((m) => m.stage === 'THIRD_PLACE')!;
    assert.ok([final.slotAId, final.slotBId].includes(semi.slotAId));
    assert.ok([third.slotAId, third.slotBId].includes(semi.slotBId));
    assert.equal(final.status, 'PENDING');
    // a outra semifinal completa a final
    const semi2 = nodes.find((m) => m.round === 1 && m.stage === 'MAIN' && m.id !== semi.id)!;
    nodes = applyPatches(nodes, planResult(nodes, semi2.id, { winnerId: semi2.slotBId }, NOW).patches);
    assert.equal(nodes.find((m) => m.id === final.id)!.status, 'READY');
    assert.equal(nodes.find((m) => m.id === third.id)!.status, 'READY');
  });

  it('regras de erro: MATCH_NOT_READY, MATCH_ALREADY_FINISHED, idempotência e validação do vencedor', () => {
    const nodes = nodesFrom(generateSingleElimination(comps(4), { seeding: 'RANDOM', thirdPlace: false, rngSeed: 3 }));
    const final = nodes.find((m) => m.round === 2)!;
    const semi = nodes.find((m) => m.round === 1)!;
    assert.equal(codeOf(() => planResult(nodes, final.id, { winnerId: 1 }, NOW)), 'MATCH_NOT_READY');
    assert.equal(codeOf(() => planStart(nodes, final.id, NOW)), 'MATCH_NOT_READY');
    assert.equal(codeOf(() => planResult(nodes, semi.id, { winnerId: 999 }, NOW)), 'INVALID_RESULT');
    assert.equal(codeOf(() => planResult(nodes, semi.id, {}, NOW)), 'INVALID_RESULT');
    assert.equal(codeOf(() => planResult(nodes, semi.id, { winnerId: semi.slotAId, resultType: 'DRAW' }, NOW)), 'INVALID_RESULT');
    assert.equal(codeOf(() => planResult(nodes, semi.id, { resultType: 'DRAW' }, NOW)), 'INVALID_RESULT', 'empate so em GROUP');
    assert.equal(codeOf(() => planResult(nodes, 9999, { winnerId: 1 }, NOW)), 'MATCH_NOT_FOUND');
    const done = applyPatches(nodes, planResult(nodes, semi.id, { winnerId: semi.slotAId, scoreA: 2, scoreB: 0 }, NOW).patches);
    const again = planResult(done, semi.id, { winnerId: semi.slotAId, scoreA: 2, scoreB: 0 }, NOW);
    assert.equal(again.idempotent, true);
    assert.equal(again.patches.size, 0);
    assert.equal(planResult(done, semi.id, { winnerId: semi.slotAId }, NOW).idempotent, true, 'placar omitido nao conta como diferente');
    assert.equal(codeOf(() => planResult(done, semi.id, { winnerId: semi.slotBId }, NOW)), 'MATCH_ALREADY_FINISHED');
    assert.equal(codeOf(() => planResult(done, semi.id, { winnerId: semi.slotAId, scoreA: 9 }, NOW)), 'MATCH_ALREADY_FINISHED');
    assert.equal(codeOf(() => planResult(done, semi.id, { winnerId: semi.slotAId, resultType: 'WALKOVER' }, NOW)), 'MATCH_ALREADY_FINISHED');
  });

  it('desfazer: LIVE->READY; FINISHED->READY limpa os slots seguintes; bloqueado se a seguinte foi jogada; folga e READY não desfazem', () => {
    let nodes = nodesFrom(generateSingleElimination(comps(5), { seeding: 'RANDOM', thirdPlace: false, rngSeed: 11 }));
    const byes = nodes.filter((m) => m.isBye);
    assert.equal(byes.length, 3);
    assert.equal(codeOf(() => planUndo(nodes, byes[0].id)), 'MATCH_IS_BYE');
    assert.equal(codeOf(() => planResult(nodes, byes[0].id, { winnerId: byes[0].winnerId }, NOW)), 'MATCH_IS_BYE', 'folga recusa resultado, ate o mesmo vencedor');
    const real = nodes.find((m) => !m.isBye && m.status === 'READY')!;
    assert.equal(codeOf(() => planUndo(nodes, real.id)), 'NOTHING_TO_UNDO');
    nodes = applyPatches(nodes, planStart(nodes, real.id, NOW).patches);
    assert.equal(nodes.find((m) => m.id === real.id)!.status, 'LIVE');
    nodes = applyPatches(nodes, planUndo(nodes, real.id).patches);
    assert.equal(nodes.find((m) => m.id === real.id)!.status, 'READY');
    nodes = applyPatches(nodes, planResult(nodes, real.id, { winnerId: real.slotBId }, NOW).patches);
    const next = nodes.find((m) => m.id === real.nextMatchId)!;
    assert.ok([next.slotAId, next.slotBId].includes(real.slotBId));
    nodes = applyPatches(nodes, planUndo(nodes, real.id).patches);
    const cleared = nodes.find((m) => m.id === real.nextMatchId)!;
    assert.ok(![cleared.slotAId, cleared.slotBId].includes(real.slotBId));
    assert.equal(cleared.status, 'PENDING');
    // seguinte LIVE bloqueia
    nodes = applyPatches(nodes, planResult(nodes, real.id, { winnerId: real.slotBId }, NOW).patches);
    const afterReal = nodes.find((m) => m.id === real.nextMatchId)!;
    assert.equal(afterReal.status, 'READY');
    nodes = applyPatches(nodes, planStart(nodes, afterReal.id, NOW).patches);
    assert.equal(codeOf(() => planUndo(nodes, real.id)), 'DEPENDENT_MATCH_PLAYED');
  });

  it('desfazer jogo de grupo: apaga o mata-mata só se nenhuma luta dele (fora folgas) começou', () => {
    const group: MatchNode = { id: 1, key: 'GROUP-0-1-0', stage: 'GROUP', round: 1, position: 0, groupIndex: 0, slotAId: 1, slotBId: 2, nextMatchId: null, nextSlot: null, loserNextMatchId: null, loserNextSlot: null, isBye: false, status: 'FINISHED', winnerId: 1, scoreA: 1, scoreB: 0, resultType: 'NORMAL' };
    const ko = (id: number, status: MatchNode['status'], isBye = false): MatchNode => ({ ...group, id, key: `MAIN-1-${id}`, stage: 'MAIN', groupIndex: null, status, isBye, winnerId: null });
    assert.deepEqual([planUndo([group, ko(2, 'READY'), ko(3, 'FINISHED', true)], 1).deleteKnockout], [true]);
    assert.equal(planUndo([group], 1).deleteKnockout, false);
    assert.equal(codeOf(() => planUndo([group, ko(2, 'LIVE')], 1)), 'DEPENDENT_MATCH_PLAYED');
    assert.equal(codeOf(() => planUndo([group, ko(2, 'FINISHED')], 1)), 'DEPENDENT_MATCH_PLAYED');
  });

  it('empate em grupos/todos contra todos não propaga e fecha a categoria só quando tudo terminou', () => {
    let nodes = nodesFrom(generateRoundRobin(comps(3), { rngSeed: 5 }));
    assert.equal(nodes.length, 3);
    for (const m of [...nodes]) {
      const cur = nodes.find((x) => x.id === m.id)!;
      nodes = applyPatches(nodes, planResult(nodes, cur.id, { resultType: 'DRAW', scoreA: 1, scoreB: 1 }, NOW).patches);
      assert.equal(nodes.find((x) => x.id === m.id)!.winnerId, null);
    }
    assert.equal(deriveCategoryStatus(nodes), 'FINISHED');
    assert.equal(deriveCategoryStatus(nodes.map((m, i) => (i === 0 ? { ...m, status: 'LIVE' as const } : m))), 'RUNNING');
    assert.equal(deriveCategoryStatus([]), 'RUNNING');
  });

  it('troca de lugares: permutação sem duplicar, bloqueios e acompanhamento do vencedor da folga', () => {
    const nodes = nodesFrom(generateSingleElimination(comps(6), { seeding: 'BY_SEED', thirdPlace: false, rngSeed: 2 }));
    const ids = new Set(comps(6).map((c) => c.id));
    const real = nodes.filter((m) => m.round === 1 && !m.isBye);
    const [m1, m2] = real;
    const plan = planSwap(nodes, m1.id, { slotAId: m2.slotAId }, ids, 'SINGLE_ELIMINATION');
    const swapped = applyPatches(nodes, plan.patches);
    const r1 = swapped.filter((m) => m.round === 1).flatMap((m) => [m.slotAId, m.slotBId]).filter((x) => x !== null);
    assert.equal(new Set(r1).size, r1.length);
    assert.equal(r1.length, 6);
    assert.equal(swapped.find((m) => m.id === m1.id)!.slotAId, m2.slotAId);
    assert.equal(swapped.find((m) => m.id === m2.id)!.slotAId, m1.slotAId);
    // no-op
    assert.equal(planSwap(nodes, m1.id, { slotAId: m1.slotAId }, ids, 'SINGLE_ELIMINATION').idempotent, true);
    // folga: o vencedor acompanha
    const bye = nodes.find((m) => m.isBye)!;
    const holder = bye.winnerId!;
    const viaBye = applyPatches(nodes, planSwap(nodes, m1.id, { slotAId: holder }, ids, 'SINGLE_ELIMINATION').patches);
    const byeAfter = viaBye.find((m) => m.id === bye.id)!;
    assert.notEqual(byeAfter.winnerId, holder);
    assert.ok([byeAfter.slotAId, byeAfter.slotBId].includes(byeAfter.winnerId));
    // erros
    assert.equal(codeOf(() => planSwap(nodes, m1.id, { slotAId: 999 }, ids, 'SINGLE_ELIMINATION')), 'COMPETITOR_NOT_FOUND');
    assert.equal(codeOf(() => planSwap(nodes, m1.id, { slotAId: m1.slotBId!, slotBId: m1.slotBId! }, ids, 'SINGLE_ELIMINATION')), 'INVALID_COMPETITOR');
    assert.equal(codeOf(() => planSwap(nodes, m1.id, { slotAId: 1 }, ids, 'ROUND_ROBIN')), 'SWAP_NOT_ALLOWED');
    const final = nodes.find((m) => m.round === Math.max(...nodes.map((x) => x.round)))!;
    assert.equal(codeOf(() => planSwap(nodes, final.id, { slotAId: 1 }, ids, 'SINGLE_ELIMINATION')), 'SWAP_NOT_ALLOWED');
    const played = applyPatches(nodes, planResult(nodes, m1.id, { winnerId: m1.slotAId }, NOW).patches);
    assert.equal(codeOf(() => planSwap(played, m2.id, { slotAId: m1.slotAId! }, ids, 'SINGLE_ELIMINATION')), 'SWAP_NOT_ALLOWED');
    // folga nao recebe atleta no lugar vazio
    assert.equal(codeOf(() => planSwap(nodes, bye.id, { slotAId: bye.winnerId!, slotBId: m2.slotAId! }, ids, 'SINGLE_ELIMINATION')), 'SWAP_NOT_ALLOWED');
  });
});

// ---------------------------------------------------------------------------------------------------------------
const category = (over: Partial<TournamentCategory> = {}): TournamentCategory => ({
  id: 1, organizationId: 10, tournamentId: 5, name: 'Cat', position: 0, format: 'ROUND_ROBIN', status: 'RUNNING', thirdPlace: false,
  groupCount: null, advancePerGroup: null, drawSeed: 99, generatedAt: NOW, createdAt: NOW, updatedAt: NOW, ...over,
});
const competitor = (id: number, over: Partial<TournamentCompetitor> = {}): TournamentCompetitor => ({
  id, organizationId: 10, categoryId: 1, displayName: `Atleta ${id}`, groupName: 'Academia', graduationLabel: 'Azul', seed: null, poolIndex: null,
  studentId: null, eventParticipantId: null, photoUrl: null, photoFile: null, photoBytes: null, photoUpdatedAt: null, ageGroup: 'UNKNOWN',
  photoAuthorized: false, photoAuthorizedById: null, photoAuthorizedAt: null, createdAt: NOW, ...over,
});
const dated = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const student = (over: Partial<{ photo: string | null; birthDate: Date | null; anonymizedAt: Date | null; person: { birthDate: Date | null } | null }> = {}) => ({
  photo: PHOTO, birthDate: null, anonymizedAt: null, person: null, ...over,
});

function sampleData(): CategoryData {
  const matches = generateRoundRobin(comps(4), { rngSeed: 1 });
  const nodes = nodesFrom(matches);
  const rows = nodes.map((n) => ({
    ...n, organizationId: 10, categoryId: 1, mat: n.id === 1 ? 3 : null, queueOrder: n.id === 1 ? 2 : null,
    note: n.id === 1 ? 'NOTA-INTERNA-SENTINELA' : null, startedAt: null, finishedAt: null, createdAt: NOW, updatedAt: NOW,
  }));
  return {
    category: category(),
    competitors: [
      { row: competitor(1, { studentId: 11, displayName: 'Menor Aluno' }), student: student({ birthDate: dated('2015-03-04') }) },
      { row: competitor(2, { studentId: 12, displayName: 'Adulto Aluno' }), student: student({ birthDate: dated('1990-05-06'), photo: 'https://cdn.exemplo.com/a.jpg' }) },
      { row: competitor(3, { displayName: 'Convidado Menor', ageGroup: 'MINOR', photoFile: OWN_FILE(3), photoBytes: 900, photoUpdatedAt: NOW }), student: null },
      { row: competitor(4, { displayName: 'Convidado Autorizado', ageGroup: 'MINOR', photoFile: OWN_FILE(4), photoBytes: 900, photoUpdatedAt: NOW, photoAuthorized: true, photoAuthorizedById: 77, photoAuthorizedAt: NOW }), student: null },
    ],
    matches: rows,
  };
}

describe('montagem do snapshot a partir de dados em memória', () => {
  const input = () => ({
    revision: 7,
    event: { title: 'Campeonato', date: NOW, location: null, imageUrl: 'javascript:alert(1)' },
    organizationName: 'Grupo',
    categories: [sampleData()],
    now: NOW,
    publicToken: TOKEN,
  });

  it('formato exato e ordem das chaves do contrato 5; serverTime na 2ª posição', () => {
    const body = buildPublicSnapshotBody(input());
    const json = JSON.parse(composeSnapshotJson(serializePublicBody(body), NOW));
    assert.deepEqual(Object.keys(json), [...PUBLIC_SNAPSHOT_KEYS.top]);
    assert.equal(json.serverTime, NOW.toISOString());
    assert.deepEqual(Object.keys(json.event), [...PUBLIC_SNAPSHOT_KEYS.event]);
    assert.equal(json.event.imageUrl, null, 'imagem do evento perigosa nao sai');
    const c = json.categories[0];
    assert.deepEqual(Object.keys(c), [...PUBLIC_SNAPSHOT_KEYS.category]);
    for (const x of c.competitors) assert.deepEqual(Object.keys(x), [...PUBLIC_SNAPSHOT_KEYS.competitor]);
    for (const x of c.matches) assert.deepEqual(Object.keys(x), [...PUBLIC_SNAPSHOT_KEYS.match]);
    assert.deepEqual(Object.keys(c.standings[0].rows[0]), [...PUBLIC_SNAPSHOT_KEYS.standingRow]);
    assert.equal(c.matches.find((m: any) => m.mat !== null).mat, '3', 'mat publico e string');
  });

  it('privacidade: foto de menor sem autorização = null; sentinelas e campos proibidos fora do JSON', () => {
    const body = buildPublicSnapshotBody(input());
    const raw = JSON.stringify(body);
    const byId = (id: number) => body.categories[0].competitors.find((c) => c.id === id)!;
    assert.equal(byId(1).photoUrl, null, 'aluno menor');
    assert.equal(byId(2).photoUrl, 'https://cdn.exemplo.com/a.jpg', 'aluno adulto');
    assert.equal(byId(3).photoUrl, null, 'convidado menor sem autorizacao');
    assert.equal(byId(4).photoUrl, OWN_URL(4), 'convidado menor autorizado: foto PROPRIA pela rota publica com o token');
    assert.ok(!raw.includes('NOTA-INTERNA-SENTINELA'));
    assert.ok(!raw.includes('2015-03-04') && !raw.includes('1990-05-06'));
    for (const forbidden of ['studentId', 'eventParticipantId', 'ageGroup', 'photoAuthorized', 'birthDate', 'note', 'organizationId', 'publicToken', 'email', 'phone', 'displayName']) {
      assert.ok(!raw.includes(`"${forbidden}`), forbidden);
    }
    assert.ok(!raw.includes(OWN_FILE(3)), 'o NOME do arquivo do menor sem autorizacao nao vaza');
    assert.equal(raw.split(OWN_FILE(4)).length - 1, 1, 'o arquivo do autorizado aparece uma vez');
    assert.equal(raw.split(TOKEN).length - 1, 1, 'o token so aparece dentro da URL da foto propria visivel');
  });

  it('aluno virou adulto = foto aparece (idade recalculada na leitura); sem data = UNKNOWN; anonimizado some', () => {
    const data = sampleData();
    const minorRow = data.competitors[0];
    assert.equal(publicPhotoFor(minorRow, NOW, TOKEN), null);
    assert.equal(publicPhotoFor(minorRow, new Date(NOW.getTime() + 9 * 366 * DAY), TOKEN), PHOTO, 'o mesmo aluno, anos depois');
    const unknown = { row: competitor(9, { studentId: 99 }), student: student({ birthDate: null }) };
    assert.equal(publicPhotoFor(unknown, NOW, TOKEN), null);
    assert.equal(publicPhotoFor({ ...unknown, row: { ...unknown.row, photoAuthorized: true } }, NOW, TOKEN), PHOTO, 'UNKNOWN autorizado');
    const anon = { row: competitor(8, { studentId: 98 }), student: student({ birthDate: dated('1980-01-01'), anonymizedAt: NOW }) };
    assert.equal(publicPhotoFor(anon, NOW, TOKEN), null);
    const body = buildPublicSnapshotBody({ ...input(), categories: [{ ...data, competitors: [anon] }] });
    assert.equal(body.categories[0].competitors[0].name, 'Atleta removido');
  });

  it('visão do operador traz o que o telão esconde (faixa etária recalculada, nota, ids) e a regra da foto pública', () => {
    const view = buildOperatorCategory(sampleData(), 7, NOW);
    const c = (id: number) => view.competitors.find((x) => x.id === id)!;
    assert.equal(c(1).ageGroup, 'MINOR');
    assert.equal(c(2).ageGroup, 'ADULT');
    assert.equal(c(1).photoUrl, PHOTO, 'aluno: foto do cadastro (/api/uploads)');
    assert.equal(c(1).photoPublic, false);
    assert.equal(c(1).hasOwnPhoto, false);
    assert.equal(c(1).photoVersion, null);
    assert.equal(c(3).photoUrl, null, 'convidado: photoUrl do operador e SO da foto do aluno');
    assert.equal(c(3).hasOwnPhoto, true);
    assert.equal(c(3).photoVersion, NOW.getTime());
    assert.equal(c(3).photoPublic, false, 'menor sem autorizacao');
    assert.equal(c(4).photoPublic, true);
    assert.equal(c(4).hasOwnPhoto, true);
    assert.ok(!JSON.stringify(view).includes(OWN_FILE(3)), 'o nome do arquivo nunca vai na visao do operador');
    assert.equal(c(1).studentId, 11);
    assert.equal(view.matches.find((m) => m.note !== null)!.note, 'NOTA-INTERNA-SENTINELA');
    assert.equal(view.revision, 7);
    assert.deepEqual(view.podium, []);
  });

  it('classificação e pódio saem do motor (todos contra todos terminado)', () => {
    const data = sampleData();
    data.matches = data.matches.map((m) => ({ ...m, status: 'FINISHED' as const, winnerId: m.slotAId, scoreA: 2, scoreB: 0, resultType: 'NORMAL' as const }));
    const view = buildOperatorCategory(data, 9, NOW);
    assert.equal(view.standings.length, 1);
    assert.deepEqual(view.standings[0].rows.map((r) => r.rank), [1, 2, 3, 4]);
    assert.deepEqual(view.podium.map((p) => p.place), [1, 2, 3]);
    assert.equal(view.podium[0].competitorId, view.standings[0].rows[0].competitorId);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('hub SSE em memória', () => {
  /** Cada conexao real tem o proprio objeto ouvinte (o hub guarda um Set). */
  const mk = () => ({ onChange: () => undefined, onClose: () => undefined });
  afterEach(() => {
    delete process.env.TOURNAMENT_MAX_VIEWERS;
  });

  it('limite por torneio, descadastro idempotente e contagem sem vazar', () => {
    process.env.TOURNAMENT_MAX_VIEWERS = '2';
    const hub = new TournamentLiveHub();
    const a = hub.subscribe(1, mk());
    const b = hub.subscribe(1, mk());
    assert.ok(a && b);
    assert.equal(hub.subscribe(1, mk()), null, 'terceiro = recusado');
    assert.ok(hub.subscribe(2, mk()), 'outro torneio tem o proprio limite');
    assert.equal(hub.listenerCount(1), 2);
    a!();
    a!();
    assert.equal(hub.listenerCount(1), 1);
    assert.ok(hub.subscribe(1, mk()), 'vaga liberada');
    b!();
    assert.equal(hub.totalListeners(), 2);
  });

  it('notifica só o torneio certo; erro em um ouvinte não afeta os outros; closeAll avisa todos', () => {
    const hub = new TournamentLiveHub();
    const got: string[] = [];
    hub.subscribe(1, { onChange: () => { throw new Error('boom'); }, onClose: () => undefined });
    hub.subscribe(1, { onChange: () => got.push('1-change'), onClose: (r) => got.push(`1-${r}`) });
    hub.subscribe(2, { onChange: () => got.push('2-change'), onClose: (r) => got.push(`2-${r}`) });
    hub.notifyChanged(1);
    hub.closeAll(1, 'token-rotated');
    assert.deepEqual(got, ['1-change', '1-token-rotated']);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('memoização do snapshot público (corrida com invalidação)', () => {
  /** Prisma falso: so o que o TournamentPublicService usa. `gate` segura a leitura para provocar a corrida. */
  function fakePrisma(state: { revision: number; enabled: boolean; calls: number; gate?: Promise<void> }) {
    const tournament = () => ({
      id: 1, organizationId: 10, revision: state.revision, publicEnabled: state.enabled,
      event: { title: 'E', date: new Date(), location: null, imageUrl: null, status: 'PUBLISHED' }, organization: { name: 'G' },
    });
    return {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        state.calls++;
        const snapshot = tournament(); // retrato do instante em que a leitura COMECOU
        if (state.gate) await state.gate;
        return fn({
          tournament: { findUnique: async () => snapshot },
          tournamentCategory: { findMany: async () => [] },
        });
      },
    };
  }
  const TOKEN = 'T'.repeat(32);
  afterEach(() => {
    delete process.env.TOURNAMENT_SNAPSHOT_TTL_MS;
  });

  it('single-flight, cache por TTL, ETag muda com a revisão e 404 uniforme', async () => {
    const state = { revision: 3, enabled: true, calls: 0 };
    const svc = new TournamentPublicService(fakePrisma(state) as never);
    const results = await Promise.all(Array.from({ length: 25 }, () => svc.getSnapshot(TOKEN)));
    assert.equal(state.calls, 1);
    assert.equal(new Set(results.map((r) => r.etag)).size, 1);
    assert.match(results[0].etag, /^"3-[0-9a-f]{10}"$/);
    await svc.getSnapshot(TOKEN);
    assert.equal(state.calls, 1, 'cache');
    process.env.TOURNAMENT_SNAPSHOT_TTL_MS = '0';
    await svc.getSnapshot(TOKEN);
    assert.equal(state.calls, 2, 'TTL 0 = sem cache');
    delete process.env.TOURNAMENT_SNAPSHOT_TTL_MS;
    state.enabled = false;
    svc.invalidate(1);
    const err = await svc.getSnapshot(TOKEN).catch((e) => e);
    assert.deepEqual(err.getResponse(), { statusCode: 404, message: 'Campeonato não encontrado.', code: 'TOURNAMENT_NOT_FOUND' });
    const malformed = await svc.getSnapshot('x').catch((e) => e);
    assert.deepEqual(malformed.getResponse(), err.getResponse(), 'token mal formado: o mesmo corpo');
  });

  it('leitura iniciada ANTES de uma invalidação nunca entra no cache (não serve velho depois da mutação)', async () => {
    let release: () => void = () => undefined;
    const state: { revision: number; enabled: boolean; calls: number; gate?: Promise<void> } = {
      revision: 1, enabled: true, calls: 0, gate: new Promise<void>((r) => (release = r)),
    };
    const svc = new TournamentPublicService(fakePrisma(state) as never);
    const slow = svc.getSnapshot(TOKEN); // le a revisao 1 e fica presa
    await new Promise((r) => setTimeout(r, 10));
    // mutacao confirma (revisao 2) e invalida enquanto a leitura velha ainda esta em voo
    state.revision = 2;
    svc.invalidate(1);
    state.gate = undefined;
    const fresh = await svc.getSnapshot(TOKEN); // nao pode reaproveitar a leitura em voo (epoch mudou)
    assert.match(fresh.etag, /^"2-/);
    release();
    const old = await slow;
    assert.match(old.etag, /^"1-/, 'quem ja estava lendo recebe o retrato antigo, uma vez');
    const after = await svc.getSnapshot(TOKEN);
    assert.match(after.etag, /^"2-/, 'o cache ficou com a revisao nova');
    assert.equal(svc.cacheSize(), 1);
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('memoização: época por torneio e cache negativo', () => {
  interface FakeTournament { id: number; revision: number; enabled: boolean }
  function fakePrisma(byToken: Map<string, FakeTournament>, counters: { calls: number; gate?: Promise<void> }) {
    return {
      $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
        counters.calls++;
        if (counters.gate) await counters.gate;
        return fn({
          tournament: {
            findUnique: async ({ where }: { where: { publicToken: string } }) => {
              const t = byToken.get(where.publicToken);
              return t
                ? { id: t.id, organizationId: 10, revision: t.revision, publicEnabled: t.enabled, event: { title: 'E', date: new Date(), location: null, imageUrl: null, status: 'PUBLISHED' }, organization: { name: 'G' } }
                : null;
            },
          },
          tournamentCategory: { findMany: async () => [] },
        });
      },
    };
  }
  const T1 = 'A'.repeat(32);
  const T2 = 'B'.repeat(32);
  afterEach(() => {
    delete process.env.TOURNAMENT_SNAPSHOT_TTL_MS;
    delete process.env.TOURNAMENT_NEGATIVE_TTL_MS;
  });

  it('mutação (invalidação) em um torneio NÃO quebra o single-flight de outro', async () => {
    const byToken = new Map<string, FakeTournament>([[T1, { id: 1, revision: 1, enabled: true }], [T2, { id: 2, revision: 1, enabled: true }]]);
    const counters: { calls: number; gate?: Promise<void> } = { calls: 0 };
    const svc = new TournamentPublicService(fakePrisma(byToken, counters) as never);
    await svc.getSnapshot(T2); // T2 conhecido (cache quente)
    process.env.TOURNAMENT_SNAPSHOT_TTL_MS = '0'; // forca nova leitura de T2 e deixa o single-flight visivel
    let release: () => void = () => undefined;
    counters.gate = new Promise<void>((r) => (release = r));
    counters.calls = 0;
    const readers = Array.from({ length: 10 }, () => svc.getSnapshot(T2));
    await new Promise((r) => setTimeout(r, 5));
    svc.invalidate(1); // mutacao em OUTRO torneio, com a leitura de T2 em voo
    const late = Array.from({ length: 10 }, () => svc.getSnapshot(T2)); // chegam depois da invalidacao de T1
    release();
    await Promise.all([...readers, ...late]);
    assert.equal(counters.calls, 1, '20 leitores de T2 = 1 montagem, apesar da invalidacao de T1');
  });

  it('cache negativo: 404 repetido custa 1 leitura, corpo idêntico, e a invalidação do torneio libera na hora', async () => {
    const byToken = new Map<string, FakeTournament>([[T1, { id: 1, revision: 1, enabled: false }]]);
    const counters: { calls: number } = { calls: 0 };
    const svc = new TournamentPublicService(fakePrisma(byToken, counters) as never);
    const errors: unknown[] = [];
    for (const t of [T1, T1, T1, T2, T2, 'curto']) errors.push(await svc.getSnapshot(t).catch((e) => e.getResponse()));
    assert.equal(counters.calls, 2, 'T1 (desligado) e T2 (inexistente): 1 leitura cada; o resto vem do negativo ou do formato');
    assert.equal(new Set(errors.map((e) => JSON.stringify(e))).size, 1, 'mesmo corpo em todos os casos');
    assert.equal(svc.negativeSize(), 2);
    // ligar o telao + invalidar = visivel imediatamente (sem esperar o TTL do negativo)
    byToken.get(T1)!.enabled = true;
    svc.invalidate(1);
    assert.match((await svc.getSnapshot(T1)).etag, /^"1-/);
    assert.equal(counters.calls, 3);
    // TTL 0 desliga o negativo
    process.env.TOURNAMENT_NEGATIVE_TTL_MS = '0';
    assert.equal(negativeTtlMs(), 0);
    const T3 = 'C'.repeat(32);
    await svc.getSnapshot(T3).catch(() => undefined);
    await svc.getSnapshot(T3).catch(() => undefined);
    assert.equal(counters.calls, 5, 'sem negativo: cada requisicao vai ao banco');
  });

  it('cache negativo tem teto (varredura de tokens aleatórios não cresce a memória sem limite)', async () => {
    const counters: { calls: number } = { calls: 0 };
    const svc = new TournamentPublicService(fakePrisma(new Map(), counters) as never);
    for (let i = 0; i < 5200; i++) await svc.getSnapshot(`${String(i).padStart(6, '0')}${'x'.repeat(26)}`).catch(() => undefined);
    assert.ok(svc.negativeSize() <= 5000, String(svc.negativeSize()));
  });
});

// ---------------------------------------------------------------------------------------------------------------
describe('frame SSE memoizado e teto de buffer proporcional', () => {
  const entry = (revision: number, tail = '"event":{}}'): PublicEntry => ({
    tournamentId: 1, revision, etag: `"${revision}-x"`, serialized: { revision, tail }, builtAt: Date.now(),
  });

  it('o frame é montado UMA vez por entrada: mesma string e mesmo serverTime para todas as conexões', () => {
    const e = entry(5);
    const a = frameFor(e, new Date('2026-11-20T15:00:00.000Z'));
    const b = frameFor(e, new Date('2030-01-01T00:00:00.000Z')); // outra conexao, outro relogio: reaproveita
    assert.equal(a, b, 'mesmo objeto');
    assert.equal(a.text, b.text);
    assert.match(a.text, /^event: snapshot\nid: 5\ndata: \{"revision":5,"serverTime":"2026-11-20T15:00:00\.000Z",/);
    assert.ok(a.text.endsWith('\n\n'));
    assert.equal(a.bytes, Buffer.byteLength(a.text));
    const c = frameFor(entry(6), new Date('2026-11-21T00:00:00.000Z'));
    assert.notEqual(c, a);
    assert.match(c.text, /id: 6\n/);
    assert.ok(!c.text.slice(0, -2).includes('\n', c.text.indexOf('data: ')), 'o data: e uma linha so');
  });

  it('teto = max(1 MB, 2 x frame) e writeWithLimit sinaliza o cliente lento', () => {
    assert.equal(bufferLimitFor(10), 1024 * 1024);
    assert.equal(bufferLimitFor(1024 * 1024), 2 * 1024 * 1024);
    assert.equal(bufferLimitFor(3 * 1024 * 1024), 6 * 1024 * 1024);
    const res = { writableLength: 0, written: [] as string[], write(chunk: string) { this.written.push(chunk); return true; } };
    assert.equal(writeWithLimit(res as never, 'a', bufferLimitFor(500)), false);
    res.writableLength = 1024 * 1024 + 1; // cliente que nao le: buffer acima do teto
    assert.equal(writeWithLimit(res as never, 'b', bufferLimitFor(500)), true);
    res.writableLength = 1024 * 1024 + 1;
    assert.equal(writeWithLimit(res as never, 'c', bufferLimitFor(600 * 1024)), false, 'frame grande: teto proporcional (1,2 MB)');
    assert.deepEqual(res.written, ['a', 'b', 'c']);
  });
});
