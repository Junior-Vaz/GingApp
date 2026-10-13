/**
 * Plural em pt-BR: `plural(1, "aluno")` -> "1 aluno"; `plural(0, "aluno")` e `plural(2, "aluno")` -> "0 alunos"/"2 alunos".
 * Em pt-BR 0 usa o plural. Palavras irregulares passam o plural: `plural(2, "mês", "meses")`.
 * `pluralForm` omitido = singular + "s". Retorna "<n> <palavra>"; use `pluralWord` para só a palavra.
 */
export function pluralWord(n: number, singular: string, pluralForm?: string): string {
  return n === 1 ? singular : (pluralForm ?? `${singular}s`);
}

export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${pluralWord(n, singular, pluralForm)}`;
}
