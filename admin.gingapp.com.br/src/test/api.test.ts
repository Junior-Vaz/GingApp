import { describe, expect, it } from 'vitest'
import { api, ApiError, buildQuery } from '@/utils/api'
import { AUTH_TOKEN_KEY, AUTH_USER_KEY } from '@/stores/auth'
import { mockFetch } from './helpers'

describe('api (cliente HTTP)', () => {
  it('envia o Bearer do token salvo', async () => {
    localStorage.setItem(AUTH_TOKEN_KEY, 'abc')
    const { calls } = mockFetch(() => ({ body: { ok: true } }))
    await api.get('/x')
    expect(calls[0].headers.Authorization).toBe('Bearer abc')
  })

  it('getPage devolve itens e total do header X-Total-Count', async () => {
    const { calls } = mockFetch(() => ({ body: [{ id: 1 }, { id: 2 }], headers: { 'X-Total-Count': '57' } }))
    const page = await api.getPage<{ id: number }>('/things', { q: ' ', limit: 20, offset: 40, status: undefined })
    expect(page).toEqual({ items: [{ id: 1 }, { id: 2 }], total: 57 })
    // q em branco e status undefined são omitidos
    expect(calls[0].query.toString()).toBe('limit=20&offset=40')
  })

  it('getPage sem header usa o tamanho da lista como total', async () => {
    mockFetch(() => ({ body: [{ id: 1 }] }))
    expect((await api.getPage('/things')).total).toBe(1)
  })

  it('junta message em array (class-validator) e usa string simples', async () => {
    mockFetch(() => ({ status: 400, body: { message: ['name curto', 'email inválido'] } }))
    await expect(api.get('/x')).rejects.toMatchObject({ message: 'name curto email inválido', status: 400 })
    mockFetch(() => ({ status: 409, body: { message: 'Já existe um usuário com este e-mail.' } }))
    await expect(api.get('/x')).rejects.toBeInstanceOf(ApiError)
    mockFetch(() => ({ status: 500, body: 'oops' }))
    await expect(api.get('/x')).rejects.toMatchObject({ message: 'Erro na requisição (500).' })
  })

  it('401 limpa a sessão e lança ApiError', async () => {
    window.history.pushState({}, '', '/login') // já em /login: evita a navegação (não implementada no jsdom)
    localStorage.setItem(AUTH_TOKEN_KEY, 'abc')
    localStorage.setItem(AUTH_USER_KEY, '{}')
    mockFetch(() => ({ status: 401, body: { message: 'Unauthorized' } }))
    await expect(api.get('/x')).rejects.toMatchObject({ status: 401 })
    expect(localStorage.getItem(AUTH_TOKEN_KEY)).toBeNull()
    expect(localStorage.getItem(AUTH_USER_KEY)).toBeNull()
  })

  it('corpo vazio (200 sem conteúdo) não quebra', async () => {
    mockFetch(() => ({ status: 200 }))
    await expect(api.post('/x')).resolves.toBeUndefined()
  })

  it('buildQuery ignora vazios', () => {
    expect(buildQuery({ a: 1, b: '', c: null, d: undefined, e: 'x y' })).toBe('?a=1&e=x+y')
    expect(buildQuery()).toBe('')
  })
})
