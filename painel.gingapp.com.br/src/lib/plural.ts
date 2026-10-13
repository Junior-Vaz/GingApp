/**
 * Concordância de número em pt-BR: 1 usa o singular; 0, 2 e demais usam o plural.
 * `plural(1, "aluno")` => "1 aluno"; `plural(2, "aluno")` => "2 alunos";
 * `plural(3, "lançamento")` => "3 lançamentos"; `plural(2, "mês", "meses")` => "2 meses".
 * Sem `pluralForm`, o plural é o singular + "s".
 */
export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${n === 1 ? singular : (pluralForm ?? `${singular}s`)}`;
}
