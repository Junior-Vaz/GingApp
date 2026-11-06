import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LedgerCategory, LedgerEntryType } from '@prisma/client';
import {
  addMonths,
  aggregateMonth,
  blankToNullText,
  categoryLabel,
  costPerActiveStudentCents,
  currentMonthSaoPaulo,
  goalCoveragePct,
  isMonthClosed,
  isMonthKey,
  isValidAmountCents,
  isValidPair,
  LEDGER_CATEGORIES,
  monthLockKey,
  monthOf,
  monthWindow,
  occurredOnError,
  reserveCents,
} from '../src/interface/http/transparency/transparency-rules';
import { buildRequestLogLine } from '../src/shared/observability/request-log.middleware';
import { AUDIT_ACTION_CODES } from '../src/shared/audit/audit-actions';

/** Regras PURAS da transparencia (docs/CONTRATO_TRANSPARENCIA.md). O comportamento HTTP esta em transparency.e2e-spec.ts. */
const { RECEITA, DESPESA } = LedgerEntryType;

describe('Transparência: par tipo × categoria (contrato 2.1)', () => {
  const despesas = ['HOSPEDAGEM', 'MAPAS', 'ARMAZENAMENTO_BACKUP', 'NOTIFICACOES', 'EMAIL', 'DOMINIO', 'FERRAMENTAS', 'PESSOAS_SUPORTE', 'IMPOSTOS_TARIFAS', 'OUTROS_DESPESA'];
  const receitas = ['APOIO', 'PATROCINIO', 'EDITAIS_OUTROS'];

  it('o catálogo é exatamente a lista fechada do contrato e cobre o enum do Prisma', () => {
    assert.deepEqual(Object.keys(LEDGER_CATEGORIES).sort(), [...despesas, ...receitas].sort());
    assert.deepEqual(Object.values(LedgerCategory).sort(), [...despesas, ...receitas].sort());
  });

  it('DESPESA só com categorias de despesa; RECEITA só com as de receita', () => {
    for (const c of despesas) {
      assert.equal(isValidPair(DESPESA, c), true, c);
      assert.equal(isValidPair(RECEITA, c), false, c);
    }
    for (const c of receitas) {
      assert.equal(isValidPair(RECEITA, c), true, c);
      assert.equal(isValidPair(DESPESA, c), false, c);
    }
  });

  it('tipo/categoria desconhecidos ou de outro formato = inválido', () => {
    for (const [t, c] of [['RECEITA', 'XPTO'], ['ENTRADA', 'APOIO'], ['receita', 'APOIO'], [null, 'APOIO'], ['DESPESA', 'toString'], ['DESPESA', '__proto__']]) {
      assert.equal(isValidPair(t, c), false, `${t}/${c}`);
    }
  });

  it('rótulos em português no servidor (exemplos do contrato)', () => {
    assert.equal(categoryLabel('HOSPEDAGEM'), 'Hospedagem e servidores');
    assert.equal(categoryLabel('PATROCINIO'), 'Patrocínios');
    for (const c of Object.values(LedgerCategory)) assert.ok(categoryLabel(c).length > 0, c);
  });
});

describe('Transparência: centavos inteiros', () => {
  it('aceita 1..1_000_000_000 inteiros; recusa float, zero, negativo, string, NaN, acima do teto', () => {
    for (const ok of [1, 199, 1_000_000_000]) assert.equal(isValidAmountCents(ok), true, String(ok));
    for (const bad of [0, -1, 10.5, 0.1, '100', NaN, Infinity, 1_000_000_001, null, undefined]) {
      assert.equal(isValidAmountCents(bad), false, String(bad));
    }
  });
});

