import { describe, expect, it } from 'vitest'
import { ApiError } from '@/utils/api'
import { AUDIT_ACTION_LABELS, auditActionLabel, auditActionOptions } from '@/utils/audit'
import {
  STATUS_META,
  STATUS_TABS,
  applicationErrorText,
  approvePayload,
  claimedRoleText,
  formatPhone,
  isStaleListError,
  reasonError,
  rejectPayload,
  slugError,
  statusLabel,
  validateApproveForm,
  validateRejectForm,
} from '@/utils/groupApplications'
import { application } from './group-applications-fixtures'

const apiError = (status: number, code?: string, message = 'texto do servidor') => new ApiError(message, status, { statusCode: status, ...(code ? { code } : {}), message })

describe('status e cargo em português', () => {
  it('rótulos dos 4 status e abas na ordem do contrato (Pendentes primeiro)', () => {
    expect(statusLabel('PENDING')).toBe('Pendente')
    expect(statusLabel('APPROVED')).toBe('Aprovado')
    expect(statusLabel('REJECTED')).toBe('Não aprovado')
    expect(statusLabel('EXPIRED')).toBe('Expirado')
    expect(statusLabel('OUTRO_STATUS')).toBe('OUTRO_STATUS')
    expect(STATUS_TABS.map((t) => t.label)).toEqual(['Pendentes', 'Aprovados', 'Não aprovados', 'Expirados'])
    expect(Object.keys(STATUS_META)).toHaveLength(4)
  })

  it('cargo informado: usa o rótulo do servidor e cai no nosso; todos os 6 cargos têm texto', () => {
    expect(claimedRoleText(application({ claimedRoleLabel: 'Contramestre' }))).toBe('Contramestre')
    const labels = (['MESTRE', 'CONTRAMESTRE', 'PROFESSOR', 'INSTRUTOR', 'MONITOR', 'OUTRO'] as const).map((claimedRole) =>
      claimedRoleText({ claimedRole, claimedRoleLabel: '' }),
    )
    expect(labels).toEqual(['Mestre', 'Contramestre', 'Professor', 'Instrutor', 'Monitor', 'Outro cargo'])
  })

  it('telefone formatado; ausente vira traço; fora do padrão volta como veio', () => {
    expect(formatPhone('62999990000')).toBe('(62) 99999-0000')
    expect(formatPhone('6233334444')).toBe('(62) 3333-4444')
    expect(formatPhone(null)).toBe('—')
    expect(formatPhone('+351 912')).toBe('+351 912')
  })
})

describe('validação do slug (opcional) e do motivo (3..300)', () => {
  it('slug vazio é válido; formato e tamanho do contrato', () => {
    expect(slugError('')).toBeNull()
    expect(slugError('   ')).toBeNull()
    expect(slugError('grupo-ginga')).toBeNull()
    expect(slugError('ab')).toBeNull()
    expect(slugError('a'.repeat(60))).toBeNull()
    for (const bad of ['a', 'a'.repeat(61), 'Grupo', 'grupo ginga', '-grupo', 'grupo-', 'grupo--x', 'grupo_x', 'grupão']) {
      expect(slugError(bad), bad).toMatch(/2 a 60 caracteres/)
    }
  })

  it('motivo: obrigatório, 3..300 depois de aparar', () => {
    expect(reasonError('')).toMatch(/Informe o motivo/)
    expect(reasonError('  ab  ')).toMatch(/mínimo 3/)
    expect(reasonError('abc')).toBeNull()
    expect(reasonError('x'.repeat(300))).toBeNull()
    expect(reasonError('x'.repeat(301))).toMatch(/No máximo 300/)
    expect(reasonError(`  ${'x'.repeat(300)}  `)).toBeNull()
  })

  it('formulários: aprovar valida slug e nota (500); rejeitar exige motivo', () => {
    expect(validateApproveForm({ slug: '', internalNote: '' })).toEqual({})
    expect(validateApproveForm({ slug: 'Ruim Slug', internalNote: 'x'.repeat(501) })).toEqual({
      slug: expect.stringContaining('2 a 60'),
      internalNote: 'No máximo 500 caracteres.',
    })
    expect(validateRejectForm({ reason: '', internalNote: '' }).reason).toBeTruthy()
    expect(validateRejectForm({ reason: 'Sem dados do grupo', internalNote: 'y'.repeat(501) })).toEqual({ internalNote: 'No máximo 500 caracteres.' })
  })

  it('corpos: campos vazios omitidos; textos aparados; sem senha', () => {
    expect(approvePayload({ slug: '', internalNote: '' })).toEqual({})
    expect(approvePayload({ slug: ' meu-grupo ', internalNote: ' ok ' })).toEqual({ slug: 'meu-grupo', internalNote: 'ok' })
    expect(rejectPayload({ reason: '  Sem dados  ', internalNote: '' })).toEqual({ reason: 'Sem dados' })
    expect(rejectPayload({ reason: 'Sem dados', internalNote: ' nota ' })).toEqual({ reason: 'Sem dados', internalNote: 'nota' })
  })
})

