import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PointEventType } from '@prisma/client';
import {
  ACHIEVEMENTS,
  ACHIEVEMENT_FAMILIES,
  DAILY_MONTH_CAP_DAYS,
  DAILY_WEEK_TARGET,
  LEGACY_ACHIEVEMENT_CODES,
  POINTS,
  RankingSource,
  achievementDef,
  achievementProgress,
  bestStreakWeeks,
  derivePoints,
  fullMonthsBetween,
  lastInstantOfSeason,
  monthLabelPt,
  pointDay,
  rankingRules,
  shouldNotifyAchievement,
  typesForCategory,
} from '../src/interface/http/ranking/ranking-rules';

/**
 * Testes de UNIDADE (sem banco) do Ginga Rank — lado do aluno (docs/CONTRATO_RANK_ALUNO.md): check-in diario (ponto,
 * teto mensal, bonus de semana ENCERRADA), catalogo novo de conquistas nos limites exatos (e 1 abaixo), contadores de
 * progresso, janela de notificacao e as constantes de "Como funciona".
 */

const NOW = new Date('2026-10-14T15:00:00.000Z'); // quarta-feira, 12h em Sao Paulo (semana de 2026-10-12)
const DAY = 86_400_000;
const day = (d: string): Date => new Date(`${d}T00:00:00.000Z`);
const noon = (d: string): Date => new Date(`${d}T12:00:00.000Z`);
const addDays = (d: string, n: number): string => new Date(day(d).getTime() + n * DAY).toISOString().slice(0, 10);
const empty = (): RankingSource => ({ attendances: [], events: [], rodas: [], graduations: [], certificates: [] });
const derive = (source: RankingSource, now = NOW) => derivePoints(source, now);
const codesOf = (source: RankingSource, now = NOW) => derive(source, now).achievements.map((a) => a.code);
const has = (source: RankingSource, code: string, now = NOW) => codesOf(source, now).includes(code);
const earnedAt = (source: RankingSource, code: string) => derive(source).achievements.find((a) => a.code === code)?.earnedAt;
const byType = (source: RankingSource, type: PointEventType) => derive(source).points.filter((p) => p.type === type);

/** n dias seguidos terminando em `last` (inclusive). */
const daysEnding = (last: string, n: number): string[] => Array.from({ length: n }, (_, i) => addDays(last, i - n + 1));
/** n aulas presentes, 1 por dia, terminando em `last`. */
const lessonsEnding = (last: string, n: number) =>
  daysEnding(last, n).map((d, i) => ({ lessonId: i + 1, lessonDate: day(d), present: true }));
/** 1 presenca na segunda-feira de cada uma das n semanas seguidas terminando na semana de `lastMonday`. */
const weeklyEnding = (lastMonday: string, n: number) =>
  Array.from({ length: n }, (_, i) => ({ lessonId: 5000 + i, lessonDate: day(addDays(lastMonday, -7 * (n - 1 - i))), present: true }));
/** 4 aulas presentes no meio de cada mes listado. */
const monthsAll = (months: string[]) =>
  months.flatMap((m, mi) => [3, 10, 17, 24].map((d, di) => ({ lessonId: 9000 + mi * 10 + di, lessonDate: day(`${m}-${String(d).padStart(2, '0')}`), present: true })));
/** check-ins de segunda a sexta (5 dias) de cada semana listada (segundas). */
const workweeks = (mondays: string[]) => mondays.flatMap((m) => daysEnding(addDays(m, 4), 5));

