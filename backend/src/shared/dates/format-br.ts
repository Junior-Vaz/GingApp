const pad2 = (n: number): string => String(n).padStart(2, '0');

/**
 * "dd/MM/yyyy" de uma DATA CIVIL (coluna gravada como meia-noite UTC do dia: aula, vencimento...).
 * Usa os campos UTC — nunca o fuso local do servidor, senão o dia recuaria em fusos negativos.
 */
export function formatCivilDateBR(date: Date): string {
  return `${pad2(date.getUTCDate())}/${pad2(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}`;
}

/** "dd/MM/yyyy às HH:mm" de um INSTANTE (evento/roda), no fuso America/Sao_Paulo (mesmo do restante do produto). */
export function formatInstantBR(date: Date): string {
  const parts = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('day')}/${get('month')}/${get('year')} às ${get('hour')}:${get('minute')}`;
}

const WEEKDAYS_PT = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];

/**
 * "terça-feira, 13/10 às 19:00" de uma DATA CIVIL (aula) + horário "HH:mm" opcional (sem horário => só "terça-feira, 13/10").
 * Campos UTC, pelo mesmo motivo de formatCivilDateBR.
 */
export function formatLessonWhenBR(date: Date, time?: string | null): string {
  const base = `${WEEKDAYS_PT[date.getUTCDay()]}, ${pad2(date.getUTCDate())}/${pad2(date.getUTCMonth() + 1)}`;
  return time && /^\d{2}:\d{2}$/.test(time) ? `${base} às ${time}` : base;
}
