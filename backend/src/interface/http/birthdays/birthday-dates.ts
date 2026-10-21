/**
 * Funcoes PURAS (sem banco, sem relogio global) do modulo de aniversariantes: fuso America/Sao_Paulo, regra do 29/02,
 * idade, normalizacao de telefone BR (atalho wa.me) e mensagem de parabens. Testadas em test/birthdays.spec.ts.
 *
 * `Person.birthDate` e uma DATA CIVIL gravada como meia-noite UTC: o mes/dia de nascimento sao sempre os campos UTC
 * (identico ao `EXTRACT(MONTH/DAY FROM "birthDate")` do indice Person_birthDate_month_day_idx).
 */

export const BIRTHDAY_TIMEZONE = 'America/Sao_Paulo';

/** Mensagem padrao dos parabens automaticos (contrato secao 2); `{nome}` = apelido ou primeiro nome, `{grupo}` = nome do grupo. */
export const DEFAULT_GREETING_MESSAGE = 'Parabéns, {nome}! 🎉 A família {grupo} deseja um ótimo dia.';

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

export interface SaoPauloNow extends CivilDate {
  hour: number;
  minute: number;
}

const SP_FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: BIRTHDAY_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Data/hora civil de um instante em America/Sao_Paulo. */
export function saoPauloNow(now: Date = new Date()): SaoPauloNow {
  const parts: Record<string, number> = {};
  for (const part of SP_FORMAT.formatToParts(now)) {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
  }
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour % 24, minute: parts.minute };
}

/** Instante (UTC) em que o dia civil de Sao Paulo de `now` comecou (00:00 SP). */
export function startOfSaoPauloDay(now: Date = new Date()): Date {
  const sp = saoPauloNow(now);
  const spAsUtc = Date.UTC(sp.year, sp.month - 1, sp.day, sp.hour, sp.minute);
  const offsetMs = spAsUtc - Math.floor(now.getTime() / 60000) * 60000; // SP - UTC (negativo: UTC-3)
  return new Date(Date.UTC(sp.year, sp.month - 1, sp.day) - offsetMs);
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Soma `days` a uma data civil (aritmetica em UTC: sem efeito de fuso/horario de verao). */
export function addDays(date: CivilDate, days: number): CivilDate {
  const d = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** `count` datas consecutivas a partir de `from` (inclusive). */
export function datesFrom(from: CivilDate, count: number): CivilDate[] {
  return Array.from({ length: count }, (_, i) => addDays(from, i));
}

export function isoDate(date: CivilDate): string {
  return `${date.year}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
}

/** Mes e dia de nascimento (campos UTC da data civil gravada). */
export function birthParts(birthDate: Date): CivilDate {
  return { year: birthDate.getUTCFullYear(), month: birthDate.getUTCMonth() + 1, day: birthDate.getUTCDate() };
}

/** Dia em que o aniversario cai em `year`: 29/02 em ano nao bissexto comemora em 28/02. */
export function occurrenceInYear(birthMonth: number, birthDay: number, year: number): { month: number; day: number } {
  if (birthMonth === 2 && birthDay === 29 && !isLeapYear(year)) return { month: 2, day: 28 };
  return { month: birthMonth, day: birthDay };
}

/** O aniversario de quem nasceu em (birthMonth, birthDay) cai em `date`? */
export function birthdayFallsOn(birthMonth: number, birthDay: number, date: CivilDate): boolean {
  const occurrence = occurrenceInYear(birthMonth, birthDay, date.year);
  return occurrence.month === date.month && occurrence.day === date.day;
}

/** Idade completa em `on` (a idade so sobe NO dia do aniversario; 29/02 em ano nao bissexto conta em 28/02). */
export function completedAge(birthDate: Date, on: CivilDate): number {
  const born = birthParts(birthDate);
  const occurrence = occurrenceInYear(born.month, born.day, on.year);
  const passed = on.month > occurrence.month || (on.month === occurrence.month && on.day >= occurrence.day);
  return on.year - born.year - (passed ? 0 : 1);
}

/** Idade que a pessoa FAZ no aniversario de `year`. */
export function turnsAgeInYear(birthDate: Date, year: number): number {
  return year - birthDate.getUTCFullYear();
}

export function isMinorOn(birthDate: Date, on: CivilDate): boolean {
  return completedAge(birthDate, on) < 18;
}

/**
 * Telefone BR para o atalho wa.me: so digitos, sem zeros de tronco a esquerda, prefixo 55 se faltar.
 * 10/11 digitos = DDD + numero (inclusive DDD 55: "55 9xxxx-xxxx" tem 11 digitos e leva o prefixo); 12/13 comecando
 * em 55 ja tem o pais. Menos de 10 digitos = invalido (null). Outros tamanhos (>13) sao mantidos como vieram.
 */
export function normalizeBrazilPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D+/g, '').replace(/^0+/, '');
  if (digits.length < 10) return null;
  if (digits.length <= 11) return `55${digits}`;
  return digits;
}

/** `https://wa.me/55<digitos>?text=<texto>` ou null sem telefone valido. */
export function whatsappLink(phone: string | null | undefined, text: string): string | null {
  const normalized = normalizeBrazilPhone(phone);
  if (!normalized) return null;
  return `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
}

/** Apelido ou primeiro nome. */
export function greetingName(name: string, nickname: string | null | undefined): string {
  const nick = nickname?.trim();
  if (nick) return nick;
  return name.trim().split(/\s+/)[0] || name;
}

/** Substitui `{nome}` e `{grupo}` (so esses dois marcadores; qualquer outro texto fica como esta). */
export function renderGreeting(template: string, vars: { nome: string; grupo: string }): string {
  return template.replace(/\{nome\}/g, vars.nome).replace(/\{grupo\}/g, vars.grupo);
}
