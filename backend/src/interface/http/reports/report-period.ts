import { BadRequestException } from '@nestjs/common';

const DAY_MS = 24 * 60 * 60 * 1000;
const SP_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Período já resolvido: datas civis (yyyy-MM-dd) e os limites prontos para o banco (`end` EXCLUSIVO). */
export interface ReportPeriod {
  from: string;
  to: string;
  /** Meia-noite UTC do primeiro dia. */
  start: Date;
  /** Meia-noite UTC do dia SEGUINTE ao último (use `lt`). */
  end: Date;
  /** Mesmos limites para colunas de INSTANTE (createdAt...): meia-noite de São Paulo (UTC-3, sem horário de verão). */
  startInstant: Date;
  endInstant: Date;
}

export interface PeriodOptions {
  /** Padrão quando `from`/`to` faltam. */
  defaultFrom: (today: string) => string;
  defaultTo: (today: string) => string;
  /** Teto de dias do período (400 acima disso). */
  maxDays: number;
}

/** Hoje (America/Sao_Paulo) como yyyy-MM-dd. */
export function todayCivil(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

const utcDay = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const toIso = (date: Date): string => date.toISOString().slice(0, 10);

export function addDays(iso: string, days: number): string {
  return toIso(new Date(utcDay(iso).getTime() + days * DAY_MS));
}

/** Primeiro dia do mês, `months` meses antes (ou depois, se negativo) do mês de `iso`. */
export function startOfMonthShift(iso: string, monthsBack: number): string {
  const d = utcDay(iso);
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - monthsBack, 1)));
}

/** Último dia do mês de `iso`. */
export function endOfMonth(iso: string): string {
  const d = utcDay(iso);
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

/**
 * Resolve ?from&to (aceita yyyy-MM-dd ou ISO; só o dia importa). Faltando um dos dois, usa o padrão do relatório.
 * from > to ou período maior que o teto => 400.
 */
export function resolvePeriod(
  from: string | undefined,
  to: string | undefined,
  options: PeriodOptions,
  now: Date = new Date(),
): ReportPeriod {
  const today = todayCivil(now);
  const fromIso = (from ?? options.defaultFrom(today)).slice(0, 10);
  const toStr = (to ?? options.defaultTo(today)).slice(0, 10);
  const start = utcDay(fromIso);
  const lastDay = utcDay(toStr);
  // toIso(...) !== texto pega dias inexistentes (2026-02-30 rola para março no Date).
  if (Number.isNaN(start.getTime()) || Number.isNaN(lastDay.getTime()) || toIso(start) !== fromIso || toIso(lastDay) !== toStr) {
    throw new BadRequestException('Período inválido.');
  }
  if (start.getTime() > lastDay.getTime()) {
    throw new BadRequestException('A data inicial não pode ser depois da data final.');
  }
  const days = Math.round((lastDay.getTime() - start.getTime()) / DAY_MS) + 1;
  if (days > options.maxDays) {
    throw new BadRequestException(`O período pode ter no máximo ${options.maxDays} dias.`);
  }
  const end = new Date(lastDay.getTime() + DAY_MS);
  return {
    from: fromIso,
    to: toStr,
    start,
    end,
    startInstant: new Date(start.getTime() + SP_OFFSET_MS),
    endInstant: new Date(end.getTime() + SP_OFFSET_MS),
  };
}

/** Lista contínua de meses ("yyyy-MM") que o período toca, do primeiro ao último. */
export function monthsOf(period: Pick<ReportPeriod, 'from' | 'to'>): string[] {
  const out: string[] = [];
  let cursor = period.from.slice(0, 7);
  const last = period.to.slice(0, 7);
  while (cursor <= last) {
    out.push(cursor);
    const [y, m] = cursor.split('-').map(Number) as [number, number];
    cursor = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  return out;
}

/** Percentual com 1 casa decimal (null quando não há base). */
export function percentOf(part: number, whole: number): number | null {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null;
}

export const AGE_GROUPS: readonly { key: string; label: string; min: number; max: number }[] = [
  { key: 'ate5', label: 'Até 5 anos', min: 0, max: 5 },
  { key: '6a12', label: '6 a 12 anos', min: 6, max: 12 },
  { key: '13a17', label: '13 a 17 anos', min: 13, max: 17 },
  { key: '18a29', label: '18 a 29 anos', min: 18, max: 29 },
  { key: '30a44', label: '30 a 44 anos', min: 30, max: 44 },
  { key: '45mais', label: '45 anos ou mais', min: 45, max: 200 },
];

/** Idade completa em `today` (yyyy-MM-dd) de uma data de nascimento civil (meia-noite UTC). */
export function ageOn(birthDate: Date, today: string): number {
  const [ty, tm, td] = today.split('-').map(Number) as [number, number, number];
  let age = ty - birthDate.getUTCFullYear();
  const monthDiff = tm - (birthDate.getUTCMonth() + 1);
  if (monthDiff < 0 || (monthDiff === 0 && td < birthDate.getUTCDate())) age--;
  return age;
}
