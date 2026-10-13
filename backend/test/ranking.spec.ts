import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PointEventType } from '@prisma/client';
import { shouldRunBackfill } from '../prisma/ranking-backfill';
import {
  RANKING_CLOSE_CRON_EXPRESSION,
  RANKING_CRON_TIMEZONE,
  RANKING_SYNC_CRON_EXPRESSION,
  isRankingCronEnabled,
} from '../src/jobs/ranking-cron.service';
import {
  LEAGUES,
  RankingSource,
  bandOf,
  checkNickname,
  currentSeason,
  currentStreakWeeks,
  derivePoints,
  displayNameOf,
  isMinor,
  leagueFor,
  nextLeagueFor,
  previousSeason,
  progressPct,
  shortName,
  typesForCategory,
  weekStart,
} from '../src/interface/http/ranking/ranking-rules';

/** Testes de UNIDADE (sem banco) das regras PURAS do Ginga Rank: pontos por tipo, anti-fraude, sequencia, ligas, privacidade. */

const NOW = new Date('2026-10-14T15:00:00.000Z'); // quarta-feira, 12h em Sao Paulo
const day = (d: string): Date => new Date(`${d}T00:00:00.000Z`);
const empty = (): RankingSource => ({ attendances: [], events: [], rodas: [], graduations: [], certificates: [] });
const byType = (source: RankingSource, type: PointEventType) =>
  derivePoints(source, NOW).points.filter((p) => p.type === type);

