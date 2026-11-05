import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SponsorCampaignReportView from '@/views/SponsorCampaignReportView.vue'
import { flushPromises, mockFetch, type Call, type MockReply } from './helpers'
import { campaign, mountAt, report } from './sponsors-fixtures'

// "Hoje" fixo: 20/11/2026. A vigência (01/10 a 31/10) já acabou -> período padrão = 02/10 a 31/10 (30 dias).
const NOW = new Date('2026-11-20T15:00:00Z')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
})
afterEach(() => vi.useRealTimers())

const mount = () => mountAt(SponsorCampaignReportView, '/sponsors/campaigns/7/report')
const t = (w: { get: (s: string) => { text: () => string } }, id: string) => w.get(`[data-testid="${id}"]`).text()
const reports = (calls: Call[]) => calls.filter((c) => c.path === '/platform-sponsor-campaigns/7/report')

function handler(data = report(), csv?: (call: Call) => MockReply) {
  return (call: Call): MockReply | undefined => {
    if (call.path === '/platform-sponsor-campaigns/7') return { body: campaign({ id: 7, status: 'ACTIVE', effectiveStatus: 'ENDED' }) }
    if (call.path === '/platform-sponsor-campaigns/7/report') return { body: data }
    if (call.path === '/platform-sponsor-campaigns/7/report.csv') return csv?.(call) ?? { body: undefined }
    return undefined
  }
}

