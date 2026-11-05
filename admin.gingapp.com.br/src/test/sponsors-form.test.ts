import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { takeFlash } from '@/utils/flash'
import SponsorCampaignFormView from '@/views/SponsorCampaignFormView.vue'
import { flushPromises, mockFetch, type Call, type MockReply } from './helpers'
import { campaign, listReply, mountAt, sponsor } from './sponsors-fixtures'

const UPLOADED = '/api/uploads/123e4567-e89b-12d3-a456-426614174000.webp'
const LOGO = '/api/uploads/aaaaaaaa-e89b-12d3-a456-426614174000.png'
const sponsors = [sponsor({ id: 1, name: 'Casa do Berimbau' }), sponsor({ id: 2, name: 'Moda Roda', logo: LOGO })]

const mountNew = () => mountAt(SponsorCampaignFormView, '/sponsors/campaigns/new')
const mountEdit = () => mountAt(SponsorCampaignFormView, '/sponsors/campaigns/7/edit')
const nonGet = (calls: Call[]) => calls.filter((c) => c.method !== 'GET')
const field = (w: VueWrapper, name: string) => w.get(`[data-testid="field-${name}"]`)
const errorOf = (w: VueWrapper, id: string) => w.find(`[data-testid="${id}-error"]`)

function handler(extra?: (call: Call) => MockReply | undefined, stored = campaign({ id: 7, status: 'DRAFT', effectiveStatus: 'DRAFT' })) {
  return (call: Call): MockReply | undefined => {
    const custom = extra?.(call)
    if (custom) return custom
    if (call.path === '/platform-sponsors') return listReply(sponsors)
    if (call.path === '/platform-sponsor-campaigns/7' && call.method === 'GET') return { body: stored }
    if (call.path === '/platform-uploads') return { status: 201, body: { url: UPLOADED } }
    if (call.method === 'POST') return { status: 201, body: campaign({ id: 99 }) }
    if (call.method === 'PATCH') return { body: stored }
    return undefined
  }
}

async function fillAll(wrapper: VueWrapper, overrides: Record<string, string> = {}) {
  const values: Record<string, string> = {
    sponsorId: '1',
    title: 'Berimbau com 20% off',
    text: 'Instrumentos artesanais para a sua roda.',
    destinationUrl: 'https://www.casadoberimbau.com.br/oferta',
    category: 'INSTRUMENTOS',
    startsAt: '2026-11-10T08:00',
    endsAt: '2026-12-10T23:59',
    weight: '3',
    price: '1.500,00',
    ...overrides,
  }
  for (const [name, value] of Object.entries(values)) await field(wrapper, name).setValue(value)
}

