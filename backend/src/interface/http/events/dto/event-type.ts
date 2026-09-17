/** Categorias de evento (projeto.txt §43) — "RODA" fica de fora, esse tipo já tem o model
 * Roda dedicado (ver CalendarModule, que agrega os dois). Usado tanto na validação do DTO
 * quanto nos filtros do calendário público. */
export const EVENT_TYPES = [
  'BATIZADO',
  'WORKSHOP',
  'CAMPEONATO',
  'FESTIVAL',
  'ENCONTRO',
  'FORMATURA',
  'VIAGEM',
  'AULA_ESPECIAL',
  'OUTRO',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];