describe('Ginga Rank: pontos por tipo', () => {
  it('aula presente = 10; falta = 0; aula de dia futuro nao conta', () => {
    const source = empty();
    source.attendances = [
      { lessonId: 1, lessonDate: day('2026-10-07'), present: true },
      { lessonId: 2, lessonDate: day('2026-10-08'), present: false },
      { lessonId: 3, lessonDate: day('2026-10-20'), present: true }, // futuro
    ];
    const rows = byType(source, PointEventType.CLASS_ATTENDANCE);
    assert.deepEqual(rows.map((r) => [r.refType, r.refId, r.points, r.season]), [['Lesson', '1', 10, '2026-10']]);
  });

  it('anti-fraude: maximo 3 pontos de aula por dia civil (4 aulas no dia = 30), 1 por aula', () => {
    const source = empty();
    source.attendances = [1, 2, 3, 4].map((lessonId) => ({ lessonId, lessonDate: day('2026-10-07'), present: true }));
    const rows = byType(source, PointEventType.CLASS_ATTENDANCE);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((r) => r.refId), ['1', '2', '3']);
    // a mesma aula repetida na origem (dado duplicado) nunca gera duas chaves diferentes
    source.attendances.push({ lessonId: 1, lessonDate: day('2026-10-07'), present: true });
    const keys = derivePoints(source, NOW).points.map((p) => `${p.type}|${p.refType}|${p.refId}`);
    assert.equal(new Set(keys).size, keys.length, 'a mesma aula repetida nao gera ponto duplicado');
    assert.equal(byType(source, PointEventType.CLASS_ATTENDANCE).length, 3);
  });

  it('streak: +5 na 2a semana seguida, +10 na 3a ... teto 25; semana sem aula quebra a sequencia', () => {
    const source = empty();
    // segundas-feiras: 09-14, 09-21, 09-28, 10-05 consecutivas; depois pula 10-12; (hoje = quarta 10-14)
    source.attendances = [
      { lessonId: 1, lessonDate: day('2026-09-14'), present: true },
      { lessonId: 2, lessonDate: day('2026-09-23'), present: true },
      { lessonId: 3, lessonDate: day('2026-09-30'), present: true },
      { lessonId: 4, lessonDate: day('2026-10-06'), present: true },
      { lessonId: 5, lessonDate: day('2026-10-14'), present: true }, // semana de 10-12: quebrou? nao, 10-05 -> 10-12 e' consecutiva
    ];
    const streak = byType(source, PointEventType.STREAK_BONUS);
    assert.deepEqual(streak.map((s) => [s.refId, s.points]), [
      ['2026-09-21', 5],
      ['2026-09-28', 10],
      ['2026-10-05', 15],
      ['2026-10-12', 20],
    ]);
    // quebra: tira a aula da semana de 09-28
    source.attendances = source.attendances.filter((a) => a.lessonId !== 3);
    const broken = byType(source, PointEventType.STREAK_BONUS);
    assert.deepEqual(broken.map((s) => [s.refId, s.points]), [['2026-09-21', 5], ['2026-10-12', 5]]);
  });

  it('streak: teto de +25 por semana', () => {
    const source = empty();
    // 8 semanas seguidas terminando em 10-05
    for (let i = 0; i < 8; i += 1) {
      const d = new Date(day('2026-08-17').getTime() + i * 7 * 86_400_000);
      source.attendances.push({ lessonId: 100 + i, lessonDate: d, present: true });
    }
    const points = byType(source, PointEventType.STREAK_BONUS).map((s) => s.points);
    assert.deepEqual(points, [5, 10, 15, 20, 25, 25, 25]);
  });

  it('evento ATTENDED = 30; roda passada = 25; certificado = 20; graduacao = 100 x ordem (minimo 1)', () => {
    const source = empty();
    source.events = [{ eventId: 7, date: new Date('2026-09-05T13:00:00.000Z') }];
    source.rodas = [
      { rodaId: 3, date: new Date('2026-09-20T18:00:00.000Z') },
      { rodaId: 4, date: new Date('2026-11-20T18:00:00.000Z') }, // futura: nao conta
    ];
    source.certificates = [{ id: 9, issuedAt: new Date('2026-09-06T00:00:00.000Z') }];
    source.graduations = [
      { id: 1, graduatedAt: day('2026-03-01'), levelOrder: 0 },
      { id: 2, graduatedAt: day('2026-09-01'), levelOrder: 3 },
    ];
    const all = derivePoints(source, NOW).points;
    const pick = (t: PointEventType) => all.filter((p) => p.type === t).map((p) => [p.refId, p.points]);
    assert.deepEqual(pick(PointEventType.EVENT_ATTENDANCE), [['7', 30]]);
    assert.deepEqual(pick(PointEventType.RODA_PARTICIPATION), [['3', 25]]);
    assert.deepEqual(pick(PointEventType.CERTIFICATE), [['9', 20]]);
    assert.deepEqual(pick(PointEventType.GRADUATION), [['1', 100], ['2', 300]]);
  });

  it('MONTHLY_CONSISTENCY: +50 so em mes encerrado com >=4 chamadas e >=80%', () => {
    const source = empty();
    // setembro: 5 chamadas, 4 presentes = 80%
    source.attendances = [1, 2, 3, 4, 5].map((i) => ({ lessonId: i, lessonDate: day(`2026-09-${String(i * 4).padStart(2, '0')}`), present: i !== 5 }));
    // agosto: 3 chamadas, todas presentes (menos de 4: nao vale)
    source.attendances.push(...[10, 11, 12].map((i) => ({ lessonId: i, lessonDate: day(`2026-08-${i}`), present: true })));
    // outubro (mes corrente): 4 presentes, mas o mes nao acabou
    source.attendances.push(...[20, 21, 22, 23].map((i) => ({ lessonId: i, lessonDate: day(`2026-10-0${i - 19}`), present: true })));
    const rows = byType(source, PointEventType.MONTHLY_CONSISTENCY);
    assert.deepEqual(rows.map((r) => [r.refId, r.points, r.season]), [['2026-09', 50, '2026-09']]);
  });

  it('derivacao e determinística (mesma origem => mesmas linhas): base da idempotencia do syncStudent', () => {
    const source = empty();
    source.attendances = [1, 2, 3].map((i) => ({ lessonId: i, lessonDate: day(`2026-10-0${i}`), present: true }));
    source.graduations = [{ id: 1, graduatedAt: day('2026-10-01'), levelOrder: 2 }];
    assert.deepEqual(derivePoints(source, NOW), derivePoints(source, NOW));
    const keys = derivePoints(source, NOW).points.map((p) => `${p.type}|${p.refType}|${p.refId}`);
    assert.equal(new Set(keys).size, keys.length, 'chave unica (type, refType, refId) sem repeticao');
  });

  it('categorias filtram os tipos de ponto', () => {
    assert.equal(typesForCategory('GENERAL'), null);
    assert.deepEqual(typesForCategory('TRAINING'), ['CLASS_ATTENDANCE', 'STREAK_BONUS', 'MONTHLY_CONSISTENCY']);
    assert.deepEqual(typesForCategory('RODAS'), ['RODA_PARTICIPATION']);
    assert.deepEqual(typesForCategory('EVENTS'), ['EVENT_ATTENDANCE']);
  });
});

