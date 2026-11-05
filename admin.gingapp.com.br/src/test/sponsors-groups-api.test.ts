import { describe, expect, it } from 'vitest'
import { ApiError } from '@/utils/api'
import {
  blockText,
  blockedReasonOf,
  filterGroups,
  isCampaignSuspended,
  reasonError,
  suspensionText,
  supervisionError,
} from '@/utils/sponsorGroups'
import { formatDateTime } from '@/utils/format'
import { GROUPS_PATH, sponsorsApi } from '@/utils/sponsorsApi'
import { loginAs, mockFetch } from './helpers'
import { groupCampaign, groupRow, listReply, sponsor } from './sponsors-fixtures'

describe('sponsorsApi — supervisão dos grupos (contrato do grupo §4)', () => {
  it('prefixo do grupo é /platform-sponsor-groups', () => {
    expect(GROUPS_PATH).toBe('/platform-sponsor-groups')
  })

  it('listGroups: GET com limit=200 (o backend pagina em 50 por padrão), no formato {organizationId,name,sponsors,campaigns,activeNow,blocked,termsAcceptedAt}', async () => {
    const { calls } = mockFetch(() => listReply([groupRow(), groupRow({ organizationId: 6, name: 'Outro', blocked: true, termsAcceptedAt: null })]))
    loginAs()
    const page = await sponsorsApi.listGroups()
    expect(calls[0].method).toBe('GET')
    expect(calls[0].path).toBe('/platform-sponsor-groups')
    expect([...calls[0].query.keys()]).toEqual(['limit'])
    expect(calls[0].query.get('limit')).toBe('200')
    expect(calls[0].headers.Authorization).toBe('Bearer test-token')
    expect(page.total).toBe(2)
    expect(page.items[1]).toMatchObject({ organizationId: 6, blocked: true, termsAcceptedAt: null })
  })

  it('listGroupSponsors e listGroupCampaigns: scope=GROUP e organizationId; filtros vazios são omitidos', async () => {
    const { calls } = mockFetch((call) => (call.path === '/platform-sponsors' ? listReply([sponsor()]) : listReply([groupCampaign()])))
    loginAs()
    await sponsorsApi.listGroupSponsors(5, { limit: 200 })
    await sponsorsApi.listGroupCampaigns(5, { q: ' abada ', effective: 'ACTIVE_NOW', limit: 200 })
    await sponsorsApi.listGroupCampaigns(5, { q: '', effective: '' })

    expect(calls[0].path).toBe('/platform-sponsors')
    expect(calls[0].query.get('scope')).toBe('GROUP')
    expect(calls[0].query.get('organizationId')).toBe('5')
    expect(calls[0].query.get('limit')).toBe('200')

    expect(calls[1].path).toBe('/platform-sponsor-campaigns')
    expect(calls[1].query.get('scope')).toBe('GROUP')
    expect(calls[1].query.get('organizationId')).toBe('5')
    expect(calls[1].query.get('effective')).toBe('ACTIVE_NOW')
    expect(calls[1].query.get('q')).toBe('abada')

    expect(calls[2].query.has('effective')).toBe(false)
    expect(calls[2].query.has('q')).toBe(false)
    expect(calls[2].query.get('scope')).toBe('GROUP')
  })

  it('as listas padrão da plataforma NÃO ganham scope/organizationId (comportamento da Fase 1 intacto)', async () => {
    const { calls } = mockFetch(() => listReply([]))
    loginAs()
    await sponsorsApi.listCampaigns({ limit: 20 })
    await sponsorsApi.listSponsors({ limit: 20 })
    for (const call of calls) {
      expect(call.query.has('scope')).toBe(false)
      expect(call.query.has('organizationId')).toBe(false)
    }
  })

  it('suspender manda {reason}; levantar suspensão, sem corpo', async () => {
    const { calls } = mockFetch(() => ({ body: groupCampaign() }))
    loginAs()
    await sponsorsApi.suspendCampaign(21, 'Conteúdo impróprio')
    await sponsorsApi.unsuspendCampaign(21)
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /platform-sponsor-campaigns/21/suspend', 'POST /platform-sponsor-campaigns/21/unsuspend'])
    expect(calls[0].body).toEqual({ reason: 'Conteúdo impróprio' })
    expect(calls[1].body).toBeUndefined()
  })

  it('bloquear manda {reason}; liberar, sem corpo (corpo vazio 200/201/204 não quebra)', async () => {
    const { calls } = mockFetch((call) => (call.path.endsWith('/unblock') ? { status: 204 } : { status: 201 }))
    loginAs()
    await expect(sponsorsApi.blockGroup(5, 'Denúncias')).resolves.toBeUndefined()
    await expect(sponsorsApi.unblockGroup(5)).resolves.toBeUndefined()
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /platform-sponsor-groups/5/block', 'POST /platform-sponsor-groups/5/unblock'])
    expect(calls[0].body).toEqual({ reason: 'Denúncias' })
    expect(calls[1].body).toBeUndefined()
  })

  it('403 chega como ApiError com status', async () => {
    mockFetch(() => ({ status: 403, body: { message: 'Forbidden resource' } }))
    loginAs()
    const error = await sponsorsApi.blockGroup(5, 'abc').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(403)
  })
})

