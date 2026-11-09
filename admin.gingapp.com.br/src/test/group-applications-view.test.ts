import type { VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import AuditView from '@/views/AuditView.vue'
import GroupApplicationsView from '@/views/GroupApplicationsView.vue'
import { application, approved, approveResult, rejected } from './group-applications-fixtures'
import { flushPromises, makeUser, mockFetch, mountView, type Call, type MockReply } from './helpers'
import { listReply } from './sponsors-fixtures'

const SENTINEL_PASSWORD = 'SenhaSecreta#123'
const nonSuper = () => makeUser({ id: 2, name: 'Ana Suporte', isSuperAdmin: false })
const memberSuper = () => makeUser({ id: 3, userType: 'MEMBER', isSuperAdmin: true })

const has = (w: VueWrapper, id: string) => w.find(`[data-testid="${id}"]`).exists()
const t = (w: VueWrapper, id: string) => w.get(`[data-testid="${id}"]`).text()
const nonGet = (calls: Call[]) => calls.filter((c) => c.method !== 'GET')
const norm = (text: string) => text.replace(/\s+/g, ' ').trim()
const listCalls = (calls: Call[]) => calls.filter((c) => c.method === 'GET' && c.path === '/platform-group-applications')

interface Overrides {
  /** Itens por status (padrão: 1 pendente, 1 aprovado, 1 não aprovado). */
  byStatus?: Partial<Record<string, unknown[]>>
  pendingCount?: MockReply
  list?: MockReply
  approve?: (call: Call) => MockReply | undefined
  reject?: (call: Call) => MockReply | undefined
}

function handler(over: Overrides = {}) {
  const data: Record<string, unknown[]> = {
    PENDING: [application()],
    APPROVED: [approved()],
    REJECTED: [rejected()],
    EXPIRED: [],
    ...over.byStatus,
  }
  return (call: Call): MockReply | undefined => {
    if (call.method === 'POST' && /\/approve$/.test(call.path)) return over.approve?.(call) ?? { status: 201, body: approveResult() }
    if (call.method === 'POST' && /\/reject$/.test(call.path)) return over.reject?.(call) ?? { status: 200, body: rejected({ id: 5 }) }
    if (call.path === '/platform-group-applications/pending-count') return over.pendingCount ?? { body: { count: data.PENDING!.length } }
    if (call.path === '/platform-group-applications') return over.list ?? listReply(data[call.query.get('status') ?? 'PENDING'] ?? [])
    return undefined
  }
}

async function mountApplications(over: Overrides = {}, user = makeUser()) {
  const { calls } = mockFetch(handler(over))
  const mounted = await mountView(GroupApplicationsView, user)
  return { ...mounted, calls }
}

async function click(wrapper: VueWrapper, css: string) {
  await wrapper.get(css).trigger('click')
  await flushPromises()
}

afterEach(() => vi.unstubAllGlobals())

describe('GroupApplicationsView — lista', () => {
  it('abre em Pendentes (status=PENDING na query) e mostra data, grupo, cidade/UF, solicitante, cargo e status', async () => {
    const { wrapper, calls } = await mountApplications()
    expect(wrapper.get('h1').text()).toBe('Pedidos de adesão')
    expect(wrapper.findAll('[role="tab"]').map((b) => norm(b.text()))).toEqual(['Pendentes(1)', 'Aprovados', 'Não aprovados', 'Expirados'])
    expect(wrapper.get('[data-testid="tab-PENDING"]').attributes('aria-selected')).toBe('true')
    expect(Object.fromEntries(listCalls(calls)[0].query)).toEqual({ status: 'PENDING', limit: '20', offset: '0' })

    const row = norm(t(wrapper, 'application-5'))
    expect(row).toContain('Núcleo Raízes do Cerrado')
    expect(row).toContain('Goiânia/GO')
    expect(row).toContain('Carlos Contramestre')
    expect(row).toContain('carlos@nucleo.com.br')
    expect(row).toContain('Contramestre')
    expect(row).toContain('Pendente')
    expect(row).toMatch(/0?[67]\/11\/2026/)
  })

  it('abas trocam o filtro de status no servidor e a lista', async () => {
    const { wrapper, calls } = await mountApplications()
    await click(wrapper, '[data-testid="tab-APPROVED"]')
    expect(listCalls(calls).at(-1)!.query.get('status')).toBe('APPROVED')
    expect(has(wrapper, 'application-6')).toBe(true)
    expect(has(wrapper, 'application-5')).toBe(false)
    expect(norm(t(wrapper, 'application-6'))).toContain('Aprovado')

    await click(wrapper, '[data-testid="tab-REJECTED"]')
    expect(listCalls(calls).at(-1)!.query.get('status')).toBe('REJECTED')
    expect(norm(t(wrapper, 'application-7'))).toContain('Não aprovado')

    await click(wrapper, '[data-testid="tab-EXPIRED"]')
    expect(listCalls(calls).at(-1)!.query.get('status')).toBe('EXPIRED')
    expect(t(wrapper, 'empty')).toBe('Nenhum pedido expirado.')
  })

  it('busca (com atraso) vai em ?q= e volta ao início; paginação usa offset', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const { wrapper, calls } = await mountApplications({ list: listReply([application()], 45) })
      await click(wrapper, '[data-testid="page-next"]')
      expect(listCalls(calls).at(-1)!.query.get('offset')).toBe('20')

      await wrapper.get('[data-testid="filter-q"]').setValue('  cerrado ')
      await vi.advanceTimersByTimeAsync(400)
      await flushPromises()
      const last = listCalls(calls).at(-1)!
      expect(last.query.get('q')).toBe('cerrado')
      expect(last.query.get('offset')).toBe('0')
    } finally {
      vi.useRealTimers()
    }
  })

  it('erro ao carregar: aviso e "Tentar de novo"', async () => {
    const { wrapper, calls } = await mountApplications({ list: { status: 500, body: { message: 'boom' } } })
    expect(t(wrapper, 'list-error')).toContain('boom')
    const before = listCalls(calls).length
    await click(wrapper, '[data-testid="retry"]')
    expect(listCalls(calls).length).toBe(before + 1)
  })

  it('lista vazia de pendentes tem texto próprio', async () => {
    const { wrapper } = await mountApplications({ byStatus: { PENDING: [] } })
    expect(t(wrapper, 'empty')).toContain('Nenhum pedido pendente')
  })
})

