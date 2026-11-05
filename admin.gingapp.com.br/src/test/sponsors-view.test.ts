import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SponsorsView from '@/views/SponsorsView.vue'
import { flushPromises, mockFetch, type Call, type MockReply } from './helpers'
import { listReply, mountAt, sponsor } from './sponsors-fixtures'

const UPLOADED = '/api/uploads/123e4567-e89b-12d3-a456-426614174000.webp'
const mount = () => mountAt(SponsorsView, '/sponsors')
const nonGet = (calls: Call[]) => calls.filter((c) => c.method !== 'GET')
const text = (w: VueWrapper, testid: string) => w.get(`[data-testid="${testid}"]`).text()

async function fill(wrapper: VueWrapper, values: Record<string, string>) {
  for (const [field, value] of Object.entries(values)) await wrapper.get(`[data-testid="field-${field}"]`).setValue(value)
}

async function pickFile(wrapper: VueWrapper, testid: string, file: File) {
  const input = wrapper.get(`[data-testid="${testid}-input"]`)
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  await input.trigger('change')
  await flushPromises()
}

describe('SponsorsView — lista', () => {
  it('lista patrocinadores com contato, documento e observações; consulta paginada', async () => {
    const { calls } = mockFetch(() => listReply([sponsor(), sponsor({ id: 2, name: 'Sem Dados', contactName: null, contactEmail: null, contactPhone: null, document: null, notes: null })], 2))
    const { wrapper } = await mount()

    expect(calls[0].path).toBe('/platform-sponsors')
    expect(calls[0].query.get('limit')).toBe('20')
    expect(calls[0].query.get('offset')).toBe('0')
    expect(calls[0].query.has('q')).toBe(false)

    const row = wrapper.get('[data-testid="sponsor-1"]').text()
    expect(row).toContain('Casa do Berimbau')
    expect(row).toContain('Ana Comercial')
    expect(row).toContain('ana@casadoberimbau.com.br')
    expect(row).toContain('62999990000')
    expect(row).toContain('12.345.678/0001-90')
    expect(row).toContain('Fecha por trimestre.')
    expect(wrapper.get('[data-testid="sponsor-2"]').text()).toContain('Sem Dados')
    expect(text(wrapper, 'page-range')).toBe('1–2 de 2')
    expect(wrapper.find('[data-testid="sponsors-tabs"]').exists()).toBe(true)
  })

  it('lista vazia: mensagem orientando o cadastro; busca sem resultado: outra mensagem', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { calls } = mockFetch(() => listReply([]))
    const { wrapper } = await mount()
    expect(text(wrapper, 'empty')).toContain('Nenhum patrocinador cadastrado ainda')
    await wrapper.get('[data-testid="sponsor-search"]').setValue('xyz')
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    expect(calls[1].query.get('q')).toBe('xyz')
    expect(text(wrapper, 'empty')).toContain('Nenhum patrocinador encontrado para essa busca')
  })

  it('carregando e erro de listagem (com "Tentar de novo")', async () => {
    let release: (reply: MockReply) => void = () => undefined
    mockFetch(() => new Promise<MockReply>((resolve) => (release = resolve)))
    const { wrapper } = await mount()
    expect(text(wrapper, 'loading')).toContain('Carregando')
    release({ status: 500, body: { message: 'Falha no servidor.' } })
    await flushPromises()
    expect(text(wrapper, 'list-error')).toContain('Falha no servidor.')

    mockFetch(() => listReply([sponsor()]))
    await wrapper.get('[data-testid="retry"]').trigger('click')
    await flushPromises()
    expect(wrapper.find('[data-testid="sponsor-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="list-error"]').exists()).toBe(false)
  })

  it('paginação: "Próxima" pede offset 20', async () => {
    const { calls } = mockFetch(() => listReply([sponsor()], 45))
    const { wrapper } = await mount()
    await wrapper.get('[data-testid="page-next"]').trigger('click')
    await flushPromises()
    expect(calls[1].query.get('offset')).toBe('20')
  })
})

