import { describe, expect, it, vi } from 'vitest'
import SidebarLayout from '@/components/layout/SidebarLayout.vue'
import router, { routes } from '@/router'
import { ApiError } from '@/utils/api'
import { CAMPAIGNS_PATH, SPONSORS_PATH, UPLOADS_PATH, sponsorsApi } from '@/utils/sponsorsApi'
import { loginAs, makeUser, mockFetch, mountView, type Call } from './helpers'
import { campaign, listReply, report, sponsor } from './sponsors-fixtures'

describe('prefixos assumidos (contrato §4.3 + convenção /platform-*)', () => {
  it('constantes únicas, de nível superior com hífen como /platform-announcements', () => {
    expect(SPONSORS_PATH).toBe('/platform-sponsors')
    expect(CAMPAIGNS_PATH).toBe('/platform-sponsor-campaigns')
    expect(UPLOADS_PATH).toBe('/platform-uploads')
  })
})

describe('sponsorsApi — patrocinadores', () => {
  it('lista: GET paginado com busca e total do X-Total-Count', async () => {
    const { calls } = mockFetch(() => listReply([sponsor(), sponsor({ id: 2, name: 'Outro' })], 42))
    loginAs()
    const page = await sponsorsApi.listSponsors({ q: ' berim ', limit: 20, offset: 0 })
    expect(calls[0].method).toBe('GET')
    expect(calls[0].path).toBe('/platform-sponsors')
    expect(calls[0].query.get('q')).toBe('berim')
    expect(calls[0].query.get('limit')).toBe('20')
    expect(calls[0].query.get('offset')).toBe('0')
    expect(page.total).toBe(42)
    expect(page.items.map((s) => s.name)).toEqual(['Casa do Berimbau', 'Outro'])
    expect(calls[0].headers.Authorization).toBe('Bearer test-token')
  })

  it('criar, editar e excluir usam POST, PATCH e DELETE', async () => {
    const { calls } = mockFetch((call) => {
      if (call.method === 'DELETE') return { status: 204 }
      return { status: call.method === 'POST' ? 201 : 200, body: sponsor() }
    })
    loginAs()
    await sponsorsApi.createSponsor({ name: 'A' })
    await sponsorsApi.updateSponsor(3, { name: 'B' })
    await expect(sponsorsApi.deleteSponsor(3)).resolves.toBeUndefined()
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /platform-sponsors', 'PATCH /platform-sponsors/3', 'DELETE /platform-sponsors/3'])
    expect(calls[0].body).toEqual({ name: 'A' })
    expect(calls[1].body).toEqual({ name: 'B' })
  })

  it('excluir patrocinador com campanhas: 409 SPONSOR_HAS_CAMPAIGNS chega como ApiError com o code', async () => {
    mockFetch(() => ({ status: 409, body: { statusCode: 409, code: 'SPONSOR_HAS_CAMPAIGNS', message: 'Patrocinador tem campanhas.' } }))
    loginAs()
    const error = await sponsorsApi.deleteSponsor(1).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(409)
    expect((error as ApiError).code).toBe('SPONSOR_HAS_CAMPAIGNS')
  })
})

