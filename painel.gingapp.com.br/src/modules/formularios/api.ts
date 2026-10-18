import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { ApiError, api, errorMessage, type QueryParams } from "@/lib/api";
import { useSessionUser } from "@/lib/session";
import type { EventItem } from "@/modules/eventos/types";
import {
  FALLBACK_TEMPLATES,
  type CreateFormPayload,
  type FormDefinition,
  type FormListItem,
  type FormSummary,
  type FormTemplate,
  type Id,
  type SubmissionAction,
  type SubmissionDetail,
  type SubmissionListItem,
  type SubmissionStatus,
} from "./types";
import type { toPayload } from "./builder";

/** Raiz de todas as chaves de cache do módulo (uma invalidação refaz lista, editor, resumo e inscrições). */
const ROOT = ["event-forms"] as const;

export const formKeys = {
  root: ROOT,
  list: (params: QueryParams) => [...ROOT, "list", params] as const,
  templates: () => [...ROOT, "templates"] as const,
  detail: (id: Id) => [...ROOT, "detail", String(id)] as const,
  summary: (id: Id) => [...ROOT, "summary", String(id)] as const,
  submissions: (id: Id, params: QueryParams) =>
    [...ROOT, "submissions", String(id), params] as const,
  submissionsOf: (id: Id) => [...ROOT, "submissions", String(id)] as const,
  submission: (id: Id, sid: Id) => [...ROOT, "submission", String(id), String(sid)] as const,
  eventOptions: () => ["event-forms-event-options"] as const,
};

// ---------------------------------------------------------------- mensagens

const FRIENDLY_CODES: Record<string, string> = {
  VALIDATION: "Alguns dados estão inválidos. Confira os pontos indicados.",
  FORM_HAS_SUBMISSIONS:
    "Este formulário já tem inscrições e não pode ser excluído. Arquive-o para tirá-lo do ar.",
  PAYMENT_MODE_NOT_AVAILABLE:
    "O Pix automático ainda não está disponível. Escolha Pix manual ou Sem pagamento.",
  FORM_HAS_CONFIRMED:
    "Este formulário já tem inscrições confirmadas: não é possível trocar o evento.",
  CONSENT_OUTDATED: "O termo foi atualizado. Leia e aceite novamente.",
};

/** Mensagens de 403 por ação: comprovantes, CSV, pagamento e anonimização são SÓ do Mestre. */
export const FORBIDDEN_MESSAGE = {
  file: "Somente o Mestre pode ver os comprovantes.",
  csv: "Somente o Mestre pode exportar as inscrições em CSV.",
  payment: "Somente o Mestre pode confirmar pagamentos.",
  anonymize: "Somente o Mestre pode anonimizar inscrições.",
} as const;

/** O papel da sessão é o Mestre? (a autorização real é do backend: isto só esconde o que daria 403.) */
export function useIsMestre(): boolean {
  return useSessionUser()?.role === "MESTRE";
}

/**
 * VALIDATION do backend real: `fields` é um objeto `{ <chave do campo | configuração>: mensagem }` (ex.: no "Publicar":
 * `{ priceCents: "Informe o valor da inscrição.", pixKey: "Informe a chave Pix." }`). Resume as 3 primeiras para o toast.
 */
export function validationSummary(error: ApiError): string | null {
  const fields = error.body?.["fields"];
  if (!fields || typeof fields !== "object") return null;
  const messages = Object.values(fields as Record<string, unknown>).filter(
    (m): m is string => typeof m === "string" && m !== "",
  );
  if (messages.length === 0) return null;
  const rest = messages.length - 3;
  return `${messages.slice(0, 3).join(" ")}${rest > 0 ? ` (+${String(rest)})` : ""}`;
}