describe('Transparência: meses em America/Sao_Paulo', () => {
  it('mês corrente é o de São Paulo, não o de UTC', () => {
    // 2026-11-01T02:00Z = 31/10 23:00 em SP => mês corrente 2026-10
    assert.equal(currentMonthSaoPaulo(new Date('2026-11-01T02:00:00.000Z')), '2026-10');
    assert.equal(currentMonthSaoPaulo(new Date('2026-11-01T03:00:00.000Z')), '2026-11');
  });

  it('mês encerrado = estritamente anterior ao corrente (SP)', () => {
    const now = new Date('2026-11-05T15:00:00.000Z');
    assert.equal(isMonthClosed('2026-10', now), true);
    assert.equal(isMonthClosed('2025-12', now), true);
    assert.equal(isMonthClosed('2026-11', now), false);
    assert.equal(isMonthClosed('2026-12', now), false);
    // virada: 31/10 23:30 em SP ainda é outubro => outubro NÃO está encerrado
    assert.equal(isMonthClosed('2026-10', new Date('2026-11-01T02:30:00.000Z')), false);
  });

  it('addMonths / monthWindow / monthOf / isMonthKey / monthLockKey', () => {
    assert.equal(addMonths('2026-01', -1), '2025-12');
    assert.equal(addMonths('2026-12', 1), '2027-01');
    assert.equal(addMonths('2026-11', -23), '2024-12');
    const w = monthWindow(new Date('2026-11-05T12:00:00.000Z'));
    assert.equal(w.length, 24);
    assert.equal(w[0], '2026-11');
    assert.equal(w[23], '2024-12');
    assert.equal(monthOf('2026-10-31'), '2026-10');
    for (const ok of ['2026-01', '2026-12', '2000-10']) assert.equal(isMonthKey(ok), true, ok);
    for (const bad of ['2026-13', '2026-00', '2026-1', '26-01', '2026-01-01', '', null]) assert.equal(isMonthKey(bad), false, String(bad));
    assert.equal(monthLockKey('2026-10'), 202610);
  });

  it('occurredOn: dia real; futuro só até o FIM do mês corrente (SP); nada antes de 2000', () => {
    const now = new Date('2026-11-05T12:00:00.000Z');
    assert.equal(occurredOnError('2026-11-30', now), null, 'fim do mês corrente é aceito');
    assert.equal(occurredOnError('2026-10-01', now), null);
    assert.equal(occurredOnError('2026-12-01', now), 'FUTURE_DATE');
    assert.equal(occurredOnError('2027-01-15', now), 'FUTURE_DATE');
    assert.equal(occurredOnError('2026-02-30', now), 'VALIDATION');
    assert.equal(occurredOnError('2026-1-01', now), 'VALIDATION');
    assert.equal(occurredOnError('1999-12-31', now), 'VALIDATION');
    assert.equal(occurredOnError(20261101, now), 'VALIDATION');
  });
});

