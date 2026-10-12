import { RodaRecurrence } from '@prisma/client';

/**
 * Recorrencia de rodas ("roda mensal") — regras puras, sem Prisma/Nest. A regra e DERIVADA da data da roda "mae"
 * (Roda.date), interpretada no fuso America/Sao_Paulo (UTC-3 fixo, sem horario de verao desde 2019):
 *  - WEEKLY: todo mesmo dia da semana, no mesmo horario;
 *  - MONTHLY_WEEKDAY: "toda 1a sexta" — o n-esimo dia da semana do mes (n = ceil(dia/7)); a "5a" cai no ULTIMO
 *    daquele dia da semana quando o mes so tem 4;
 *  - MONTHLY_DAY: "todo dia X" — o mesmo dia do mes, limitado ao ultimo dia dos meses curtos (dia 31 -> 30/28).
 */
const SP_OFFSET_MS = 3 * 60 * 60 * 1000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
/** Teto de iteracoes ao procurar proximas ocorrencias (defesa contra regra/intervalo patologico). */
const MAX_STEPS = 1200;

interface LocalParts {
  year: number;
  month: number; // 0-11
  day: number;
  weekday: number; // 0 (domingo) - 6
  hours: number;
  minutes: number;
}

function toLocal(date: Date): LocalParts {
  const d = new Date(date.getTime() - SP_OFFSET_MS); // campos UTC de `d` = relogio de Sao Paulo
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
    weekday: d.getUTCDay(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
  };
}

function fromLocal(year: number, month: number, day: number, hours: number, minutes: number): Date {
  return new Date(Date.UTC(year, month, day, hours, minutes) + SP_OFFSET_MS);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/** Dia do mes do n-esimo `weekday` (n = 1..5; 5 = ultimo se o mes nao tem a 5a). */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): number {
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const firstHit = 1 + ((weekday - firstWeekday + 7) % 7);
  let day = firstHit + (n - 1) * 7;
  while (day > daysInMonth(year, month)) day -= 7;
  return day;
}

/** Descricao legivel da regra, ex.: "toda 1ª sexta do mês". */
export function describeRecurrence(recurrence: RodaRecurrence, base: Date): string | null {
  const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
  const p = toLocal(base);
  switch (recurrence) {
    case RodaRecurrence.WEEKLY:
      return `toda ${WEEKDAYS[p.weekday]}`;
    case RodaRecurrence.MONTHLY_WEEKDAY:
      return `toda ${Math.ceil(p.day / 7)}ª ${WEEKDAYS[p.weekday]} do mês`;
    case RodaRecurrence.MONTHLY_DAY:
      return `todo dia ${p.day}`;
    default:
      return null;
  }
}

/**
 * Datas da serie APOS a roda base, em ordem, que sejam estritamente depois de `after` e (se informado) ate
 * `until` inclusive. No maximo `count`. Recorrencia NONE devolve [].
 */
export function nextOccurrences(
  base: Date,
  recurrence: RodaRecurrence,
  options: { after: Date; until?: Date | null; count: number },
): Date[] {
  if (recurrence === RodaRecurrence.NONE || options.count <= 0) return [];
  const p = toLocal(base);
  const ordinal = Math.ceil(p.day / 7);
  const out: Date[] = [];
  for (let step = 1; step <= MAX_STEPS && out.length < options.count; step++) {
    let candidate: Date;
    if (recurrence === RodaRecurrence.WEEKLY) {
      candidate = new Date(base.getTime() + step * WEEK_MS);
    } else {
      const monthIndex = p.month + step;
      const year = p.year + Math.floor(monthIndex / 12);
      const month = ((monthIndex % 12) + 12) % 12;
      const day =
        recurrence === RodaRecurrence.MONTHLY_WEEKDAY
          ? nthWeekdayOfMonth(year, month, p.weekday, ordinal)
          : Math.min(p.day, daysInMonth(year, month));
      candidate = fromLocal(year, month, day, p.hours, p.minutes);
    }
    if (options.until && candidate.getTime() > options.until.getTime()) break;
    if (candidate.getTime() > options.after.getTime()) out.push(candidate);
  }
  return out;
}

/** "Ultimo dia da serie": so data (yyyy-MM-dd) vale ate o fim desse dia em Sao Paulo; ISO completo vale o instante. */
export function parseRecurrenceUntil(value: string): Date {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T23:59:59.999-03:00`) : new Date(value);
}
