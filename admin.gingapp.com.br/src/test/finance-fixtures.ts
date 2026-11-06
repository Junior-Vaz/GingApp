import type { FinanceMonth, FinanceSettings, LedgerEntry, TransparencyBody } from '@/utils/finance'

/** Formatos EXATOS do contrato (docs/CONTRATO_TRANSPARENCIA.md §3 e §4). */

export function entry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: 1,
    type: 'DESPESA',
    category: 'HOSPEDAGEM',
    categoryLabel: 'Hospedagem e servidores',
    amountCents: 150000,
    occurredOn: '2026-10-05',
    month: '2026-10',
    description: 'Servidor VPS (Fornecedor SEGREDO-FORNECEDOR)',
    locked: false,
    createdAt: '2026-10-05T12:00:00.000Z',
    ...overrides,
  }
}

export function month(overrides: Partial<FinanceMonth> = {}): FinanceMonth {
  return {
    month: '2026-10',
    published: false,
    publishedAt: null,
    note: null,
    revenueCents: 280000,
    expenseCents: 250000,
    balanceCents: 30000,
    entries: 3,
    expensesByCategory: [{ category: 'HOSPEDAGEM', label: 'Hospedagem e servidores', cents: 250000 }],
    revenueByCategory: [{ category: 'PATROCINIO', label: 'Patrocínios', cents: 280000 }],
    liveActiveStudents: 1200,
    liveActiveGroups: 30,
    snapshot: null,
    ...overrides,
  }
}

export function publishedMonth(overrides: Partial<FinanceMonth> = {}): FinanceMonth {
  return month({
    month: '2026-09',
    published: true,
    publishedAt: '2026-10-03T15:00:00.000Z',
    note: 'Mês de lançamento do patrocínio.',
    snapshot: { activeStudents: 1100, activeGroups: 28, goalCents: 300000 },
    liveActiveStudents: null,
    liveActiveGroups: null,
    ...overrides,
  })
}

export function settings(overrides: Partial<FinanceSettings> = {}): FinanceSettings {
  return {
    monthlyGoalCents: 300000,
    openingReserveCents: 123400,
    entityName: 'Associação X',
    introText: 'A plataforma é gratuita.',
    surplusText: 'O excedente vira reserva.',
    updatedAt: '2026-10-01T12:00:00.000Z',
    ...overrides,
  }
}

export function preview(overrides: Partial<TransparencyBody> = {}): TransparencyBody {
  return {
    generatedAt: '2026-11-07T12:00:00.000Z',
    entityName: 'Associação X',
    introText: 'A plataforma é gratuita.',
    surplusText: 'O excedente vira reserva.',
    monthlyGoalCents: 300000,
    reserveCents: 123400,
    months: [
      {
        month: '2026-10',
        publishedAt: '2026-11-03T12:00:00.000Z',
        note: 'Mês tranquilo.',
        revenueCents: 280000,
        expenseCents: 250000,
        balanceCents: 30000,
        revenueBySource: [{ category: 'PATROCINIO', label: 'Patrocínios', cents: 280000 }],
        expensesByCategory: [
          { category: 'HOSPEDAGEM', label: 'Hospedagem e servidores', cents: 150000 },
          { category: 'MAPAS', label: 'Mapas', cents: 100000 },
        ],
        activeStudents: 1200,
        activeGroups: 30,
        costPerActiveStudentCents: 208,
        goalCents: 300000,
        goalCoveragePct: 93,
      },
    ],
    ...overrides,
  }
}
