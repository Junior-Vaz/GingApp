import { describe, expect, it } from 'vitest'
import SponsorCampaignReportView from '@/views/SponsorCampaignReportView.vue'
import { mockFetch, type Call, type MockReply } from './helpers'
import { groupCampaign, mountAt, report } from './sponsors-fixtures'

/** Relatório de campanha de GRUPO: reaproveita a tela da plataforma (contrato do grupo §4: o endpoint existente passa a aceitar campanhas de grupo). */
function handler(c = groupCampaign()) {
  return (call: Call): MockReply | undefined => {
    if (call.path === `/platform-sponsor-campaigns/${c.id}`) return { body: c }
    if (call.path === `/platform-sponsor-campaigns/${c.id}/report`) return { body: report({ campaign: { id: c.id, title: c.title, sponsorName: 'Loja do Axé', startsAt: c.startsAt, endsAt: c.endsAt, status: 'ACTIVE' } }) }
    return undefined
  }
}

describe('SponsorCampaignReportView — campanha de grupo', () => {
  it('vindo do grupo (?group=5): "voltar" retorna à tela do grupo, mostra o nome do grupo e usa o mesmo endpoint de relatório', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper } = await mountAt(SponsorCampaignReportView, '/sponsors/campaigns/21/report?group=5')
    const back = wrapper.get('[data-testid="back"]')
    expect(back.attributes('href')).toBe('/sponsors/groups/5')
    expect(back.text()).toBe('← Voltar para o grupo')
    expect(wrapper.get('[data-testid="report-group"]').text()).toBe('Capoeira Raízes')
    expect(calls.map((c) => c.path)).toEqual(['/platform-sponsor-campaigns/21', '/platform-sponsor-campaigns/21/report'])
    expect(wrapper.get('[data-testid="total-impressions"]').text()).toBe('1.234')
    expect(wrapper.get('[data-testid="privacy-note"]').text()).toBe('Os números são agregados e não identificam pessoas.')
  })

  it('campanha suspensa pela plataforma mostra o selo no cabeçalho do relatório', async () => {
    mockFetch(handler(groupCampaign({ platformSuspended: true, platformSuspendReason: 'Denúncia' })))
    const { wrapper } = await mountAt(SponsorCampaignReportView, '/sponsors/campaigns/21/report?group=5')
    expect(wrapper.get('[data-testid="suspended-badge"]').text()).toBe('Suspensa pela plataforma')
  })

  it('sem ?group (campanha da plataforma): "voltar" continua indo para as campanhas, sem selo nem grupo', async () => {
    mockFetch(handler(groupCampaign({ organization: null, platformSuspended: false })))
    const { wrapper } = await mountAt(SponsorCampaignReportView, '/sponsors/campaigns/21/report')
    const back = wrapper.get('[data-testid="back"]')
    expect(back.attributes('href')).toBe('/sponsors/campaigns')
    expect(back.text()).toBe('← Voltar para as campanhas')
    expect(wrapper.find('[data-testid="report-group"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="suspended-badge"]').exists()).toBe(false)
  })

  it('?group inválido é ignorado (não monta link estranho)', async () => {
    mockFetch(handler())
    const { wrapper } = await mountAt(SponsorCampaignReportView, '/sponsors/campaigns/21/report?group=abc')
    expect(wrapper.get('[data-testid="back"]').attributes('href')).toBe('/sponsors/campaigns')
  })
})
