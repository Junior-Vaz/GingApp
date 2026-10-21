import type { ReactNode, RefObject } from "react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { linkify } from "@/lib/feed";
import { cn } from "@/lib/utils";

/**
 * Folha inferior do feed (Sheet do app). O X padrão do Sheet tem só 16px: aqui ele ganha área de toque de 44px.
 * `focusRef` = campo que recebe o foco ao abrir (senão o foco vai para o primeiro botão da folha).
 */
export function FeedSheet({
  open,
  onOpenChange,
  title,
  description,
  focusRef,
  tall = false,
  testId,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  focusRef?: RefObject<HTMLElement | null>;
  /** Folha alta (lista de comentários); sem isso a folha tem a altura do conteúdo. */
  tall?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        data-testid={testId}
        onOpenAutoFocus={(event) => {
          if (focusRef?.current) {
            event.preventDefault();
            focusRef.current.focus();
          }
        }}
        className={cn(
          "mx-auto flex w-full max-w-xl flex-col gap-3 overflow-hidden rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)] sm:max-w-xl",
          tall ? "h-[88dvh]" : "max-h-[90dvh]",
          "[&>button.absolute]:right-1 [&>button.absolute]:top-1 [&>button.absolute]:flex [&>button.absolute]:h-11 [&>button.absolute]:w-11 [&>button.absolute]:items-center [&>button.absolute]:justify-center",
        )}
      >
        <SheetHeader className="px-4 pr-14 pt-4 text-left">
          <SheetTitle className="font-display">{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  );
}

/** Confirmação de ação destrutiva. O chamador fecha a caixa ao terminar (nada fecha sozinho enquanto `pending`). */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  pending = false,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm rounded-lg">
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel className="h-11" disabled={pending}>
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction
            className="h-11 bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {pending ? "Apagando…" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Texto de post/comentário: SEMPRE texto puro (o React escapa tudo; sem HTML bruto). Só URLs http(s) viram link,
 * com rel="noopener noreferrer nofollow". Quebras de linha preservadas.
 */
export function RichText({ text, className, testId }: { text: string; className?: string; testId?: string }) {
  return (
    <p className={cn("whitespace-pre-wrap break-words [overflow-wrap:anywhere]", className)} data-testid={testId}>
      {linkify(text).map((part, index) =>
        part.type === "link" ? (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="font-medium text-primary underline underline-offset-2"
          >
            {part.value}
          </a>
        ) : (
          <span key={index}>{part.value}</span>
        ),
      )}
    </p>
  );
}