describe('Ginga Rank: conquistas', () => {
  it('SEQ_4W, FIRST_GRADUATION, RODA_10, EVENT_5, PERFECT_MONTH e CENTURION', () => {
    const source = empty();
    // 100 aulas presentes em dias distintos (1/dia) em ~14 semanas seguidas (7 por semana), setembro-outubro; PERFECT_MONTH em 2026-06
    for (let i = 0; i < 100; i += 1) {
      source.attendances.push({ lessonId: 1000 + i, lessonDate: new Date(day('2026-06-01').getTime() + i * 86_400_000), present: true });
    }
    source.events = Array.from({ length: 5 }, (_, i) => ({ eventId: i + 1, date: new Date(`2026-08-0${i + 1}T15:00:00.000Z`) }));
    source.rodas = Array.from({ length: 10 }, (_, i) => ({ rodaId: i + 1, date: new Date(`2026-08-${10 + i}T15:00:00.000Z`) }));
    source.graduations = [{ id: 1, graduatedAt: day('2026-05-10'), levelOrder: 1 }];
    const codes = derivePoints(source, NOW).achievements.map((a) => a.code).sort();
    assert.deepEqual(codes, ['CENTURION', 'EVENT_5', 'FIRST_GRADUATION', 'PERFECT_MONTH', 'RODA_10', 'SEQ_4W']);
  });

  it('sem os minimos nenhuma conquista', () => {
    const source = empty();
    source.events = [{ eventId: 1, date: new Date('2026-08-01T15:00:00.000Z') }];
    assert.deepEqual(derivePoints(source, NOW).achievements, []);
  });
});

describe('Ginga Rank: ligas', () => {
  it('limites das ligas e progresso', () => {
    assert.deepEqual(LEAGUES.map((l) => [l.code, l.minPoints, l.color]), [
      ['CRUA', 0, '#E5E5E5'],
      ['VERDE', 300, '#22C55E'],
      ['AMARELA', 900, '#FACC15'],
      ['AZUL', 2000, '#3B82F6'],
      ['ROXA', 4000, '#8B5CF6'],
      ['MARROM', 7500, '#92400E'],
      ['PRETA', 12000, '#111827'],
    ]);
    // Nomes de exibicao NAO repetem os das cordas (Crua/Verde/Amarela...): so os codigos e cores seguem os antigos.
    assert.deepEqual(LEAGUES.map((l) => l.name), ['Semente', 'Broto', 'Ginga', 'Roda', 'Axé', 'Mandinga', 'Lenda']);
    assert.equal(leagueFor(0).code, 'CRUA');
    assert.equal(leagueFor(299).code, 'CRUA');
    assert.equal(leagueFor(300).code, 'VERDE');
    assert.equal(leagueFor(11999).code, 'MARROM');
    assert.equal(leagueFor(12000).code, 'PRETA');
    assert.equal(nextLeagueFor(12000), null);
    assert.equal(nextLeagueFor(150)?.code, 'VERDE');
    assert.equal(progressPct(150), 50);
    assert.equal(progressPct(12500), 100);
  });
});

