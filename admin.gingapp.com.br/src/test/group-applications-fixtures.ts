import type { ApproveResult, GroupApplication } from '@/utils/groupApplications'

/** Formato EXATO do contrato (docs/CONTRATO_ADESAO_GRUPOS.md §4). Nunca tem senha nem token. */
export function application(overrides: Partial<GroupApplication> = {}): GroupApplication {
  return {
    id: 5,
    status: 'PENDING',
    applicantName: 'Carlos Contramestre',
    email: 'carlos@nucleo.com.br',
    phone: '62999990000',
    claimedRole: 'CONTRAMESTRE',
    claimedRoleLabel: 'Contramestre',
    groupName: 'Núcleo Raízes do Cerrado',
    city: 'Goiânia',
    state: 'GO',
    estimatedStudents: 40,
    message: 'Somos um núcleo com 12 anos de roda de rua.',
    createdAt: '2026-11-07T12:00:00.000Z',
    decidedAt: null,
    decidedBy: null,
    rejectionReason: null,
    internalNote: null,
    organization: null,
    ...overrides,
  }
}

export function approved(overrides: Partial<GroupApplication> = {}): GroupApplication {
  return application({
    id: 6,
    status: 'APPROVED',
    groupName: 'Grupo Aprovado',
    decidedAt: '2026-11-08T10:00:00.000Z',
    decidedBy: { id: 1, name: 'Owner' },
    internalNote: 'Conferido pelo Instagram.',
    organization: { id: 31, name: 'Grupo Aprovado', slug: 'grupo-aprovado' },
    ...overrides,
  })
}

export function rejected(overrides: Partial<GroupApplication> = {}): GroupApplication {
  return application({
    id: 7,
    status: 'REJECTED',
    groupName: 'Grupo Recusado',
    decidedAt: '2026-11-08T11:00:00.000Z',
    decidedBy: { id: 1, name: 'Owner' },
    rejectionReason: 'Não encontramos informações do grupo.',
    ...overrides,
  })
}

export function approveResult(overrides: Partial<ApproveResult> = {}): ApproveResult {
  return {
    application: approved({ id: 5 }),
    organization: { id: 31, name: 'Núcleo Raízes do Cerrado', slug: 'nucleo-raizes-do-cerrado' },
    ...overrides,
  }
}