describe('Ginga Rank (aluno): check-in diario', () => {
  it('1 ponto por dia de check-in (refType Day, refId do dia, temporada do mes); dia futuro e duplicado nao contam', () => {
    const source = { ...empty(), dailyCheckins: ['2026-10-01', '2026-10-01', '2026-10-02', '2026-10-15', 'lixo'] };
    const rows = byType(source, PointEventType.DAILY_CHECKIN);
    assert.deepEqual(rows.map((r) => [r.refType, r.refId, r.points, r.season, r.occurredAt.toISOString()]), [
      ['Day', '2026-10-01', 1, '2026-10', '2026-10-01T12:00:00.000Z'],
      ['Day', '2026-10-02', 1, '2026-10', '2026-10-02T12:00:00.000Z'],
    ]);
    assert.equal(POINTS.DAILY_CHECKIN, 1);
    assert.equal(derive(source).counters.dailyCheckins, 2);
  });

  it('teto mensal: so os primeiros 20 dias do mes pontuam; os demais contam para o contador (conquistas)', () => {
    assert.equal(DAILY_MONTH_CAP_DAYS, 20);
    const source = { ...empty(), dailyCheckins: [...daysEnding('2026-09-25', 25), ...daysEnding('2026-10-03', 3)] };
    const rows = byType(source, PointEventType.DAILY_CHECKIN);
    const sept = rows.filter((r) => r.season === '2026-09');
    assert.equal(sept.length, 20);
    assert.deepEqual(sept.map((r) => r.refId), daysEnding('2026-09-20', 20), 'os 20 PRIMEIROS dias do mes');
    assert.equal(rows.filter((r) => r.season === '2026-10').length, 3, 'o teto e por mes');
    assert.equal(derive(source).counters.dailyCheckins, 28);
    // exatamente 20 = todos pontuam; 21 = um sem ponto
    assert.equal(byType({ ...empty(), dailyCheckins: daysEnding('2026-09-20', 20) }, PointEventType.DAILY_CHECKIN).length, 20);
    assert.equal(byType({ ...empty(), dailyCheckins: daysEnding('2026-09-21', 21) }, PointEventType.DAILY_CHECKIN).length, 20);
  });

  it('semana em dia: +5 so com a semana ENCERRADA e >= 5 dias, 1 por semana; 4 dias nao; semana corrente nao', () => {
    assert.equal(DAILY_WEEK_TARGET, 5);
    assert.equal(POINTS.DAILY_WEEK_BONUS, 5);
    const source = {
      ...empty(),
      dailyCheckins: [
        ...daysEnding('2026-10-11', 7), // semana de 10-05: 7 dias (encerrada no domingo 10-11) => 1 bonus so
        ...daysEnding('2026-09-24', 4), // semana de 09-21: 4 dias => sem bonus
        ...daysEnding('2026-10-14', 3), // semana corrente (10-12..10-14) nao encerrada
      ],
    };
    const bonus = byType(source, PointEventType.DAILY_WEEK_BONUS);
    assert.deepEqual(bonus.map((b) => [b.refType, b.refId, b.points, b.season, b.occurredAt.toISOString()]), [
      ['Week', '2026-10-05', 5, '2026-10', '2026-10-11T12:00:00.000Z'],
    ]);
    // semana corrente com 5 dias (seg..sex, "hoje" = sexta) ainda nao fecha
    const friday = new Date('2026-10-16T15:00:00.000Z');
    assert.equal(
      derivePoints({ ...empty(), dailyCheckins: daysEnding('2026-10-16', 5) }, friday).points.filter((p) => p.type === PointEventType.DAILY_WEEK_BONUS).length,
      0,
    );
    // no domingo ela ainda esta aberta; na segunda seguinte o bonus aparece
    const sunday = new Date('2026-10-18T15:00:00.000Z');
    const monday = new Date('2026-10-19T15:00:00.000Z');
    const five = { ...empty(), dailyCheckins: daysEnding('2026-10-16', 5) };
    assert.equal(derivePoints(five, sunday).points.filter((p) => p.type === PointEventType.DAILY_WEEK_BONUS).length, 0);
    assert.deepEqual(
      derivePoints(five, monday).points.filter((p) => p.type === PointEventType.DAILY_WEEK_BONUS).map((p) => p.refId),
      ['2026-10-12'],
    );
  });

  it('semana que cruza o mes: o bonus vai para a temporada do domingo; os dias acima do teto ainda contam para a semana', () => {
    const cross = byType({ ...empty(), dailyCheckins: daysEnding('2026-10-02', 5) }, PointEventType.DAILY_WEEK_BONUS);
    assert.deepEqual(cross.map((b) => [b.refId, b.season]), [['2026-09-28', '2026-10']]);
    // setembro com 30 dias: dias 21..30 nao pontuam, mas a semana de 09-21 (5+ dias) ganha o bonus
    const capped = { ...empty(), dailyCheckins: daysEnding('2026-09-30', 30) };
    assert.ok(byType(capped, PointEventType.DAILY_WEEK_BONUS).some((b) => b.refId === '2026-09-21'));
  });

  it('categoria: DAILY_* so entram no GENERAL (null = todos), nunca em TRAINING/RODAS/EVENTS', () => {
    assert.equal(typesForCategory('GENERAL'), null);
    for (const category of ['TRAINING', 'RODAS', 'EVENTS'] as const) {
      const types = typesForCategory(category) ?? [];
      assert.ok(!types.includes(PointEventType.DAILY_CHECKIN) && !types.includes(PointEventType.DAILY_WEEK_BONUS), category);
    }
  });
});

