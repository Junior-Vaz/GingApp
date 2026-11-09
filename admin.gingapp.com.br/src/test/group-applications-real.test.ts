import { describe, expect, it } from 'vitest'
import GroupApplicationsView from '@/views/GroupApplicationsView.vue'
import { EMAIL_VERIFICATION_META, ROLE_LABELS, STATUS_META, isInstagramHandle } from '@/utils/groupApplications'
import { REAL_ADMIN_LIST, REAL_TOTAL_HEADER } from './real-contract-adesao'
import { flushPromises, mockFetch, mountView } from './helpers'

/** Conformidade com o backend REAL: lista do admin capturada do e2e (um item de cada status). */
const items = REAL_ADMIN_LIST as Array<Record<string, unknown>>

describe('pedidos de adesão: resposta real do backend', () => {
  it('cada item real tem exatamente as chaves que o admin lê, e nunca senha/token', () => {
    for (const item of items) {
      expect(Object.keys(item).sort()).toEqual(
        [
          'applicantName', 'city', 'claimedRole', 'claimedRoleLabel', 'createdAt', 'decidedAt', 'decidedBy', 'email',
          'emailVerification', 'emailVerifiedAt', 'estimatedStudents', 'groupName', 'id', 'instagram', 'internalNote',
          'message', 'organization', 'phone', 'rejectionReason', 'state', 'status',
        ].sort(),
      )
    }
    expect(JSON.stringify(items)).not.toMatch(/password|tokenHash|statusToken/i)
  })

  it('os valores reais de status, verificação do e-mail e Instagram são os que o admin entende', () => {
    for (const item of items) {
      expect(Object.keys(STATUS_META), `status ${String(item.status)}`).toContain(item.status)
      expect(Object.keys(EMAIL_VERIFICATION_META), `emailVerification ${String(item.emailVerification)}`).toContain(item.emailVerification)
      // `emailVerifiedAt` só existe quando confirmado; `instagram` é o handle já normalizado ou null (nunca URL/@).
      if (item.emailVerification === 'VERIFIED') expect(typeof item.emailVerifiedAt).toBe('string')
      else expect(item.emailVerifiedAt).toBeNull()
      if (item.instagram !== null) expect(isInstagramHandle(item.instagram), `instagram ${String(item.instagram)}`).toBe(true)
    }
  })

  it('os rótulos de cargo do servidor batem com os do admin', () => {
    const labels = ROLE_LABELS as Record<string, string>
    for (const item of items) expect(labels[item.claimedRole as string]).toBe(item.claimedRoleLabel)
  })

  it('a tela monta com a lista real (cabeçalho X-Total-Count real) sem erro', async () => {
    mockFetch((call) => {
      if (call.path === '/platform-group-applications/pending-count') return { body: { count: 1 } }
      if (call.path === '/platform-group-applications') return { body: items, headers: { 'x-total-count': REAL_TOTAL_HEADER } }
      return undefined
    })
    const { wrapper } = await mountView(GroupApplicationsView)
    await flushPromises()
    expect(wrapper.text()).toContain(items[0]!.groupName as string)
  })
})