describe('SponsorCampaignReportView', () => {
  it('abre com o período padrão (últimos 30 dias da vigência) e pede o relatório com from/to', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper } = await mount()
    expect(calls.map((c) => c.path)).toEqual(['/platform-sponsor-campaigns/7', '/platform-sponsor-campaigns/7/report'])
    expect(reports(calls)[0].query.get('from')).toBe('2026-10-02')
    expect(reports(calls)[0].query.get('to')).toBe('2026-10-31')
    expect((wrapper.get('[data-testid="range-from"]').element as HTMLInputElement).value).toBe('2026-10-02')
    expect((wrapper.get('[data-testid="range-to"]').element as HTMLInputElement).value).toBe('2026-10-31')
    expect(t(wrapper, 'period-label')).toBe('Período: 02/10/2026 a 31/10/2026')
    expect(t(wrapper, 'report-header')).toContain('Berimbau com 20% off')
    expect(t(wrapper, 'report-header')).toContain('Casa do Berimbau')
  })

  it('cartões de totais: impressões, cliques e CTR (formato pt-BR)', async () => {
    mockFetch(handler(report({ totals: { impressions: 1234, clicks: 56, ctr: 4.54 } })))
    const { wrapper } = await mount()
    expect(t(wrapper, 'total-impressions')).toBe('1.234')
    expect(t(wrapper, 'total-clicks')).toBe('56')
    expect(t(wrapper, 'total-ctr')).toBe('4,54%')
  })

  it('CTR sem impressões é 0,00% (sem dividir por zero)', async () => {
    mockFetch(handler(report({ totals: { impressions: 0, clicks: 0, ctr: 0 }, byDay: [], byState: [] })))
    const { wrapper } = await mount()
    expect(t(wrapper, 'total-ctr')).toBe('0,00%')
  })

  it('aviso de privacidade: números agregados, sem identificar pessoas', async () => {
    mockFetch(handler())
    const { wrapper } = await mount()
    expect(t(wrapper, 'privacy-note')).toBe('Os números são agregados e não identificam pessoas.')
  })

  it('série por dia: gráficos de barras SVG (impressões e cliques) com os dias sem dado zerados', async () => {
    mockFetch(handler())
    const { wrapper } = await mount()
    const bars = wrapper.findAll('[data-testid="chart-impressions"] rect[data-value]')
    expect(bars).toHaveLength(30) // 02/10 .. 31/10, contínuo
    expect(bars.map((b) => b.attributes('data-value')).filter((v) => v !== '0')).toEqual(['1000', '234'])
    expect(wrapper.findAll('[data-testid="chart-clicks"] rect[data-value]').map((b) => b.attributes('data-value')).filter((v) => v !== '0')).toEqual(['40', '16'])
    expect(wrapper.get('[data-testid="chart-impressions"] svg').attributes('role')).toBe('img')
    expect(wrapper.get('[data-testid="chart-impressions"] title').text()).toMatch(/^\d{2}\/\d{2}: /)

    // a mesma informação em tabela (acessível)
    const day5 = wrapper.get('[data-testid="day-2026-10-05"]')
    expect(day5.text()).toContain('05/10/2026')
    expect(day5.text()).toContain('1.000')
    expect(day5.text()).toContain('40')
    expect(day5.text()).toContain('4,00%')
    expect(wrapper.findAll('[data-testid="by-day-table"] tbody tr')).toHaveLength(30)
  })

  it('tabela por UF: ordenada por impressões, "Não identificada" para UF vazia e CTR por linha', async () => {
    mockFetch(handler())
    const { wrapper } = await mount()
    const rows = wrapper.findAll('[data-testid="by-state-table"] tbody tr')
    expect(rows.map((r) => r.find('th').text())).toEqual(['GO — Goiás', 'SP — São Paulo', 'Não identificada'])
    expect(rows[0].text()).toContain('1.000')
    expect(rows[0].text()).toContain('4,00%')
    expect(rows[1].text()).toContain('5,00%')
    expect(rows[2].text()).toContain('17,65%') // 6/34
  })

  it('período sem nenhum dado: estado vazio claro (os totais zerados continuam visíveis)', async () => {
    mockFetch(handler(report({ totals: { impressions: 0, clicks: 0, ctr: 0 }, byDay: [], byState: [] })))
    const { wrapper } = await mount()
    expect(t(wrapper, 'empty')).toContain('Ainda não há impressões nem cliques')
    expect(wrapper.find('[data-testid="chart-impressions"]').exists()).toBe(false)
    expect(t(wrapper, 'total-impressions')).toBe('0')
  })

  it('carregando e erro (com "Tentar de novo" que refaz a consulta)', async () => {
    let release: (r: MockReply) => void = () => undefined
    mockFetch((call) => (call.path.endsWith('/report') ? new Promise<MockReply>((resolve) => (release = resolve)) : handler()(call)))
    const { wrapper } = await mount()
    expect(t(wrapper, 'loading')).toContain('Carregando relatório')
    release({ status: 500, body: { message: 'Relatório indisponível.' } })
    await flushPromises()
    expect(t(wrapper, 'load-error')).toContain('Relatório indisponível.')
    expect(wrapper.find('[data-testid="total-impressions"]').exists()).toBe(false)

    const { calls } = mockFetch(handler())
    await wrapper.get('[data-testid="retry"]').trigger('click')
    await flushPromises()
    expect(reports(calls)).toHaveLength(1)
    expect(t(wrapper, 'total-impressions')).toBe('1.234')
  })

  it('campanha que não existe: erro, sem tentar o relatório', async () => {
    const { calls } = mockFetch((call) => (call.path === '/platform-sponsor-campaigns/7' ? { status: 404, body: { message: 'Campanha não encontrada.' } } : undefined))
    const { wrapper } = await mount()
    expect(t(wrapper, 'load-error')).toContain('Campanha não encontrada.')
    expect(reports(calls)).toHaveLength(0)
  })

  it('seletor de período: datas livres, atalhos e validação', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper } = await mount()

    await wrapper.get('[data-testid="range-from"]').setValue('2026-10-10')
    await wrapper.get('[data-testid="range-to"]').setValue('2026-10-12')
    await wrapper.get('[data-testid="range-form"]').trigger('submit')
    await flushPromises()
    expect(reports(calls)[1].query.get('from')).toBe('2026-10-10')
    expect(reports(calls)[1].query.get('to')).toBe('2026-10-12')
    expect(t(wrapper, 'period-label')).toBe('Período: 10/10/2026 a 12/10/2026')
    expect(wrapper.findAll('[data-testid="by-day-table"] tbody tr')).toHaveLength(3)

    await wrapper.get('[data-testid="preset-7"]').trigger('click')
    await flushPromises()
    expect(reports(calls)[2].query.get('from')).toBe('2026-10-25')
    expect(reports(calls)[2].query.get('to')).toBe('2026-10-31')

    await wrapper.get('[data-testid="preset-all"]').trigger('click')
    await flushPromises()
    expect(reports(calls)[3].query.get('from')).toBe('2026-10-01')
    expect(reports(calls)[3].query.get('to')).toBe('2026-10-31')

    // inválido: from depois de to -> mensagem e nenhuma chamada nova
    await wrapper.get('[data-testid="range-from"]').setValue('2026-10-20')
    await wrapper.get('[data-testid="range-to"]').setValue('2026-10-10')
    await wrapper.get('[data-testid="range-form"]').trigger('submit')
    await flushPromises()
    expect(t(wrapper, 'range-error')).toContain('anterior ou igual')
    expect(reports(calls)).toHaveLength(4)
  })

  describe('Exportar CSV', () => {
    function stubDownload() {
      const created: Blob[] = []
      const clicked: Array<{ download: string; href: string }> = []
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: (b: Blob) => (created.push(b), 'blob:csv-1') })
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: () => undefined })
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push({ download: this.download, href: this.href })
      })
      return { created, clicked }
    }

    it('baixa o .csv do período mostrado, com nome de arquivo claro', async () => {
      const { clicked, created } = stubDownload()
      const csvText = '﻿dia;impressoes;cliques\r\n2026-10-05;1000;40\r\n'
      const { calls } = mockFetch(
        handler(report(), () => ({ body: undefined })),
      )
      // O servidor devolve texto, não JSON: troca só a resposta do CSV.
      const base = globalThis.fetch as unknown as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
      vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) =>
        String(input).includes('report.csv') ? (calls.push({ method: 'GET', path: new URL(String(input)).pathname.replace(/^\/api/, ''), query: new URL(String(input)).searchParams, body: undefined, headers: init?.headers as Record<string, string> }), new Response(csvText, { headers: { 'Content-Type': 'text/csv' } })) : base(input, init),
      )
      const { wrapper } = await mount()
      expect(wrapper.get('[data-testid="export-csv"]').text()).toBe('Exportar CSV')
      await wrapper.get('[data-testid="export-csv"]').trigger('click')
      await flushPromises()

      const csvCall = calls.find((c) => c.path.endsWith('report.csv'))!
      expect(csvCall.path).toBe('/platform-sponsor-campaigns/7/report.csv')
      expect(csvCall.query.get('from')).toBe('2026-10-02')
      expect(csvCall.query.get('to')).toBe('2026-10-31')
      expect(csvCall.headers.Authorization).toBe('Bearer test-token')
      expect(created).toHaveLength(1)
      expect(created[0].size).toBeGreaterThan(0)
      expect(clicked).toEqual([{ download: 'campanha-7-2026-10-02_a_2026-10-31.csv', href: 'blob:csv-1' }])
      expect(wrapper.find('[data-testid="export-error"]').exists()).toBe(false)
    })

    it('exporta o período que está na tela (não o que está só digitado nos campos)', async () => {
      const { clicked } = stubDownload()
      const { calls } = mockFetch(handler(report(), () => ({ body: undefined })))
      const { wrapper } = await mount()
      await wrapper.get('[data-testid="range-from"]').setValue('2026-10-20') // digitado, mas não aplicado
      await wrapper.get('[data-testid="export-csv"]').trigger('click')
      await flushPromises()
      expect(calls.find((c) => c.path.endsWith('report.csv'))!.query.get('from')).toBe('2026-10-02')
      expect(clicked[0].download).toContain('2026-10-02')
    })

    it('erro ao exportar: mensagem junto do botão e nenhum arquivo baixado', async () => {
      const { clicked } = stubDownload()
      mockFetch(handler(report(), () => ({ status: 500, body: { message: 'Falha ao gerar o CSV.' } })))
      const { wrapper } = await mount()
      await wrapper.get('[data-testid="export-csv"]').trigger('click')
      await flushPromises()
      expect(t(wrapper, 'export-error')).toBe('Falha ao gerar o CSV.')
      expect(clicked).toHaveLength(0)
      expect(wrapper.get('[data-testid="export-csv"]').attributes('disabled')).toBeUndefined()
    })
  })
})