describe('Ginga Rank (aluno): catalogo de conquistas', () => {
  it('codigos unicos, familias com icone, nivel valido, meta e contador coerentes; os 6 originais intactos', () => {
    const codes = ACHIEVEMENTS.map((a) => a.code);
    assert.equal(new Set(codes).size, codes.length, 'sem codigo repetido');
    assert.equal(codes.length, 33);
    for (const a of ACHIEVEMENTS) {
      assert.ok(ACHIEVEMENT_FAMILIES.some((f) => f.family === a.family), a.code);
      assert.ok(a.tier === 'BRONZE' || a.tier === 'SILVER' || a.tier === 'GOLD', a.code);
      assert.equal(a.target === null, a.counter === null, `${a.code}: target e counter juntos`);
    }
    assert.deepEqual(ACHIEVEMENT_FAMILIES.map((f) => f.icon), ['presenca', 'sequencia', 'mes', 'rodas', 'eventos', 'jornada', 'tempo', 'diario']);
    assert.deepEqual([...LEGACY_ACHIEVEMENT_CODES].sort(), ['CENTURION', 'EVENT_5', 'FIRST_GRADUATION', 'PERFECT_MONTH', 'RODA_10', 'SEQ_4W']);
    const legacy = (code: string) => {
      const d = achievementDef(code);
      return d && [d.name, d.description, d.tier];
    };
    assert.deepEqual(legacy('SEQ_4W'), ['Sequência de 4 semanas', 'Treinou 4 semanas seguidas.', 'BRONZE']);
    assert.deepEqual(legacy('FIRST_GRADUATION'), ['Primeira corda', 'Recebeu a primeira graduação.', 'BRONZE']);
    assert.deepEqual(legacy('RODA_10'), ['Rodeiro', 'Participou de 10 rodas.', 'SILVER']);
    assert.deepEqual(legacy('EVENT_5'), ['Presença em eventos', 'Esteve em 5 eventos do grupo.', 'SILVER']);
    assert.deepEqual(legacy('PERFECT_MONTH'), ['Mês perfeito', '100% de presença em um mês (mínimo de 4 aulas).', 'GOLD']);
    assert.deepEqual(legacy('CENTURION'), ['Centurião', 'Chegou a 100 aulas presentes.', 'SILVER']);
    assert.equal(achievementDef('PERFECT_MONTH')?.target, null);
    assert.equal(achievementDef('COMEBACK')?.target, null);
  });

  it('PRESENCA: AULAS_25 / CENTURION / AULAS_250 / AULAS_500 / AULAS_1000 nos limites exatos e 1 abaixo (earnedAt = n-esima aula)', () => {
    for (const [code, n] of [['AULAS_25', 25], ['CENTURION', 100], ['AULAS_250', 250], ['AULAS_500', 500], ['AULAS_1000', 1000]] as const) {
      const at = { ...empty(), attendances: lessonsEnding('2026-10-13', n) };
      const below = { ...empty(), attendances: lessonsEnding('2026-10-13', n - 1) };
      assert.ok(has(at, code), `${code} com ${n}`);
      assert.ok(!has(below, code), `${code} com ${n - 1}`);
      assert.equal(earnedAt(at, code)?.toISOString(), day('2026-10-13').toISOString());
      assert.equal(derive(at).counters.lessons, n);
    }
    // anti-fraude: 4 aulas no mesmo dia contam 3 para o contador tambem
    const sameDay = { ...empty(), attendances: [1, 2, 3, 4].map((id) => ({ lessonId: id, lessonDate: day('2026-10-07'), present: true })) };
    assert.equal(derive(sameDay).counters.lessons, 3);
  });

  it('SEQUENCIA: SEQ_4W / 8W / 12W / 26W / 52W nos limites exatos e 1 abaixo; SEQ_4W inalterado', () => {
    for (const [code, n] of [['SEQ_4W', 4], ['SEQ_8W', 8], ['SEQ_12W', 12], ['SEQ_26W', 26], ['SEQ_52W', 52]] as const) {
      assert.ok(has({ ...empty(), attendances: weeklyEnding('2026-10-12', n) }, code), `${code} com ${n}`);
      assert.ok(!has({ ...empty(), attendances: weeklyEnding('2026-10-12', n - 1) }, code), `${code} com ${n - 1}`);
    }
    const eight = { ...empty(), attendances: weeklyEnding('2026-10-12', 8) };
    assert.equal(earnedAt(eight, 'SEQ_8W')?.toISOString(), noon('2026-10-12').toISOString());
    assert.equal(earnedAt(eight, 'SEQ_4W')?.toISOString(), noon('2026-09-14').toISOString(), 'SEQ_4W na 4a semana seguida (como sempre)');
    assert.equal(derive(eight).counters.bestStreakWeeks, 8);
  });

  it('MES: CONSISTENT_3M / 6M (meses SEGUIDOS com bonus) nos limites e 1 abaixo; buraco quebra; mes corrente nao conta', () => {
    const three = { ...empty(), attendances: monthsAll(['2026-05', '2026-06', '2026-07']) };
    assert.ok(has(three, 'CONSISTENT_3M'));
    assert.equal(earnedAt(three, 'CONSISTENT_3M')?.toISOString(), lastInstantOfSeason('2026-07').toISOString());
    assert.ok(!has({ ...empty(), attendances: monthsAll(['2026-06', '2026-07']) }, 'CONSISTENT_3M'));
    assert.ok(!has({ ...empty(), attendances: monthsAll(['2026-04', '2026-05', '2026-07', '2026-08']) }, 'CONSISTENT_3M'), 'buraco em junho');
    assert.ok(!has({ ...empty(), attendances: monthsAll(['2026-08', '2026-09', '2026-10']) }, 'CONSISTENT_3M'), 'outubro ainda aberto');
    const six = { ...empty(), attendances: monthsAll(['2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']) };
    assert.ok(has(six, 'CONSISTENT_6M'));
    assert.equal(derive(six).counters.bestConsistentMonths, 6);
    assert.ok(!has({ ...empty(), attendances: monthsAll(['2026-04', '2026-05', '2026-06', '2026-07', '2026-08']) }, 'CONSISTENT_6M'));
  });

  it('RODAS e EVENTOS: 1 / 10 / 25 / 50 e 1 / 5 / 15 / 30 nos limites exatos e 1 abaixo', () => {
    const rodas = (n: number) => ({ ...empty(), rodas: Array.from({ length: n }, (_, i) => ({ rodaId: i + 1, date: new Date(NOW.getTime() - (i + 1) * DAY) })) });
    const events = (n: number) => ({ ...empty(), events: Array.from({ length: n }, (_, i) => ({ eventId: i + 1, date: new Date(NOW.getTime() - (i + 1) * DAY) })) });
    for (const [code, n] of [['RODA_1', 1], ['RODA_10', 10], ['RODA_25', 25], ['RODA_50', 50]] as const) {
      assert.ok(has(rodas(n), code), `${code} ${n}`);
      assert.ok(!has(rodas(n - 1), code), `${code} ${n - 1}`);
    }
    for (const [code, n] of [['EVENT_1', 1], ['EVENT_5', 5], ['EVENT_15', 15], ['EVENT_30', 30]] as const) {
      assert.ok(has(events(n), code), `${code} ${n}`);
      assert.ok(!has(events(n - 1), code), `${code} ${n - 1}`);
    }
    // roda futura nao conta (nem para o contador)
    const future = { ...empty(), rodas: [{ rodaId: 1, date: new Date(NOW.getTime() + DAY) }] };
    assert.equal(derive(future).counters.rodas, 0);
    assert.ok(!has(future, 'RODA_1'));
  });

  it('JORNADA: FIRST_GRADUATION / GRADUATIONS_3 / GRADUATIONS_5 / CERTIFICATES_3 nos limites e 1 abaixo', () => {
    const grads = (n: number) => ({ ...empty(), graduations: Array.from({ length: n }, (_, i) => ({ id: i + 1, graduatedAt: day(`2025-0${i + 1}-10`), levelOrder: i + 1 })) });
    for (const [code, n] of [['FIRST_GRADUATION', 1], ['GRADUATIONS_3', 3], ['GRADUATIONS_5', 5]] as const) {
      assert.ok(has(grads(n), code), `${code} ${n}`);
      assert.ok(!has(grads(n - 1), code), `${code} ${n - 1}`);
    }
    assert.equal(earnedAt(grads(3), 'GRADUATIONS_3')?.toISOString(), day('2025-03-10').toISOString());
    // certificados fora de ordem: earnedAt = o 3o pela data de emissao
    const certs = { ...empty(), certificates: [{ id: 3, issuedAt: day('2026-03-01') }, { id: 1, issuedAt: day('2026-01-01') }, { id: 2, issuedAt: day('2026-02-01') }] };
    assert.equal(earnedAt(certs, 'CERTIFICATES_3')?.toISOString(), day('2026-03-01').toISOString());
    assert.ok(!has({ ...empty(), certificates: certs.certificates.slice(0, 2) }, 'CERTIFICATES_3'));
  });

  it('TEMPO: YEARS_1 / 2 / 5 desde a primeira data conhecida (matricula ou 1a presenca, a mais antiga) no dia exato e 1 dia antes', () => {
    const joined = (d: string) => ({ ...empty(), joinedAt: day(d) });
    assert.ok(has(joined('2025-10-14'), 'YEARS_1'));
    assert.equal(earnedAt(joined('2025-10-14'), 'YEARS_1')?.toISOString(), noon('2026-10-14').toISOString());
    assert.ok(!has(joined('2025-10-15'), 'YEARS_1'), 'falta 1 dia');
    assert.equal(derive(joined('2025-10-15')).counters.monthsInGroup, 11);
    assert.ok(has(joined('2024-10-14'), 'YEARS_2') && !has(joined('2024-10-15'), 'YEARS_2'));
    assert.ok(has(joined('2021-10-14'), 'YEARS_5') && !has(joined('2021-10-15'), 'YEARS_5'));
    // primeira presenca mais antiga que a matricula vale
    const older = { ...empty(), joinedAt: day('2026-01-01'), attendances: [{ lessonId: 1, lessonDate: day('2024-10-01'), present: true }] };
    assert.ok(has(older, 'YEARS_2'));
    assert.equal(derive(older).firstKnownDay, '2024-10-01');
    // falta nao e' presenca; sem data nenhuma = 0 meses e nenhuma conquista de tempo
    assert.equal(derive({ ...empty(), attendances: [{ lessonId: 1, lessonDate: day('2020-01-01'), present: false }] }).firstKnownDay, null);
    assert.equal(derive(empty()).counters.monthsInGroup, 0);
    // matricula no futuro e' ignorada
    assert.equal(derive(joined('2027-01-01')).firstKnownDay, null);
  });

  it('TEMPO: COMEBACK = presenca depois de >= 30 dias sem nenhuma (30 sim, 29 nao); a primeira presenca da vida nao conta', () => {
    const pair = (a: string, b: string) => ({
      ...empty(),
      attendances: [
        { lessonId: 1, lessonDate: day(a), present: true },
        { lessonId: 2, lessonDate: day(b), present: true },
      ],
    });
    assert.ok(has(pair('2026-08-01', '2026-08-31'), 'COMEBACK'));
    assert.equal(earnedAt(pair('2026-08-01', '2026-08-31'), 'COMEBACK')?.toISOString(), day('2026-08-31').toISOString());
    assert.ok(!has(pair('2026-08-01', '2026-08-30'), 'COMEBACK'));
    assert.ok(!has({ ...empty(), attendances: [{ lessonId: 1, lessonDate: day('2026-08-01'), present: true }] }, 'COMEBACK'));
  });

  it('DIARIO: DAILY_7 / 30 / 100 e WEEK_OK_4 (4 semanas em dia SEGUIDAS) nos limites e 1 abaixo', () => {
    for (const [code, n] of [['DAILY_7', 7], ['DAILY_30', 30], ['DAILY_100', 100]] as const) {
      assert.ok(has({ ...empty(), dailyCheckins: daysEnding('2026-10-13', n) }, code), `${code} ${n}`);
      assert.ok(!has({ ...empty(), dailyCheckins: daysEnding('2026-10-13', n - 1) }, code), `${code} ${n - 1}`);
    }
    // DAILY_* contam todos os dias, inclusive acima do teto mensal de pontos
    assert.ok(has({ ...empty(), dailyCheckins: daysEnding('2026-09-30', 30) }, 'DAILY_30'));
    const four = { ...empty(), dailyCheckins: workweeks(['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05']) };
    assert.ok(has(four, 'WEEK_OK_4'));
    assert.equal(earnedAt(four, 'WEEK_OK_4')?.toISOString(), noon('2026-10-11').toISOString());
    assert.equal(derive(four).counters.bestDailyWeekRun, 4);
    assert.ok(!has({ ...empty(), dailyCheckins: workweeks(['2026-09-21', '2026-09-28', '2026-10-05']) }, 'WEEK_OK_4'));
    const broken = { ...empty(), dailyCheckins: workweeks(['2026-08-31', '2026-09-07', '2026-09-14', '2026-09-28', '2026-10-05']) };
    assert.ok(!has(broken, 'WEEK_OK_4'), 'a semana de 09-21 sem check-in quebra a sequencia');
    assert.equal(derive(broken).counters.bestDailyWeekRun, 3);
    // a semana corrente (nao encerrada) nao entra na sequencia
    assert.ok(!has({ ...empty(), dailyCheckins: [...workweeks(['2026-09-21', '2026-09-28', '2026-10-05']), ...daysEnding('2026-10-14', 3)] }, 'WEEK_OK_4'));
  });

  it('progresso vem dos contadores da derivacao (current limitado ao target; null quando nao contavel)', () => {
    const d = derive({ ...empty(), attendances: lessonsEnding('2026-10-13', 30), dailyCheckins: daysEnding('2026-10-13', 3) });
    assert.deepEqual(achievementProgress(achievementDef('AULAS_25')!, d.counters), { current: 25, target: 25 });
    assert.deepEqual(achievementProgress(achievementDef('CENTURION')!, d.counters), { current: 30, target: 100 });
    assert.deepEqual(achievementProgress(achievementDef('DAILY_7')!, d.counters), { current: 3, target: 7 });
    assert.equal(achievementProgress(achievementDef('PERFECT_MONTH')!, d.counters), null);
    assert.equal(achievementProgress(achievementDef('COMEBACK')!, d.counters), null);
  });

  it('notificacao: conquista nova so se atingida nos ultimos 7 dias; as 6 originais seguem como sempre', () => {
    const sevenDaysAgo = new Date(NOW.getTime() - 7 * DAY);
    assert.equal(shouldNotifyAchievement('AULAS_25', sevenDaysAgo, NOW), true);
    assert.equal(shouldNotifyAchievement('AULAS_25', new Date(sevenDaysAgo.getTime() - 1), NOW), false);
    assert.equal(shouldNotifyAchievement('FIRST_GRADUATION', day('2019-03-15'), NOW), true);
  });
});