async function pickFile(wrapper: VueWrapper, testid: string, file: File) {
  const input = wrapper.get(`[data-testid="${testid}-input"]`)
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

describe('SponsorCampaignFormView — criar', () => {
  it('busca os patrocinadores e oferece SÓ as 7 categorias da lista branca, em português', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper } = await mountNew()
    expect(calls[0].path).toBe('/platform-sponsors')
    expect(calls[0].query.get('limit')).toBe('200')
    expect(field(wrapper, 'sponsorId').findAll('option').map((o) => o.text())).toEqual(['Escolha…', 'Casa do Berimbau', 'Moda Roda'])
    const options = field(wrapper, 'category').findAll('option')
    expect(options.map((o) => o.attributes('value'))).toEqual(['', 'INSTRUMENTOS', 'VESTUARIO', 'SAUDE', 'EDUCACAO', 'EVENTOS_TURISMO', 'ALIMENTACAO', 'ESPORTES'])
    expect(options.slice(1).map((o) => o.text())).toEqual(['Instrumentos', 'Vestuário', 'Saúde', 'Educação', 'Eventos e turismo', 'Alimentação', 'Esportes'])
    expect((field(wrapper, 'ctaLabel').element as HTMLInputElement).value).toBe('Conhecer')
    expect((field(wrapper, 'weight').element as HTMLInputElement).value).toBe('1')
  })

  it('cria como rascunho: POST no formato do contrato, datas em ISO (Brasília), centavos e UFs; volta para a lista com aviso', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper, router } = await mountNew()
    await fillAll(wrapper)
    await wrapper.get('[data-testid="uf-SP"]').setValue(true)
    await wrapper.get('[data-testid="uf-GO"]').setValue(true)
    await pickFile(wrapper, 'image', new File([new Uint8Array(2000)], 'fundo.webp', { type: 'image/webp' }))
    await wrapper.get('[data-testid="campaign-form"]').trigger('submit')
    await flushPromises()

    const posts = nonGet(calls).filter((c) => c.path === '/platform-sponsor-campaigns')
    expect(posts).toHaveLength(1)
    expect(posts[0].method).toBe('POST')
    expect(posts[0].body).toEqual({
      sponsorId: 1,
      title: 'Berimbau com 20% off',
      text: 'Instrumentos artesanais para a sua roda.',
      imageRef: UPLOADED,
      ctaLabel: 'Conhecer',
      destinationUrl: 'https://www.casadoberimbau.com.br/oferta',
      category: 'INSTRUMENTOS',
      startsAt: '2026-11-10T11:00:00.000Z',
      endsAt: '2026-12-11T02:59:00.000Z',
      weight: 3,
      states: ['GO', 'SP'],
      priceCents: 150000,
      billingNote: null,
    })
    expect(router.currentRoute.value.path).toBe('/sponsors/campaigns')
    expect(takeFlash()).toContain('criada como rascunho')
  })

  it('sem UF marcada vai states: [] (Brasil todo) e sem preço vai priceCents: null', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper } = await mountNew()
    expect(wrapper.get('[data-testid="states-summary"]').text()).toContain('Brasil todo')
    await fillAll(wrapper, { price: '' })
    await wrapper.get('[data-testid="campaign-form"]').trigger('submit')
    await flushPromises()
    const body = nonGet(calls)[0].body as Record<string, unknown>
    expect(body.states).toEqual([])
    expect(body.priceCents).toBeNull()
  })

  it('UFs: 27 caixas; "Marcar todos" e "Brasil todo (limpar)"', async () => {
    mockFetch(handler())
    const { wrapper } = await mountNew()
    expect(wrapper.findAll('[data-testid^="uf-"]')).toHaveLength(27)
    await wrapper.get('[data-testid="states-all"]').trigger('click')
    expect(wrapper.get('[data-testid="states-summary"]').text()).toContain('27 estado(s)')
    expect(wrapper.get('[data-testid="states-all"]').text()).toBe('Desmarcar todos')
    await wrapper.get('[data-testid="states-clear"]').trigger('click')
    expect(wrapper.get('[data-testid="states-summary"]').text()).toContain('Brasil todo')
    await wrapper.get('[data-testid="uf-RJ"]').setValue(true)
    expect(wrapper.get('[data-testid="states-summary"]').text()).toContain('1 estado(s)')
  })

  it('contadores de título (60), texto (90) e botão (24) acompanham a digitação e ficam vermelhos ao estourar', async () => {
    mockFetch(handler())
    const { wrapper } = await mountNew()
    await field(wrapper, 'title').setValue('Oferta')
    expect(wrapper.get('[data-testid="cf-title-counter"]').text()).toBe('6/60')
    expect(wrapper.get('[data-testid="cf-title-counter"]').classes()).not.toContain('text-red-700')
    await field(wrapper, 'title').setValue('x'.repeat(61))
    expect(wrapper.get('[data-testid="cf-title-counter"]').text()).toBe('61/60')
    expect(wrapper.get('[data-testid="cf-title-counter"]').classes()).toContain('text-red-700')
    await field(wrapper, 'text').setValue('y'.repeat(91))
    expect(wrapper.get('[data-testid="cf-text-counter"]').text()).toBe('91/90')
    expect(wrapper.get('[data-testid="cf-cta-counter"]').text()).toBe('8/24')
  })

  it('URL: validação AO VIVO (sem sair do campo), com aviso quando não é https', async () => {
    mockFetch(handler())
    const { wrapper } = await mountNew()
    expect(errorOf(wrapper, 'cf-url').exists()).toBe(false) // vazio e intocado: sem erro

    await field(wrapper, 'destinationUrl').setValue('http://www.loja.com.br')
    expect(errorOf(wrapper, 'cf-url').text()).toContain('https://')
    expect(wrapper.get('[data-testid="url-warning"]').text()).toContain('não é seguro')
    expect(field(wrapper, 'destinationUrl').attributes('aria-invalid')).toBe('true')

    await field(wrapper, 'destinationUrl').setValue('https://usuario:senha@loja.com.br')
    expect(errorOf(wrapper, 'cf-url').text()).toContain('usuário ou senha')
    expect(wrapper.find('[data-testid="url-warning"]').exists()).toBe(false)

    for (const bad of ['https://127.0.0.1/x', 'https://localhost/x', 'https://[::1]/']) {
      await field(wrapper, 'destinationUrl').setValue(bad)
      expect(errorOf(wrapper, 'cf-url').exists(), bad).toBe(true)
    }

    await field(wrapper, 'destinationUrl').setValue('https://www.loja.com.br/oferta')
    expect(errorOf(wrapper, 'cf-url').exists()).toBe(false)
    expect(field(wrapper, 'destinationUrl').attributes('aria-invalid')).toBeUndefined()
  })

  it('pré-visualização fiel e ao vivo: título, texto, botão, selo "Patrocinado", patrocinador, logo e imagem', async () => {
    mockFetch(handler())
    const { wrapper } = await mountNew()
    const preview = wrapper.get('[data-testid="slide-preview"]')

    // estado inicial: placeholders + botão padrão + selo SEMPRE presente
    expect(preview.get('[data-testid="preview-badge"]').text()).toBe('Patrocinado')
    expect(preview.get('[data-testid="preview-cta"]').text()).toContain('Conhecer')
    expect(preview.find('[data-testid="preview-image"]').exists()).toBe(false) // sem imagem: degradê
    expect(preview.classes().join(' ') + preview.html()).toContain('sp-slide--plain')
    expect(preview.text()).toContain('Pré-visualização no app (375 px)')

    await field(wrapper, 'title').setValue('Oferta de Natal')
    await field(wrapper, 'text').setValue('Frete grátis para todo o Brasil.')
    await field(wrapper, 'ctaLabel').setValue('Ver oferta')
    expect(preview.get('[data-testid="preview-title"]').text()).toBe('Oferta de Natal')
    expect(preview.get('[data-testid="preview-text"]').text()).toBe('Frete grátis para todo o Brasil.')
    expect(preview.get('[data-testid="preview-cta"]').text()).toContain('Ver oferta')

    await field(wrapper, 'sponsorId').setValue('2')
    expect(preview.get('[data-testid="preview-sponsor"]').text()).toContain('Moda Roda')
    expect((preview.get('[data-testid="preview-logo"]').element as HTMLImageElement).src).toContain(LOGO)

    await pickFile(wrapper, 'image', new File([new Uint8Array(100)], 'f.webp', { type: 'image/webp' }))
    expect((preview.get('[data-testid="preview-image"]').element as HTMLImageElement).src).toContain(UPLOADED)
    expect(preview.html()).not.toContain('sp-slide--plain')

    // botão em branco volta ao padrão
    await field(wrapper, 'ctaLabel').setValue('')
    expect(preview.get('[data-testid="preview-cta"]').text()).toContain('Conhecer')
    // moldura de 375 px (largura do celular)
    expect(preview.find('.sp-slide').exists()).toBe(true)
  })

  it('aviso explícito: "Patrocinado" é obrigatório e o anúncio não pode imitar aviso/post do Mestre', async () => {
    mockFetch(handler())
    const { wrapper } = await mountNew()
    const warning = wrapper.get('[data-testid="label-warning"]').text()
    expect(warning).toContain('“Patrocinado” é obrigatório')
    expect(warning).toContain('não pode imitar aviso, notificação ou post do Mestre')
  })

  it('o logo vem do patrocinador (somente leitura) com atalho para editá-lo', async () => {
    mockFetch(handler())
    const { wrapper } = await mountNew()
    await field(wrapper, 'sponsorId').setValue('2')
    const note = wrapper.get('[data-testid="logo-readonly"]')
    expect(note.text()).toContain('já cadastrado')
    expect(note.find('a').attributes('href')).toBe('/sponsors')
    await field(wrapper, 'sponsorId').setValue('1')
    expect(note.text()).toContain('ainda não tem logo')
  })

  it('imagem: aceita só JPEG/PNG/WebP até 250 KB (recusa antes de enviar) e avisa quando passa o limite', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper } = await mountNew()
    await pickFile(wrapper, 'image', new File([new Uint8Array(251 * 1024)], 'enorme.jpg', { type: 'image/jpeg' }))
    expect(wrapper.get('[data-testid="image-error"]').text()).toContain('250 KB')
    await pickFile(wrapper, 'image', new File([new Uint8Array(10)], 'x.svg', { type: 'image/svg+xml' }))
    expect(wrapper.get('[data-testid="image-error"]').text()).toContain('JPEG, PNG ou WebP')
    expect(calls.filter((c) => c.path === '/platform-uploads')).toHaveLength(0)
    expect(wrapper.get('#upload-msg-image').text()).toContain('1200×630')
    // remover imagem
    await pickFile(wrapper, 'image', new File([new Uint8Array(10)], 'ok.png', { type: 'image/png' }))
    expect(wrapper.find('[data-testid="image-preview"]').exists()).toBe(true)
    await wrapper.get('[data-testid="image-remove"]').trigger('click')
    expect(wrapper.find('[data-testid="image-preview"]').exists()).toBe(false)
  })

  it('enviar vazio: mostra todos os erros, foca o primeiro campo inválido e NÃO chama a API', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper } = await mountNew()
    await wrapper.get('[data-testid="campaign-form"]').trigger('submit')
    await flushPromises()
    expect(nonGet(calls)).toHaveLength(0)
    for (const id of ['cf-sponsor', 'cf-title', 'cf-text', 'cf-url', 'cf-category', 'cf-starts', 'cf-ends']) {
      expect(errorOf(wrapper, id).exists(), id).toBe(true)
    }
    expect(document.activeElement?.id).toBe('cf-sponsor')
  })

  it('datas: fim antes do início e janela maior que 366 dias são recusados', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper } = await mountNew()
    await fillAll(wrapper, { startsAt: '2026-11-10T08:00', endsAt: '2026-11-09T08:00' })
    await wrapper.get('[data-testid="campaign-form"]').trigger('submit')
    await flushPromises()
    expect(errorOf(wrapper, 'cf-ends').text()).toContain('depois do início')
    await field(wrapper, 'endsAt').setValue('2027-11-12T08:00')
    expect(errorOf(wrapper, 'cf-ends').text()).toContain('366')
    expect(nonGet(calls)).toHaveLength(0)
    await field(wrapper, 'endsAt').setValue('2027-11-10T08:00')
    expect(errorOf(wrapper, 'cf-ends').exists()).toBe(false)
  })

  it('peso e preço inválidos', async () => {
    mockFetch(handler())
    const { wrapper } = await mountNew()
    await fillAll(wrapper, { weight: '11', price: 'abc' })
    await wrapper.get('[data-testid="campaign-form"]').trigger('submit')
    await flushPromises()
    expect(errorOf(wrapper, 'cf-weight').text()).toContain('1 a 10')
    expect(errorOf(wrapper, 'cf-price').text()).toContain('inválido')
  })

  it('400 do servidor com o nome do campo aparece no campo (priceCents -> preço); o resto em bloco; editar o campo limpa o erro', async () => {
    mockFetch(
      handler((call) =>
        call.method === 'POST' && call.path === '/platform-sponsor-campaigns'
          ? { status: 400, body: { message: ['destinationUrl deve ser uma URL https pública', 'priceCents deve ser inteiro', 'Já existe campanha igual neste período.'] } }
          : undefined,
      ),
    )
    const { wrapper, router } = await mountNew()
    await fillAll(wrapper)
    await wrapper.get('[data-testid="campaign-form"]').trigger('submit')
    await flushPromises()
    expect(errorOf(wrapper, 'cf-url').text()).toBe('destinationUrl deve ser uma URL https pública')
    expect(errorOf(wrapper, 'cf-price').text()).toBe('priceCents deve ser inteiro')
    expect(wrapper.get('[data-testid="form-errors"]').text()).toContain('Já existe campanha igual')
    expect(router.currentRoute.value.path).toBe('/sponsors/campaigns/new')
    await field(wrapper, 'destinationUrl').setValue('https://www.outra.com.br')
    expect(errorOf(wrapper, 'cf-url').exists()).toBe(false)
    expect(errorOf(wrapper, 'cf-price').exists()).toBe(true) // o outro campo mantém o erro
  })

  it('erro de rede/500 ao salvar: mensagem em bloco e o botão volta a funcionar', async () => {
    mockFetch(handler((call) => (call.method === 'POST' && call.path === '/platform-sponsor-campaigns' ? { status: 500, body: { message: 'Erro interno.' } } : undefined)))
    const { wrapper } = await mountNew()
    await fillAll(wrapper)
    await wrapper.get('[data-testid="campaign-form"]').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[data-testid="form-errors"]').text()).toBe('Erro interno.')
    expect(wrapper.get('[data-testid="campaign-save"]').attributes('disabled')).toBeUndefined()
  })

  it('sem patrocinadores cadastrados: avisa e bloqueia o salvar', async () => {
    mockFetch((call) => (call.path === '/platform-sponsors' ? listReply([]) : undefined))
    const { wrapper } = await mountNew()
    expect(wrapper.get('[data-testid="no-sponsors"]').text()).toContain('Cadastre um patrocinador')
    expect(wrapper.get('[data-testid="campaign-save"]').attributes('disabled')).toBeDefined()
  })

  it('falha ao carregar os patrocinadores: erro com "Tentar de novo"', async () => {
    mockFetch(() => ({ status: 500, body: { message: 'Indisponível.' } }))
    const { wrapper } = await mountNew()
    expect(wrapper.get('[data-testid="load-error"]').text()).toContain('Indisponível.')
    expect(wrapper.find('[data-testid="campaign-form"]').exists()).toBe(false)
  })
})

