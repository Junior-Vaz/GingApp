import { useMemo, useRef, useState } from "react";
import { Send, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  COMMENT_MAX,
  authorLabel,
  feedErrorMessage,
  feedTime,
  useAddComment,
  useComments,
  useDeleteComment,
  type FeedComment,
  type FeedPost,
} from "@/lib/feed";
import { Avatar } from "../avatar";
import { ConfirmDialog, FeedSheet, RichText } from "./feed-sheet";
import { ReportSheet, type ReportTarget } from "./report-sheet";

interface ReplyTarget {
  /** Id do comentário de 1º nível que recebe a resposta (só há um nível). */
  parentId: number;
  name: string;
}

function CommentItem({
  comment,
  reply = false,
  canReply,
  onReply,
  onDelete,
  onReport,
}: {
  comment: FeedComment;
  reply?: boolean;
  canReply: boolean;
  onReply: () => void;
  onDelete: () => void;
  onReport: () => void;
}) {
  const name = authorLabel(comment.author);
  return (
    <li className={reply ? "ml-9 flex gap-2" : "flex gap-2"} data-testid={reply ? "comment-reply" : "comment"} data-comment-id={comment.id}>
      <Avatar decorative name={comment.author?.name ?? "?"} src={comment.author?.photo ?? null} size={reply ? 26 : 32} />
      <div className="min-w-0 flex-1">
        <div className="rounded-xl bg-muted px-3 py-2">
          <p className="truncate text-xs font-bold">{name}</p>
          <RichText text={comment.body} className="text-sm" />
        </div>
        <div className="flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
          <time className="px-1" dateTime={comment.createdAt}>
            {feedTime(comment.createdAt)}
          </time>
          {canReply && (
            <button type="button" className="min-h-11 px-2 font-semibold hover:text-primary" onClick={onReply}>
              Responder
            </button>
          )}
          {comment.canDelete ? (
            <button type="button" className="min-h-11 px-2 font-semibold hover:text-destructive" onClick={onDelete}>
              Apagar
            </button>
          ) : (
            <button type="button" className="min-h-11 px-2 font-semibold hover:text-destructive" onClick={onReport}>
              Denunciar
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/** Comentários do post em folha: lista infinita, campo de resposta, responder (1 nível), apagar o meu e denunciar. */
export function CommentsSheet({
  post,
  open,
  onOpenChange,
  allowComments,
}: {
  post: FeedPost;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  allowComments: boolean;
}) {
  const comments = useComments(post.id, open);
  const add = useAddComment(post.id);
  const remove = useDeleteComment(post.id);
  const [text, setText] = useState("");
  const [replyTo, setReplyTo] = useState<ReplyTarget | null>(null);
  const [toDelete, setToDelete] = useState<FeedComment | null>(null);
  const [report, setReport] = useState<ReportTarget | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);

  const { threads, repliesByParent } = useMemo(() => {
    const loaded = new Set(comments.items.map((item) => item.id));
    const replies = new Map<number, FeedComment[]>();
    const top: FeedComment[] = [];
    for (const item of comments.items) {
      if (item.parentId !== null && loaded.has(item.parentId)) {
        replies.set(item.parentId, [...(replies.get(item.parentId) ?? []), item]);
      } else {
        top.push(item); // 1º nível, ou resposta cujo pai ainda não foi carregado
      }
    }
    return { threads: top, repliesByParent: replies };
  }, [comments.items]);

  const trimmed = text.trim();

  function submit() {
    if (!trimmed || add.isPending) return;
    add.mutate(
      { body: trimmed, ...(replyTo ? { parentId: replyTo.parentId } : {}) },
      {
        onSuccess: () => {
          setText("");
          setReplyTo(null);
        },
        onError: (error) => toast.error(feedErrorMessage(error, "Não foi possível comentar. Tente de novo.")),
      },
    );
  }

  function startReply(comment: FeedComment) {
    setReplyTo({ parentId: comment.parentId ?? comment.id, name: comment.author?.name ?? "comentário" });
    field.current?.focus();
  }

  function confirmDelete() {
    if (!toDelete) return;
    const removedCount = 1 + (repliesByParent.get(toDelete.id)?.length ?? 0);
    remove.mutate(
      { commentId: toDelete.id, removedCount },
      {
        onSuccess: () => {
          toast.success("Comentário apagado.");
          setToDelete(null);
        },
        onError: (error) => {
          toast.error(feedErrorMessage(error, "Não foi possível apagar o comentário."));
          setToDelete(null);
        },
      },
    );
  }

  return (
    <>
      <FeedSheet
        open={open}
        onOpenChange={onOpenChange}
        title="Comentários"
        description={`Publicação de ${authorLabel(post.author)}`}
        tall
        testId="comments-sheet"
      >
        <div className="flex-1 overflow-y-auto px-4" data-testid="comments-list">
          {comments.isLoading ? (
            <div className="grid gap-3 py-2" aria-busy="true" data-testid="comments-loading">
              {[0, 1, 2].map((key) => (
                <div key={key} className="flex gap-2">
                  <Skeleton className="size-8 rounded-full" />
                  <Skeleton className="h-12 flex-1" />
                </div>
              ))}
            </div>
          ) : comments.isError && comments.items.length === 0 ? (
            <div className="py-8 text-center" role="alert">
              <p className="text-sm text-destructive">{feedErrorMessage(comments.error, "Não foi possível carregar os comentários.")}</p>
              <Button type="button" variant="outline" className="mt-3 h-11" onClick={() => void comments.refetch()}>
                Tentar de novo
              </Button>
            </div>
          ) : comments.items.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground" data-testid="comments-empty">
              Seja o primeiro a comentar.
            </p>
          ) : (
            <ul className="grid grid-cols-1 gap-1 pb-2">
              {threads.map((comment) => (
                <li key={comment.id} className="list-none">
                  <ul className="grid grid-cols-1 gap-1">
                    <CommentItem
                      comment={comment}
                      canReply={allowComments}
                      onReply={() => startReply(comment)}
                      onDelete={() => setToDelete(comment)}
                      onReport={() => setReport({ kind: "comment", id: comment.id })}
                    />
                    {(repliesByParent.get(comment.id) ?? []).map((item) => (
                      <CommentItem
                        key={item.id}
                        comment={item}
                        reply
                        canReply={allowComments}
                        onReply={() => startReply(item)}
                        onDelete={() => setToDelete(item)}
                        onReport={() => setReport({ kind: "comment", id: item.id })}
                      />
                    ))}
                  </ul>
                </li>
              ))}
              {comments.hasNextPage && (
                <li className="list-none text-center">
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-11"
                    disabled={comments.isFetchingNextPage}
                    onClick={() => void comments.fetchNextPage()}
                    data-testid="comments-more"
                  >
                    {comments.isFetchingNextPage ? "Carregando…" : "Ver mais comentários"}
                  </Button>
                </li>
              )}
            </ul>
          )}
        </div>
        {allowComments ? (
          <form
            className="border-t border-border px-4 pb-3 pt-2"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            {replyTo && (
              <p className="mb-1 flex items-center justify-between gap-2 rounded-md bg-secondary px-3 py-1 text-xs" data-testid="reply-target">
                <span className="truncate">Respondendo a {replyTo.name}</span>
                <button type="button" aria-label="Cancelar resposta" className="flex size-11 items-center justify-center -my-2 -mr-3" onClick={() => setReplyTo(null)}>
                  <X size={14} />
                </button>
              </p>
            )}
            <div className="flex items-end gap-2">
              <label htmlFor={`comment-field-${post.id}`} className="sr-only">
                Escreva um comentário
              </label>
              <Textarea
                id={`comment-field-${post.id}`}
                ref={field}
                value={text}
                rows={1}
                maxLength={COMMENT_MAX}
                placeholder={replyTo ? "Escreva sua resposta…" : "Escreva um comentário…"}
                className="max-h-32 min-h-11 flex-1 resize-none"
                disabled={add.isPending}
                onChange={(event) => setText(event.target.value.slice(0, COMMENT_MAX))}
              />
              <Button type="submit" size="icon" className="size-11 flex-none" aria-label="Enviar comentário" disabled={!trimmed || add.isPending} data-testid="comment-send">
                <Send />
              </Button>
            </div>
            {text.length > COMMENT_MAX - 100 && (
              <p className="mt-1 text-right text-xs text-muted-foreground" aria-live="polite">
                {text.length}/{COMMENT_MAX}
              </p>
            )}
          </form>
        ) : (
          <p className="border-t border-border px-4 py-3 text-center text-xs text-muted-foreground" data-testid="comments-off">
            Os comentários estão desligados neste grupo.
          </p>
        )}
      </FeedSheet>
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(next) => !next && setToDelete(null)}
        title="Apagar comentário?"
        description="Essa ação não pode ser desfeita."
        confirmLabel="Apagar"
        pending={remove.isPending}
        onConfirm={confirmDelete}
      />
      <ReportSheet target={report} onClose={() => setReport(null)} />
    </>
  );
}
