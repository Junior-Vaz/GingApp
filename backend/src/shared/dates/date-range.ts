/**
 * Intervalo inclusivo sobre uma coluna de DATA CIVIL (aula, vencimento...: gravada como meia-noite
 * UTC do dia). `from` vale a partir daquele instante; `to` só com data (YYYY-MM-DD) inclui o dia
 * inteiro (até 23:59:59.999Z), com ISO completo vale exatamente aquele instante. Devolve
 * `undefined` quando nenhum dos dois foi informado (o chamador não filtra a coluna).
 * Mesma regra de GET /lessons, compartilhada com GET /lessons/me e GET /attendance/me.
 */
export function civilDateRange(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
  if (!from && !to) return undefined;
  return {
    ...(from ? { gte: new Date(from) } : {}),
    ...(to ? { lte: new Date(/^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to}T23:59:59.999Z` : to) } : {}),
  };
}
