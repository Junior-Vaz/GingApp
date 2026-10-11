/**
 * SSOT das 27 unidades federativas do Brasil (26 estados + DF): sigla e nome oficial (IBGE).
 *
 * Usada por prisma/bootstrap.ts (popula a tabela State em produção) e pelas validações de UF
 * (Unit.state, Organization.state). Sem dependência de Prisma/Nest para poder ser importada de
 * qualquer lugar (inclusive dos scripts de prisma/).
 */
export interface BrState {
  uf: string;
  name: string;
}

export const BR_STATES: readonly BrState[] = [
  { uf: 'AC', name: 'Acre' },
  { uf: 'AL', name: 'Alagoas' },
  { uf: 'AP', name: 'Amapá' },
  { uf: 'AM', name: 'Amazonas' },
  { uf: 'BA', name: 'Bahia' },
  { uf: 'CE', name: 'Ceará' },
  { uf: 'DF', name: 'Distrito Federal' },
  { uf: 'ES', name: 'Espírito Santo' },
  { uf: 'GO', name: 'Goiás' },
  { uf: 'MA', name: 'Maranhão' },
  { uf: 'MT', name: 'Mato Grosso' },
  { uf: 'MS', name: 'Mato Grosso do Sul' },
  { uf: 'MG', name: 'Minas Gerais' },
  { uf: 'PA', name: 'Pará' },
  { uf: 'PB', name: 'Paraíba' },
  { uf: 'PR', name: 'Paraná' },
  { uf: 'PE', name: 'Pernambuco' },
  { uf: 'PI', name: 'Piauí' },
  { uf: 'RJ', name: 'Rio de Janeiro' },
  { uf: 'RN', name: 'Rio Grande do Norte' },
  { uf: 'RS', name: 'Rio Grande do Sul' },
  { uf: 'RO', name: 'Rondônia' },
  { uf: 'RR', name: 'Roraima' },
  { uf: 'SC', name: 'Santa Catarina' },
  { uf: 'SP', name: 'São Paulo' },
  { uf: 'SE', name: 'Sergipe' },
  { uf: 'TO', name: 'Tocantins' },
];

export const BR_UFS: readonly string[] = BR_STATES.map((s) => s.uf);

/** `uf` (qualquer caixa, com espaços) é uma das 27 siglas? */
export function isBrUf(uf: unknown): boolean {
  return typeof uf === 'string' && BR_UFS.includes(uf.trim().toUpperCase());
}