describe('GroupApplicationsView — detalhe', () => {
  it('abre em diálogo com todos os campos, sem nenhuma senha', async () => {
    const { wrapper } = await mountApplications()
    await click(wrapper, '[data-testid="application-5"] [data-action="open"]')
    const dialog = wrapper.get('[data-testid="application-detail"]')
    expect(dialog.attributes('role')).toBe('dialog')
    expect(t(wrapper, 'detail-applicant')).toBe('Carlos Contramestre')
    expect(t(wrapper, 'detail-email')).toBe('carlos@nucleo.com.br')
    expect(t(wrapper, 'detail-phone')).toBe('(62) 99999-0000')
    expect(t(wrapper, 'detail-role')).toContain('Contramestre')
    expect(norm(t(wrapper, 'detail-city'))).toBe('Goiânia / GO')
    expect(t(wrapper, 'detail-students')).toBe('40')
    expect(t(wrapper, 'detail-message')).toContain('12 anos de roda de rua')
    expect(dialog.text().toLowerCase()).not.toContain('senha')
    await click(wrapper, '[data-testid="detail-close"]')
    expect(has(wrapper, 'application-detail')).toBe(false)
  })

  it('aprovado: mostra decisão, quem decidiu, grupo criado e nota interna', async () => {
    const { wrapper } = await mountApplications()
    await click(wrapper, '[data-testid="tab-APPROVED"]')
    await click(wrapper, '[data-testid="application-6"] [data-action="open"]')
    expect(t(wrapper, 'detail-decided-by')).toBe('Owner')
    expect(norm(t(wrapper, 'detail-organization'))).toBe('Grupo Aprovado (grupo-aprovado)')
    expect(t(wrapper, 'detail-note')).toContain('Conferido pelo Instagram.')
    expect(has(wrapper, 'detail-approve')).toBe(false) // já decidido: sem botões de decisão
  })

  it('não aprovado: mostra o motivo que foi ao solicitante', async () => {
    const { wrapper } = await mountApplications()
    await click(wrapper, '[data-testid="tab-REJECTED"]')
    await click(wrapper, '[data-testid="application-7"] [data-action="open"]')
    expect(t(wrapper, 'detail-reason')).toContain('Não encontramos informações do grupo.')
  })
})