describe('mensagens de erro em português', () => {
  it('409 NOT_PENDING', () => {
    const text = applicationErrorText(apiError(409, 'NOT_PENDING'), 'approve')
    expect(text).toMatch(/já foi decidido/)
    expect(text).not.toContain('NOT_PENDING')
  })

  it('409 EMAIL_TAKEN', () => {
    const text = applicationErrorText(apiError(409, 'EMAIL_TAKEN'), 'approve')
    expect(text).toMatch(/e-mail do solicitante já virou uma conta/)
    expect(text).not.toContain('EMAIL_TAKEN')
  })

  it('código só na message (sem code) também é traduzido', () => {
    expect(applicationErrorText(new ApiError('NOT_PENDING', 409), 'reject')).toMatch(/já foi decidido/)
    expect(applicationErrorText(new ApiError('EMAIL_TAKEN', 409), 'approve')).toMatch(/já virou uma conta/)
  })

  it('409 de slug em uso (por código, por mensagem ou por termos enviado um slug)', () => {
    const slugText = /endereço \(slug\) já está em uso/
    expect(applicationErrorText(apiError(409, 'SLUG_TAKEN'), 'approve')).toMatch(slugText)
    expect(applicationErrorText(apiError(409, undefined, 'Slug já em uso.'), 'approve')).toMatch(slugText)
    expect(applicationErrorText(apiError(409, undefined, 'Conflito.'), 'approve', true)).toMatch(slugText)
    // sem slug enviado e sem pista de slug: mensagem do servidor (nada inventado)
    expect(applicationErrorText(apiError(409, undefined, 'Conflito.'), 'approve', false)).toBe('Conflito.')
    // rejeitar não tem slug
    expect(applicationErrorText(apiError(409, undefined, 'Conflito.'), 'reject', true)).toBe('Conflito.')
  })

  it('403 e 404', () => {
    expect(applicationErrorText(apiError(403), 'approve')).toBe('Só o super admin pode aprovar ou não aprovar pedidos.')
    expect(applicationErrorText(apiError(404), 'reject')).toBe('Esse pedido não existe mais. Atualize a lista.')
  })

  it('erro que não é da API usa o texto padrão do contexto; outros status usam a mensagem do servidor', () => {
    expect(applicationErrorText(new Error('x'), 'approve')).toBe('Não foi possível aprovar o pedido.')
    expect(applicationErrorText(new Error('x'), 'reject')).toBe('Não foi possível registrar a decisão.')
    expect(applicationErrorText(apiError(500, undefined, 'Erro interno.'), 'approve')).toBe('Erro interno.')
  })

  it('lista desatualizada = 409 ou 404', () => {
    expect(isStaleListError(apiError(409))).toBe(true)
    expect(isStaleListError(apiError(404))).toBe(true)
    expect(isStaleListError(apiError(403))).toBe(false)
    expect(isStaleListError(new Error('x'))).toBe(false)
  })
})

describe('rótulos de auditoria', () => {
  it('ações de adesão de grupos em português', () => {
    expect(AUDIT_ACTION_LABELS.GROUP_APPLICATION_APPROVE).toBe('Pedido de adesão aprovado')
    expect(AUDIT_ACTION_LABELS.GROUP_APPLICATION_REJECT).toBe('Pedido de adesão não aprovado')
    expect(auditActionLabel('GROUP_APPLICATION_APPROVE')).toBe('Pedido de adesão aprovado')
  })

  it('as 7 ações PLATFORM_FINANCE_* da rodada anterior também têm rótulo', () => {
    const codes = [
      'PLATFORM_FINANCE_ENTRY_CREATE',
      'PLATFORM_FINANCE_ENTRY_UPDATE',
      'PLATFORM_FINANCE_ENTRY_DELETE',
      'PLATFORM_FINANCE_MONTH_PUBLISH',
      'PLATFORM_FINANCE_MONTH_UNPUBLISH',
      'PLATFORM_FINANCE_SETTINGS_UPDATE',
      'PLATFORM_FINANCE_EXPORT',
    ]
    for (const code of codes) {
      const label = auditActionLabel(code)
      expect(label, code).not.toBe(code)
      expect(label, code).not.toMatch(/[A-Z]{3,}_/)
    }
    expect(auditActionLabel('PLATFORM_FINANCE_MONTH_PUBLISH')).toBe('Mês da transparência publicado')
  })

  it('as novas ações entram no filtro da tela de auditoria', () => {
    const values = auditActionOptions().map((o) => o.value)
    expect(values).toContain('GROUP_APPLICATION_APPROVE')
    expect(values).toContain('GROUP_APPLICATION_REJECT')
    expect(values).toContain('PLATFORM_FINANCE_EXPORT')
  })
})