describe('SponsorCampaignFormView — editar', () => {
  it('carrega a campanha no formulário (datas em hora de Brasília, preço em reais) e salva com PATCH', async () => {
    const { calls } = mockFetch(handler())
    const { wrapper, router } = await mountEdit()
    expect(wrapper.get('h1').text()).toBe('Editar campanha')
    expect(calls.map((c) => c.path)).toContain('/platform-sponsor-campaigns/7')
    expect((field(wrapper, 'title').element as HTMLInputElement).value).toBe('Berimbau com 20% off')
    expect((field(wrapper, 'startsAt').element as HTMLInputElement).value).toBe('2026-10-01T00:00')
    expect((field(wrapper, 'endsAt').element as HTMLInputElement).value).toBe('2026-11-01T00:00')
    expect((field(wrapper, 'price').element as HTMLInputElement).value).toBe('1500,00')
    expect((field(wrapper, 'category').element as HTMLSelectElement).value).toBe('INSTRUMENTOS')
    expect((wrapper.get('[data-testid="uf-GO"]').element as HTMLInputElement).checked).toBe(true)
    expect((wrapper.get('[data-testid="uf-AC"]').element as HTMLInputElement).checked).toBe(false)
    expect(wrapper.find('[data-testid="live-warning"]').exists()).toBe(false) // rascunho: sem aviso

    await field(wrapper, 'title').setValue('Berimbau com 25% off')
    await wrapper.get('[data-testid="campaign-form"]').trigger('submit')
    await flushPromises()
    const patch = nonGet(calls)[0]
    expect(patch.method).toBe('PATCH')
    expect(patch.path).toBe('/platform-sponsor-campaigns/7')
    expect(patch.body).toMatchObject({ title: 'Berimbau com 25% off', sponsorId: 1, priceCents: 150000, states: ['GO', 'SP'], startsAt: '2026-10-01T03:00:00.000Z' })
    expect(nonGet(calls)).toHaveLength(1)
    expect(router.currentRoute.value.path).toBe('/sponsors/campaigns')
    expect(takeFlash()).toContain('salva')
  })

  it('mostra o status e "aprovada por … em …" quando houver', async () => {
    mockFetch(handler(undefined, campaign({ id: 7, status: 'PAUSED', effectiveStatus: 'PAUSED', approvedByUserId: 1, approvedAt: '2026-10-02T15:30:00.000Z', approvedBy: { id: 1, name: 'Owner GingApp' } })))
    const { wrapper } = await mountEdit()
    expect(wrapper.get('[data-testid="campaign-meta"]').text()).toContain('Pausada')
    expect(wrapper.get('[data-testid="approval"]').text()).toBe('Aprovada por Owner GingApp em 02/10/2026, 12:30')
  })

  describe('campanha ATIVA', () => {
    const active = campaign({ id: 7, status: 'ACTIVE', effectiveStatus: 'ACTIVE_NOW' })

    it('avisa de antemão que mudar o conteúdo a devolve para rascunho', async () => {
      mockFetch(handler(undefined, active))
      const { wrapper } = await mountEdit()
      expect(wrapper.get('[data-testid="live-warning"]').text()).toContain('volta para rascunho')
      expect(wrapper.get('[data-testid="live-warning"]').text()).toContain('super admin')
    })

    it('mudou o conteúdo: pede confirmação; só confirmando envia o PATCH; o aviso final diz que voltou a rascunho', async () => {
      const { calls } = mockFetch(handler((call) => (call.method === 'PATCH' ? { body: { ...active, status: 'DRAFT', effectiveStatus: 'DRAFT' } } : undefined), active))
      const { wrapper } = await mountEdit()
      await field(wrapper, 'title').setValue('Título novo')
      await wrapper.get('[data-testid="campaign-form"]').trigger('submit')
      await flushPromises()
      expect(wrapper.get('[data-testid="draft-confirm-text"]').text()).toContain('volta para rascunho')
      expect(nonGet(calls)).toHaveLength(0)

      await wrapper.get('[data-cancel]').trigger('click')
      expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(false)
      expect(nonGet(calls)).toHaveLength(0)

      await wrapper.get('[data-testid="campaign-form"]').trigger('submit')
      await flushPromises()
      await wrapper.get('[data-testid="confirm-ok"]').trigger('click')
      await flushPromises()
      expect(nonGet(calls)).toHaveLength(1)
      expect(takeFlash()).toContain('devolvida para RASCUNHO')
    })

    it('mudou só peso/UF/preço/datas (não é conteúdo): salva direto, sem confirmação', async () => {
      const { calls } = mockFetch(handler(undefined, active))
      const { wrapper } = await mountEdit()
      await field(wrapper, 'weight').setValue('8')
      await wrapper.get('[data-testid="uf-RJ"]').setValue(true)
      await field(wrapper, 'price').setValue('2.000,00')
      await wrapper.get('[data-testid="campaign-form"]').trigger('submit')
      await flushPromises()
      expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(false)
      expect(nonGet(calls)).toHaveLength(1)
      expect(takeFlash()).not.toContain('RASCUNHO')
    })
  })

  it('campanha inexistente (404): erro no lugar do formulário', async () => {
    mockFetch((call) => (call.path === '/platform-sponsor-campaigns/7' ? { status: 404, body: { message: 'Campanha não encontrada.' } } : listReply(sponsors)))
    const { wrapper } = await mountEdit()
    expect(wrapper.get('[data-testid="load-error"]').text()).toContain('Campanha não encontrada.')
    expect(wrapper.find('[data-testid="campaign-form"]').exists()).toBe(false)
  })
})