describe('GroupApplicationsView — travas por papel', () => {
  it('super admin PLATFORM: botões Aprovar/Não aprovar na linha e no detalhe; sem aviso de somente leitura', async () => {
    const { wrapper } = await mountApplications()
    expect(has(wrapper, 'read-only-banner')).toBe(false)
    expect(wrapper.find('[data-testid="application-5"] [data-action="approve"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="application-5"] [data-action="reject"]').exists()).toBe(true)
    await click(wrapper, '[data-testid="application-5"] [data-action="open"]')
    expect(has(wrapper, 'detail-approve')).toBe(true)
    expect(has(wrapper, 'detail-reject')).toBe(true)
  })

  it.each([
    ['PLATFORM comum (não super)', nonSuper],
    ['MEMBER com isSuperAdmin=true (só PLATFORM conta)', memberSuper],
  ])('%s: lê tudo, mas SEM botões de decisão e SEM chamada que não seja GET', async (_name, user) => {
    const { wrapper, calls } = await mountApplications({}, user())
    expect(has(wrapper, 'read-only-banner')).toBe(true)
    expect(wrapper.find('[data-testid="application-5"] [data-action="open"]').exists()).toBe(true)
    expect(wrapper.find('[data-action="approve"]').exists()).toBe(false)
    expect(wrapper.find('[data-action="reject"]').exists()).toBe(false)

    await click(wrapper, '[data-testid="application-5"] [data-action="open"]')
    expect(has(wrapper, 'detail-approve')).toBe(false)
    expect(has(wrapper, 'detail-reject')).toBe(false)
    expect(has(wrapper, 'detail-read-only')).toBe(true)
    expect(has(wrapper, 'detail-close')).toBe(true)
    await click(wrapper, '[data-testid="detail-close"]')

    for (const tab of ['APPROVED', 'REJECTED', 'EXPIRED', 'PENDING']) await click(wrapper, `[data-testid="tab-${tab}"]`)
    expect(nonGet(calls)).toHaveLength(0)
    // sem confirm-dialog de decisão em lugar nenhum
    expect(has(wrapper, 'confirm-dialog')).toBe(false)
  })
})

