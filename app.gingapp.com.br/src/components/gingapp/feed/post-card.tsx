import { memo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Clock, Flag, MoreHorizontal, Pencil, Pin, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  FEED_BODY_MAX,
  authorLabel,
  feedErrorMessage,
  feedTime,
  recentCommentsOf,
  shortAuthorName,
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

/** A legenda ("nome + texto") é cortada em 3 linhas: acima disso (ou com muitas quebras) aparece "mais". */
const CAPTION_CHARS = 110;
const CAPTION_LINES = 3;
const isLongCaption = (body: string) => body.length > CAPTION_CHARS || body.split("\n").length > CAPTION_LINES;

/**
 * Cartão de um post do feed, ESTILO INSTAGRAM: sem container (sem fundo, borda, sombra ou cantos), só um filete embaixo
 * para separar do próximo; a foto vai de ponta a ponta (quem usa o cartão o faz sangrar até a borda da tela no celular) e
 * só o cabeçalho, as ações e os textos têm 12 px de respiro lateral. Ordem: cabeçalho (avatar, nome, tempo, menu) ->
 * foto -> reações/comentar -> contagem -> "nome + legenda" -> "Ver todos os N comentários" -> 2 comentários recentes ->
 * "Adicionar comentário…". `compact` = variante da prévia na Home: UMA foto (as outras viram "+N" que levam ao feed) e o
 * "mais" da legenda leva ao feed (no feed ele expande ali mesmo).
 */
function PostCardBase({ post, allowComments = true, compact = false }: { post: FeedPost; allowComments?: boolean; compact?: boolean }) {
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
  const [captionOpen, setCaptionOpen] = useState(false);
  const recent = recentCommentsOf(post);
  // "Ver todos" aparece quando há mais comentários do que os 2 recentes que o post trouxe (campo ausente = 0 recentes).
  const hasMoreComments = post.commentsCount > recent.length;
  const longCaption = post.body ? isLongCaption(post.body) : false;

  function openComments() {
    setCommentsMounted(true);
    setCommentsOpen(true);
  }

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
      className={cn("border-b border-border pb-2 pt-3", pending && "opacity-75")}
      data-testid="post-card"
      data-compact={compact || undefined}
      data-post-id={post.id}
      data-status={post.status}
      aria-label={`Publicação de ${name}`}
    >
      <header className="flex items-center gap-2.5 pl-3 pr-1">
        <Avatar decorative name={post.author?.name ?? "?"} src={post.author?.photo ?? null} size={32} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold leading-tight" data-testid="post-author">
            {name}
          </p>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-tight text-muted-foreground">
            {post.author?.roleLabel && <span data-testid="post-role">{post.author.roleLabel}</span>}
            <time dateTime={post.createdAt}>{feedTime(post.createdAt)}</time>
            {post.edited && <span data-testid="post-edited">editado</span>}
            {post.pinned && (
              <span className="inline-flex items-center gap-1 font-semibold text-primary" data-testid="post-pinned">
                <Pin size={11} aria-hidden="true" /> Fixado
              </span>
            )}
          </p>
        </div>
        <button
          type="button"
          aria-label="Mais opções da publicação"
          data-testid="post-menu"
          className="flex size-11 flex-none items-center justify-center rounded-full text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setMenuOpen(true)}
        >
          <MoreHorizontal size={20} />
        </button>
      </header>

      {pending && (
        <div className="mx-3 mt-1 flex items-start gap-2 rounded-md border border-[color:var(--warning)]/40 bg-[color-mix(in_oklch,var(--warning)_12%,var(--card))] p-3 text-sm" role="status" data-testid="pending-banner">
          <Clock size={16} className="mt-0.5 flex-none text-[color:var(--warning)]" aria-hidden="true" />
          <div>
            <p className="font-semibold">Aguardando aprovação</p>
            <p className="text-xs text-muted-foreground">Seu post será publicado depois que um professor aprovar.</p>
          </div>
        </div>
      )}

      {/* Mídia de ponta a ponta (sem padding lateral, sem cantos). */}
      {post.media.length > 0 && (
        <div className="relative mt-2" data-testid="post-media">
          <MediaGallery media={compact ? post.media.slice(0, 1) : post.media} />
          {compact && post.media.length > 1 && (
            <Link
              to="/feed"
              className="absolute bottom-0 right-0 inline-flex min-h-11 min-w-11 items-center justify-center no-underline"
              aria-label={`Ver mais ${post.media.length - 1} ${post.media.length - 1 === 1 ? "foto" : "fotos"} no Grupo`}
              data-testid="post-more-photos"
            >
              <span className="rounded-full bg-black/65 px-2.5 py-1 text-xs font-semibold text-white">+{post.media.length - 1}</span>
            </Link>
          )}
        </div>
      )}

      {!pending && (
        <div className="mt-1">
          <ReactionBar post={post} allowComments={allowComments} onOpenComments={openComments} />
        </div>
      )}

      {post.body && (
        <div className="px-3 pt-1">
          <RichText
            text={post.body}
            className={cn("text-sm leading-snug", longCaption && !captionOpen && "line-clamp-3")}
            testId="post-body"
            prefix={
              <>
                <span className="font-bold" data-testid="post-caption-author">
                  {shortAuthorName(post.author)}
                </span>{" "}
              </>
            }
          />
          {longCaption && !captionOpen && (compact ? (
            <Link to="/feed" className="inline-flex min-h-11 items-center text-sm font-semibold text-muted-foreground no-underline" data-testid="post-see-more">
              mais
            </Link>
          ) : (
            <button
              type="button"
              className="inline-flex min-h-11 items-center text-sm font-semibold text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="post-see-more"
              aria-expanded={false}
              onClick={() => setCaptionOpen(true)}
            >
              mais
            </button>
          ))}
        </div>
      )}

      {!pending && allowComments && (
        <div className="px-3" data-testid="post-comments-preview">
          {hasMoreComments && (
            <button
              type="button"
              className="flex min-h-11 items-center text-left text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              data-testid="comments-see-all"
              onClick={openComments}
            >
              {post.commentsCount === 1 ? "Ver 1 comentário" : `Ver todos os ${post.commentsCount} comentários`}
            </button>
          )}
          {recent.length > 0 && (
            <ul className="grid gap-0.5" data-testid="recent-comments">
              {recent.map((comment) => (
                <li key={comment.id} data-testid="recent-comment" data-comment-id={comment.id}>
                  <RichText
                    text={comment.body}
                    className="line-clamp-2 text-sm leading-snug"
                    prefix={
                      <>
                        <span className="font-bold">{shortAuthorName(comment.author)}</span>{" "}
                      </>
                    }
                  />
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="flex min-h-11 w-full items-center text-left text-sm text-muted-foreground/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="add-comment-line"
            onClick={openComments}
          >
            Adicionar comentário…
          </button>
        </div>
      )}

      <FeedSheet open={menuOpen} onOpenChange={setMenuOpen} title="Opções da publicação" description={`Publicação de ${name}`} testId="post-menu-sheet">
        <div className="grid gap-1 px-2 pb-4">
          {/* Só o post PUBLICADO se edita (PATCH no pendente dá 409 INVALID_STATE: a aprovação vale para o texto que o
              moderador leu). O backend real manda canEdit=false no pendente (conferido em 2026-10-28; antes mandava true),
              então o pendente - que só o próprio autor vê no feed - nunca oferece "Editar" nem "Denunciar". */}
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
          {!post.canEdit && !pending && (
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
