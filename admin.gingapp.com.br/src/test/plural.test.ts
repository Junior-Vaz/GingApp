import { describe, expect, it } from 'vitest'
import { plural, pluralWord } from '@/utils/plural'

describe('plural (pt-BR)', () => {
  it('1 usa o singular; 0 e demais usam o plural', () => {
    expect(plural(1, 'aluno')).toBe('1 aluno')
    expect(plural(0, 'aluno')).toBe('0 alunos')
    expect(plural(2, 'aluno')).toBe('2 alunos')
  })

  it('aceita plural irregular e devolve só a palavra com pluralWord', () => {
    expect(plural(1, 'mês', 'meses')).toBe('1 mês')
    expect(plural(3, 'mês', 'meses')).toBe('3 meses')
    expect(pluralWord(1, 'unidade')).toBe('unidade')
    expect(pluralWord(5, 'unidade')).toBe('unidades')
  })
})
