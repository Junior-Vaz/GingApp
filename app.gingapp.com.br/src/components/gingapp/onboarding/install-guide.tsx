import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Check, Copy, Share, SquarePlus, TriangleAlert, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useInstall } from "@/lib/install";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------------------------------------
 * Ajuda para instalar o GingApp. iPhone/iPad NÃO permitem instalar por código: a folha abaixo guia o usuário com uma
 * seta apontando para o botão Compartilhar do Safari. Android/desktop sem prompt nativo caem no texto manual.
 * ---------------------------------------------------------------------------------------------- */

/** Endereço que o usuário abre no Safari (raiz do app: funciona de qualquer tela). */
function appLink(): string {
  return `${window.location.origin}/`;
}

async function copyAppLink(): Promise<void> {
  try {
    await navigator.clipboard.writeText(appLink());
    toast.success("Link copiado! Abra o Safari e cole na barra de endereço.");
  } catch {
    toast.info(`Não foi possível copiar sozinho. No Safari, digite: ${appLink()}`);
  }
}

function Step({ n, icon: Icon, title, children }: { n: number; icon: LucideIcon; title: string; children?: string }) {
  return (
    <li className="flex items-start gap-3" data-testid={`ios-step-${n}`}>
      <span
        className="flex size-10 flex-none items-center justify-center rounded-full bg-secondary text-primary"
        aria-hidden="true"
      >
        <Icon className="size-5" />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-snug">
          <span className="sr-only">Passo {n}: </span>
          {title}
        </p>
        {children && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{children}</p>}
      </div>
    </li>
  );
}

/**
 * Seta que aponta para o botão Compartilhar do Safari: embaixo no iPhone (barra inferior) e no canto superior direito no
 * iPad. Fica FORA da folha (portal em `document.body`, `fixed`) para não herdar a transformação de entrada da folha.
 * Decorativa (aria-hidden) e sem animação com `prefers-reduced-motion`.
 */
function ShareArrow({ ipad }: { ipad: boolean }) {
  const reduced = useReducedMotion();
  const Arrow = ipad ? ArrowUp : ArrowDown;
  return createPortal(
    <div
      aria-hidden="true"
      data-testid="ios-share-arrow"
      data-animated={reduced ? "false" : "true"}
      className={cn(
        "pointer-events-none fixed z-[60] flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg",
        ipad ? "right-3 top-2" : "bottom-[calc(env(safe-area-inset-bottom)+8px)] left-1/2 -translate-x-1/2",
        !reduced && "animate-bounce",
      )}
    >
      <Arrow className="size-6" />
    </div>,
    document.body,
  );
}

export function IosInstallGuide({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { iosBrowserIsSafari, isIpad } = useInstall();
  const device = isIpad ? "iPad" : "iPhone";
  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className={cn("max-h-[92dvh] overflow-y-auto rounded-t-2xl px-5", !isIpad && iosBrowserIsSafari ? "pb-24" : "pb-6")}
          data-testid="ios-install-guide"
        >
          <SheetHeader>
            <SheetTitle>Instalar o GingApp no {device}</SheetTitle>
            <SheetDescription>
              {device === "iPad"
                ? "Leva menos de um minuto: 3 toques e o GingApp fica na tela inicial."
                : "Leva menos de um minuto: 3 toques e o GingApp fica na tela inicial do iPhone."}
            </SheetDescription>
          </SheetHeader>

          {!iosBrowserIsSafari && (
            <div
              className="mt-4 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm"
              role="note"
              data-testid="ios-not-safari"
            >
              <p className="flex items-start gap-2 font-semibold">
                <TriangleAlert className="mt-0.5 size-4 flex-none" aria-hidden="true" />
                <span>Abra este link no Safari</span>
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                No {device}, o caminho garantido para instalar é pelo Safari. Copie o link, abra o Safari, cole na barra de
                endereço e siga os passos abaixo.
              </p>
              <Button type="button" variant="outline" className="mt-3 min-h-11 w-full sm:w-auto" onClick={() => void copyAppLink()}>
                <Copy aria-hidden="true" />
                Copiar link
              </Button>
            </div>
          )}

          <ol className="mt-4 space-y-4" aria-label="Passo a passo">
            <Step n={1} icon={Share} title="Toque em Compartilhar">
              {isIpad
                ? "É o ícone de um quadrado com uma seta para cima, no canto superior direito do Safari."
                : "É o ícone de um quadrado com uma seta para cima, na barra de baixo do Safari. Não achou? Toque em ⋯ (Mais) e depois em Compartilhar."}
            </Step>
            <Step n={2} icon={SquarePlus} title="Adicionar à Tela de Início">
              Role a lista de opções até encontrar esta.
            </Step>
            <Step n={3} icon={Check} title="Adicionar">
              Confirme no canto superior direito. O ícone do GingApp aparece na tela inicial.
            </Step>
          </ol>

          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Depois, abra o GingApp pelo ícone da tela inicial. Por lá você também pode ativar as notificações.
          </p>
          <Button type="button" className="mt-4 min-h-11 w-full" onClick={() => onOpenChange(false)}>
            Entendi
          </Button>
        </SheetContent>
      </Sheet>
      {open && iosBrowserIsSafari && <ShareArrow ipad={isIpad} />}
    </>
  );
}

/** Texto manual para quem não tem o prompt nativo (Android sem o evento, Firefox, desktop...). */
export function ManualInstallHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Leve sua capoeira com você</DialogTitle>
        <DialogDescription>Instale o GingApp na tela inicial do seu celular.</DialogDescription>
        <div className="space-y-4 text-sm">
          <p>
            <strong>No iPhone:</strong> abra no Safari, toque em Compartilhar e selecione “Adicionar à Tela de Início”.
          </p>
          <p>
            <strong>No Android:</strong> abra no Chrome, toque no menu ⋮ e selecione “Instalar aplicativo” ou “Adicionar à tela inicial”.
          </p>
          <p className="text-muted-foreground">
            A instalação e o acesso básico sem internet ficam disponíveis na versão publicada. Dados da sua conta sempre são buscados online.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Ajuda certa para o aparelho: folha guiada no iPhone/iPad, texto manual nos demais. */
export function InstallHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { platform } = useInstall();
  return platform === "ios" ? (
    <IosInstallGuide open={open} onOpenChange={onOpenChange} />
  ) : (
    <ManualInstallHelp open={open} onOpenChange={onOpenChange} />
  );
}
