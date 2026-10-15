import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, Copy, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";
import {
  BODY_MAX,
  BODY_MIN,
  EMOJI_MAX,
  TEMPLATE_LIMIT,
  TITLE_MAX,
  TITLE_MIN,
  templateTitle,
  useQuickTemplates,
  useTemplateMutations,
  type QuickTemplate,
} from "./aviso-api";

/**
 * Faixa de MODELOS do Aviso rápido: chips com rolagem horizontal (sem estourar a largura da página no celular).
 * Tocar num modelo só PREENCHE título e mensagem (o chamador decide o resto); "Gerenciar modelos" só aparece para o MESTRE.
 */
export function TemplateStrip({
  templates,
  loading,
  selectedId,
  onPick,
  onManage,
}: {
  templates: QuickTemplate[];
  loading: boolean;
  selectedId: number | string | null;
  onPick: (template: QuickTemplate) => void;
  onManage?: (() => void) | undefined;
}) {
  // Sem modelos (ou a lista falhou): a faixa some e o aviso segue manual como sempre foi.
  if (!loading && templates.length === 0) return null;
  return (
    <div className="min-w-0 space-y-1.5" data-testid="quick-notice-templates">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium leading-none">Modelos</p>
        {onManage && (
          <Button type="button" variant="link" size="sm" className="h-auto p-0 text-xs" onClick={onManage}>
            Gerenciar modelos
          </Button>
        )}
      </div>
      {loading ? (
        <Skeleton className="h-9 w-full" />
      ) : (
        <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" aria-label="Modelos de aviso">
          {templates.map((t) => {
            const selected = selectedId === t.id;
            return (
              <li key={t.id} className="shrink-0">
                <button
                  type="button"
                  title={t.body}
                  aria-pressed={selected}
                  onClick={() => onPick(t)}
                  className={`max-w-[15rem] truncate rounded-full border px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                    selected ? "border-primary bg-primary/10 font-semibold text-primary" : "bg-card hover:bg-muted"
                  }`}
                >
                  {t.emoji ? `${t.emoji} ` : ""}
                  {t.title}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

interface Draft {
  /** undefined = modelo novo. */
  id?: number | string;
  emoji: string;
  title: string;
  body: string;
}

const draftOf = (t: QuickTemplate, asCopy = false): Draft => ({
  ...(asCopy ? {} : { id: t.id }),
  emoji: t.emoji ?? "",
  title: t.title,
  body: t.body,
});

/**
 * Gerenciador de modelos (só MESTRE): criar, editar, reordenar (subir/descer) e apagar com confirmação NA LINHA
 * (um AlertDialog sairia do Popover/Sheet do aviso e fecharia o painel). Os modelos padrão são somente leitura;
 * "Duplicar" abre um modelo novo já preenchido.
 */
export function TemplateManager({ onBack }: { onBack: () => void }) {
  const templates = useQuickTemplates();
  const { create, update, remove, reorder } = useTemplateMutations();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmId, setConfirmId] = useState<number | string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const all = templates.data ?? [];
  const own = all.filter((t) => !t.builtin);
  const builtins = all.filter((t) => t.builtin);
  const atLimit = own.length >= TEMPLATE_LIMIT;
  const busy = create.isPending || update.isPending || remove.isPending || reorder.isPending;

  const title = draft?.title.trim() ?? "";
  const body = draft?.body.trim() ?? "";
  const draftOk = draft !== null && title.length >= TITLE_MIN && title.length <= TITLE_MAX && body.length >= BODY_MIN && body.length <= BODY_MAX;

  async function run(action: () => Promise<unknown>, done?: string): Promise<boolean> {
    setError(null);
    try {
      await action();
      if (done) toast.success(done);
      return true;
    } catch (e) {
      setError(errorMessage(e, "Não foi possível concluir. Tente novamente."));
      return false;
    }
  }

  async function save() {
    if (!draft || !draftOk) return;
    const input = { title, body, emoji: draft.emoji.trim() || null };
    const ok = await run(
      () => (draft.id === undefined ? create.mutateAsync(input) : update.mutateAsync({ id: draft.id, ...input })),
      draft.id === undefined ? "Modelo criado." : "Modelo atualizado.",
    );
    if (ok) setDraft(null);
  }

  function move(index: number, delta: -1 | 1) {
    const next = [...own];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    void run(() => reorder.mutateAsync(next));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="quick-notice-manager">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3">
        <Button type="button" variant="ghost" size="icon" aria-label="Voltar ao aviso" onClick={onBack}>
          <ChevronLeft />
        </Button>
        <h2 className="font-display text-base font-extrabold">Gerenciar modelos</h2>
      </div>

      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {error && (
          <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        {draft ? (
          <div className="space-y-3 rounded-lg border p-3" data-testid="template-editor">
            <p className="text-sm font-semibold">{draft.id === undefined ? "Novo modelo" : "Editar modelo"}</p>
            <div className="flex gap-2">
              <Input
                aria-label="Emoji do modelo"
                className="w-16 shrink-0 text-center"
                value={draft.emoji}
                maxLength={EMOJI_MAX}
                placeholder="🙂"
                onChange={(e) => setDraft({ ...draft, emoji: e.target.value })}
              />
              <Input
                aria-label="Título do modelo"
                className="min-w-0"
                value={draft.title}
                maxLength={TITLE_MAX + 20}
                placeholder="Título do aviso"
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              />
            </div>
            <Textarea
              aria-label="Mensagem do modelo"
              rows={3}
              value={draft.body}
              maxLength={BODY_MAX + 40}
              placeholder="Mensagem que os alunos vão receber."
              onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Título de {TITLE_MIN} a {TITLE_MAX} e mensagem de {BODY_MIN} a {BODY_MAX} caracteres.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setDraft(null)}>
                Cancelar
              </Button>
              <Button type="button" size="sm" disabled={!draftOk || busy} onClick={() => void save()}>
                {busy && <Loader2 className="animate-spin" />}
                Salvar modelo
              </Button>
            </div>
          </div>
        ) : (
          <Button type="button" size="sm" disabled={atLimit} onClick={() => setDraft({ emoji: "", title: "", body: "" })}>
            <Plus /> Novo modelo
          </Button>
        )}
        {atLimit && !draft && (
          <p className="text-xs text-muted-foreground">Limite de {TEMPLATE_LIMIT} modelos do grupo. Apague algum para criar outro.</p>
        )}

        <section className="space-y-2" aria-label="Modelos do grupo">
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Modelos do grupo ({own.length}/{TEMPLATE_LIMIT})
          </h3>
          {templates.isLoading && <Skeleton className="h-16 w-full" />}
          {templates.error && <p className="text-sm text-destructive">{errorMessage(templates.error, "Não foi possível carregar os modelos.")}</p>}
          {!templates.isLoading && own.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum modelo do grupo ainda. Crie um ou duplique um dos padrão abaixo.</p>
          )}
          <ul className="space-y-2">
            {own.map((t, index) => (
              <li key={t.id} className="rounded-lg border p-2.5" data-testid="own-template">
                <p className="truncate text-sm font-semibold">
                  {t.emoji ? `${t.emoji} ` : ""}
                  {t.title}
                </p>
                <p className="line-clamp-2 break-words text-xs text-muted-foreground">{t.body}</p>
                {confirmId === t.id ? (
                  <div className="mt-2 flex flex-wrap items-center justify-end gap-2">
                    <span className="mr-auto text-xs font-medium text-destructive">Apagar este modelo?</span>
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => setConfirmId(null)}>
                      Não
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={busy}
                      onClick={() => void run(() => remove.mutateAsync(t.id), "Modelo apagado.").then(() => setConfirmId(null))}
                    >
                      Sim, apagar
                    </Button>
                  </div>
                ) : (
                  <div className="mt-2 flex items-center justify-end gap-1">
                    <Button type="button" variant="ghost" size="icon" aria-label={`Subir ${t.title}`} disabled={busy || index === 0} onClick={() => move(index, -1)}>
                      <ArrowUp />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Descer ${t.title}`} disabled={busy || index === own.length - 1} onClick={() => move(index, 1)}>
                      <ArrowDown />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Editar ${t.title}`} disabled={busy} onClick={() => setDraft(draftOf(t))}>
                      <Pencil />
                    </Button>
                    <Button type="button" variant="ghost" size="icon" aria-label={`Apagar ${t.title}`} disabled={busy} onClick={() => setConfirmId(t.id)}>
                      <Trash2 className="text-destructive" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="space-y-2" aria-label="Modelos padrão do sistema">
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Modelos padrão do sistema</h3>
          <ul className="space-y-2">
            {builtins.map((t) => (
              <li key={t.id} className="flex items-start gap-2 rounded-lg border bg-muted/30 p-2.5" data-testid="builtin-template">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{templateTitle(t)}</p>
                  <p className="line-clamp-2 break-words text-xs text-muted-foreground">{t.body}</p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Duplicar ${t.title}`}
                  disabled={busy || atLimit}
                  onClick={() => setDraft(draftOf(t, true))}
                >
                  <Copy />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