describe('Transparência: números públicos', () => {
  it('custo por aluno ativo = round(despesa / alunos); 0 alunos = null', () => {
    assert.equal(costPerActiveStudentCents(250000, 1200), 208); // exemplo do contrato
    assert.equal(costPerActiveStudentCents(250, 100), 3); // 2,5 -> 3 (meio para cima)
    assert.equal(costPerActiveStudentCents(249, 100), 2);
    assert.equal(costPerActiveStudentCents(0, 10), 0);
    assert.equal(costPerActiveStudentCents(1000, 0), null);
    assert.equal(costPerActiveStudentCents(1000, -1), null);
  });

  it('goalCoveragePct = round(receita*100/meta), inteiro, pode passar de 100; meta 0 = null', () => {
    assert.equal(goalCoveragePct(280000, 300000), 93); // exemplo do contrato (93,33)
    assert.equal(goalCoveragePct(450000, 300000), 150);
    assert.equal(goalCoveragePct(1, 200), 1); // 0,5 -> 1
    assert.equal(goalCoveragePct(0, 300000), 0);
    assert.equal(goalCoveragePct(1000, 0), null);
    // inteiros grandes sem perder precisão (receitas somadas no teto)
    assert.equal(goalCoveragePct(13 * 1_000_000_000, 1_000_000_000), 1300);
    assert.ok(Number.isInteger(goalCoveragePct(123457, 300001)!));
  });

  it('reserva = inicial + saldo de TODOS os meses publicados (pode ficar negativa)', () => {
    assert.equal(reserveCents(100000, [30000, -50000]), 80000);
    assert.equal(reserveCents(0, [-10000, -5000]), -15000);
    assert.equal(reserveCents(5000, []), 5000);
  });

  it('agregação: totais, saldo e listas por categoria ordenadas por valor desc, só > 0', () => {
    const t = aggregateMonth([
      { type: DESPESA, category: 'HOSPEDAGEM', cents: 100000 },
      { type: DESPESA, category: 'MAPAS', cents: 30000 },
      { type: DESPESA, category: 'HOSPEDAGEM', cents: 50000 },
      { type: DESPESA, category: 'EMAIL', cents: 0 },
      { type: RECEITA, category: 'APOIO', cents: 20000 },
      { type: RECEITA, category: 'PATROCINIO', cents: 260000 },
    ]);
    assert.equal(t.revenueCents, 280000);
    assert.equal(t.expenseCents, 180000);
    assert.equal(t.balanceCents, 100000);
    assert.deepEqual(t.expensesByCategory, [
      { category: 'HOSPEDAGEM', label: 'Hospedagem e servidores', cents: 150000 },
      { category: 'MAPAS', label: 'Mapas', cents: 30000 },
    ]);
    assert.deepEqual(t.revenueByCategory.map((r) => r.category), ['PATROCINIO', 'APOIO']);
    // empate de valor: ordem do catálogo (determinística)
    const tie = aggregateMonth([
      { type: DESPESA, category: 'EMAIL', cents: 10 },
      { type: DESPESA, category: 'MAPAS', cents: 10 },
    ]);
    assert.deepEqual(tie.expensesByCategory.map((r) => r.category), ['MAPAS', 'EMAIL']);
    // mês vazio
    assert.deepEqual(aggregateMonth([]), { revenueCents: 0, expenseCents: 0, balanceCents: 0, revenueByCategory: [], expensesByCategory: [] });
  });

  it('texto opcional: trim e vazio = null', () => {
    assert.equal(blankToNullText('  '), null);
    assert.equal(blankToNullText(undefined), null);
    assert.equal(blankToNullText(' Associação X '), 'Associação X');
  });
});

describe('Transparência: auditoria e log de requisição', () => {
  it('catálogo de auditoria tem os códigos novos (únicos)', () => {
    for (const code of [
      'PLATFORM_FINANCE_ENTRY_CREATE', 'PLATFORM_FINANCE_ENTRY_UPDATE', 'PLATFORM_FINANCE_ENTRY_DELETE',
      'PLATFORM_FINANCE_MONTH_PUBLISH', 'PLATFORM_FINANCE_MONTH_UNPUBLISH', 'PLATFORM_FINANCE_SETTINGS_UPDATE', 'PLATFORM_FINANCE_EXPORT',
    ]) {
      assert.ok(AUDIT_ACTION_CODES.includes(code), code);
    }
    assert.equal(new Set(AUDIT_ACTION_CODES).size, AUDIT_ACTION_CODES.length);
  });

  it('GET /api/transparency sai no log SEM userId e SEM ip; /api/platform-finance/* segue normal', () => {
    const req = (route: string) => ({ method: 'GET', baseUrl: '', route: { path: route }, ip: '198.51.100.9', user: { id: 7 } });
    const pub = buildRequestLogLine(req('/api/transparency') as never, { statusCode: 200 } as never, 'rid-123456', 1);
    assert.equal(pub.userId, null);
    assert.equal(pub.ip, null);
    const admin = buildRequestLogLine(req('/api/platform-finance/months') as never, { statusCode: 200 } as never, 'rid-123456', 1);
    assert.equal(admin.userId, 7);
    assert.equal(admin.ip, '198.51.100.9');
    // prefixo parecido NAO herda o anonimato
    const other = buildRequestLogLine(req('/api/transparency-x') as never, { statusCode: 200 } as never, 'rid-123456', 1);
    assert.equal(other.ip, '198.51.100.9');
  });
});
