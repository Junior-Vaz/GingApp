import { useEffect, useRef, useState } from "react";
import { MessageCircle, SmilePlus } from "lucide-react";
import { toast } from "sonner";
import { REACTIONS, feedErrorMessage, reactionInfo, useReact, type FeedPost, type ReactionType } from "@/lib/feed";
import { cn } from "@/lib/utils";

const LONG_PRESS_MS = 450;

/**
 * Reações do post. O botão principal alterna AXE (ou remove a reação que eu já tenho); segurar o botão ou tocar
 * em "Mais reações" abre as 5 opções. Atualização otimista com rollback fica em `useReact`.
 */
export function ReactionBar({
  post,
  allowComments,
  onOpenComments,
}: {
  post: FeedPost;
  allowComments: boolean;
  onOpenComments: () => void;
}) {
  const react = useReact();
  const [pickerOpen, setPickerOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const mine = post.reactions.mine;
  const shown = reactionInfo(mine ?? "AXE");
  const counts = REACTIONS.filter((item) => (post.reactions.counts[item.type] ?? 0) > 0);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  function send(type: ReactionType | null) {
    // mutateAsync: cada toque tem o seu aviso de erro (o rollback já acontece no hook).
    react.mutateAsync({ postId: post.id, type }).catch((error: unknown) => {
      toast.error(feedErrorMessage(error, "Não foi possível registrar sua reação."));
    });
  }

  function choose(type: ReactionType) {
    setPickerOpen(false);
    send(type === mine ? null : type);
  }

  function startPress() {
    longPressed.current = false;
    timer.current = setTimeout(() => {
      longPressed.current = true;
      setPickerOpen(true);
    }, LONG_PRESS_MS);
  }

  function endPress() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }

  return (
    <div data-testid="reaction-bar">
      <div className="flex flex-wrap items-center gap-1 px-1.5">
        <button
          type="button"
          data-testid="react-main"
          aria-pressed={mine !== null}
          aria-label={mine ? `Sua reação: ${shown.label}. Toque para remover` : "Reagir com Axé"}
          className={cn(
            "inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            mine ? "bg-secondary text-primary" : "text-muted-foreground hover:bg-muted",
          )}
          onPointerDown={startPress}
          onPointerUp={endPress}
          onPointerLeave={endPress}
          onPointerCancel={endPress}
          onContextMenu={(event) => event.preventDefault()}
          onClick={() => {
            if (longPressed.current) {
              longPressed.current = false;
              return;
            }
            send(mine ? null : "AXE");
          }}
        >
          <span aria-hidden="true" className="text-lg leading-none">
            {shown.emoji}
          </span>
          {shown.label}
        </button>
        <button
          type="button"
          data-testid="react-more"
          aria-label="Mais reações"
          aria-expanded={pickerOpen}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setPickerOpen((open) => !open)}
        >
          <SmilePlus size={20} />
        </button>
        {allowComments && (
          <button
            type="button"
            data-testid="open-comments"
            className="ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-semibold text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={
              post.commentsCount > 0
                ? `Abrir comentários (${post.commentsCount})`
                : "Comentar"
            }
            onClick={onOpenComments}
          >
            <MessageCircle size={18} />
            <span data-testid="comments-count">{post.commentsCount > 0 ? post.commentsCount : "Comentar"}</span>
          </button>
        )}
      </div>
      {counts.length > 0 && (
        <p
          className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-1 pt-0.5 text-xs text-muted-foreground"
          data-testid="reaction-summary"
        >
          <span className="sr-only">
            {`${post.reactions.total} ${post.reactions.total === 1 ? "reação" : "reações"}: ${counts
              .map((item) => `${item.label} ${post.reactions.counts[item.type]}`)
              .join(", ")}`}
          </span>
          {counts.map((item) => (
            <span key={item.type} aria-hidden="true" className="inline-flex items-center gap-1">
              <span>{item.emoji}</span>
              <span className="font-semibold text-foreground" data-testid={`count-${item.type}`}>
                {post.reactions.counts[item.type]}
              </span>
            </span>
          ))}
        </p>
      )}
      {pickerOpen && (
        <div
          role="group"
          aria-label="Escolha uma reação"
          data-testid="reaction-picker"
          className="mx-3 mt-1 flex flex-wrap gap-1 rounded-lg border border-border bg-card p-1 shadow-sm"
        >
          {REACTIONS.map((item) => (
            <button
              key={item.type}
              type="button"
              data-reaction={item.type}
              aria-label={item.label}
              aria-pressed={mine === item.type}
              className={cn(
                "flex min-h-11 min-w-11 flex-col items-center justify-center rounded-md px-2 text-[10px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                mine === item.type ? "bg-secondary text-primary" : "text-muted-foreground hover:bg-muted",
              )}
              onClick={() => choose(item.type)}
            >
              <span aria-hidden="true" className="text-xl leading-none">
                {item.emoji}
              </span>
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