describe('Ginga Rank: privacidade e apresentacao', () => {
  it('nome curto, apelido e faixas etarias', () => {
    assert.equal(shortName('Maria da Silva'), 'Maria S.');
    assert.equal(shortName('  Pedro   Henrique Lacerda '), 'Pedro L.');
    assert.equal(shortName('Zeca'), 'Zeca');
    assert.equal(displayNameOf('Maria da Silva', 'Mari'), 'Mari');
    assert.equal(displayNameOf('Maria da Silva', '  '), 'Maria S.');
    assert.equal(bandOf(null, NOW), 'ADULT');
    assert.equal(bandOf(day('2014-10-15'), NOW), 'KIDS'); // 11 anos
    assert.equal(bandOf(day('2013-10-14'), NOW), 'YOUTH'); // 13 hoje
    assert.equal(bandOf(day('2009-10-15'), NOW), 'YOUTH'); // 16
    assert.equal(bandOf(day('2008-10-14'), NOW), 'ADULT'); // 18 hoje
    assert.equal(isMinor(day('2010-01-01'), NOW), true);
    assert.equal(isMinor(null, NOW), false);
  });

  it('apelido: 2-20 caracteres, letras/numeros/espaco/._-, sem palavrao', () => {
    assert.deepEqual(checkNickname('  Ju   da Roda '), { ok: true, value: 'Ju da Roda' });
    assert.deepEqual(checkNickname(null), { ok: true, value: null });
    assert.deepEqual(checkNickname('   '), { ok: true, value: null });
    assert.deepEqual(checkNickname('Zé_do-Axé.2'), { ok: true, value: 'Zé_do-Axé.2' });
    for (const bad of ['a', 'x'.repeat(21), 'rock<script>', 'o@o!', 'café ☕', 'Seu Merda', 'p0rr4', 'fdp', 'PUTA']) {
      assert.equal(checkNickname(bad).ok, false, bad);
    }
    // palavras legitimas que contem trechos de palavroes continuam valendo
    for (const good of ['Computador', 'Cultura', 'Capoeira Raiz', 'Pauline']) {
      assert.equal(checkNickname(good).ok, true, good);
    }
  });
});

describe('Ginga Rank: temporadas e datas', () => {
  it('temporada no fuso de Sao Paulo, mes anterior, inicio da semana e sequencia atual', () => {
    assert.equal(currentSeason(new Date('2026-11-01T01:30:00.000Z')), '2026-10'); // 22:30 de 31/10 em SP
    assert.equal(currentSeason(new Date('2026-11-01T03:00:00.000Z')), '2026-11');
    assert.equal(previousSeason('2026-01'), '2025-12');
    assert.equal(previousSeason('2026-10'), '2026-09');
    assert.equal(weekStart('2026-10-14'), '2026-10-12'); // quarta -> segunda
    assert.equal(weekStart('2026-10-18'), '2026-10-12'); // domingo -> segunda
    // hoje quarta 10-14; semanas com presenca: 09-28, 10-05 (semana atual ainda sem aula) => sequencia 2
    assert.equal(currentStreakWeeks(['2026-09-28', '2026-10-05'], '2026-10-14'), 2);
    assert.equal(currentStreakWeeks(['2026-09-28', '2026-10-05', '2026-10-12'], '2026-10-14'), 3);
    assert.equal(currentStreakWeeks(['2026-09-14'], '2026-10-14'), 0);
  });
});

describe('Ginga Rank: backfill no boot', () => {
  it('RANKING_BACKFILL: true roda sempre, false nunca, padrao 1x (tabela vazia); manual roda sempre', () => {
    assert.equal(shouldRunBackfill('auto', {}, 0), true);
    assert.equal(shouldRunBackfill('auto', {}, 5), false);
    assert.equal(shouldRunBackfill('auto', { RANKING_BACKFILL: 'true' }, 5), true);
    assert.equal(shouldRunBackfill('auto', { RANKING_BACKFILL: 'false' }, 0), false);
    assert.equal(shouldRunBackfill('manual', {}, 5), true);
    assert.equal(shouldRunBackfill('manual', { RANKING_BACKFILL: 'false' }, 5), false);
  });
});

describe('Ginga Rank: jobs agendados', () => {
  it('02:30 diario (recalculo) e 03:00 do dia 1 (fechamento), America/Sao_Paulo; RANKING_CRON=false desliga', () => {
    assert.equal(RANKING_SYNC_CRON_EXPRESSION, '30 2 * * *');
    assert.equal(RANKING_CLOSE_CRON_EXPRESSION, '0 3 1 * *');
    assert.equal(RANKING_CRON_TIMEZONE, 'America/Sao_Paulo');
    assert.equal(isRankingCronEnabled({ RANKING_CRON: 'false' }), false);
    assert.equal(isRankingCronEnabled({}), true);
    assert.equal(isRankingCronEnabled({ RANKING_CRON: 'true' }), true);
  });
});
