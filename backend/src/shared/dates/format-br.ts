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