describe('SponsorsView — criar e editar', () => {
  it('cria com nome, logo (upload), contato, documento e observações; campos vazios vão como null', async () => {
    const { calls } = mockFetch((call) => {
      if (call.method === 'POST' && call.path === '/platform-uploads') return { status: 201, body: { url: UPLOADED } }
      if (call.method === 'POST') return { status: 201, body: sponsor({ id: 9, name: 'Nova Loja' }) }
      return listReply([])
    })
    const { wrapper } = await mount()
    await wrapper.get('[data-testid="new-sponsor"]').trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('Novo patrocinador')

    await fill(wrapper, { name: '  Nova Loja ', contactName: 'Beto', contactEmail: 'beto@loja.com.br', document: '11.222.333/0001-44' })
    await pickFile(wrapper, 'logo', new File([new Uint8Array(1000)], 'logo.png', { type: 'image/png' }))
    expect((wrapper.get('[data-testid="logo-preview"]').element as HTMLImageElement).src).toContain(UPLOADED)

    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const posts = nonGet(calls).filter((c) => c.path === '/platform-sponsors')
    expect(posts).toHaveLength(1)
    expect(posts[0].body).toEqual({
      name: 'Nova Loja',
      logo: UPLOADED,
      contactName: 'Beto',
      contactEmail: 'beto@loja.com.br',
      contactPhone: null,
      document: '11.222.333/0001-44',
      notes: null,
    })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(text(wrapper, 'notice')).toContain('Nova Loja')
    // recarregou a lista
    expect(calls.filter((c) => c.method === 'GET' && c.path === '/platform-sponsors')).toHaveLength(2)
  })

  it('valida no cliente (nome curto, e-mail inválido, observações > 1000) e não chama a API', async () => {
    const { calls } = mockFetch(() => listReply([]))
    const { wrapper } = await mount()
    await wrapper.get('[data-testid="new-sponsor"]').trigger('click')
    await fill(wrapper, { name: 'a', contactEmail: 'sem-arroba', notes: 'x'.repeat(1001) })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(nonGet(calls)).toHaveLength(0)
    expect(text(wrapper, 'sp-name-error')).toContain('2 a 80')
    expect(text(wrapper, 'sp-contact-email-error')).toContain('e-mail válido')
    expect(text(wrapper, 'sp-notes-error')).toContain('1000')
    expect(wrapper.get('#sp-name').attributes('aria-invalid')).toBe('true')
    expect(text(wrapper, 'sp-name-counter')).toBe('1/80')
  })

  it('400 do servidor com o nome do campo aparece NO campo; sem campo, em bloco', async () => {
    mockFetch((call) => {
      if (call.method === 'POST') return { status: 400, body: { message: ['name já cadastrado', 'contactPhone deve ter só números', 'Algo geral deu errado.'] } }
      return listReply([])
    })
    const { wrapper } = await mount()
    await wrapper.get('[data-testid="new-sponsor"]').trigger('click')
    await fill(wrapper, { name: 'Casa' })
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(text(wrapper, 'sp-name-error')).toBe('name já cadastrado')
    expect(text(wrapper, 'sp-contact-phone-error')).toBe('contactPhone deve ter só números')
    expect(text(wrapper, 'form-errors')).toContain('Algo geral deu errado.')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true) // o formulário continua aberto
  })

  it('editar: carrega os valores, PATCH com o que foi alterado e null no que foi limpo', async () => {
    const { calls } = mockFetch((call) => (call.method === 'PATCH' ? { body: sponsor({ name: 'Casa Renomeada' }) } : listReply([sponsor({ logo: UPLOADED })])))
    const { wrapper } = await mount()
    await wrapper.get('[data-testid="sponsor-1"] [data-action="edit"]').trigger('click')
    expect((wrapper.get('[data-testid="field-name"]').element as HTMLInputElement).value).toBe('Casa do Berimbau')
    expect((wrapper.get('[data-testid="logo-preview"]').element as HTMLImageElement).src).toContain(UPLOADED)

    await fill(wrapper, { name: 'Casa Renomeada', contactPhone: '' })
    await wrapper.get('[data-testid="logo-remove"]').trigger('click')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const patch = nonGet(calls)[0]
    expect(patch.method).toBe('PATCH')
    expect(patch.path).toBe('/platform-sponsors/1')
    expect(patch.body).toMatchObject({ name: 'Casa Renomeada', logo: null, contactPhone: null, contactEmail: 'ana@casadoberimbau.com.br' })
    expect(text(wrapper, 'notice')).toContain('atualizado')
  })

  it('upload recusado no cliente: formato errado e peso acima de 250 KB (nenhuma chamada de upload)', async () => {
    const { calls } = mockFetch(() => listReply([]))
    const { wrapper } = await mount()
    await wrapper.get('[data-testid="new-sponsor"]').trigger('click')

    await pickFile(wrapper, 'logo', new File([new Uint8Array(10)], 'a.gif', { type: 'image/gif' }))
    expect(text(wrapper, 'logo-error')).toContain('JPEG, PNG ou WebP')
    await pickFile(wrapper, 'logo', new File([new Uint8Array(251 * 1024)], 'grande.png', { type: 'image/png' }))
    expect(text(wrapper, 'logo-error')).toContain('250 KB')
    expect(calls.filter((c) => c.path === '/platform-uploads')).toHaveLength(0)
  })

  it('falha do upload no servidor mostra a mensagem junto da imagem', async () => {
    mockFetch((call) => (call.path === '/platform-uploads' ? { status: 413, body: { message: 'Imagem acima do limite.' } } : listReply([])))
    const { wrapper } = await mount()
    await wrapper.get('[data-testid="new-sponsor"]').trigger('click')
    await pickFile(wrapper, 'logo', new File([new Uint8Array(100)], 'a.png', { type: 'image/png' }))
    expect(text(wrapper, 'logo-error')).toBe('Imagem acima do limite.')
  })

  it('Esc fecha o formulário', async () => {
    mockFetch(() => listReply([]))
    const { wrapper } = await mount()
    await wrapper.get('[data-testid="new-sponsor"]').trigger('click')
    await wrapper.get('[data-testid="field-name"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })
})

describe('SponsorsView — excluir', () => {
  it('confirma e exclui; a lista é recarregada', async () => {
    let deleted = false
    const { calls } = mockFetch((call) => {
      if (call.method === 'DELETE') {
        deleted = true
        return { status: 204 }
      }
      return listReply(deleted ? [] : [sponsor()])
    })
    const { wrapper } = await mount()
    await wrapper.get('[data-testid="sponsor-1"] [data-action="delete"]').trigger('click')
    expect(text(wrapper, 'confirm-dialog')).toContain('Casa do Berimbau')
    expect(nonGet(calls)).toHaveLength(0) // nada antes de confirmar
    await wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    expect(nonGet(calls)[0].method).toBe('DELETE')
    expect(nonGet(calls)[0].path).toBe('/platform-sponsors/1')
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="sponsor-1"]').exists()).toBe(false)
    expect(text(wrapper, 'notice')).toContain('excluído')
  })

  it('409 SPONSOR_HAS_CAMPAIGNS: mensagem clara no diálogo, patrocinador continua na lista', async () => {
    mockFetch((call) =>
      call.method === 'DELETE'
        ? { status: 409, body: { statusCode: 409, code: 'SPONSOR_HAS_CAMPAIGNS', message: 'SPONSOR_HAS_CAMPAIGNS' } }
        : listReply([sponsor()]),
    )
    const { wrapper } = await mount()
    await wrapper.get('[data-testid="sponsor-1"] [data-action="delete"]').trigger('click')
    await wrapper.get('[data-testid="confirm-ok"]').trigger('click')
    await flushPromises()
    const error = text(wrapper, 'confirm-error')
    expect(error).toContain('tem campanhas')
    expect(error).toContain('Exclua as campanhas')
    expect(error).not.toContain('SPONSOR_HAS_CAMPAIGNS')
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="sponsor-1"]').exists()).toBe(true)
  })

  it('cancelar não exclui', async () => {
    const { calls } = mockFetch(() => listReply([sponsor()]))
    const { wrapper } = await mount()
    await wrapper.get('[data-testid="sponsor-1"] [data-action="delete"]').trigger('click')
    await wrapper.get('[data-cancel]').trigger('click')
    expect(wrapper.find('[data-testid="confirm-dialog"]').exists()).toBe(false)
    expect(nonGet(calls)).toHaveLength(0)
  })
})
