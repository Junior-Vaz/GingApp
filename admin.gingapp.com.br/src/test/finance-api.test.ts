import { describe, expect, it, vi } from 'vitest'
import SidebarLayout from '@/components/layout/SidebarLayout.vue'
import router, { routes } from '@/router'
import { ApiError } from '@/utils/api'
import { FINANCE_PATH, financeApi } from '@/utils/financeApi'
import { entry, month, preview, publishedMonth, settings } from './finance-fixtures'
import { loginAs, makeUser, mockFetch, mountView, type Call } from './helpers'
import { listReply } from './sponsors-fixtures'

describe('financeApi — prefixo e rotas do contrato §3', () => {
  it('prefixo único /platform-finance', () => {
    expect(FINANCE_PATH).toBe('/platform-finance')
  })

  it('lista de lançamentos: GET com filtros na query, ordem do servidor e total no X-Total-Count', async () => {
    const { calls } = mockFetch(() => listReply([entry(), entry({ id: 2 })], 42))
    loginAs()
    const page = await financeApi.listEntries({ month: '2026-10', type: 'DESPESA', category: 'HOSPEDAGEM', q: ' servidor ', limit: 20, offset: 40 })
    expect(calls[0].method).toBe('GET')
    expect(calls[0].path).toBe('/platform-finance/entries')
    expect(Object.fromEntries(calls[0].query)).toEqual({ month: '2026-10', type: 'DESPESA', category: 'HOSPEDAGEM', q: 'servidor', limit: '20', offset: '40' })
    expect(page.total).toBe(42)
    expect(page.items.map((e) => e.id)).toEqual([1, 2])
    expect(calls[0].headers.Authorization).toBe('Bearer test-token')
  })

  it('filtros vazios são omitidos da query', async () => {
    const { calls } = mockFetch(() => listReply([]))
    loginAs()
    await financeApi.listEntries({ month: '', type: '', category: '', q: '', limit: 20, offset: 0 })
    expect(Object.fromEntries(calls[0].query)).toEqual({ limit: '20', offset: '0' })
  })

  it('criar, editar e excluir: POST, PATCH e DELETE com o corpo do contrato (amountCents inteiro)', async () => {
    const { calls } = mockFetch((call) => (call.method === 'DELETE' ? { status: 204 } : { status: call.method === 'POST' ? 201 : 200, body: entry() }))
    loginAs()
    const body = { type: 'DESPESA', category: 'HOSPEDAGEM', amountCents: 150000, occurredOn: '2026-10-05', description: 'Servidor' }
    await financeApi.createEntry(body)
    await financeApi.updateEntry(7, { amountCents: 99 })
    await expect(financeApi.deleteEntry(7)).resolves.toBeUndefined()
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /platform-finance/entries', 'PATCH /platform-finance/entries/7', 'DELETE /platform-finance/entries/7'])
    expect(calls[0].body).toEqual(body)
    expect(calls[1].body).toEqual({ amountCents: 99 })
    expect(calls[2].body).toBeUndefined()
  })

  it('CSV: GET autenticado em entries.csv com ?month=, devolvido como Blob com BOM intacto', async () => {
    const csv = '﻿data;tipo;valor\r\n2026-10-05;DESPESA;1500,00\r\n'
    const calls: Call[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input))
        calls.push({ method: init?.method ?? 'GET', path: url.pathname.replace(/^\/api/, ''), query: url.searchParams, body: undefined, headers: init?.headers as Record<string, string> })
        return new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8' } })
      }),
    )
    loginAs()
    const blob = await financeApi.getEntriesCsv('2026-10')
    const bytes = Array.from(new Uint8Array(await new Response(blob).arrayBuffer()))
    expect(bytes.slice(0, 3)).toEqual([0xef, 0xbb, 0xbf])
    expect(calls[0].path).toBe('/platform-finance/entries.csv')
    expect(calls[0].query.get('month')).toBe('2026-10')
    expect(calls[0].headers.Authorization).toBe('Bearer test-token')
    await financeApi.getEntriesCsv()
    expect(calls[1].query.has('month')).toBe(false)
  })

  it('meses: GET devolve { items } (não um array)', async () => {
    const { calls } = mockFetch(() => ({ body: { items: [month(), publishedMonth()] } }))
    loginAs()
    const data = await financeApi.listMonths()
    expect(calls[0].method).toBe('GET')
    expect(calls[0].path).toBe('/platform-finance/months')
    expect(data.items.map((m) => m.month)).toEqual(['2026-10', '2026-09'])
  })

  it('publicar: POST /months/:month/publish com { note } só quando há observação; sem ela vai {}', async () => {
    const { calls } = mockFetch(() => ({ status: 201, body: publishedMonth() }))
    loginAs()
    await financeApi.publishMonth('2026-10', '  Mês tranquilo  ')
    await financeApi.publishMonth('2026-10', '   ')
    await financeApi.publishMonth('2026-10')
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(Array(3).fill('POST /platform-finance/months/2026-10/publish'))
    expect(calls[0].body).toEqual({ note: 'Mês tranquilo' })
    expect(calls[1].body).toEqual({})
    expect(calls[2].body).toEqual({})
  })

  it('despublicar: POST /months/:month/unpublish, 204', async () => {
    const { calls } = mockFetch(() => ({ status: 204 }))
    loginAs()
    await expect(financeApi.unpublishMonth('2026-09')).resolves.toBeUndefined()
    expect(calls[0].method).toBe('POST')
    expect(calls[0].path).toBe('/platform-finance/months/2026-09/unpublish')
  })

  it('configurações: GET e PUT /settings; prévia: GET /preview', async () => {
    const { calls } = mockFetch((call) => (call.path.endsWith('/preview') ? { body: preview() } : { body: settings() }))
    loginAs()
    const s = await financeApi.getSettings()
    await financeApi.updateSettings({ monthlyGoalCents: 1, openingReserveCents: 0, entityName: null, introText: null, surplusText: null })
    const p = await financeApi.getPreview()
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['GET /platform-finance/settings', 'PUT /platform-finance/settings', 'GET /platform-finance/preview'])
    expect(calls[1].body).toEqual({ monthlyGoalCents: 1, openingReserveCents: 0, entityName: null, introText: null, surplusText: null })
    expect(s.monthlyGoalCents).toBe(300000)
    expect(p.months[0]?.goalCoveragePct).toBe(93)
  })

  it('409 chega como ApiError com status e code', async () => {
    mockFetch(() => ({ status: 409, body: { statusCode: 409, code: 'MONTH_PUBLISHED', message: 'Mês publicado.' } }))
    loginAs()
    const error = await financeApi.createEntry({}).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(409)
    expect((error as ApiError).code).toBe('MONTH_PUBLISHED')
  })
})