/** Mensagem amigável por código de negócio, depois por status HTTP e, por fim, a do servidor/fallback. */
export function formsErrorMessage(error: unknown, fallback?: string, forbidden?: string): string {
  const generic = fallback ?? "Algo deu errado. Tente novamente.";
  if (error instanceof ApiError) {
    if (error.code && FRIENDLY_CODES[error.code]) return FRIENDLY_CODES[error.code]!;
    if (error.status === 403)
      return forbidden ?? "Você não tem permissão para gerenciar formulários de inscrição.";
    // 404: quem chama diz o que não foi encontrado (formulário, inscrição, arquivo…).
    if (error.status === 404) return fallback ?? "Não encontrado. Talvez tenha sido excluído.";
    if (error.status === 429)
      return "Muitas tentativas seguidas. Aguarde um instante e tente de novo.";
    return error.message || generic;
  }
  if (error instanceof TypeError)
    return "Sem conexão com o servidor. Verifique a internet e tente de novo.";
  return errorMessage(error, generic);
}

export function notifyFormsError(error: unknown, fallback?: string, forbidden?: string): void {
  toast.error(formsErrorMessage(error, fallback, forbidden));
}

export const isValidationError = (error: unknown): error is ApiError =>
  error instanceof ApiError && error.code === "VALIDATION";

// ------------------------------------------------------------- formulários

export function useForms(params: QueryParams) {
  const query = useQuery({
    queryKey: formKeys.list(params),
    queryFn: () => api.getPage<FormListItem>("/event-forms", params),
    placeholderData: keepPreviousData,
  });
  return {
    items: query.data?.items,
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}

/** Modelos: se o servidor não responder, usa a lista embutida (o cartão de modelo continua funcionando). */
export function useTemplates(enabled = true): FormTemplate[] {
  const query = useQuery({
    queryKey: formKeys.templates(),
    queryFn: () => api.get<FormTemplate[]>("/event-forms/templates"),
    enabled,
    staleTime: 10 * 60 * 1000,
  });
  return query.data && query.data.length > 0 ? query.data : [...FALLBACK_TEMPLATES];
}

export function useCreateForm() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateFormPayload) => api.post<FormDefinition>("/event-forms", payload),
    onSuccess: () => void client.invalidateQueries({ queryKey: ROOT }),
    onError: (error) => notifyFormsError(error, "Não foi possível criar o formulário."),
  });
}

export function useFormDefinition(id: Id) {
  return useQuery({
    queryKey: formKeys.detail(id),
    queryFn: () => api.get<FormDefinition>(`/event-forms/${String(id)}`),
  });
}

export type SavePayload = ReturnType<typeof toPayload>;

/** Salva a definição ATÔMICA (PUT) e coloca a resposta no cache; o erro é tratado pelo editor (VALIDATION por campo). */
export function useSaveForm(id: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (payload: SavePayload) =>
      api.put<FormDefinition>(`/event-forms/${String(id)}`, payload),
    onSuccess: (definition) => {
      if (definition && typeof definition === "object")
        client.setQueryData(formKeys.detail(id), definition);
      void client.invalidateQueries({ queryKey: [...ROOT, "list"] });
    },
  });
}

export type FormAction = "open" | "close" | "archive" | "duplicate";

const ACTION_DONE: Record<FormAction, string> = {
  open: "Formulário aberto para inscrições.",
  close: "Inscrições encerradas.",
  archive: "Formulário arquivado.",
  duplicate: "Formulário duplicado.",
};

export function useFormAction() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: Id; action: FormAction }) =>
      api.post<Partial<FormDefinition> | undefined>(`/event-forms/${String(id)}/${action}`),
    onSuccess: (_data, { action }) => {
      void client.invalidateQueries({ queryKey: ROOT });
      toast.success(ACTION_DONE[action]);
    },
    // "Publicar" recusado (400 VALIDATION com `fields`): o toast diz O QUE falta (preço, chave Pix…), não só "inválido".
    onError: (error) =>
      isValidationError(error) && validationSummary(error)
        ? toast.error(validationSummary(error)!)
        : notifyFormsError(error),
  });
}

