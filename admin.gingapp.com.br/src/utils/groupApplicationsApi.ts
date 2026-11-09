/**
 * Chamadas HTTP dos pedidos de adesão de grupos (rotas de PLATAFORMA, docs/CONTRATO_ADESAO_GRUPOS.md §4).
 * Leitura: qualquer usuário PLATFORM. Decidir (aprovar/não aprovar): só super admin
 * (o servidor é a barreira real; a tela só esconde os botões). Nenhuma resposta traz senha.
 */
import { api, type Page, type QueryParams } from '@/utils/api'
import type { ApproveResult, GroupApplication, GroupApplicationStatus } from '@/utils/groupApplications'

export const GROUP_APPLICATIONS_PATH = '/platform-group-applications'

export interface ApplicationListParams {
  status?: GroupApplicationStatus | ''
  q?: string
  limit?: number
  offset?: number
}

export const groupApplicationsApi = {
  /** Corpo = array; total em `X-Total-Count`. Filtros vazios são omitidos. */
  list: (params: ApplicationListParams = {}): Promise<Page<GroupApplication>> =>
    api.getPage<GroupApplication>(GROUP_APPLICATIONS_PATH, params as QueryParams),
  pendingCount: () => api.get<{ count: number }>(`${GROUP_APPLICATIONS_PATH}/pending-count`),
  get: (id: number) => api.get<GroupApplication>(`${GROUP_APPLICATIONS_PATH}/${id}`),
  /** 201 `{ application, organization }`. 409: NOT_PENDING, EMAIL_TAKEN ou slug em uso. */
  approve: (id: number, body: { slug?: string; internalNote?: string } = {}) =>
    api.post<ApproveResult>(`${GROUP_APPLICATIONS_PATH}/${id}/approve`, body),
  /** 200. `reason` (3..300) vai ao solicitante. 409 NOT_PENDING se já decidido. */
  reject: (id: number, body: { reason: string; internalNote?: string }) =>
    api.post<GroupApplication>(`${GROUP_APPLICATIONS_PATH}/${id}/reject`, body),
}

/**
 * Contador do menu. Falha (rede, 403, corpo estranho) devolve `null`: o menu continua sem o número,
 * nunca quebra por causa disso.
 */
export async function fetchPendingCount(): Promise<number | null> {
  try {
    const { count } = await groupApplicationsApi.pendingCount()
    return typeof count === 'number' && Number.isInteger(count) && count >= 0 ? count : null
  } catch {
    return null
  }
}
