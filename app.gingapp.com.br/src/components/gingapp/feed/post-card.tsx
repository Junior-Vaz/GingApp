import { memo, useRef, useState } from "react";
import { Clock, Flag, MoreHorizontal, Pencil, Pin, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  FEED_BODY_MAX,
  authorLabel,
  feedErrorMessage,
  feedTime,
  useDeletePost,
  useEditPost,
  type FeedPost,
} from "@/lib/feed";
import { cn } from "@/lib/utils";
import { Avatar } from "../avatar";
import { CommentsSheet } from "./comments-sheet";
import { ConfirmDialog, FeedSheet, RichText } from "./feed-sheet";
import { MediaGallery } from "./media-gallery";
import { ReactionBar } from "./reaction-bar";
import { ReportSheet, type ReportTarget } from "./report-sheet";

function EditPostSheet({ post, open, onOpenChange }: { post: FeedPost; open: boolean; onOpenChange: (open: boolean) => void }) {
  const edit = useEditPost();
  const [text, setText] = useState(post.body ?? "");
  const field = useRef<HTMLTextAreaElement>(null);
  const trimmed = text.trim();
  const changed = trimmed !== (post.body ?? "").trim();
  const valid = changed && (trimmed.length > 0 || post.media.length > 0);

  function save() {
    if (!valid || edit.isPending) return;
    edit.mutate(
      { postId: post.id, body: trimmed },
      {
        onSuccess: () => {
          toast.success("Publicação atualizada.");
          onOpenChange(false);
        },
        onError: (error) => toast.error(feedErrorMessage(error, "Não foi possível salvar a edição.")),
      },
    );
  }

  return (
    <FeedSheet
      open={open}
      onOpenChange={(next) => {
        if (next) setText(post.body ?? "");
        onOpenChange(next);
      }}
      title="Editar publicação"
      description="Só o texto pode ser alterado. A publicação ficará marcada como editada."
      focusRef={field}
      testId="edit-sheet"
    >
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <label htmlFor={`edit-post-${post.id}`} className="sr-only">
          Texto da publicação
        </label>
        <Textarea
          id={`edit-post-${post.id}`}
          ref={field}
          rows={6}
          value={text}
          maxLength={FEED_BODY_MAX}
          disabled={edit.isPending}
          onChange={(event) => setText(event.target.value.slice(0, FEED_BODY_MAX))}
        />
        <p className="mt-1 text-right text-xs text-muted-foreground" aria-live="polite">
          {text.length}/{FEED_BODY_MAX}
        </p>
        <Button type="button" className="mt-3 h-11 w-full" disabled={!valid || edit.isPending} onClick={save} data-testid="edit-save">
          {edit.isPending ? "Salvando…" : "Salvar"}
        </Button>
      </div>
    </FeedSheet>
  );
}