describe('rota e menu de Financeiro', () => {
  it('/financeiro: exige login, é só da equipe PLATFORM e tem um item de menu "Financeiro"', () => {
    const route = routes.find((r) => r.name === 'finance')
    expect(route?.path).toBe('/financeiro')
    expect(route?.meta).toMatchObject({ requiresAuth: true, platformOnly: true, navLabel: 'Financeiro' })
  })

  it('o guard manda quem não é PLATFORM de volta ao painel; qualquer PLATFORM (inclusive não-super) entra', async () => {
    loginAs(makeUser({ userType: 'MEMBER', isSuperAdmin: true }))
    await router.push('/financeiro')
    expect(router.currentRoute.value.name).toBe('dashboard')

    loginAs(makeUser({ id: 2, userType: 'PLATFORM', isSuperAdmin: false }))
    await router.push('/financeiro')
    expect(router.currentRoute.value.name).toBe('finance')
  })

  it('o menu lateral mostra "Financeiro" para PLATFORM (super ou não) e esconde dos demais', async () => {
    mockFetch(() => ({ body: { twoFactorEnabled: true } }))
    const platform = await mountView(SidebarLayout, makeUser({ userType: 'PLATFORM' }))
    expect(platform.wrapper.find('nav').text()).toContain('Financeiro')
    platform.wrapper.unmount()

    mockFetch(() => ({ body: { twoFactorEnabled: true } }))
    const plain = await mountView(SidebarLayout, makeUser({ id: 2, userType: 'PLATFORM', isSuperAdmin: false }))
    expect(plain.wrapper.find('nav').text()).toContain('Financeiro')
    plain.wrapper.unmount()

    mockFetch(() => ({ body: { twoFactorEnabled: true } }))
    const member = await mountView(SidebarLayout, makeUser({ userType: 'MEMBER' }))
    expect(member.wrapper.find('nav').text()).not.toContain('Financeiro')
  })
})
