import { describe, expect, it, vi } from 'vitest'
import SidebarLayout from '@/components/layout/SidebarLayout.vue'
import TwoFactorModal from '@/components/TwoFactorModal.vue'
import { AUTH_USER_KEY } from '@/stores/auth'
import { AUDIT_ACTION_LABELS } from '@/utils/audit'
import { flushPromises, mockFetch, mountView, type MockReply } from './helpers'

const SETUP = { secret: 'JBSWY3DPEHPK3PXP', otpauthUrl: 'otpauth://totp/x', qrCodeDataUrl: 'data:image/png;base64,AAAA' }
const CODES = Array.from({ length: 8 }, (_, i) => `abcd${i}-efgh${i}`)

/** Simula o contrato do backend; `overrides` troca a resposta de um caminho (ex.: erro 400/403). */
function api(me: { twoFactorEnabled: boolean; recoveryCodesRemaining?: number }, overrides: Record<string, MockReply> = {}) {
  return mockFetch((call) => {
    if (overrides[call.path]) return overrides[call.path]
    if (call.method === 'GET' && call.path === '/auth/me') return { body: { id: 1, ...me } }
    if (call.path === '/auth/2fa/setup') return { body: SETUP }
    if (call.path === '/auth/2fa/enable') return { body: { recoveryCodes: CODES } }
    if (call.path === '/auth/2fa/disable') return { body: { twoFactorEnabled: false } }
    return undefined
  })
}

describe('TwoFactorModal', () => {
  it('ativar: QR + segredo, confirma o código e mostra os códigos de recuperação uma única vez', async () => {
    const { calls } = api({ twoFactorEnabled: false })
    const { wrapper, store } = await mountView(TwoFactorModal)

    await wrapper.get('[data-testid="two-factor-start"]').trigger('click')
    await flushPromises()
    expect(wrapper.get('img').attributes('src')).toBe(SETUP.qrCodeDataUrl)
    expect(wrapper.get('[data-testid="two-factor-secret"]').text()).toBe(SETUP.secret)

    await wrapper.get('#two-factor-enable-code').setValue('654 321')
    await wrapper.get('[data-testid="two-factor-setup"]').trigger('submit')
    await flushPromises()

    expect(calls.find((c) => c.path === '/auth/2fa/enable')!.body).toEqual({ code: '654321' })
    expect(wrapper.text()).toContain('não serão exibidos de novo')
    expect(wrapper.findAll('[data-testid="recovery-code"]')).toHaveLength(8)
    expect(store.user?.twoFactorEnabled).toBe(true)

    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    await wrapper.get('[data-testid="copy-codes"]').trigger('click')
    await flushPromises()
    expect(writeText).toHaveBeenCalledWith(CODES.join('\n'))

    await wrapper.get('[data-testid="codes-done"]').trigger('click')
    expect(wrapper.find('[data-testid="recovery-code"]').exists()).toBe(false)
    expect(wrapper.get('[data-testid="two-factor-on"]').text()).toContain('Ativada')
    expect(wrapper.html()).not.toContain(CODES[0])
  })

  it('código de ativação incorreto (400): mostra a mensagem e não mostra códigos', async () => {
    api({ twoFactorEnabled: false }, { '/auth/2fa/enable': { status: 400, body: { message: 'Código incorreto.' } } })
    const { wrapper } = await mountView(TwoFactorModal)
    await wrapper.get('[data-testid="two-factor-start"]').trigger('click')
    await flushPromises()
    await wrapper.get('#two-factor-enable-code').setValue('000000')
    await wrapper.get('[data-testid="two-factor-setup"]').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Código incorreto.')
    expect(wrapper.find('[data-testid="two-factor-codes"]').exists()).toBe(false)
  })

  it('ativada: mostra o restante de códigos e desativa com senha + código', async () => {
    const { calls } = api({ twoFactorEnabled: true, recoveryCodesRemaining: 5 })
    const { wrapper, store } = await mountView(TwoFactorModal)
    expect(wrapper.get('[data-testid="two-factor-on"]').text()).toContain('Ativada')
    expect(wrapper.get('[data-testid="recovery-remaining"]').text()).toContain('5')

    await wrapper.get('#two-factor-disable-password').setValue('SenhaSegura#2026')
    await wrapper.get('#two-factor-disable-code').setValue('123456')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(calls.find((c) => c.path === '/auth/2fa/disable')!.body).toEqual({ password: 'SenhaSegura#2026', code: '123456' })
    expect(wrapper.find('[data-testid="two-factor-off"]').exists()).toBe(true)
    expect(store.user?.twoFactorEnabled).toBe(false)
    expect(localStorage.getItem(AUTH_USER_KEY)).toContain('"twoFactorEnabled":false')
  })

  it('desativar com senha incorreta (403): mostra a mensagem e continua ativada', async () => {
    api(
      { twoFactorEnabled: true, recoveryCodesRemaining: 8 },
      { '/auth/2fa/disable': { status: 403, body: { message: 'Senha incorreta.' } } },
    )
    const { wrapper } = await mountView(TwoFactorModal)
    await wrapper.get('#two-factor-disable-password').setValue('errada')
    await wrapper.get('#two-factor-disable-code').setValue('123456')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBe('Senha incorreta.')
    expect(wrapper.find('[data-testid="two-factor-on"]').exists()).toBe(true)
  })
})

describe('SidebarLayout — incentivo à 2FA', () => {
  it('mostra o aviso discreto quando a 2FA está desativada e o esconde quando está ativada', async () => {
    api({ twoFactorEnabled: false })
    const off = await mountView(SidebarLayout)
    expect(off.wrapper.get('[data-testid="two-factor-nudge"]').text()).toContain('Recomendado: ative a verificação em duas etapas')
    off.wrapper.unmount()

    api({ twoFactorEnabled: true, recoveryCodesRemaining: 8 })
    const on = await mountView(SidebarLayout)
    expect(on.wrapper.find('[data-testid="two-factor-nudge"]').exists()).toBe(false)
  })

  it('falha ao consultar /auth/me: sem aviso e sem quebrar o layout', async () => {
    mockFetch(() => ({ status: 500, body: { message: 'boom' } }))
    const { wrapper } = await mountView(SidebarLayout)
    expect(wrapper.find('[data-testid="two-factor-nudge"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="two-factor"]').exists()).toBe(true)
  })
})

describe('rótulos de auditoria da 2FA', () => {
  it('traduz os códigos novos', () => {
    expect(AUDIT_ACTION_LABELS.TWO_FACTOR_ENABLE).toBe('Verificação em duas etapas ativada')
    expect(AUDIT_ACTION_LABELS.AUDIT_PURGE).toBe('Limpeza automática da auditoria')
  })
})