describe('GroupApplicationsView — aprovar', () => {
  it('abre o diálogo com o aviso; sem slug nem nota o corpo é {}; sucesso recarrega a lista e o contador', async () => {
    const { wrapper, calls } = await mountApplications()
    await click(wrapper, '[data-testid="application-5"] [data-action="approve"]')
    expect(has(wrapper, 'confirm-dialog')).toBe(true)
    expect(t(wrapper, 'approve-group')).toBe('Núcleo Raízes do Cerrado')
    expect(t(wrapper, 'approve-warning')).toContain('cria o grupo e a conta de administrador')
    expect(t(wrapper, 'approve-warning')).toContain('avisa por e-mail')
    expect(nonGet(calls)).toHaveLength(0) // abrir não decide nada

    const listsBefore = listCalls(calls).length
    const countsBefore = calls.filter((c) => c.path.endsWith('/pending-count')).length
    await click(wrapper, '[data-testid="confirm-ok"]')
    const posts = nonGet(calls)
    expect(posts).toHaveLength(1)
    expect(posts[0].method).toBe('POST')
    expect(posts[0].path).toBe('/platform-group-applications/5/approve')
    expect(posts[0].body).toEqual({})
    expect(has(wrapper, 'confirm-dialog')).toBe(false)
    expect(t(wrapper, 'notice')).toContain('Núcleo Raízes do Cerrado')
    expect(t(wrapper, 'notice')).toContain('nucleo-raizes-do-cerrado')
    expect(listCalls(calls).length).toBe(listsBefore + 1)
    expect(calls.filter((c) => c.path.endsWith('/pending-count')).length).toBe(countsBefore + 1)
  })

  it('slug e nota interna válidos vão no corpo, aparados', async () => {
    const { wrapper, calls } = await mountApplications()
    await click(wrapper, '[data-testid="application-5"] [data-action="approve"]')
    await wrapper.get('[data-testid="approve-slug"]').setValue(' raizes-do-cerrado ')
    await wrapper.get('[data-testid="approve-note"]').setValue(' conferido ')
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(nonGet(calls)[0].body).toEqual({ slug: 'raizes-do-cerrado', internalNote: 'conferido' })
  })

  it('slug inválido ou nota longa demais: erro no campo e NENHUMA chamada', async () => {
    const { wrapper, calls } = await mountApplications()
    await click(wrapper, '[data-testid="application-5"] [data-action="approve"]')
    await wrapper.get('[data-testid="approve-slug"]').setValue('Slug Ruim')
    await wrapper.get('[data-testid="approve-note"]').setValue('x'.repeat(501))
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(t(wrapper, 'approve-slug-error')).toContain('2 a 60 caracteres')
    expect(t(wrapper, 'approve-note-error')).toContain('No máximo 500')
    expect(wrapper.get('[data-testid="approve-slug"]').attributes('aria-invalid')).toBe('true')
    expect(nonGet(calls)).toHaveLength(0)
    expect(has(wrapper, 'confirm-dialog')).toBe(true)
  })

  it('Cancelar fecha sem chamar nada', async () => {
    const { wrapper, calls } = await mountApplications()
    await click(wrapper, '[data-testid="application-5"] [data-action="approve"]')
    await click(wrapper, '[data-cancel]')
    expect(has(wrapper, 'confirm-dialog')).toBe(false)
    expect(nonGet(calls)).toHaveLength(0)
  })

  it('aprovar a partir do detalhe fecha o detalhe e abre o diálogo de aprovação', async () => {
    const { wrapper } = await mountApplications()
    await click(wrapper, '[data-testid="application-5"] [data-action="open"]')
    await click(wrapper, '[data-testid="detail-approve"]')
    expect(has(wrapper, 'application-detail')).toBe(false)
    expect(has(wrapper, 'approve-group')).toBe(true)
  })

  it.each([
    ['NOT_PENDING', 409, { statusCode: 409, code: 'NOT_PENDING', message: 'Pedido não está pendente.' }, /já foi decidido/],
    ['EMAIL_TAKEN', 409, { statusCode: 409, code: 'EMAIL_TAKEN', message: 'E-mail já cadastrado.' }, /e-mail do solicitante já virou uma conta/],
    ['slug em uso', 409, { statusCode: 409, code: 'SLUG_TAKEN', message: 'Slug já em uso.' }, /endereço \(slug\) já está em uso/],
    ['403', 403, { statusCode: 403, message: 'Forbidden resource' }, /Só o super admin/],
    ['404', 404, { statusCode: 404, message: 'Not Found' }, /não existe mais/],
  ])('erro %s: mensagem em português no diálogo, que continua aberto', async (_name, status, body, text) => {
    const { wrapper, calls } = await mountApplications({ approve: () => ({ status, body }) })
    await click(wrapper, '[data-testid="application-5"] [data-action="approve"]')
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(has(wrapper, 'confirm-dialog')).toBe(true)
    const message = t(wrapper, 'confirm-error')
    expect(message).toMatch(text)
    expect(message).not.toMatch(/NOT_PENDING|EMAIL_TAKEN|SLUG_TAKEN|Forbidden|Not Found/)
    expect(nonGet(calls)).toHaveLength(1)
  })

  it('409/404 recarregam a lista e o contador (lista estava desatualizada)', async () => {
    const { wrapper, calls } = await mountApplications({ approve: () => ({ status: 409, body: { statusCode: 409, code: 'NOT_PENDING', message: 'x' } }) })
    await click(wrapper, '[data-testid="application-5"] [data-action="approve"]')
    const listsBefore = listCalls(calls).length
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(listCalls(calls).length).toBe(listsBefore + 1)
  })

  it('400 do servidor no slug vira erro no campo', async () => {
    const { wrapper } = await mountApplications({
      approve: () => ({ status: 400, body: { statusCode: 400, message: ['slug must match /^[a-z0-9]+$/ regex'] } }),
    })
    await click(wrapper, '[data-testid="application-5"] [data-action="approve"]')
    await wrapper.get('[data-testid="approve-slug"]').setValue('ok-slug')
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(t(wrapper, 'approve-slug-error')).toContain('slug must match')
  })
})