export function useDeleteForm() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: Id) => api.delete<void>(`/event-forms/${String(id)}`),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ROOT });
      toast.success("Formulário excluído.");
    },
    // FORM_HAS_SUBMISSIONS é tratado pela tela (oferece Arquivar); aqui só os demais erros viram toast.
    onError: (error) => {
      if (!(error instanceof ApiError && error.code === "FORM_HAS_SUBMISSIONS"))
        notifyFormsError(error);
    },
  });
}

// ---------------------------------------------------------------- inscrições

export function useSummary(id: Id) {
  return useQuery({
    queryKey: formKeys.summary(id),
    queryFn: () => api.get<FormSummary>(`/event-forms/${String(id)}/summary`),
  });
}

export function useSubmissions(id: Id, params: QueryParams) {
  const query = useQuery({
    queryKey: formKeys.submissions(id, params),
    queryFn: () =>
      api.getPage<SubmissionListItem>(`/event-forms/${String(id)}/submissions`, params),
    placeholderData: keepPreviousData,
  });
  return {
    items: query.data?.items,
    total: query.data?.total ?? 0,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}

export function useSubmission(id: Id, sid: Id | null) {
  return useQuery({
    queryKey: formKeys.submission(id, sid ?? ""),
    queryFn: () =>
      api.get<SubmissionDetail>(`/event-forms/${String(id)}/submissions/${String(sid)}`),
    enabled: sid !== null,
    // Cada GET do detalhe grava uma linha de auditoria (acesso a dado pessoal): sem refazê-lo a cada foco da janela.
    // As ações/nota continuam atualizando (invalidateQueries) e as respostas das ações já devolvem o detalhe.
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  });
}

/** O que a ação muda na tela antes de o servidor responder (promover fica de fora: quem decide o destino é o servidor). */
const OPTIMISTIC: Partial<
  Record<SubmissionAction, { status?: SubmissionStatus; paymentStatus?: "CONFIRMED" }>
> = {
  "confirm-payment": { paymentStatus: "CONFIRMED" },
  approve: { status: "CONFIRMED" },
  reject: { status: "REJECTED" },
  cancel: { status: "CANCELLED" },
  waitlist: { status: "WAITLIST" },
};

function patchCached(
  client: QueryClient,
  id: Id,
  sid: Id,
  patch: { status?: SubmissionStatus; paymentStatus?: "CONFIRMED" },
) {
  client.setQueriesData<{ items: SubmissionListItem[]; total: number }>(
    { queryKey: formKeys.submissionsOf(id) },
    (old) =>
      old
        ? {
            ...old,
            items: old.items.map((item) =>
              String(item.id) === String(sid) ? { ...item, ...patch } : item,
            ),
          }
        : old,
  );
  client.setQueryData<SubmissionDetail>(formKeys.submission(id, sid), (old) =>
    old ? { ...old, ...patch } : old,
  );
}

const SUBMISSION_ACTION_DONE: Record<SubmissionAction, string> = {
  "confirm-payment": "Pagamento confirmado.",
  approve: "Inscrição aprovada.",
  reject: "Inscrição recusada.",
  cancel: "Inscrição cancelada.",
  waitlist: "Inscrição movida para a lista de espera.",
  promote: "Inscrição promovida da lista de espera.",
};

export function useSubmissionAction(formId: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      sid,
      action,
      reason,
      linkStudentId,
    }: {
      sid: Id;
      action: SubmissionAction;
      reason?: string;
      /** Só em `confirm-payment`/`approve`: vincula a inscrição à ficha deste aluno (opcional). */
      linkStudentId?: number;
    }) =>
      api.post<unknown>(
        `/event-forms/${String(formId)}/submissions/${String(sid)}/${action}`,
        action === "reject"
          ? { reason: reason || undefined }
          : (action === "confirm-payment" || action === "approve") && linkStudentId !== undefined
            ? { linkStudentId }
            : undefined,
      ),
    onMutate: async ({ sid, action }) => {
      const patch = OPTIMISTIC[action];
      if (!patch) return undefined;
      await client.cancelQueries({ queryKey: [...ROOT, "submissions", String(formId)] });
      const snapshot = client.getQueriesData({
        queryKey: [...ROOT, "submissions", String(formId)],
      });
      const detail = client.getQueryData<SubmissionDetail>(formKeys.submission(formId, sid));
      patchCached(client, formId, sid, patch);
      return { snapshot, detail, sid };
    },
    onError: (error, vars, context) => {
      if (context) {
        for (const [key, data] of context.snapshot) client.setQueryData(key, data);
        if (context.detail)
          client.setQueryData(formKeys.submission(formId, context.sid), context.detail);
      }
      notifyFormsError(
        error,
        undefined,
        vars.action === "confirm-payment" ? FORBIDDEN_MESSAGE.payment : undefined,
      );
    },
    onSuccess: (_data, { action }) => toast.success(SUBMISSION_ACTION_DONE[action]),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: formKeys.submissionsOf(formId) });
      void client.invalidateQueries({ queryKey: [...ROOT, "submission", String(formId)] });
      void client.invalidateQueries({ queryKey: formKeys.summary(formId) });
      void client.invalidateQueries({ queryKey: [...ROOT, "list"] });
    },
  });
}

