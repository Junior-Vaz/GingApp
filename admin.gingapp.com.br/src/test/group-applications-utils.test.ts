import { describe, expect, it } from 'vitest'
import { ApiError } from '@/utils/api'
import { AUDIT_ACTION_LABELS, auditActionLabel, auditActionOptions } from '@/utils/audit'
import {
  APPROVE_BLOCKED_HINT,
  EMAIL_VERIFICATION_META,
  INSTAGRAM_CHECK_HINT,
  STATUS_META,
  STATUS_TABS,
  applicationErrorText,
  approvePayload,
  claimedRoleText,
  emailVerificationMeta,
  formatPhone,
  instagramUrl,
  isAwaitingEmail,
  isInstagramHandle,
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
  it('rótulos dos 5 status e abas na ordem do contrato (Pendentes primeiro, "Aguardando e-mail" logo depois)', () => {
    expect(statusLabel('PENDING')).toBe('Pendente')
    expect(statusLabel('UNVERIFIED')).toBe('Aguardando e-mail')
    expect(statusLabel('APPROVED')).toBe('Aprovado')
    expect(statusLabel('REJECTED')).toBe('Não aprovado')
    expect(statusLabel('EXPIRED')).toBe('Expirado')
    expect(statusLabel('OUTRO_STATUS')).toBe('OUTRO_STATUS')
    expect(STATUS_TABS.map((t) => t.label)).toEqual(['Pendentes', 'Aguardando e-mail', 'Aprovados', 'Não aprovados', 'Expirados'])
    expect(STATUS_TABS.map((t) => t.key)).toEqual(['PENDING', 'UNVERIFIED', 'APPROVED', 'REJECTED', 'EXPIRED'])
    expect(Object.keys(STATUS_META)).toHaveLength(5)
  })

  it('só UNVERIFIED está aguardando e-mail (e por isso não pode ser aprovado)', () => {
    expect(isAwaitingEmail({ status: 'UNVERIFIED' })).toBe(true)
    for (const status of ['PENDING', 'APPROVED', 'REJECTED', 'EXPIRED'] as const) expect(isAwaitingEmail({ status })).toBe(false)
    expect(APPROVE_BLOCKED_HINT).toBe('Disponível depois que o solicitante confirmar o e-mail.')
  })

  it('selos da verificação do e-mail: textos do contrato e tons (envio desligado = aviso)', () => {
    expect(EMAIL_VERIFICATION_META.VERIFIED).toMatchObject({ label: 'E-mail confirmado', tone: 'success' })
    expect(EMAIL_VERIFICATION_META.SKIPPED).toMatchObject({ label: 'E-mail não confirmado (envio desligado)', tone: 'warning' })
    expect(EMAIL_VERIFICATION_META.PENDING).toMatchObject({ label: 'Aguardando confirmação', tone: 'info' })
    expect(emailVerificationMeta('SKIPPED')?.label).toBe('E-mail não confirmado (envio desligado)')
    // ausente/desconhecido (servidor antigo): sem selo, nunca um texto inventado
    for (const value of [undefined, null, '', 'OUTRO', 'toString', '__proto__']) expect(emailVerificationMeta(value as string | null | undefined)).toBeNull()
  })

  it('aviso do detalhe sobre conferir o perfil (texto do contrato)', () => {
    expect(INSTAGRAM_CHECK_HINT).toBe('Confira o perfil antes de aprovar: o e-mail só prova que o solicitante recebe mensagens nele.')
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

  it('409 EMAIL_NOT_VERIFIED (por código ou só na message) em português, para aprovar', () => {
    const text = applicationErrorText(apiError(409, 'EMAIL_NOT_VERIFIED'), 'approve')
    expect(text).toMatch(/ainda não confirmou o e-mail/)
    expect(text).not.toContain('EMAIL_NOT_VERIFIED')
    expect(applicationErrorText(new ApiError('EMAIL_NOT_VERIFIED', 409), 'approve')).toBe(text)
    // não confunde com os outros 409 conhecidos, nem é tratado como "slug em uso" mesmo com slug enviado
    expect(applicationErrorText(apiError(409, 'EMAIL_NOT_VERIFIED'), 'approve', true)).toBe(text)
    expect(text).not.toMatch(/já foi decidido|virou uma conta|slug/)
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

describe('Instagram: link só de handle validado no cliente', () => {
  it.each(['a', '9', 'meugrupo', 'meu.grupo', 'meu_grupo', 'grupo2026', '_x_', 'a'.repeat(30)])('%j vira https://www.instagram.com/<handle>/', (handle) => {
    expect(isInstagramHandle(handle)).toBe(true)
    expect(instagramUrl(handle)).toBe(`https://www.instagram.com/${handle}/`)
  })

  it.each([
    '',
    ' ',
    ' meugrupo',
    'meugrupo ',
    'meu grupo',
    '@meugrupo',
    'MeuGrupo',
    'a'.repeat(31),
    'a..b',
    '..',
    '.',
    'meugrupo.',
    'grupo-x',
    'grupo/x',
    'grupo?x=1',
    'grupo#x',
    'https://www.instagram.com/meugrupo/',
    'instagram.com/meugrupo',
    '//evil.example',
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    ' javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:x',
    '<script>alert(1)</script>',
    '"><img src=x onerror=alert(1)>',
    'é',
    'a\nb',
  ])('%j NUNCA vira link', (bad) => {
    expect(isInstagramHandle(bad)).toBe(false)
    expect(instagramUrl(bad)).toBeNull()
  })

  it('não-string (null, undefined, número, objeto) nunca vira link', () => {
    for (const value of [null, undefined, 123, {}, [], ['meugrupo'], true]) expect(instagramUrl(value)).toBeNull()
  })

  it('o link montado nunca sai do host do Instagram', () => {
    for (const handle of ['a', 'x.y', 'z_9', 'a'.repeat(30)]) {
      const url = new URL(instagramUrl(handle)!)
      expect(url.protocol).toBe('https:')
      expect(url.host).toBe('www.instagram.com')
      expect(url.pathname).toBe(`/${handle}/`)
      expect(url.search + url.hash + url.username + url.password).toBe('')
    }
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