function MenuAction({ icon, children, destructive = false, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon: React.ReactNode; destructive?: boolean }) {
  return (
    <button
      type="button"
      className={cn(
        "flex min-h-12 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-semibold hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        destructive && "text-destructive",
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}

/** Cartão de um post do feed. */
function PostCardBase({ post, allowComments = true }: { post: FeedPost; allowComments?: boolean }) {
  const remove = useDeletePost();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const pending = post.status === "PENDING_APPROVAL";
  const name = authorLabel(post.author);
  // A folha de comentários só monta depois da 1ª abertura (não são 15 folhas montadas ao abrir o feed).
  const [commentsMounted, setCommentsMounted] = useState(false);

  function confirmDelete() {
    remove.mutate(post.id, {
      onSuccess: () => toast.success("Publicação apagada."),
      onError: (error) => {
        toast.error(feedErrorMessage(error, "Não foi possível apagar a publicação."));
        setConfirmingDelete(false);
      },
    });
  }

  return (
    <article
      className={cn("rounded-lg border border-border bg-card p-3 shadow-[var(--shadow)]", pending && "opacity-75")}
      data-testid="post-card"
      data-post-id={post.id}
      data-status={post.status}
      aria-label={`Publicação de ${name}`}
    >
      <header className="flex items-start gap-3">
        <Avatar decorative name={post.author?.name ?? "?"} src={post.author?.photo ?? null} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold" data-testid="post-author">
            {name}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
            {post.author?.roleLabel && <span data-testid="post-role">{post.author.roleLabel}</span>}
            <time dateTime={post.createdAt}>{feedTime(post.createdAt)}</time>
            {post.edited && <span data-testid="post-edited">editado</span>}
          </p>
          {post.pinned && (
            <span className="mt-1 inline-flex items-center gap-1 rounded bg-secondary px-2 py-0.5 text-[11px] font-semibold text-primary" data-testid="post-pinned">
              <Pin size={11} aria-hidden="true" /> Fixado
            </span>
          )}
        </div>
        <button
          type="button"
          aria-label="Mais opções da publicação"
          data-testid="post-menu"
          className="-mr-1 -mt-1 flex size-11 flex-none items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setMenuOpen(true)}
        >
          <MoreHorizontal size={20} />
        </button>
      </header>

      {pending && (
        <div className="mt-3 flex items-start gap-2 rounded-md border border-[color:var(--warning)]/40 bg-[color-mix(in_oklch,var(--warning)_12%,var(--card))] p-3 text-sm" role="status" data-testid="pending-banner">
          <Clock size={16} className="mt-0.5 flex-none text-[color:var(--warning)]" aria-hidden="true" />
          <div>
            <p className="font-semibold">Aguardando aprovação</p>
            <p className="text-xs text-muted-foreground">Seu post será publicado depois que um professor aprovar.</p>
          </div>
        </div>
      )}

      {post.body && <RichText text={post.body} className="mt-3 text-sm leading-relaxed" testId="post-body" />}
      {post.media.length > 0 && (
        <div className="mt-3">
          <MediaGallery media={post.media} />
        </div>
      )}

      {!pending && (
        <div className="mt-3">
          <ReactionBar
            post={post}
            allowComments={allowComments}
            onOpenComments={() => {
              setCommentsMounted(true);
              setCommentsOpen(true);
            }}
          />
        </div>
      )}

      <FeedSheet open={menuOpen} onOpenChange={setMenuOpen} title="Opções da publicação" description={`Publicação de ${name}`} testId="post-menu-sheet">
        <div className="grid gap-1 px-2 pb-4">
          {/* O backend manda canEdit=true também no post pendente, mas PATCH nele dá 409 INVALID_STATE (a aprovação vale para o
              texto que o moderador leu): só se edita o publicado. */}
          {post.canEdit && !pending && (
            <MenuAction
              icon={<Pencil size={18} />}
              data-testid="menu-edit"
              onClick={() => {
                setMenuOpen(false);
                setEditing(true);
              }}
            >
              Editar
            </MenuAction>
          )}
          {post.canDelete && (
            <MenuAction
              icon={<Trash2 size={18} />}
              destructive
              data-testid="menu-delete"
              onClick={() => {
                setMenuOpen(false);
                setConfirmingDelete(true);
              }}
            >
              Apagar
            </MenuAction>
          )}
          {!post.canEdit && (
            <MenuAction
              icon={<Flag size={18} />}
              data-testid="menu-report"
              onClick={() => {
                setMenuOpen(false);
                setReport({ kind: "post", id: post.id });
              }}
            >
              Denunciar
            </MenuAction>
          )}
        </div>
      </FeedSheet>
      {editing && <EditPostSheet post={post} open={editing} onOpenChange={setEditing} />}
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title="Apagar publicação?"
        description="A publicação, as fotos e os comentários dela saem do grupo. Essa ação não pode ser desfeita."
        confirmLabel="Apagar"
        pending={remove.isPending}
        onConfirm={confirmDelete}
      />
      <ReportSheet target={report} onClose={() => setReport(null)} />
      {!pending && commentsMounted && (
        <CommentsSheet post={post} open={commentsOpen} onOpenChange={setCommentsOpen} allowComments={allowComments} />
      )}
    </article>
  );
}

export const PostCard = memo(PostCardBase);
