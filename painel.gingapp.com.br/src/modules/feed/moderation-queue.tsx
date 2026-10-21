import { useState } from "react";
import { Check, EyeOff, Flag, Loader2, Pin, PinOff, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { EntityAvatar } from "@/components/painel/entity-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmt, toDate } from "@/lib/format";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";
import { feedErrorMessage, flattenQueue, itemKey, useModerate, useQueue, type ModAction } from "./api";
import { PostGallery } from "./post-gallery";
import {
  QUEUE_EMPTY,
  REASON_LABEL,
  STATUS_LABEL,
  VISIBILITY_LABEL,
  type QueueItem,
  type QueueKind,
} from "./types";

const formatDate = (iso: string) => fmt(toDate(iso), "dd/MM/yyyy 'às' HH:mm");
const MAX_NOTES = 5;

interface ActionDef {
  action: ModAction;
  label: string;
  ariaLabel: string;
  icon: typeof Check;
  variant?: "default" | "outline" | "destructive";
  /** Pede confirmação antes (ações que não dá para desfazer). */
  confirm?: boolean;
}

/** Quais ações cada item oferece, por aba e situação (o servidor continua sendo quem autoriza de verdade). */
function actionsFor(item: QueueItem, kind: QueueKind, who: string): ActionDef[] {
  const { post } = item;
  if (item.comment) {
    return [
      {
        action: "dismissComment",
        label: "Manter comentário",
        ariaLabel: `Manter o comentário de ${who} e ignorar as denúncias`,
        icon: ShieldCheck,
      },
      {
        action: "removeComment",
        label: "Remover comentário",
        ariaLabel: `Remover comentário de ${who}`,
        icon: Trash2,
        variant: "destructive",
        confirm: true,
      },
    ];
  }
  if (post.canModerate === false) return [];

  const list: ActionDef[] = [];
  if (kind === "PENDING") {
    list.push({ action: "approve", label: "Aprovar", ariaLabel: `Aprovar publicação de ${who}`, icon: Check });
    list.push({ action: "hide", label: "Ocultar", ariaLabel: `Ocultar publicação de ${who}`, icon: EyeOff, variant: "outline" });
  } else if (kind === "REPORTED") {
    list.push({
      action: "dismiss",
      label: "Manter (ignorar denúncias)",
      ariaLabel: `Manter a publicação de ${who} e ignorar as denúncias`,
      icon: ShieldCheck,
    });
    if (post.status !== "HIDDEN")
      list.push({
        action: "resolveHide",
        label: "Ocultar",
        ariaLabel: `Ocultar publicação de ${who}`,
        icon: EyeOff,
        variant: "outline",
      });
  } else {
    list.push({ action: "restore", label: "Restaurar", ariaLabel: `Restaurar publicação de ${who}`, icon: RotateCcw });
  }
  // Fixar só faz sentido numa publicação visível no feed.
  if (post.status === "PUBLISHED")
    list.push(
      post.pinned
        ? { action: "unpin", label: "Desafixar", ariaLabel: `Desafixar publicação de ${who}`, icon: PinOff, variant: "outline" }
        : { action: "pin", label: "Fixar", ariaLabel: `Fixar publicação de ${who}`, icon: Pin, variant: "outline" },
    );
  list.push({
    action: kind === "REPORTED" ? "resolveRemove" : "remove",
    label: "Remover",
    ariaLabel: `Remover publicação de ${who}`,
    icon: Trash2,
    variant: "destructive",
    confirm: true,
  });
  return list;
}

function ReportsBlock({ item }: { item: QueueItem }) {
  const total = Math.max(item.reportsCount, item.reports.length);
  if (total === 0 && item.reports.length === 0) return null;
  const counts = new Map<string, number>();
  for (const r of item.reports) counts.set(r.reason, (counts.get(r.reason) ?? 0) + 1);
  const notes = item.reports.filter((r) => r.note);
  return (
    <section
      aria-label="Denúncias"
      className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
    >
      <p className="flex items-center gap-1.5 font-medium text-destructive">
        <Flag className="size-4 shrink-0" aria-hidden /> {plural(total, "denúncia")}
      </p>
      {counts.size > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {[...counts].map(([reason, n]) => (
            <li key={reason}>
              <Badge variant="outline" className="whitespace-normal">
                {REASON_LABEL[reason] ?? reason}
                {n > 1 ? ` · ${String(n)}` : ""}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <ul className="space-y-1 text-muted-foreground">
          {notes.slice(0, MAX_NOTES).map((r, index) => (
            <li key={`${r.createdAt}-${String(index)}`} className="break-words">
              “{r.note}” <span className="text-xs">· {formatDate(r.createdAt)}</span>
            </li>
          ))}
          {notes.length > MAX_NOTES && <li className="text-xs">+{notes.length - MAX_NOTES} observações</li>}
        </ul>
      )}
    </section>
  );
}

function QueueCard({
  item,
  kind,
  onAction,
}: {
  item: QueueItem;
  kind: QueueKind;
  onAction: (item: QueueItem, def: ActionDef) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const { post, comment } = item;
  const author = comment ? (comment.author ?? null) : post.author;
  const who = author?.name ?? "autor removido";
  const text = comment ? comment.body : post.body;
  const actions = actionsFor(item, kind, who);

  async function run(def: ActionDef) {
    setBusy(true);
    try {
      await onAction(item, def);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article
      data-testid="queue-item"
      data-post-id={String(post.id)}
      aria-label={comment ? `Comentário de ${who}` : `Publicação de ${who}`}
      className="min-w-0 space-y-3 rounded-lg border bg-card p-3 text-card-foreground shadow-sm sm:p-4"
    >
      <header className="flex min-w-0 items-start gap-3">
        <EntityAvatar name={author?.name ?? ""} photo={author?.photo} className="size-10" />
        <div className="min-w-0 flex-1">
          <p className="break-words font-semibold leading-tight">
            {author ? author.name : "Autor removido"}
            {author?.nickname && <span className="font-normal text-muted-foreground"> ({author.nickname})</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            {author?.roleLabel ? `${author.roleLabel} · ` : ""}
            {formatDate(comment?.createdAt ?? post.createdAt)}
          </p>
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {comment && <Badge variant="destructive">Comentário denunciado</Badge>}
        {comment?.status === "HIDDEN" && <Badge variant="secondary">Comentário oculto</Badge>}
        <Badge variant={post.status === "PENDING_APPROVAL" ? "default" : "secondary"}>{STATUS_LABEL[post.status]}</Badge>
        <Badge variant="outline">{VISIBILITY_LABEL[post.visibility]}</Badge>
        {post.pinned && <Badge variant="outline">Fixado</Badge>}
        {post.edited && <Badge variant="outline">Editado</Badge>}
      </div>

      {comment && (
        <p className="text-xs text-muted-foreground">
          Na publicação de {post.author?.name ?? "autor removido"}
          {post.body ? `: “${post.body.slice(0, 80)}${post.body.length > 80 ? "…" : ""}”` : ""}
        </p>
      )}
      {text ? (
        <p className="whitespace-pre-wrap break-words text-sm">{text}</p>
      ) : !comment && post.media.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">Publicação sem texto.</p>
      ) : null}
      {!comment && <PostGallery media={post.media} authorName={who} />}

      <ReportsBlock item={item} />

      {actions.length > 0 ? (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Ações de moderação">
          {actions.map((def) => (
            <Button
              key={def.action}
              type="button"
              variant={def.variant ?? "default"}
              disabled={busy}
              aria-label={def.ariaLabel}
              className={cn("min-w-0 grow whitespace-normal text-center sm:grow-0")}
              onClick={() => void run(def)}
            >
              <def.icon aria-hidden /> {def.label}
            </Button>
          ))}
        </div>
      ) : (
        post.canModerate === false && (
          <p className="text-xs text-muted-foreground">
            Você pode ver esta publicação, mas só o Mestre decide sobre posts de todo o grupo ou de fora das suas unidades.
          </p>
        )
      )}
    </article>
  );
}

/** Lista de uma aba da fila: carregando, erro, vazio, itens e "Carregar mais" (cursor). */
export function QueueList({ kind }: { kind: QueueKind }) {
  const query = useQueue(kind);
  const moderate = useModerate();
  const [confirming, setConfirming] = useState<{ item: QueueItem; def: ActionDef } | null>(null);
  const items = flattenQueue(query.data);

  const execute = (item: QueueItem, def: ActionDef) =>
    moderate.mutateAsync({ action: def.action, item, kind }).then(
      () => undefined,
      () => undefined, // o toast de erro e o rollback já foram feitos pelo hook
    );

  function handleAction(item: QueueItem, def: ActionDef) {
    if (def.confirm) {
      setConfirming({ item, def });
      return;
    }
    return execute(item, def);
  }

  if (query.isPending) {
    return (
      <div className="space-y-3" role="status" aria-busy="true" aria-label="Carregando publicações">
        {[0, 1].map((n) => (
          <Skeleton key={n} className="h-40 w-full" />
        ))}
      </div>
    );
  }

  // Falha sem nenhum dado carregado substitui a lista; falha em "Carregar mais" ou ao atualizar mantém o que está na tela.
  if (query.isError && query.data === undefined) {
    return (
      <div className="grid gap-3 rounded-lg border border-destructive/30 p-4 text-center">
        <p role="alert" className="text-sm text-destructive">
          {feedErrorMessage(query.error, "Não foi possível carregar a fila de moderação.")}
        </p>
        <Button type="button" variant="outline" className="justify-self-center" onClick={() => void query.refetch()}>
          Tentar de novo
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {QUEUE_EMPTY[kind]}
        </p>
      ) : (
        items.map((item) => <QueueCard key={itemKey(item)} item={item} kind={kind} onAction={handleAction} />)
      )}

      {query.hasNextPage && (
        <div className="flex justify-center">
          <Button
            type="button"
            variant="outline"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? (
              <>
                <Loader2 className="animate-spin" aria-hidden /> Carregando…
              </>
            ) : (
              "Carregar mais"
            )}
          </Button>
        </div>
      )}
      {query.isError && (
        <p role="alert" className="text-center text-sm text-destructive">
          {feedErrorMessage(
            query.error,
            query.isFetchNextPageError
              ? "Não foi possível carregar mais publicações."
              : "Não foi possível atualizar a lista.",
          )}
        </p>
      )}

      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => !open && setConfirming(null)}
        title={confirming?.def.action === "removeComment" ? "Remover o comentário?" : "Remover a publicação?"}
        description={
          confirming?.def.action === "removeComment"
            ? "O comentário some do feed para todo o grupo. Não dá para desfazer pelo painel."
            : "A publicação e as fotos somem do feed para todo o grupo. Não dá para desfazer pelo painel."
        }
        confirmLabel="Remover"
        onConfirm={async () => {
          const target = confirming!;
          await moderate.mutateAsync({ action: target.def.action, item: target.item, kind });
        }}
      />
    </div>
  );
}