describe('sponsorsApi — campanhas', () => {
  it('lista com filtros effective, sponsorId e q; vazios são omitidos', async () => {
    const { calls } = mockFetch(() => listReply([campaign()], 1))
    loginAs()
    await sponsorsApi.listCampaigns({ q: '', effective: 'ACTIVE_NOW', sponsorId: '4', limit: 20, offset: 40 })
    expect(calls[0].path).toBe('/platform-sponsor-campaigns')
    expect(calls[0].query.get('effective')).toBe('ACTIVE_NOW')
    expect(calls[0].query.get('sponsorId')).toBe('4')
    expect(calls[0].query.get('offset')).toBe('40')
    expect(calls[0].query.has('q')).toBe(false)
    await sponsorsApi.listCampaigns({ effective: '', sponsorId: '' })
    expect(calls[1].query.has('effective')).toBe(false)
    expect(calls[1].query.has('sponsorId')).toBe(false)
  })

  it('ler, criar, editar, excluir e as ações de estado', async () => {
    const { calls } = mockFetch((call) => (call.method === 'DELETE' ? { status: 204 } : { body: campaign() }))
    loginAs()
    await sponsorsApi.getCampaign(7)
    await sponsorsApi.createCampaign({ title: 'x' })
    await sponsorsApi.updateCampaign(7, { title: 'y' })
    await sponsorsApi.activateCampaign(7)
    await sponsorsApi.pauseCampaign(7)
    await sponsorsApi.resumeCampaign(7)
    await sponsorsApi.deleteCampaign(7)
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'GET /platform-sponsor-campaigns/7',
      'POST /platform-sponsor-campaigns',
      'PATCH /platform-sponsor-campaigns/7',
      'POST /platform-sponsor-campaigns/7/activate',
      'POST /platform-sponsor-campaigns/7/pause',
      'POST /platform-sponsor-campaigns/7/resume',
      'DELETE /platform-sponsor-campaigns/7',
    ])
    // ativar/pausar/retomar não mandam corpo (o aprovador é quem está logado)
    expect(calls[3].body).toBeUndefined()
  })

  it('relatório JSON: from/to na query e o formato do contrato', async () => {
    const { calls } = mockFetch(() => ({ body: report() }))
    loginAs()
    const data = await sponsorsApi.getReport(7, { from: '2026-10-01', to: '2026-10-31' })
    expect(calls[0].path).toBe('/platform-sponsor-campaigns/7/report')
    expect(calls[0].query.get('from')).toBe('2026-10-01')
    expect(calls[0].query.get('to')).toBe('2026-10-31')
    expect(data.totals).toEqual({ impressions: 1234, clicks: 56, ctr: 4.54 })
    expect(data.byDay).toHaveLength(2)
    expect(data.byState).toHaveLength(3)
  })

  it('relatório CSV: baixa o arquivo (Blob) com o Bearer, sem tentar ler como JSON', async () => {
    const csv = '﻿dia;impressoes;cliques\r\n2026-10-05;1000;40\r\n'
    const calls: Call[] = []
    // O mockFetch devolve JSON; para o CSV usamos uma resposta de texto própria.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input))
        calls.push({ method: init?.method ?? 'GET', path: url.pathname.replace(/^\/api/, ''), query: url.searchParams, body: undefined, headers: init?.headers as Record<string, string> })
        return new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv; charset=utf-8' } })
      }),
    )
    loginAs()
    const blob = await sponsorsApi.getReportCsv(7, { from: '2026-10-01', to: '2026-10-31' })
    // (o Blob vem do undici do Node, não da classe do jsdom: confere pelo conteúdo)
    expect(blob.type).toContain('text/csv')
    // os bytes chegam intactos, inclusive o BOM UTF-8 (EF BB BF) que o Excel precisa
    const bytes = Array.from(new Uint8Array(await new Response(blob).arrayBuffer()))
    expect(bytes.slice(0, 3)).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(new Uint8Array(bytes.slice(3)))).toBe(csv.slice(1))
    expect(calls[0].path).toBe('/platform-sponsor-campaigns/7/report.csv')
    expect(calls[0].query.get('from')).toBe('2026-10-01')
    expect(calls[0].query.get('to')).toBe('2026-10-31')
    expect(calls[0].headers.Authorization).toBe('Bearer test-token')
    expect(calls[0].headers['Content-Type']).toBe('application/json')
  })

  it('CSV com erro (403): ApiError com a mensagem do servidor', async () => {
    mockFetch(() => ({ status: 403, body: { message: 'Sem permissão.' } }))
    loginAs()
    await expect(sponsorsApi.getReportCsv(7, { from: '2026-10-01', to: '2026-10-31' })).rejects.toMatchObject({ status: 403, message: 'Sem permissão.' })
  })
})