describe('GroupApplicationsView — não aprovar', () => {
  it('motivo obrigatório: vazio e curto demais não chamam a API; mostra o aviso de que o motivo vai ao solicitante', async () => {
    const { wrapper, calls } = await mountApplications()
    await click(wrapper, '[data-testid="application-5"] [data-action="reject"]')
    expect(t(wrapper, 'reject-warning')).toContain('mostrado ao solicitante')
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(t(wrapper, 'reject-reason-error')).toContain('Informe o motivo')
    await wrapper.get('[data-testid="reject-reason"]').setValue('ab')
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(t(wrapper, 'reject-reason-error')).toContain('mínimo 3')
    await wrapper.get('[data-testid="reject-reason"]').setValue('x'.repeat(301))
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(t(wrapper, 'reject-reason-error')).toContain('No máximo 300')
    expect(nonGet(calls)).toHaveLength(0)
    expect(t(wrapper, 'reject-reason-counter')).toBe('301/300')
  })

  it('motivo válido: POST /reject com { reason } (nota só se preenchida); sucesso recarrega lista e contador', async () => {
    const { wrapper, calls } = await mountApplications()
    await click(wrapper, '[data-testid="application-5"] [data-action="reject"]')
    await wrapper.get('[data-testid="reject-reason"]').setValue('  Não encontramos o grupo.  ')
    const listsBefore = listCalls(calls).length
    await click(wrapper, '[data-testid="confirm-ok"]')
    const posts = nonGet(calls)
    expect(posts).toHaveLength(1)
    expect(posts[0].path).toBe('/platform-group-applications/5/reject')
    expect(posts[0].body).toEqual({ reason: 'Não encontramos o grupo.' })
    expect(has(wrapper, 'confirm-dialog')).toBe(false)
    expect(t(wrapper, 'notice')).toContain('não aprovado')
    expect(listCalls(calls).length).toBe(listsBefore + 1)
  })

  it('nota interna vai junto quando preenchida', async () => {
    const { wrapper, calls } = await mountApplications()
    await click(wrapper, '[data-testid="application-5"] [data-action="reject"]')
    await wrapper.get('[data-testid="reject-reason"]').setValue('Dados insuficientes')
    await wrapper.get('[data-testid="reject-note"]').setValue(' suspeita de duplicata ')
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(nonGet(calls)[0].body).toEqual({ reason: 'Dados insuficientes', internalNote: 'suspeita de duplicata' })
  })

  it('409 NOT_PENDING em português; diálogo continua aberto', async () => {
    const { wrapper } = await mountApplications({ reject: () => ({ status: 409, body: { statusCode: 409, code: 'NOT_PENDING', message: 'x' } }) })
    await click(wrapper, '[data-testid="application-5"] [data-action="reject"]')
    await wrapper.get('[data-testid="reject-reason"]').setValue('Dados insuficientes')
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(t(wrapper, 'confirm-error')).toMatch(/já foi decidido/)
    expect(has(wrapper, 'confirm-dialog')).toBe(true)
  })

  it('403 em português', async () => {
    const { wrapper } = await mountApplications({ reject: () => ({ status: 403, body: { statusCode: 403, message: 'Forbidden resource' } }) })
    await click(wrapper, '[data-testid="application-5"] [data-action="reject"]')
    await wrapper.get('[data-testid="reject-reason"]').setValue('Dados insuficientes')
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(t(wrapper, 'confirm-error')).toBe('Só o super admin pode aprovar ou não aprovar pedidos.')
  })
})

