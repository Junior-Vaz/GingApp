import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { RodaRecurrence } from '@prisma/client';
import { buildCheckinToken, peekCheckinToken, verifyCheckinToken } from '../src/shared/checkin/checkin-token';
import { eventCheckinWindow, isInsideWindow, lessonCheckinWindow } from '../src/shared/checkin/checkin-window';
import { describeRecurrence, nextOccurrences } from '../src/interface/http/rodas/roda-recurrence';
import { isFull, spotsLeft } from '../src/interface/http/events/event-registration';

/** Testes de UNIDADE (sem banco): token de check-in por QR, janelas, recorrência de rodas e vagas. */
describe('Check-in por QR (token e janelas)', () => {
  it('token: ida e volta; adulterado, de outro grupo e tipo trocado são rejeitados; aceita URL e minúsculas', () => {
    const token = buildCheckinToken('E', 12, 7);
    assert.match(token, /^E12-[A-HJ-NP-Z2-9]{10}$/);
    assert.deepEqual(verifyCheckinToken(token, 7), { kind: 'E', id: 12 });
    assert.deepEqual(verifyCheckinToken(` ${token.toLowerCase()} `, 7), { kind: 'E', id: 12 });
    assert.deepEqual(verifyCheckinToken(`https://app.x.com/checkin?token=${token}`, 7), { kind: 'E', id: 12 });
    assert.equal(verifyCheckinToken(token, 8), null, 'outro grupo');
    assert.equal(verifyCheckinToken(token.replace('E12', 'E13'), 7), null, 'id trocado');
    assert.equal(verifyCheckinToken(token.replace('E12', 'L12'), 7), null, 'tipo trocado');
    assert.equal(verifyCheckinToken('lixo', 7), null);
    assert.deepEqual(peekCheckinToken(token), { kind: 'E', id: 12 });
  });

  it('janela do evento: 2h antes até 6h depois do início', () => {
    const start = new Date('2026-12-05T13:00:00Z');
    const w = eventCheckinWindow(start);
    assert.equal(isInsideWindow(w, new Date('2026-12-05T10:59:00Z')), false);
    assert.equal(isInsideWindow(w, new Date('2026-12-05T11:01:00Z')), true);
    assert.equal(isInsideWindow(w, new Date('2026-12-05T18:59:00Z')), true);
    assert.equal(isInsideWindow(w, new Date('2026-12-05T19:01:00Z')), false);
  });

  it('janela da aula: HH:mm de São Paulo (UTC-3), 2h antes do início até 2h depois do fim; sem horário vale o dia', () => {
    const day = new Date('2026-12-07T00:00:00Z'); // data civil
    const w = lessonCheckinWindow(day, '19:00', '20:30');
    assert.equal(w.opensAt.toISOString(), '2026-12-07T20:00:00.000Z'); // 17:00 em SP
    assert.equal(w.closesAt.toISOString(), '2026-12-08T01:30:00.000Z'); // 22:30 em SP
    const noTime = lessonCheckinWindow(day, null, null);
    assert.equal(isInsideWindow(noTime, new Date('2026-12-07T15:00:00Z')), true);
  });
});

describe('Recorrência de rodas', () => {
  const sp = (iso: string) => new Date(`${iso}-03:00`);
  const dates = (list: Date[]) => list.map((d) => d.toISOString());

  it('toda 1ª sexta do mês (MONTHLY_WEEKDAY)', () => {
    const base = sp('2026-10-02T20:00:00'); // 1ª sexta de outubro/2026
    const next = nextOccurrences(base, RodaRecurrence.MONTHLY_WEEKDAY, { after: base, count: 3 });
    assert.deepEqual(dates(next), [
      sp('2026-11-06T20:00:00').toISOString(),
      sp('2026-12-04T20:00:00').toISOString(),
      sp('2027-01-01T20:00:00').toISOString(),
    ]);
    assert.equal(describeRecurrence(RodaRecurrence.MONTHLY_WEEKDAY, base), 'toda 1ª sexta do mês');
  });

  it('todo dia X (MONTHLY_DAY) limita o dia 31 ao fim dos meses curtos; semanal soma 7 dias; "until" corta', () => {
    const base = sp('2026-01-31T19:00:00');
    const monthly = nextOccurrences(base, RodaRecurrence.MONTHLY_DAY, { after: base, count: 2 });
    assert.deepEqual(dates(monthly), [sp('2026-02-28T19:00:00').toISOString(), sp('2026-03-31T19:00:00').toISOString()]);
    const weekly = nextOccurrences(base, RodaRecurrence.WEEKLY, { after: base, count: 2 });
    assert.deepEqual(dates(weekly), [sp('2026-02-07T19:00:00').toISOString(), sp('2026-02-14T19:00:00').toISOString()]);
    const cut = nextOccurrences(base, RodaRecurrence.WEEKLY, { after: base, until: sp('2026-02-08T00:00:00'), count: 5 });
    assert.equal(cut.length, 1);
    assert.deepEqual(nextOccurrences(base, RodaRecurrence.NONE, { after: base, count: 3 }), []);
  });
});

describe('Vagas de evento', () => {
  it('spotsLeft/isFull: null = ilimitado; nunca negativo', () => {
    assert.equal(spotsLeft(null, 10), null);
    assert.equal(spotsLeft(5, 3), 2);
    assert.equal(spotsLeft(5, 9), 0);
    assert.equal(isFull(5, 5), true);
    assert.equal(isFull(5, 4), false);
    assert.equal(isFull(null, 999), false);
  });
});
