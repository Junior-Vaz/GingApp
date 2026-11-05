/**
 * Chamadas HTTP do módulo de Patrocinadores (rotas de PLATAFORMA do contrato, docs/CONTRATO_PATROCINADORES.md §4.3).
 *
 * PREFIXO: o contrato diz "/platform/sponsors … acompanhar a convenção do projeto". As rotas de plataforma já existentes
 * no admin são de nível superior com hífen (`/platform-announcements`, `/platform-team`, `/platform-settings`), então
 * assumimos `/platform-sponsors`, `/platform-sponsor-campaigns` e `/platform-uploads`. Se o backend escolher outro
 * prefixo, MUDE SÓ AS TRÊS CONSTANTES ABAIXO.
 */
import { api, type Page, type QueryParams } from '@/utils/api'
import type { CampaignReport, EffectiveStatus, Sponsor, SponsorCampaign } from '@/utils/sponsors'

export const SPONSORS_PATH = '/platform-sponsors'
export const CAMPAIGNS_PATH = '/platform-sponsor-campaigns'
export const UPLOADS_PATH = '/platform-uploads'

export interface SponsorListParams {
  q?: string
  limit?: number
  offset?: number
}

export interface CampaignListParams {
  q?: string
  effective?: EffectiveStatus | ''
  sponsorId?: number | string
  limit?: number
  offset?: number
}

export const sponsorsApi = {
  listSponsors: (params: SponsorListParams = {}): Promise<Page<Sponsor>> =>
    api.getPage<Sponsor>(SPONSORS_PATH, params as QueryParams),
  createSponsor: (body: unknown) => api.post<Sponsor>(SPONSORS_PATH, body),
  updateSponsor: (id: number, body: unknown) => api.patch<Sponsor>(`${SPONSORS_PATH}/${id}`, body),
  deleteSponsor: (id: number) => api.delete<void>(`${SPONSORS_PATH}/${id}`),

  listCampaigns: (params: CampaignListParams = {}): Promise<Page<SponsorCampaign>> =>
    api.getPage<SponsorCampaign>(CAMPAIGNS_PATH, params as QueryParams),
  getCampaign: (id: number) => api.get<SponsorCampaign>(`${CAMPAIGNS_PATH}/${id}`),
  createCampaign: (body: unknown) => api.post<SponsorCampaign>(CAMPAIGNS_PATH, body),
  updateCampaign: (id: number, body: unknown) => api.patch<SponsorCampaign>(`${CAMPAIGNS_PATH}/${id}`, body),
  deleteCampaign: (id: number) => api.delete<void>(`${CAMPAIGNS_PATH}/${id}`),
  activateCampaign: (id: number) => api.post<SponsorCampaign>(`${CAMPAIGNS_PATH}/${id}/activate`),
  pauseCampaign: (id: number) => api.post<SponsorCampaign>(`${CAMPAIGNS_PATH}/${id}/pause`),
  resumeCampaign: (id: number) => api.post<SponsorCampaign>(`${CAMPAIGNS_PATH}/${id}/resume`),

  getReport: (id: number, range: { from: string; to: string }) =>
    api.get<CampaignReport>(`${CAMPAIGNS_PATH}/${id}/report${queryOf(range)}`),
  getReportCsv: (id: number, range: { from: string; to: string }) =>
    api.getBlob(`${CAMPAIGNS_PATH}/${id}/report.csv`, range),

  /** Envia UMA imagem (multipart, campo "file"). Resposta como a do upload de grupo: `{ url: '/api/uploads/<arquivo>' }`. */
  async uploadImage(file: File): Promise<string> {
    const form = new FormData()
    form.append('file', file)
    const result = await api.postForm<{ url: string }>(UPLOADS_PATH, form)
    return result.url
  },
}

function queryOf(params: { from: string; to: string }): string {
  return `?from=${encodeURIComponent(params.from)}&to=${encodeURIComponent(params.to)}`
}