describe('senha nunca aparece', () => {
  it('mesmo que o servidor vazasse um campo de senha, a tela não o exibe; os corpos enviados nunca levam senha', async () => {
    // Simula uma resposta com campo indevido (o contrato garante que não vem): a tela só renderiza campos conhecidos.
    const withSentinel = { ...application({ message: 'texto normal' }), passwordHash: SENTINEL_PASSWORD, password: SENTINEL_PASSWORD }
    const { wrapper, calls } = await mountApplications({ byStatus: { PENDING: [withSentinel] } })
    await click(wrapper, '[data-testid="application-5"] [data-action="open"]')
    expect(wrapper.html()).not.toContain(SENTINEL_PASSWORD)
    expect(wrapper.html().toLowerCase()).not.toContain('passwordhash')
    expect(wrapper.html().toLowerCase()).not.toContain('type="password"')
    await click(wrapper, '[data-testid="detail-approve"]')
    await click(wrapper, '[data-testid="confirm-ok"]')
    expect(JSON.stringify(nonGet(calls).map((c) => c.body))).not.toMatch(/pass/i)
  })
})

describe('AuditView — rótulos das ações novas', () => {
  it('mostra "Pedido de adesão aprovado/não aprovado" e as ações PLATFORM_FINANCE_* em português', async () => {
    const log = (id: number, action: string, entity: string) => ({
      id,
      createdAt: '2026-11-08T15:00:00.000Z',
      action,
      entity,
      entityId: '5',
      organizationId: null,
      organizationName: null,
      userId: 1,
      userName: 'Owner',
      userEmail: 'owner@gingapp.com.br',
      ip: '10.0.0.1',
      meta: { status: 'APPROVED' },
    })
    mockFetch((call) => {
      if (call.path === '/organizations') return { body: [], headers: { 'X-Total-Count': '0' } }
      if (call.path === '/audit-logs') {
        return listReply([
          log(1, 'GROUP_APPLICATION_APPROVE', 'group_application'),
          log(2, 'GROUP_APPLICATION_REJECT', 'group_application'),
          log(3, 'PLATFORM_FINANCE_MONTH_PUBLISH', 'platform_ledger_month'),
        ])
      }
      return undefined
    })
    const { wrapper } = await mountView(AuditView)
    expect(norm(t(wrapper, 'audit-1'))).toContain('Pedido de adesão aprovado')
    expect(norm(t(wrapper, 'audit-2'))).toContain('Pedido de adesão não aprovado')
    expect(norm(t(wrapper, 'audit-3'))).toContain('Mês da transparência publicado')
    expect(norm(t(wrapper, 'audit-1'))).not.toContain('GROUP_APPLICATION_APPROVE')
    const options = wrapper.findAll('[data-testid="filter-action"] option').map((o) => o.text())
    expect(options).toContain('Pedido de adesão aprovado')
    expect(options).toContain('Pedido de adesão não aprovado')
  })
})
