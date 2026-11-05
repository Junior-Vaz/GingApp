import { describe, expect, it } from 'vitest'
import { ApiError } from '@/utils/api'
import {
  addDays,
  approvalText,
  BRAZIL_STATES,
  campaignPayload,
  campaignSponsorName,
  centsToReaisText,
  checkDestinationUrl,
  computeCtr,
  contentChanged,
  defaultReportRange,
  DEFAULT_CTA_LABEL,
  EFFECTIVE_STATUS_META,
  emptyCampaignForm,
  fillDays,
  formatPercent,
  imageSrc,
  isoToLocal,
  localToIso,
  reaisToCents,
  serverFieldErrors,
  SPONSOR_CATEGORIES,
  SPONSOR_IMAGE_MAX_BYTES,
  spDay,
  stateReportLabel,
  statesLabel,
  validateCampaignForm,
  validateDestinationUrl,
  validateImageFile,
  validateSponsorForm,
  sponsorPayload,
  emptySponsorForm,
  type CampaignFormState,
} from '@/utils/sponsors'
import { campaign, sponsor } from './sponsors-fixtures'

function validForm(overrides: Partial<CampaignFormState> = {}): CampaignFormState {
  return {
    ...emptyCampaignForm(),
    sponsorId: '1',
    title: 'Berimbau com 20% off',
    text: 'Instrumentos artesanais para a sua roda.',
    destinationUrl: 'https://www.casadoberimbau.com.br/oferta',
    category: 'INSTRUMENTOS',
    startsAt: '2026-11-10T08:00',
    endsAt: '2026-12-10T23:59',
    weight: '3',
    states: ['GO'],
    price: '1.500,00',
    ...overrides,
  }
}

describe('categorias e UFs (listas fixas do contrato)', () => {
  it('SÓ as 7 categorias da lista branca, com rótulo em português', () => {
    expect(SPONSOR_CATEGORIES.map((c) => c.value)).toEqual([
      'INSTRUMENTOS',
      'VESTUARIO',
      'SAUDE',
      'EDUCACAO',
      'EVENTOS_TURISMO',
      'ALIMENTACAO',
      'ESPORTES',
    ])
    expect(SPONSOR_CATEGORIES.map((c) => c.label)).toEqual(['Instrumentos', 'Vestuário', 'Saúde', 'Educação', 'Eventos e turismo', 'Alimentação', 'Esportes'])
  })

  it('27 UFs, sem repetição', () => {
    expect(BRAZIL_STATES).toHaveLength(27)
    expect(new Set(BRAZIL_STATES.map((s) => s.uf)).size).toBe(27)
    expect(BRAZIL_STATES.map((s) => s.uf)).toContain('DF')
  })

  it('statesLabel: vazio = "Brasil todo"', () => {
    expect(statesLabel([])).toBe('Brasil todo')
    expect(statesLabel(['GO', 'SP'])).toBe('GO, SP')
    expect(stateReportLabel('')).toBe('Não identificada')
    expect(stateReportLabel('GO')).toBe('GO — Goiás')
  })

  it('5 status efetivos, cada um com rótulo escrito diferente', () => {
    const labels = Object.values(EFFECTIVE_STATUS_META).map((m) => m.label)
    expect(Object.keys(EFFECTIVE_STATUS_META).sort()).toEqual(['ACTIVE_NOW', 'DRAFT', 'ENDED', 'PAUSED', 'SCHEDULED'])
    expect(new Set(labels).size).toBe(5)
  })
})

