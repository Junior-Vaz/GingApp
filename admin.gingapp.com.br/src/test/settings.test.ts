import type { VueWrapper } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import SettingsView from '@/views/SettingsView.vue'
import { flushPromises, mockFetch, mountView, type Call, type MockReply } from './helpers'

const SECRET_VALUE = 'sk_live_SUPER_SECRETO_123'

function setting(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    key: 'billing.trial_days',
    value: 14,
    isSecret: false,
    hasValue: true,
    updatedByUserId: 1,
    createdAt: '2026-10-01T10:00:00.000Z',
    updatedAt: '2026-10-02T10:00:00.000Z',
    ...overrides,
  }
}

const secretRow = setting({ id: 2, key: 'gateway.api_key', value: null, isSecret: true })

function listReply(items: unknown[], total = items.length): MockReply {
  return { body: items, headers: { 'X-Total-Count': String(total) } }
}

const rows = (wrapper: VueWrapper) => wrapper.findAll('[data-testid="setting-row"]')
const byText = (wrapper: VueWrapper, selector: string, text: string) =>
  wrapper.findAll(selector).find((el) => el.text().includes(text))!

async function openCreate(wrapper: VueWrapper) {
  await byText(wrapper, 'button', '+ Nova configuração').trigger('click')
}

describe('SettingsView', () => {
  it('mostra o aviso permanente e lista as configurações (valor JSON compacto)', async () => {
    const { calls } = mockFetch(() =>
      listReply([setting(), setting({ id: 3, key: 'ui.theme', value: { dark: true, n: [1, 2] } })], 2),
    )
    const { wrapper } = await mountView(SettingsView)

    expect(wrapper.get('[data-testid="settings-warning"]').text()).toBe(
      'Estas configurações são armazenadas, mas ainda não são lidas por nenhum recurso do sistema.',
    )
    expect(calls[0].path).toBe('/platform-settings')
    expect(calls[0].query.get('limit')).toBe('20')
    expect(calls[0].query.get('offset')).toBe('0')
    expect(calls[0].query.has('q')).toBe(false)
    expect(rows(wrapper)).toHaveLength(2)
    expect(rows(wrapper)[0].text()).toContain('billing.trial_days')
    expect(rows(wrapper)[1].text()).toContain('{"dark":true,"n":[1,2]}')
    expect(wrapper.text()).not.toContain('Em construção')
  })

  it('segredo: badge "segredo", valor mascarado e nunca exibido (nem ao editar)', async () => {
    mockFetch(() => listReply([secretRow]))
    const { wrapper } = await mountView(SettingsView)

    const row = rows(wrapper)[0]
    expect(row.text()).toContain('segredo')
    expect(row.text()).toContain('••••••••')
    expect(row.text()).not.toContain('null')

    await byText(wrapper, 'button', 'Editar').trigger('click')
    const textarea = wrapper.get('#setting-value')
    expect((textarea.element as HTMLTextAreaElement).value).toBe('')
    expect(textarea.attributes('placeholder')).toContain('não é exibido')
    expect((wrapper.get('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)
  })

  it('editar segredo exige novo valor e mantém o segredo mascarado depois de salvar', async () => {
    const { calls } = mockFetch((call) => {
      if (call.method === 'PUT') return { body: secretRow }
      return listReply([secretRow])
    })
    const { wrapper } = await mountView(SettingsView)
    await byText(wrapper, 'button', 'Editar').trigger('click')

    await wrapper.get('form').trigger('submit')
    expect(wrapper.text()).toContain('Informe o valor (um JSON válido).')
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0)

    await wrapper.get('#setting-value').setValue(JSON.stringify(SECRET_VALUE))
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const put = calls.find((c) => c.method === 'PUT') as Call
    expect(put.path).toBe('/platform-settings/gateway.api_key')
    expect(put.body).toEqual({ value: SECRET_VALUE, isSecret: true })
    // modal fechado, valor digitado não está mais em lugar nenhum da tela
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.html()).not.toContain(SECRET_VALUE)
    expect(rows(wrapper)[0].text()).toContain('••••••••')
  })

  it('valida JSON: inválido, null, grande demais e chave inválida (sem chamar a API)', async () => {
    const { calls } = mockFetch(() => listReply([]))
    const { wrapper } = await mountView(SettingsView)
    await openCreate(wrapper)

    const submit = async (key: string, value: string) => {
      await wrapper.get('#setting-key').setValue(key)
      await wrapper.get('#setting-value').setValue(value)
      await wrapper.get('form').trigger('submit')
    }

    await submit('ok.key', '{ nao e json')
    expect(wrapper.get('[role="alert"]').text()).toContain('não é um JSON válido')

    await submit('ok.key', 'null')
    expect(wrapper.get('[role="alert"]').text()).toContain('não pode ser null')

    await submit('ok.key', JSON.stringify('x'.repeat(10 * 1024)))
    expect(wrapper.get('[role="alert"]').text()).toContain('excede o limite de 10 KB')

    await submit('Chave Inválida!', '1')
    expect(wrapper.get('[role="alert"]').text()).toContain('Chave inválida')

    await submit('ok.key', '')
    expect(wrapper.get('[role="alert"]').text()).toContain('Informe o valor')

    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0)
  })

  it('criar: PUT /platform-settings/:key com value parseado e isSecret, depois recarrega a lista', async () => {
    let created = false
    const { calls } = mockFetch((call) => {
      if (call.method === 'PUT') {
        created = true
        return { body: setting({ key: 'ui.theme', value: { dark: true } }) }
      }
      return listReply(created ? [setting({ key: 'ui.theme', value: { dark: true } })] : [])
    })
    const { wrapper } = await mountView(SettingsView)
    expect(wrapper.text()).toContain('Nenhuma configuração cadastrada ainda.')

    await openCreate(wrapper)
    await wrapper.get('#setting-key').setValue(' ui.theme ')
    await wrapper.get('#setting-value').setValue('{ "dark": true }')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    const put = calls.find((c) => c.method === 'PUT') as Call
    expect(put.path).toBe('/platform-settings/ui.theme')
    expect(put.body).toEqual({ value: { dark: true }, isSecret: false })
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(wrapper.get('[role="status"]').text()).toContain('"ui.theme" salva')
    expect(rows(wrapper)).toHaveLength(1)
    expect(calls.filter((c) => c.method === 'GET')).toHaveLength(2)
  })

  it('criar como segredo envia isSecret: true', async () => {
    const { calls } = mockFetch((call) => (call.method === 'PUT' ? { body: secretRow } : listReply([])))
    const { wrapper } = await mountView(SettingsView)
    await openCreate(wrapper)
    await wrapper.get('#setting-key').setValue('gateway.api_key')
    await wrapper.get('#setting-value').setValue(JSON.stringify(SECRET_VALUE))
    await wrapper.get('input[type="checkbox"]').setValue(true)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect((calls.find((c) => c.method === 'PUT') as Call).body).toEqual({ value: SECRET_VALUE, isSecret: true })
  })

  it('editar configuração normal: chave bloqueada e valor preenchido com o JSON atual', async () => {
    const { calls } = mockFetch((call) =>
      call.method === 'PUT' ? { body: setting({ value: 30 }) } : listReply([setting()]),
    )
    const { wrapper } = await mountView(SettingsView)
    await byText(wrapper, 'button', 'Editar').trigger('click')

    expect(wrapper.get('#setting-key').attributes('disabled')).toBeDefined()
    expect((wrapper.get('#setting-key').element as HTMLInputElement).value).toBe('billing.trial_days')
    expect((wrapper.get('#setting-value').element as HTMLTextAreaElement).value).toBe('14')

    await wrapper.get('#setting-value').setValue('30')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    const put = calls.find((c) => c.method === 'PUT') as Call
    expect(put.path).toBe('/platform-settings/billing.trial_days')
    expect(put.body).toEqual({ value: 30, isSecret: false })
  })

  it('erro do backend (array) aparece no modal e o modal continua aberto', async () => {
    mockFetch((call) =>
      call.method === 'PUT'
        ? { status: 400, body: { message: ['isSecret deve ser booleano', 'outro erro'] } }
        : listReply([]),
    )
    const { wrapper } = await mountView(SettingsView)
    await openCreate(wrapper)
    await wrapper.get('#setting-key').setValue('a')
    await wrapper.get('#setting-value').setValue('1')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('isSecret deve ser booleano outro erro')
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
  })

  it('excluir pede confirmação: cancelar não chama a API; confirmar chama DELETE e recarrega', async () => {
    let deleted = false
    const { calls } = mockFetch((call) => {
      if (call.method === 'DELETE') {
        deleted = true
        return { body: { key: 'billing.trial_days', deleted: true } }
      }
      return listReply(deleted ? [] : [setting()])
    })
    const { wrapper } = await mountView(SettingsView)

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    await byText(wrapper, 'button', 'Excluir').trigger('click')
    expect(confirmSpy).toHaveBeenCalledOnce()
    expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0)

    confirmSpy.mockReturnValue(true)
    await byText(wrapper, 'button', 'Excluir').trigger('click')
    await flushPromises()
    expect(calls.find((c) => c.method === 'DELETE')?.path).toBe('/platform-settings/billing.trial_days')
    expect(rows(wrapper)).toHaveLength(0)
    expect(wrapper.get('[role="status"]').text()).toContain('excluída')
  })

  it('erro ao excluir (404 do backend) é exibido', async () => {
    mockFetch((call) =>
      call.method === 'DELETE'
        ? { status: 404, body: { message: 'Configuração não encontrada.' } }
        : listReply([setting()]),
    )
    const { wrapper } = await mountView(SettingsView)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await byText(wrapper, 'button', 'Excluir').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Configuração não encontrada.')
  })

  it('erro ao carregar a lista mostra a mensagem do backend', async () => {
    mockFetch(() => ({ status: 403, body: { message: 'Acesso restrito à equipe da plataforma GingApp.' } }))
    const { wrapper } = await mountView(SettingsView)
    expect(wrapper.get('[role="alert"]').text()).toBe('Acesso restrito à equipe da plataforma GingApp.')
  })

  it('estado carregando', async () => {
    mockFetch(() => new Promise(() => {}))
    const { wrapper } = await mountView(SettingsView)
    expect(wrapper.text()).toContain('Carregando…')
  })

  it('busca por chave é debounced, vai ao servidor e volta ao offset 0', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { calls } = mockFetch((call) =>
      listReply(call.query.get('q') ? [] : [setting()], call.query.get('q') ? 0 : 45),
    )
    const { wrapper } = await mountView(SettingsView)

    await wrapper.get('input[type="search"]').setValue('gate')
    await wrapper.get('input[type="search"]').setValue('gateway')
    expect(calls).toHaveLength(1) // nada enviado antes do debounce
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()

    expect(calls).toHaveLength(2)
    expect(calls[1].query.get('q')).toBe('gateway')
    expect(calls[1].query.get('offset')).toBe('0')
    expect(wrapper.text()).toContain('Nenhuma configuração encontrada para a busca.')
  })

  it('paginação no servidor usa X-Total-Count e avança o offset', async () => {
    const { calls } = mockFetch(() => listReply([setting()], 45))
    const { wrapper } = await mountView(SettingsView)
    expect(wrapper.get('[data-testid="page-range"]').text()).toBe('1–20 de 45')
    expect(wrapper.get('[data-testid="page-prev"]').attributes('disabled')).toBeDefined()

    await wrapper.get('[data-testid="page-next"]').trigger('click')
    await flushPromises()
    expect(calls[1].query.get('offset')).toBe('20')
    expect(wrapper.get('[data-testid="page-range"]').text()).toBe('21–40 de 45')
  })
})