/** Anonimiza a inscrição (só Mestre): remove nome, contatos, respostas e anexos; mantém protocolo e contagem. */
export function useAnonymizeSubmission(formId: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (sid: Id) =>
      api.post<SubmissionDetail | undefined>(
        `/event-forms/${String(formId)}/submissions/${String(sid)}/anonymize`,
      ),
    onSuccess: (detail, sid) => {
      if (detail && typeof detail === "object" && "protocol" in detail)
        client.setQueryData(formKeys.submission(formId, sid), detail);
      // Os comprovantes já baixados (blobs em cache) deixam de existir no servidor: não os mantém na memória.
      client.removeQueries({ queryKey: [...ROOT, "file", String(formId), String(sid)] });
      toast.success("Inscrição anonimizada.");
    },
    onError: (error) =>
      notifyFormsError(error, "Não foi possível anonimizar a inscrição.", FORBIDDEN_MESSAGE.anonymize),
    onSettled: () => {
      void client.invalidateQueries({ queryKey: formKeys.submissionsOf(formId) });
      void client.invalidateQueries({ queryKey: [...ROOT, "submission", String(formId)] });
      void client.invalidateQueries({ queryKey: formKeys.summary(formId) });
    },
  });
}

export function useSaveInternalNote(formId: Id) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ sid, internalNote }: { sid: Id; internalNote: string }) =>
      api.patch<unknown>(`/event-forms/${String(formId)}/submissions/${String(sid)}`, {
        internalNote,
      }),
    onSuccess: (_d, { sid, internalNote }) => {
      client.setQueryData<SubmissionDetail>(formKeys.submission(formId, sid), (old) =>
        old ? { ...old, internalNote } : old,
      );
      toast.success("Nota salva.");
    },
    onError: (error) => notifyFormsError(error, "Não foi possível salvar a nota."),
  });
}

/** Arquivo privado (comprovante): baixado com o token e entregue como blob (a rota exige Authorization). */
export function useSubmissionFile(formId: Id, sid: Id, fileId: Id | null) {
  return useQuery({
    queryKey: [...ROOT, "file", String(formId), String(sid), String(fileId)],
    queryFn: () =>
      api.getBlob(
        `/event-forms/${String(formId)}/submissions/${String(sid)}/files/${String(fileId)}`,
      ),
    enabled: fileId !== null,
    staleTime: Infinity,
    gcTime: 60_000,
    retry: false,
  });
}

// -------------------------------------------------------------------- eventos

/** Eventos para o seletor "Evento (opcional)": até 100, os mais recentes primeiro (o servidor já ordena). */
export function useEventOptions(enabled = true) {
  return useQuery({
    queryKey: formKeys.eventOptions(),
    queryFn: async () => (await api.getPage<EventItem>("/events", { limit: 100, offset: 0 })).items,
    enabled,
    staleTime: 60_000,
  });
}
