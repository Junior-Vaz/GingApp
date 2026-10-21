import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

export const AUDIENCE_SCOPES = ["GROUP", "UNIT", "CLASS", "ROLE", "STUDENTS"] as const;
export type AudienceScope = (typeof AUDIENCE_SCOPES)[number];

export const SCOPE_LABEL: Record<AudienceScope, string> = {
  GROUP: "Todo o grupo",
  UNIT: "Unidade",
  CLASS: "Turma",
  ROLE: "Perfil",
  STUDENTS: "Alunos específicos",
};

export const TITLE_MIN = 2;
export const TITLE_MAX = 80;
export const BODY_MIN = 2;
export const BODY_MAX = 280;

/** Corpo de POST /notifications/send. */
export interface NoticeAudience {
  scope: AudienceScope;
  unitId?: number;
  classId?: number;
  audienceRole?: string;
  studentIds?: number[];
}
export interface SendNoticeInput {
  title: string;
  body: string;
  audience: NoticeAudience;
  alsoPublish?: boolean;
}
export interface SendNoticeResult {
  sent: number;
  announcementId: number | null;
}

/** Monta o `audience` do POST /notifications/send; `null` = falta escolher o alvo do alcance. */
export function buildAudience(form: {
  scope: AudienceScope;
  unitId: string;
  classId: string;
  role: string;
  students: { id: number }[];
}): NoticeAudience | null {
  switch (form.scope) {
    case "GROUP":
      return { scope: "GROUP" };
    case "UNIT":
      return form.unitId ? { scope: "UNIT", unitId: Number(form.unitId) } : null;
    case "CLASS":
      return form.classId ? { scope: "CLASS", classId: Number(form.classId) } : null;
    case "ROLE":
      return form.role ? { scope: "ROLE", audienceRole: form.role } : null;
    case "STUDENTS":
      return form.students.length > 0 ? { scope: "STUDENTS", studentIds: form.students.map((s) => s.id) } : null;
  }
}

/** GET /notifications/audiences: opções para os alcances Unidade/Turma/Perfil. */
export interface Audiences {
  units: { id: number; name: string }[];
  classes: { id: number; name: string; unitId: number | null }[];
  /** O backend manda `{value,label}`; aceita-se texto simples por compatibilidade. */
  roles: (string | { value: string; label: string })[];
  /** false = professor restrito a unidades: não pode enviar para o grupo inteiro. */
  groupWide?: boolean;
}

export const AUDIENCES_KEY = ["notifications", "audiences"] as const;

/**
 * `ownClasses` (Comunicar): para Professor/Instrutor o servidor devolve só as turmas que ele leciona (as outras dariam 403
 * ao enviar). O Mestre recebe todas do mesmo jeito. Chave de cache própria para não misturar com o aviso rápido.
 */
export function useAudiences(enabled = true, options: { ownClasses?: boolean } = {}) {
  const own = options.ownClasses === true;
  return useQuery({
    queryKey: own ? ([...AUDIENCES_KEY, "own"] as const) : AUDIENCES_KEY,
    queryFn: () => api.get<Audiences>(own ? "/notifications/audiences?own=1" : "/notifications/audiences"),
    enabled,
    staleTime: 60_000,
  });
}

/** POST /notifications/send. Com `alsoPublish`, o comunicado criado entra na lista do mural (invalida /announcements). */
export function useSendNotice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SendNoticeInput) => api.post<SendNoticeResult>("/notifications/send", input),
    onSuccess: (result) => {
      if (result?.announcementId) void queryClient.invalidateQueries({ queryKey: ["crud", "/announcements"] });
    },
  });
}

// ---------------------------------------------------------------------------------------------
// MODELOS de aviso rápido (GET/POST/PATCH/DELETE /notifications/quick-templates)
// ---------------------------------------------------------------------------------------------

/** Item da listagem: `id` numérico = modelo do grupo; "builtin:*" = padrão do sistema (somente leitura). */
export interface QuickTemplate {
  id: number | string;
  title: string;
  body: string;
  emoji: string | null;
  sortOrder: number;
  builtin: boolean;
}
export interface QuickTemplateInput {
  title: string;
  body: string;
  emoji?: string | null;
  sortOrder?: number;
}

/** Teto de modelos próprios por grupo (espelha o backend). */
export const TEMPLATE_LIMIT = 30;
export const EMOJI_MAX = 8;

export const TEMPLATES_KEY = ["notifications", "quick-templates"] as const;

/** Modelos do grupo (primeiro) + padrão do sistema. Qualquer papel que envia aviso rápido pode listar. */
export function useQuickTemplates(enabled = true) {
  return useQuery({
    queryKey: TEMPLATES_KEY,
    queryFn: () => api.get<QuickTemplate[]>("/notifications/quick-templates"),
    enabled,
    staleTime: 60_000,
  });
}

/** Cria/edita/apaga/reordena (só MESTRE no backend). Toda escrita invalida a lista de modelos. */
export function useTemplateMutations() {
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: TEMPLATES_KEY });
  const create = useMutation({
    mutationFn: (input: QuickTemplateInput) => api.post<QuickTemplate>("/notifications/quick-templates", input),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, ...input }: Partial<QuickTemplateInput> & { id: number | string }) =>
      api.patch<QuickTemplate>(`/notifications/quick-templates/${id}`, input),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: (id: number | string) => api.delete<{ id: number }>(`/notifications/quick-templates/${id}`),
    onSuccess: invalidate,
  });
  /** Grava a nova ordem (sortOrder = posição) só nos itens que mudaram. */
  const reorder = useMutation({
    mutationFn: async (ordered: QuickTemplate[]) => {
      const changed = ordered.map((t, index) => ({ t, index })).filter(({ t, index }) => t.sortOrder !== index);
      await Promise.all(changed.map(({ t, index }) => api.patch(`/notifications/quick-templates/${t.id}`, { sortOrder: index })));
    },
    onSettled: invalidate,
  });
  return { create, update, remove, reorder };
}

const LEADING_EMOJI = /^(\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic}|\p{Emoji_Modifier})*)\s*/u;

/** Separa um emoji no começo do título ("🥋 Treino" => { emoji: "🥋", title: "Treino" }) para guardar como ícone do modelo. */
export function splitLeadingEmoji(text: string): { emoji: string | null; title: string } {
  const trimmed = text.trim();
  const match = LEADING_EMOJI.exec(trimmed);
  if (!match || match[1]!.length > EMOJI_MAX) return { emoji: null, title: trimmed };
  const rest = trimmed.slice(match[0].length).trim();
  return rest.length >= TITLE_MIN ? { emoji: match[1]!, title: rest } : { emoji: null, title: trimmed };
}

/** Título que vai para o formulário ao tocar num modelo: "emoji + título", cortado no limite do envio. */
export function templateTitle(t: Pick<QuickTemplate, "emoji" | "title">): string {
  return `${t.emoji ? `${t.emoji} ` : ""}${t.title}`.slice(0, TITLE_MAX);
}
