import { api } from '@/utils/api'
import { useAuthStore } from '@/stores/auth'

/** Documentos legais (E10) servidos pela API em GET /legal/terms e /legal/privacy (públicos, sem login). */
export type LegalDocumentType = 'terms' | 'privacy'

export interface LegalSection {
  heading: string
  paragraphs: string[]
}

export interface LegalDocument {
  type: LegalDocumentType
  title: string
  version: string
  updatedAt: string
  /** "MODELO — revisar com assessoria jurídica…" (exibido no topo). */
  notice: string
  sections: LegalSection[]
}

export const fetchLegalDocument = (type: LegalDocumentType) =>
  api.get<LegalDocument>(`/legal/${type}`, { skipAuth: true })

export const fetchLegalVersion = async (): Promise<string> =>
  (await api.get<{ version: string }>('/legal', { skipAuth: true })).version

/** POST /auth/accept-terms com a versão que o usuário viu; no sucesso a sessão deixa de exigir o aceite. */
export async function acceptTerms(version: string): Promise<void> {
  await api.post('/auth/accept-terms', { version })
  useAuthStore().updateUser({ termsAcceptanceRequired: false, acceptedTermsVersion: version, currentTermsVersion: version })
}
