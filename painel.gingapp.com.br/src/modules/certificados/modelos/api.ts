import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, api, errorMessage } from "@/lib/api";
import { toWireLayout } from "./layout-utils";
import {
  LIMITS,
  PURPOSE_LABEL,
  type CertificateLayout,
  type CertificatePreset,
  type CertificatePurpose,
  type CertificateTemplate,
  type CertificateTemplateSummary,
  type CreateTemplatePayload,
} from "./types";

/** Raiz das chaves de cache do módulo: uma invalidação refaz lista, detalhe e miniaturas. */
const ROOT = ["certificate-templates"] as const;

export const templateKeys = {
  root: ROOT,
  list: () => [...ROOT, "list"] as const,
  presets: () => [...ROOT, "presets"] as const,
  detail: (id: number | string) => [...ROOT, "detail", String(id)] as const,
};

// ---------------------------------------------------------------- mensagens

/** Mensagem amigável: código de negócio, depois status HTTP e, por fim, a do servidor/fallback. */
export function templatesErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.code === "TEMPLATE_LIMIT")
      return `O grupo já tem ${String(LIMITS.maxTemplates)} modelos. Exclua algum para criar outro.`;
    if (error.status === 403) return "Somente o Mestre e o Professor podem criar e editar modelos de certificado.";
    if (error.status === 404) return fallback;
    if (error.status === 429) return "Muitas pré-visualizações seguidas. Aguarde um instante e tente de novo.";
    return error.message || fallback;
  }
  if (error instanceof TypeError) return "Sem conexão com o servidor. Verifique a internet e tente de novo.";
  return errorMessage(error, fallback);
}

export function notifyTemplatesError(error: unknown, fallback: string): void {
  toast.error(templatesErrorMessage(error, fallback));
}

// ------------------------------------------------------------------ consultas

/** GET /certificate-templates (resumos, sem o desenho). */
export function useTemplates(enabled = true) {
  return useQuery({
    queryKey: templateKeys.list(),
    queryFn: () => api.get<CertificateTemplateSummary[]>("/certificate-templates"),
    enabled,
    staleTime: 30_000,
  });
}

/** GET /certificate-templates/presets (modelos prontos, com o desenho). */
export function usePresets(enabled = true) {
  return useQuery({
    queryKey: templateKeys.presets(),
    queryFn: () => api.get<CertificatePreset[]>("/certificate-templates/presets"),
    enabled,
    staleTime: 10 * 60_000,
  });
}

/** GET /certificate-templates/:id (com o desenho). Também alimenta as miniaturas da lista. */
export function useTemplate(id: number | string | null, enabled = true) {
  return useQuery({
    queryKey: templateKeys.detail(id ?? ""),
    queryFn: () => api.get<CertificateTemplate>(`/certificate-templates/${String(id)}`),
    enabled: enabled && id !== null,
    staleTime: 30_000,
  });
}

// ------------------------------------------------------------------ mutações

/** POST /certificate-templates: `layout` OU `presetKey` (o desenho vai só com as chaves do contrato). */
export function useCreateTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateTemplatePayload) =>
      api.post<CertificateTemplate>(
        "/certificate-templates",
        "layout" in payload ? { ...payload, layout: toWireLayout(payload.layout) } : payload,
      ),
    onSuccess: (created) => {
      if (created && typeof created === "object") client.setQueryData(templateKeys.detail(created.id), created);
      void client.invalidateQueries({ queryKey: templateKeys.list() });
      toast.success("Modelo criado.");
    },
    onError: (error) => notifyTemplatesError(error, "Não foi possível criar o modelo."),
  });
}

export interface UpdateTemplatePayload {
  name?: string;
  purpose?: CertificatePurpose;
  layout?: CertificateLayout;
}

/** PATCH /certificate-templates/:id. O erro é tratado pelo editor (mostra a mensagem do servidor na tela). */
export function useUpdateTemplate(id: number | string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateTemplatePayload) =>
      api.patch<CertificateTemplate>(`/certificate-templates/${String(id)}`, {
        ...(payload.name !== undefined ? { name: payload.name } : {}),
        ...(payload.purpose !== undefined ? { purpose: payload.purpose } : {}),
        ...(payload.layout !== undefined ? { layout: toWireLayout(payload.layout) } : {}),
      }),
    onSuccess: (saved) => {
      if (saved && typeof saved === "object" && "layout" in saved) client.setQueryData(templateKeys.detail(id), saved);
      else void client.invalidateQueries({ queryKey: templateKeys.detail(id) });
      void client.invalidateQueries({ queryKey: templateKeys.list() });
    },
  });
}

/** POST /certificate-templates/:id/duplicate -> 201 cópia (" (cópia)", sem ser padrão). */
export function useDuplicateTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<CertificateTemplate>(`/certificate-templates/${String(id)}/duplicate`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: templateKeys.list() });
      toast.success("Modelo duplicado.");
    },
    onError: (error) => notifyTemplatesError(error, "Não foi possível duplicar o modelo."),
  });
}

/** POST /certificate-templates/:id/default -> marca como padrão do uso (troca o anterior no servidor). */
export function useSetDefaultTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<CertificateTemplate>(`/certificate-templates/${String(id)}/default`),
    onSuccess: (saved) => {
      void client.invalidateQueries({ queryKey: templateKeys.root });
      toast.success(
        saved && typeof saved === "object" && saved.purpose
          ? `Modelo definido como padrão de “${PURPOSE_LABEL[saved.purpose]}”.`
          : "Modelo definido como padrão.",
      );
    },
    onError: (error) => notifyTemplatesError(error, "Não foi possível definir o modelo padrão."),
  });
}

/** DELETE /certificate-templates/:id -> 204 (certificados já emitidos seguem pela cópia do desenho). */
export function useDeleteTemplate() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.delete<void>(`/certificate-templates/${String(id)}`),
    onSuccess: (_data, id) => {
      client.removeQueries({ queryKey: templateKeys.detail(id) });
      void client.invalidateQueries({ queryKey: templateKeys.list() });
      toast.success("Modelo excluído.");
    },
    onError: (error) => notifyTemplatesError(error, "Não foi possível excluir o modelo."),
  });
}

/** POST /certificate-templates/preview { layout } -> PDF (Blob) com dados de exemplo. Limite de 20/min no servidor. */
export function usePreviewPdf() {
  return useMutation({
    mutationFn: (layout: CertificateLayout) =>
      api.postBlob("/certificate-templates/preview", { layout: toWireLayout(layout) }),
  });
}