describe('Ginga Rank (aluno): utilitarios e "Como funciona"', () => {
  it('pointDay: aula/graduacao pela data civil; instantes pelo dia de Sao Paulo', () => {
    assert.equal(pointDay(PointEventType.CLASS_ATTENDANCE, day('2026-10-05')), '2026-10-05');
    assert.equal(pointDay(PointEventType.GRADUATION, day('2026-10-05')), '2026-10-05');
    assert.equal(pointDay(PointEventType.EVENT_ATTENDANCE, new Date('2026-10-06T01:00:00.000Z')), '2026-10-05'); // 22h em SP
    assert.equal(pointDay(PointEventType.DAILY_CHECKIN, noon('2026-10-05')), '2026-10-05');
  });

  it('fullMonthsBetween, bestStreakWeeks e monthLabelPt', () => {
    assert.equal(fullMonthsBetween('2025-10-14', '2026-10-14'), 12);
    assert.equal(fullMonthsBetween('2025-10-15', '2026-10-14'), 11);
    assert.equal(fullMonthsBetween('2026-10-14', '2026-10-01'), 0);
    assert.equal(bestStreakWeeks(['2026-09-07', '2026-09-14', '2026-09-28', '2026-10-05', '2026-10-12']), 3);
    assert.equal(bestStreakWeeks([]), 0);
    assert.equal(monthLabelPt('2026-03'), 'março/2026');
  });

  it('rankingRules devolve as constantes REAIS (pontos, limites, ligas, categorias, faixas, catalogo, temporadas)', () => {
    const r = rankingRules();
    assert.deepEqual(r.points, {
      classAttendance: 10, streakStep: 5, streakMax: 25, eventAttendance: 30, rodaParticipation: 25,
      monthlyConsistency: 50, graduationPerLevel: 100, certificate: 20, dailyCheckin: 1, dailyWeekBonus: 5,
    });
    assert.deepEqual(r.limits, { maxClassPointsPerDay: 3, consistencyMinRate: 0.8, consistencyMinLessons: 4, dailyWeekTarget: 5, dailyMonthCapDays: 20 });
    assert.equal(r.leagues.length, 7);
    assert.deepEqual(r.categories.map((c) => c.code), ['GENERAL', 'TRAINING', 'RODAS', 'EVENTS']);
    assert.deepEqual(r.bands.map((b) => b.code), ['KIDS', 'YOUTH', 'ADULT']);
    assert.equal(r.achievements.length, ACHIEVEMENTS.length);
    assert.deepEqual(r.seasons, { lengthLabel: 'mensal', timezone: 'America/Sao_Paulo' });
  });
});
