/**
 * Siglas das 27 UFs (espelho de backend/src/shared/geo/br-states.ts) para os selects de "UF" dos
 * formulários de texto livre (Unidade, Configurações do grupo). Para estado/cidade ligados às tabelas
 * de referência (Rodas, Eventos) use os hooks de `modules/rodas/reference.ts`.
 */
export const BR_UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;

export type Uf = (typeof BR_UFS)[number];