describe('sponsorsApi — upload de imagem', () => {
  it('POST multipart em /platform-uploads, campo "file", SEM Content-Type JSON, devolve a url', async () => {
    const { calls, fetchMock } = mockFetch(() => ({ status: 201, body: { url: '/api/uploads/123e4567-e89b-12d3-a456-426614174000.webp', filename: 'x.webp', contentType: 'image/webp', size: 1000 } }))
    loginAs()
    const file = new File([new Uint8Array(10)], 'logo.png', { type: 'image/png' })
    const url = await sponsorsApi.uploadImage(file)
    expect(url).toBe('/api/uploads/123e4567-e89b-12d3-a456-426614174000.webp')
    expect(calls[0].method).toBe('POST')
    expect(calls[0].path).toBe('/platform-uploads')
    expect(calls[0].headers['Content-Type']).toBeUndefined()
    expect(calls[0].headers.Authorization).toBe('Bearer test-token')
    const sent = (fetchMock.mock.calls[0]![1] as RequestInit).body
    expect(sent).toBeInstanceOf(FormData)
    expect((sent as FormData).get('file')).toBeInstanceOf(File)
    expect(((sent as FormData).get('file') as File).name).toBe('logo.png')
  })
})

describe('rotas e menu de Patrocinadores', () => {
  it('4 telas de campanhas/patrocinadores, todas só para PLATAFORMA, com um único item de menu', () => {
    const byName = (name: string) => routes.find((r) => r.name === name)
    expect(byName('sponsors')?.path).toBe('/sponsors')
    expect(byName('sponsor-campaigns')?.path).toBe('/sponsors/campaigns')
    expect(byName('sponsor-campaign-new')?.path).toBe('/sponsors/campaigns/new')
    expect(byName('sponsor-campaign-edit')?.path).toContain('/sponsors/campaigns/:id')
    expect(byName('sponsor-campaign-report')?.path).toContain('/report')
    const sponsorRoutes = routes.filter((r) => String(r.path).startsWith('/sponsors'))
    expect(sponsorRoutes).toHaveLength(5)
    expect(sponsorRoutes.every((r) => r.meta?.platformOnly === true && r.meta?.requiresAuth === true)).toBe(true)
    expect(sponsorRoutes.filter((r) => r.meta?.navLabel)).toHaveLength(1)
  })

  it('o guard manda usuário que não é da plataforma de volta ao painel; PLATFORM entra', async () => {
    loginAs(makeUser({ userType: 'MEMBER' }))
    await router.push('/sponsors/campaigns')
    expect(router.currentRoute.value.name).toBe('dashboard')

    loginAs(makeUser({ userType: 'PLATFORM' }))
    await router.push('/sponsors/campaigns')
    expect(router.currentRoute.value.name).toBe('sponsor-campaigns')
    await router.push('/sponsors/campaigns/7/report')
    expect(router.currentRoute.value.name).toBe('sponsor-campaign-report')
    await router.push('/sponsors/campaigns/abc/edit') // id não numérico não casa com a rota
    expect(router.currentRoute.value.name).not.toBe('sponsor-campaign-edit')
  })

  it('o menu lateral mostra "Patrocinadores" para a plataforma e esconde para os demais', async () => {
    mockFetch(() => ({ body: { twoFactorEnabled: true } }))
    const platform = await mountView(SidebarLayout, makeUser({ userType: 'PLATFORM' }))
    expect(platform.wrapper.find('nav').text()).toContain('Patrocinadores')
    platform.wrapper.unmount()

    mockFetch(() => ({ body: { twoFactorEnabled: true } }))
    const member = await mountView(SidebarLayout, makeUser({ userType: 'MEMBER' }))
    expect(member.wrapper.find('nav').text()).not.toContain('Patrocinadores')
    expect(member.wrapper.find('nav').text()).toContain('Painel')
  })
})
