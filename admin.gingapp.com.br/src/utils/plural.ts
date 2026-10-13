/**
 * Plural em pt-BR: `plural(1, 'aluno')` -> '1 aluno'; 0 e demais usam o plural ('0 alunos', '2 alunos').
 * Palavra irregular passa o plural: `plural(2, 'mês', 'meses')`. `pluralForm` omitido = singular + 's'.
 */
export function pluralWord(n: number, singular: string, pluralForm?: string): string {
  return n === 1 ? singular : (pluralForm ?? `${singular}s`)
}

export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${pluralWord(n, singular, pluralForm)}`
}
