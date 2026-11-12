import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, buildQuery, errorMessage } from "@/lib/api";
import { saveBlob } from "@/lib/csv";
import { isUploadPath, imageSrc as uploadImageSrc, uploadFileName } from "@/lib/uploads";
import {
  SPONSOR_LIMITS,
  reportCsvFilename,
  validateSponsorImageFile,
  type CampaignReport,
  type EffectiveStatus,
  type GroupCampaign,
  type GroupSponsor,
  type SponsorTerms,
} from "./sponsor-utils";

/**
 * Chamadas HTTP do módulo "Patrocinadores" do Mestre (docs/CONTRATO_PATROCINADORES_GRUPO.md §3). Tudo é filtrado pelo grupo
 * do token no servidor (id de outro grupo = 404); só o MESTRE acessa (qualquer outro papel = 403).
 */
export const TERMS_PATH = "/group-sponsors/terms";
export const SPONSORS_PATH = "/group-sponsors";
export const CAMPAIGNS_PATH = "/group-sponsor-campaigns";
/** Upload do GRUPO (o mesmo `POST /uploads` dos demais módulos). */
/** Rota própria do Mestre para imagens de patrocinador: o servidor reprocessa até 250 KB (o `/uploads` comum recusa acima disso). */
export const UPLOAD_PATH = "/group-sponsor-uploads";

/** Os dois limites (10 patrocinadores/10 campanhas) cabem numa só página: busca tudo de uma vez. */
const LIST_LIMIT = 100;

const ROOT = ["group-sponsors"] as const;

export const sponsorKeys = {
  root: ROOT,
  terms: () => [...ROOT, "terms"] as const,
  sponsors: (params: SponsorListParams) => [...ROOT, "sponsors", params] as const,
  campaigns: (params: CampaignListParams) => [...ROOT, "campaigns", params] as const,
  report: (id: number, range: { from: string; to: string }) => [...ROOT, "report", id, range.from, range.to] as const,
};

export interface SponsorListParams {
  q?: string;
}

export interface CampaignListParams {
  q?: string;
  effective?: EffectiveStatus | "";
  sponsorId?: number | "";
}

// ---------------------------------------------------------------- mensagens de erro

/** Mensagem amigável: código de negócio, depois status HTTP e, por fim, a do servidor/fallback. */
export function sponsorsErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case "SPONSOR_HAS_CAMPAIGNS":
        return "Este patrocinador ainda tem campanhas. Exclua as campanhas dele antes de excluí-lo.";
      case "SPONSOR_LIMIT":
        return `Limite do grupo atingido: no máximo ${String(SPONSOR_LIMITS.maxSponsors)} patrocinadores, ${String(SPONSOR_LIMITS.maxCampaigns)} campanhas e ${String(SPONSOR_LIMITS.maxActiveCampaigns)} campanhas ativas ao mesmo tempo. Exclua ou pause algum item e tente de novo.`;
      case "SPONSOR_TERMS_REQUIRED":
        return "Aceite o termo de responsabilidade (aba Termo) para poder ativar campanhas.";
      case "SPONSORS_BLOCKED":
        return "A plataforma bloqueou o patrocínio local do seu grupo. Fale com o suporte do GingApp.";
      case "SUSPENDED_BY_PLATFORM":
        return "Esta campanha foi suspensa pela plataforma e não pode ser retomada por você. Fale com o suporte do GingApp.";
      case "TERMS_VERSION_MISMATCH":
        return "O termo foi atualizado. Leia a nova versão e aceite de novo.";
      case "CAMPAIGN_ENDED":
        return "A campanha já terminou. Ajuste as datas de início e fim antes de ativá-la.";
      case "INVALID_TRANSITION":
        return "A situação da campanha mudou. A lista foi atualizada: confira e tente de novo.";
      default:
        break;
    }
    if (error.status === 403) return "Somente o Mestre do grupo pode gerenciar patrocinadores.";
    if (error.status === 404) return "Registro não encontrado (ele pode ter sido excluído). A lista foi atualizada.";
    if (error.status === 413) return "A imagem é grande demais. O limite é 250 KB.";
    if (error.status === 429) return "Muitas tentativas seguidas. Aguarde um instante e tente de novo.";
    return error.message || fallback;
  }
  if (error instanceof TypeError) return "Sem conexão com o servidor. Verifique a internet e tente de novo.";
  return errorMessage(error, fallback);
}

// ---------------------------------------------------------------- consultas

/** GET /group-sponsors/terms: texto vigente, aceite do grupo e bloqueio da plataforma. */
export function useTerms(enabled = true) {
  return useQuery({
    queryKey: sponsorKeys.terms(),
    queryFn: () => api.get<SponsorTerms>(TERMS_PATH),
    enabled,
    staleTime: 30_000,
    retry: false,
  });
}

/** GET /group-sponsors?q&limit&offset (array + X-Total-Count). */
export function useSponsors(params: SponsorListParams, enabled = true) {
  return useQuery({
    queryKey: sponsorKeys.sponsors(params),
    queryFn: () => api.getPage<GroupSponsor>(SPONSORS_PATH, { q: params.q, limit: LIST_LIMIT, offset: 0 }),
    enabled,
    retry: false,
  });
}