describe('checkDestinationUrl — regras do contrato §2.6', () => {
  it('aceita https por nome de domínio (com caminho, query e porta)', () => {
    for (const ok of ['https://www.loja.com.br', 'https://loja.com.br/oferta?x=1&y=2', 'https://sub.loja.com.br:8443/a#b', 'HTTPS://LOJA.COM.BR/']) {
      expect(validateDestinationUrl(ok), ok).toBeNull()
    }
  })

  it('vazio e com espaço', () => {
    expect(validateDestinationUrl('')).toMatch(/Informe/)
    expect(validateDestinationUrl('   ')).toMatch(/Informe/)
    expect(validateDestinationUrl('https://loja.com.br/a b')).toMatch(/espaços/)
  })

  it('http:// é recusado e vem com AVISO de que não é seguro', () => {
    const r = checkDestinationUrl('http://www.loja.com.br')
    expect(r.error).toMatch(/https/)
    expect(r.warning).toMatch(/não é seguro/)
  })

  it('sem esquema ou com esquema estranho', () => {
    expect(validateDestinationUrl('www.loja.com.br')).toMatch(/https:\/\//)
    expect(validateDestinationUrl('ftp://loja.com.br')).toMatch(/https/)
    expect(validateDestinationUrl('javascript:alert(1)')).toMatch(/https/)
    expect(validateDestinationUrl('data:text/html,<b>x</b>')).toMatch(/https/)
  })

  it('usuário/senha na URL', () => {
    expect(validateDestinationUrl('https://user:senha@loja.com.br')).toMatch(/usuário ou senha/)
    expect(validateDestinationUrl('https://user@loja.com.br')).toMatch(/usuário ou senha/)
  })

  it('IP (v4, v6 e formas numéricas/hex), localhost e rede interna', () => {
    for (const bad of ['https://127.0.0.1/x', 'https://10.0.0.5', 'https://192.168.1.1:8080', 'https://[::1]/', 'https://2130706433/', 'https://0x7f.0.0.1/']) {
      expect(validateDestinationUrl(bad), bad).toMatch(/IP/)
    }
    for (const bad of ['https://localhost/', 'https://localhost:3000/x', 'https://intranet/', 'https://app.local/', 'https://svc.internal/', 'https://api.localhost/']) {
      expect(validateDestinationUrl(bad), bad).toMatch(/público|local/i)
    }
  })

  it('limite de 500 caracteres', () => {
    const long = `https://www.loja.com.br/${'a'.repeat(480)}`
    expect(long.length).toBeGreaterThan(500)
    expect(validateDestinationUrl(long)).toMatch(/500/)
    expect(validateDestinationUrl(`https://www.loja.com.br/${'a'.repeat(400)}`)).toBeNull()
  })
})

describe('validateCampaignForm — limites do contrato', () => {
  it('formulário válido não tem erro', () => {
    expect(validateCampaignForm(validForm())).toEqual({})
  })

  it('título 2..60 e texto 2..90 (a contagem ignora espaços nas pontas)', () => {
    expect(validateCampaignForm(validForm({ title: 'a' })).title).toBeDefined()
    expect(validateCampaignForm(validForm({ title: ' a ' })).title).toBeDefined()
    expect(validateCampaignForm(validForm({ title: 'ab' })).title).toBeUndefined()
    expect(validateCampaignForm(validForm({ title: 'x'.repeat(60) })).title).toBeUndefined()
    expect(validateCampaignForm(validForm({ title: 'x'.repeat(61) })).title).toMatch(/2 a 60/)
    expect(validateCampaignForm(validForm({ text: 'x'.repeat(90) })).text).toBeUndefined()
    expect(validateCampaignForm(validForm({ text: 'x'.repeat(91) })).text).toMatch(/2 a 90/)
  })

  it('botão 2..24, com padrão "Conhecer"', () => {
    expect(emptyCampaignForm().ctaLabel).toBe(DEFAULT_CTA_LABEL)
    expect(DEFAULT_CTA_LABEL).toBe('Conhecer')
    expect(validateCampaignForm(validForm({ ctaLabel: 'x'.repeat(25) })).ctaLabel).toMatch(/2 a 24/)
    expect(validateCampaignForm(validForm({ ctaLabel: 'x' })).ctaLabel).toBeDefined()
    expect(validateCampaignForm(validForm({ ctaLabel: 'x'.repeat(24) })).ctaLabel).toBeUndefined()
  })

  it('categoria: só as 7 da lista; patrocinador obrigatório', () => {
    for (const bad of ['', 'BEBIDAS', 'APOSTAS', 'instrumentos']) {
      expect(validateCampaignForm(validForm({ category: bad })).category, bad).toBeDefined()
    }
    for (const c of SPONSOR_CATEGORIES) expect(validateCampaignForm(validForm({ category: c.value })).category).toBeUndefined()
    expect(validateCampaignForm(validForm({ sponsorId: '' })).sponsorId).toBeDefined()
  })

  it('datas: fim depois do início e janela de até 366 dias', () => {
    expect(validateCampaignForm(validForm({ startsAt: '' })).startsAt).toBeDefined()
    expect(validateCampaignForm(validForm({ endsAt: '' })).endsAt).toBeDefined()
    expect(validateCampaignForm(validForm({ startsAt: '2026-11-10T08:00', endsAt: '2026-11-10T08:00' })).endsAt).toMatch(/depois do início/)
    expect(validateCampaignForm(validForm({ startsAt: '2026-11-10T08:00', endsAt: '2026-11-09T08:00' })).endsAt).toMatch(/depois do início/)
    // exatamente 366 dias: ok; 1 minuto a mais: erro
    expect(validateCampaignForm(validForm({ startsAt: '2026-01-01T00:00', endsAt: '2027-01-02T00:00' })).endsAt).toBeUndefined()
    expect(validateCampaignForm(validForm({ startsAt: '2026-01-01T00:00', endsAt: '2027-01-02T00:01' })).endsAt).toMatch(/366/)
  })

  it('peso inteiro de 1 a 10', () => {
    for (const bad of ['0', '11', '1.5', '', 'abc', '-1']) expect(validateCampaignForm(validForm({ weight: bad })).weight, bad).toBeDefined()
    for (const ok of ['1', '5', '10']) expect(validateCampaignForm(validForm({ weight: ok })).weight, ok).toBeUndefined()
  })

  it('UFs inválidas são recusadas; vazio é válido (Brasil todo)', () => {
    expect(validateCampaignForm(validForm({ states: [] })).states).toBeUndefined()
    expect(validateCampaignForm(validForm({ states: ['GO', 'XX'] })).states).toBeDefined()
  })

  it('preço: vazio vale (sem preço), formato inválido não', () => {
    expect(validateCampaignForm(validForm({ price: '' })).price).toBeUndefined()
    expect(validateCampaignForm(validForm({ price: 'abc' })).price).toMatch(/inválido/)
    expect(validateCampaignForm(validForm({ price: '99999999999' })).price).toBeDefined()
  })

  it('URL inválida aparece no mesmo objeto de erros', () => {
    expect(validateCampaignForm(validForm({ destinationUrl: 'http://x.com.br' })).destinationUrl).toMatch(/https/)
  })
})

describe('campaignPayload / contentChanged', () => {
  it('monta o corpo do contrato: datas em ISO (Brasília = UTC-3), centavos e UFs ordenadas', () => {
    expect(campaignPayload(validForm({ states: ['SP', 'GO'], billingNote: '  boleto ', imageRef: '' }))).toEqual({
      sponsorId: 1,
      title: 'Berimbau com 20% off',
      text: 'Instrumentos artesanais para a sua roda.',
      imageRef: null,
      ctaLabel: 'Conhecer',
      destinationUrl: 'https://www.casadoberimbau.com.br/oferta',
      category: 'INSTRUMENTOS',
      startsAt: '2026-11-10T11:00:00.000Z',
      endsAt: '2026-12-11T02:59:00.000Z',
      weight: 3,
      states: ['GO', 'SP'],
      priceCents: 150000,
      billingNote: 'boleto',
    })
  })

  it('sem preço: priceCents null', () => {
    expect(campaignPayload(validForm({ price: '' })).priceCents).toBeNull()
  })

  it('contentChanged: título/texto/imagem/botão/link/categoria/patrocinador contam; peso, datas, UFs e cobrança não', () => {
    const base = validForm()
    expect(contentChanged(base, { ...base })).toBe(false)
    expect(contentChanged(base, { ...base, weight: '9', states: ['AC'], price: '1', billingNote: 'x', startsAt: '2026-11-11T08:00' })).toBe(false)
    for (const patch of [{ title: 'Outro' }, { text: 'Outro texto' }, { imageRef: '/api/uploads/x.webp' }, { ctaLabel: 'Ver' }, { destinationUrl: 'https://outro.com.br' }, { category: 'ESPORTES' }, { sponsorId: '2' }]) {
      expect(contentChanged(base, { ...base, ...patch }), JSON.stringify(patch)).toBe(true)
    }
  })
})

describe('validateSponsorForm / sponsorPayload', () => {
  it('nome 2..80, e-mail válido, notas até 1000', () => {
    const ok = { ...emptySponsorForm(), name: 'Casa do Berimbau' }
    expect(validateSponsorForm(ok)).toEqual({})
    expect(validateSponsorForm({ ...ok, name: 'a' }).name).toMatch(/2 a 80/)
    expect(validateSponsorForm({ ...ok, name: 'x'.repeat(81) }).name).toMatch(/2 a 80/)
    expect(validateSponsorForm({ ...ok, name: 'x'.repeat(80) }).name).toBeUndefined()
    expect(validateSponsorForm({ ...ok, contactEmail: 'sem-arroba' }).contactEmail).toBeDefined()
    expect(validateSponsorForm({ ...ok, contactEmail: 'a@b.com' }).contactEmail).toBeUndefined()
    expect(validateSponsorForm({ ...ok, notes: 'x'.repeat(1001) }).notes).toMatch(/1000/)
    expect(validateSponsorForm({ ...ok, notes: 'x'.repeat(1000) }).notes).toBeUndefined()
  })

  it('campos vazios viram null no corpo', () => {
    expect(sponsorPayload({ ...emptySponsorForm(), name: ' Casa ', contactPhone: '6299' })).toEqual({
      name: 'Casa',
      logo: null,
      contactName: null,
      contactEmail: null,
      contactPhone: '6299',
      document: null,
      notes: null,
    })
  })
})

describe('dinheiro e datas', () => {
  it('reaisToCents', () => {
    expect(reaisToCents('')).toBeNull()
    expect(reaisToCents('  ')).toBeNull()
    expect(reaisToCents('1.500,00')).toBe(150000)
    expect(reaisToCents('1500,5')).toBe(150050)
    expect(reaisToCents('1500,00')).toBe(150000)
    expect(reaisToCents('10')).toBe(1000)
    expect(reaisToCents('1.234')).toBe(123400)
    expect(reaisToCents('12.5')).toBe(1250)
    expect(reaisToCents('R$ 99,90')).toBe(9990)
    expect(reaisToCents('0,01')).toBe(1)
    for (const bad of ['abc', '1,2,3', '-5', '1.2.3,4,5', '10,999']) expect(reaisToCents(bad), bad).toBe('invalid')
    expect(centsToReaisText(150000)).toBe('1500,00')
    expect(centsToReaisText(null)).toBe('')
  })

  it('localToIso / isoToLocal (hora de Brasília, UTC-3 fixo) e ida-e-volta', () => {
    expect(localToIso('2026-11-10T08:00')).toBe('2026-11-10T11:00:00.000Z')
    expect(localToIso('2026-11-10')).toBeNull()
    expect(localToIso('')).toBeNull()
    expect(isoToLocal('2026-11-10T11:00:00.000Z')).toBe('2026-11-10T08:00')
    expect(isoToLocal(localToIso('2026-12-31T23:30'))).toBe('2026-12-31T23:30')
    expect(isoToLocal(null)).toBe('')
  })

  it('spDay e addDays', () => {
    expect(spDay('2026-11-05T02:30:00.000Z')).toBe('2026-11-04') // 23:30 em São Paulo
    expect(spDay('2026-11-05T03:00:00.000Z')).toBe('2026-11-05')
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-10-31', -29)).toBe('2026-10-02')
  })
})

describe('relatório: período padrão, dias zerados, CTR', () => {
  const starts = '2026-10-01T03:00:00.000Z' // 01/10 00:00 em SP
  const ends = '2026-11-01T03:00:00.000Z' // exclusivo: último dia = 31/10

  it('defaultReportRange: últimos 30 dias limitados à vigência', () => {
    expect(defaultReportRange(starts, ends, new Date('2026-11-20T12:00:00Z'))).toEqual({ from: '2026-10-02', to: '2026-10-31' }) // já encerrada
    expect(defaultReportRange(starts, ends, new Date('2026-10-10T15:00:00Z'))).toEqual({ from: '2026-10-01', to: '2026-10-10' }) // em andamento
    expect(defaultReportRange(starts, ends, new Date('2026-09-20T15:00:00Z'))).toEqual({ from: '2026-10-01', to: '2026-10-01' }) // ainda não começou
  })

  it('fillDays completa os dias sem dados com zero, em ordem', () => {
    const out = fillDays([{ day: '2026-11-02', impressions: 5, clicks: 1 }], '2026-11-01', '2026-11-03')
    expect(out).toEqual([
      { day: '2026-11-01', impressions: 0, clicks: 0 },
      { day: '2026-11-02', impressions: 5, clicks: 1 },
      { day: '2026-11-03', impressions: 0, clicks: 0 },
    ])
  })

  it('computeCtr: % com 2 casas e 0 sem impressões; formatPercent em pt-BR', () => {
    expect(computeCtr(0, 0)).toBe(0)
    expect(computeCtr(56, 1234)).toBe(4.54)
    expect(computeCtr(1, 3)).toBe(33.33)
    expect(formatPercent(4.5)).toBe('4,50%')
    expect(formatPercent(0)).toBe('0,00%')
  })
})

describe('imagens, erros do servidor, aprovação', () => {
  it('validateImageFile: tipo e peso máximo (250 KB)', () => {
    expect(validateImageFile({ type: 'image/gif', size: 100 })).toMatch(/JPEG, PNG ou WebP/)
    expect(validateImageFile({ type: 'image/png', size: 0 })).toMatch(/vazio/)
    expect(validateImageFile({ type: 'image/png', size: SPONSOR_IMAGE_MAX_BYTES })).toBeNull()
    expect(validateImageFile({ type: 'image/webp', size: SPONSOR_IMAGE_MAX_BYTES + 1 })).toMatch(/250 KB/)
    expect(validateImageFile({ type: 'image/jpeg', size: 1000 })).toBeNull()
  })

  it('imageSrc: caminho de upload ganha a origem da API; URL externa passa direto; vazio = ""', () => {
    const path = '/api/uploads/123e4567-e89b-12d3-a456-426614174000.webp'
    expect(imageSrc(path).endsWith(path)).toBe(true)
    expect(imageSrc(path).length).toBeGreaterThanOrEqual(path.length)
    expect(imageSrc('https://cdn.exemplo.com/a.png')).toBe('https://cdn.exemplo.com/a.png')
    expect(imageSrc(null)).toBe('')
  })

  it('serverFieldErrors separa o que cita um campo do que não cita', () => {
    const error = new ApiError('x', 400, {
      message: ['title deve ter entre 2 e 60 caracteres', 'states.0 deve ser uma UF válida', 'priceCents: valor inválido', 'A janela passa de 366 dias.'],
    })
    const r = serverFieldErrors(error, ['title', 'states', 'priceCents'])
    expect(r.fields.title).toMatch(/entre 2 e 60/)
    expect(r.fields.states).toMatch(/UF/)
    expect(r.fields.priceCents).toMatch(/inválido/)
    expect(r.general).toEqual(['A janela passa de 366 dias.'])
  })

  it('serverFieldErrors: mensagem única em string e erro que não é da API', () => {
    expect(serverFieldErrors(new ApiError('Nome já usado', 400, { message: 'Nome já usado' }), ['name']).general).toEqual(['Nome já usado'])
    expect(serverFieldErrors(new ApiError('x', 400, { message: 'name já existe', field: 'name' }), ['name']).fields.name).toBe('name já existe')
    expect(serverFieldErrors(new Error('boom'), ['name'])).toEqual({ fields: {}, general: [] })
  })

  it('approvalText e nome do patrocinador (formatos aceitos)', () => {
    const fmt = (v: string) => `<${v}>`
    expect(approvalText(campaign(), fmt)).toBe('')
    expect(approvalText(campaign({ approvedByUserId: 5, approvedAt: '2026-11-04T12:00:00.000Z', approvedBy: { id: 5, name: 'Owner' } }), fmt)).toBe('Aprovada por Owner em <2026-11-04T12:00:00.000Z>')
    expect(approvalText(campaign({ approvedByUserId: 5, approvedAt: '2026-11-04T12:00:00.000Z' }), fmt)).toContain('usuário #5')
    expect(campaignSponsorName(campaign({ sponsorName: undefined, sponsor: { id: 1, name: 'Via objeto' } }))).toBe('Via objeto')
    expect(campaignSponsorName(campaign({ sponsorName: undefined, sponsorId: 1 }), [sponsor()])).toBe('Casa do Berimbau')
    expect(campaignSponsorName(campaign({ sponsorName: undefined, sponsorId: 9 }))).toBe('Patrocinador #9')
  })
})
