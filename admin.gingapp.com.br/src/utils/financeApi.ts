/**
 * Chamadas HTTP do módulo Financeiro/Transparência (rotas de PLATAFORMA, docs/CONTRATO_TRANSPARENCIA.md §3).
 * Leitura: qualquer usuário PLATFORM. Escrita (criar/editar/excluir/publicar/despublicar/configurar): só super admin
 * (o servidor é a barreira real; a tela só esconde os botões).
 */
import { api, type Page, type QueryParams } from '@/utils/api'
import type { FinanceMonth, FinanceSettings, LedgerEntry, LedgerType, TransparencyBody } from '@/utils/finance'

export const FINANCE_PATH = '/platform-finance'

export interface EntryListParams {
  /** "YYYY-MM". */
  month?: string
  type?: LedgerType | ''
  category?: string
  q?: string
  limit?: number
  offset?: number
}

export const financeApi = {
  /** Corpo = array; total em `X-Total-Count`. Filtros vazios são omitidos. */
  listEntries: (params: EntryListParams = {}): Promise<Page<LedgerEntry>> =>
    api.getPage<LedgerEntry>(`${FINANCE_PATH}/entries`, params as QueryParams),
  createEntry: (body: unknown) => api.post<LedgerEntry>(`${FINANCE_PATH}/entries`, body),
  updateEntry: (id: number, body: unknown) => api.patch<LedgerEntry>(`${FINANCE_PATH}/entries/${id}`, body),
  deleteEntry: (id: number) => api.delete<void>(`${FINANCE_PATH}/entries/${id}`),
  /** CSV do mês (ou de tudo, sem `month`). Arquivo autenticado: baixa como Blob. */
  getEntriesCsv: (month?: string) => api.getBlob(`${FINANCE_PATH}/entries.csv`, { month } as QueryParams),

  /** Atenção: aqui o corpo é `{ items }`, não um array. */
  listMonths: () => api.get<{ items: FinanceMonth[] }>(`${FINANCE_PATH}/months`),
  /** `note` (pública, até 500) é opcional. Sem ela vai `{}`. */
  publishMonth: (month: string, note?: string) =>
    api.post<FinanceMonth>(`${FINANCE_PATH}/months/${encodeURIComponent(month)}/publish`, note && note.trim() ? { note: note.trim() } : {}),
  /** 204. */
  unpublishMonth: (month: string) => api.post<void>(`${FINANCE_PATH}/months/${encodeURIComponent(month)}/unpublish`),

  getSettings: () => api.get<FinanceSettings>(`${FINANCE_PATH}/settings`),
  updateSettings: (body: unknown) => api.put<FinanceSettings>(`${FINANCE_PATH}/settings`, body),

  /** Exatamente o corpo que `GET /transparency` devolveria hoje. */
  getPreview: () => api.get<TransparencyBody>(`${FINANCE_PATH}/preview`),
}