/** GET /group-sponsor-campaigns?effective&sponsorId&q&limit&offset. */
export function useCampaigns(params: CampaignListParams, enabled = true) {
  return useQuery({
    queryKey: sponsorKeys.campaigns(params),
    queryFn: () =>
      api.getPage<GroupCampaign>(CAMPAIGNS_PATH, {
        effective: params.effective,
        sponsorId: params.sponsorId,
        q: params.q,
        limit: LIST_LIMIT,
        offset: 0,
      }),
    enabled,
    retry: false,
  });
}

/** GET /group-sponsor-campaigns/:id/report?from&to. */
export function useCampaignReport(id: number | null, range: { from: string; to: string }, enabled = true) {
  return useQuery({
    queryKey: sponsorKeys.report(id ?? 0, range),
    queryFn: () => api.get<CampaignReport>(`${CAMPAIGNS_PATH}/${String(id)}/report${buildQuery(range)}`),
    enabled: enabled && id !== null && range.from !== "" && range.to !== "" && range.from <= range.to,
    retry: false,
  });
}

// ---------------------------------------------------------------- mutações

/** Depois de qualquer escrita, refaz termo, listas e relatórios (o servidor é a fonte da verdade). */
function useInvalidate() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ROOT });
}

/** Erros que indicam que o termo/bloqueio mudou no servidor: recarrega o termo. */
function useRefreshOnStaleState() {
  const queryClient = useQueryClient();
  return (error: unknown) => {
    if (
      error instanceof ApiError &&
      (error.code === "TERMS_VERSION_MISMATCH" || error.code === "SPONSOR_TERMS_REQUIRED" || error.code === "SPONSORS_BLOCKED")
    ) {
      void queryClient.invalidateQueries({ queryKey: sponsorKeys.terms() });
    }
    if (error instanceof ApiError && (error.status === 404 || error.code === "INVALID_TRANSITION" || error.code === "SUSPENDED_BY_PLATFORM")) {
      void queryClient.invalidateQueries({ queryKey: ROOT });
    }
  };
}

/** POST /group-sponsors/terms/accept {version}: 409 TERMS_VERSION_MISMATCH recarrega o termo. */
export function useAcceptTerms() {
  const invalidate = useInvalidate();
  const refresh = useRefreshOnStaleState();
  return useMutation({
    mutationFn: (version: string) => api.post<unknown>(`${TERMS_PATH}/accept`, { version }),
    onSuccess: () => void invalidate(),
    onError: refresh,
  });
}

export function useSponsorMutations() {
  const invalidate = useInvalidate();
  const refresh = useRefreshOnStaleState();
  const options = { onSuccess: () => void invalidate(), onError: refresh };
  return {
    create: useMutation({ mutationFn: (body: unknown) => api.post<GroupSponsor>(SPONSORS_PATH, body), ...options }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: number; body: unknown }) => api.patch<GroupSponsor>(`${SPONSORS_PATH}/${String(id)}`, body),
      ...options,
    }),
    remove: useMutation({ mutationFn: (id: number) => api.delete<void>(`${SPONSORS_PATH}/${String(id)}`), ...options }),
  };
}

export function useCampaignMutations() {
  const invalidate = useInvalidate();
  const refresh = useRefreshOnStaleState();
  const options = { onSuccess: () => void invalidate(), onError: refresh };
  const action = (name: "activate" | "pause" | "resume") => (id: number) =>
    api.post<GroupCampaign>(`${CAMPAIGNS_PATH}/${String(id)}/${name}`);
  return {
    create: useMutation({ mutationFn: (body: unknown) => api.post<GroupCampaign>(CAMPAIGNS_PATH, body), ...options }),
    update: useMutation({
      mutationFn: ({ id, body }: { id: number; body: unknown }) => api.patch<GroupCampaign>(`${CAMPAIGNS_PATH}/${String(id)}`, body),
      ...options,
    }),
    remove: useMutation({ mutationFn: (id: number) => api.delete<void>(`${CAMPAIGNS_PATH}/${String(id)}`), ...options }),
    activate: useMutation({ mutationFn: action("activate"), ...options }),
    pause: useMutation({ mutationFn: action("pause"), ...options }),
    resume: useMutation({ mutationFn: action("resume"), ...options }),
  };
}

// ---------------------------------------------------------------- upload e CSV

/**
 * Envia a imagem do GRUPO (POST /uploads, multipart "file") e devolve o caminho `/api/uploads/<arquivo>` a gravar em
 * `logo`/`imageRef`. Recusa no navegador arquivo > 250 KB ou que não seja JPEG/PNG/WebP (o servidor confere de novo).
 */
export async function uploadSponsorImage(file: Blob): Promise<string> {
  const invalid = validateSponsorImageFile(file);
  if (invalid) throw new ApiError(invalid, 400);
  const form = new FormData();
  form.append("file", file, uploadFileName(file));
  const result = await api.postForm<{ url: string }>(UPLOAD_PATH, form);
  return result.url;
}

/** Caminho gravado (`/api/uploads/...`) -> `src` do <img> (em desenvolvimento a API fica em outra origem). */
export const sponsorImageSrc = (ref: string | null | undefined): string => {
  const value = ref?.trim() ?? "";
  return value && isUploadPath(value) ? uploadImageSrc(value) : value;
};

/** GET autenticado de `report.csv` (Blob com Bearer) e entrega como `campanha-<id>-<from>_a_<to>.csv`. */
export async function downloadCampaignCsv(id: number, range: { from: string; to: string }): Promise<void> {
  const blob = await api.getBlob(`${CAMPAIGNS_PATH}/${String(id)}/report.csv${buildQuery(range)}`);
  saveBlob(reportCsvFilename(id, range), blob);
}