describe('sponsorGroups — utilitários', () => {
  it('reasonError: obrigatório, 3..300, conta sem espaços nas pontas', () => {
    expect(reasonError('')).toBe('Informe o motivo.')
    expect(reasonError('    ')).toBe('Informe o motivo.')
    expect(reasonError('ab')).toBe('O motivo deve ter pelo menos 3 caracteres.')
    expect(reasonError('  ab  ')).toBe('O motivo deve ter pelo menos 3 caracteres.')
    expect(reasonError('abc')).toBe('')
    expect(reasonError('a'.repeat(300))).toBe('')
    expect(reasonError('a'.repeat(301))).toBe('O motivo pode ter no máximo 300 caracteres.')
  })

  it('filterGroups: busca sem acento nem caixa', () => {
    const groups = [groupRow({ name: 'Capoeira Raízes' }), groupRow({ organizationId: 6, name: 'Ginga Mundo' })]
    expect(filterGroups(groups, 'raizes').map((g) => g.organizationId)).toEqual([5])
    expect(filterGroups(groups, ' GINGA ').map((g) => g.organizationId)).toEqual([6])
    expect(filterGroups(groups, '').length).toBe(2)
    expect(filterGroups(groups, 'zzz')).toEqual([])
  })

  it('isCampaignSuspended: pelo booleano ou pela data; suspensionText só inclui quem/quando que vieram', () => {
    expect(isCampaignSuspended(groupCampaign())).toBe(false)
    expect(isCampaignSuspended(groupCampaign({ platformSuspended: true }))).toBe(true)
    expect(isCampaignSuspended(groupCampaign({ platformSuspended: undefined, platformSuspendedAt: '2026-11-02T13:00:00.000Z' }))).toBe(true)

    expect(suspensionText(groupCampaign({ platformSuspended: true }), formatDateTime)).toBe('Suspensa pela plataforma')
    expect(
      suspensionText(groupCampaign({ platformSuspended: true, platformSuspendedAt: '2026-11-02T13:00:00.000Z', platformSuspendedBy: { id: 9, name: 'Ana Suporte' } }), formatDateTime),
    ).toBe('Suspensa pela plataforma por Ana Suporte em 02/11/2026, 10:00')
    expect(suspensionText(groupCampaign({ platformSuspended: true, platformSuspendedByUserId: 9 }), formatDateTime)).toBe('Suspensa pela plataforma por usuário #9')
  })

  it('blockText / blockedReasonOf aceitam os nomes de campo do contrato (sponsorsBlocked*) e os curtos', () => {
    expect(blockText(groupRow({ blocked: true }), formatDateTime)).toBe('Bloqueado pela plataforma')
    expect(blockText(groupRow({ blocked: true, sponsorsBlockedAt: '2026-11-02T13:00:00.000Z', blockedByName: 'Owner' }), formatDateTime)).toBe('Bloqueado pela plataforma por Owner em 02/11/2026, 10:00')
    expect(blockedReasonOf(groupRow({ sponsorsBlockedReason: 'Denúncias' }))).toBe('Denúncias')
    expect(blockedReasonOf(groupRow({ blockedReason: 'Outro' }))).toBe('Outro')
    expect(blockedReasonOf(groupRow())).toBe('')
  })

  it('supervisionError: mensagem em português do servidor vence; padrão em inglês do Nest vira texto claro (403/404/400)', () => {
    expect(supervisionError(new ApiError('Somente super admin pode bloquear grupos.', 403), 'x')).toBe('Somente super admin pode bloquear grupos.')
    expect(supervisionError(new ApiError('Forbidden resource', 403), 'x')).toContain('não tem permissão')
    expect(supervisionError(new ApiError('Not Found', 404), 'x')).toContain('não existe mais')
    expect(supervisionError(new ApiError('Erro na requisição (404).', 404), 'x')).toContain('não existe mais')
    expect(supervisionError(new ApiError('Bad Request', 400), 'x')).toContain('Confira o motivo')
    expect(supervisionError(new ApiError('reason deve ter entre 3 e 300 caracteres.', 400), 'x')).toBe('reason deve ter entre 3 e 300 caracteres.')
    expect(supervisionError(new TypeError('Failed to fetch'), 'Sem conexão.')).toBe('Sem conexão.')
    expect(supervisionError(new ApiError('Erro na requisição (500).', 500), 'Falhou.')).toBe('Falhou.')
  })
})
