import { useState } from "react";
import { CheckCircle2, Info, Loader2, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { useSessionUser } from "@/lib/session";
import { birthdayErrorMessage, useGreet } from "./api";
import type { BirthdayItem, GreetResult } from "./types";
import { GREETING_MAX, GREETING_TEMPLATES, defaultGreeting, greetingName, whatsappLink } from "./utils";

export const ALREADY_SENT_LABEL = "Já enviado este ano";

interface GreetDialogProps {
  /** Quem vai receber os parabéns; `null` = fechado. */
  item: BirthdayItem | null;
  onClose: () => void;
}

/** "Enviar parabéns": mensagem padrão editável + modelos; manda a notificação (POST greet) e oferece o WhatsApp. */
export function GreetDialog({ item, onClose }: GreetDialogProps) {
  return (
    <Dialog open={item !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" data-testid="greet-dialog">
        <DialogHeader>
          <DialogTitle>Enviar parabéns</DialogTitle>
          <DialogDescription>
            {item ? `Para ${item.name}. Edite a mensagem ou escolha um modelo.` : "Escolha a mensagem."}
          </DialogDescription>
        </DialogHeader>
        {item && <GreetBody key={item.personId} item={item} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function GreetBody({ item, onClose }: { item: BirthdayItem; onClose: () => void }) {
  const group = useSessionUser()?.organizationName?.trim() || null;
  const greet = useGreet();
  const [message, setMessage] = useState(() => defaultGreeting(item, group));
  const [result, setResult] = useState<GreetResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const text = message.trim();
  const tooLong = text.length > GREETING_MAX;
  const alreadySent = item.greetedThisYear || result?.alreadyGreeted === true;
  // O `whatsappUrl` devolvido pelo servidor tem prioridade; antes do envio vale o atalho montado aqui.
  const whatsapp = result?.whatsappUrl ?? whatsappLink(item.phone, text);
  const canSend = text.length > 0 && !tooLong && !alreadySent && !greet.isPending && result === null;

  async function send() {
    if (!canSend) return;
    setError(null);
    try {
      const response = await greet.mutateAsync({ personId: item.personId, message: text });
      setResult(response);
      if (response.alreadyGreeted) toast.info(ALREADY_SENT_LABEL + ".");
      else if (response.sent) toast.success(`Parabéns enviado para ${item.name}.`);
      else toast.info(`${item.name} ainda não tem acesso ao app. Use o WhatsApp para parabenizar.`);
    } catch (e) {
      if (e instanceof ApiError && e.code === "ALREADY_GREETED") {
        setResult({ sent: false, alreadyGreeted: true, whatsappUrl: null });
        return;
      }
      setError(birthdayErrorMessage(e, "Não foi possível enviar os parabéns. Tente novamente."));
    }
  }

  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      {alreadySent && (
        <p className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm" data-testid="greet-already">
          <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden />
          <span>
            <strong>{ALREADY_SENT_LABEL}.</strong> Os parabéns pelo app só são enviados uma vez por ano.
          </span>
        </p>
      )}

      {result?.sent && (
        <p className="flex items-center gap-2 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm" data-testid="greet-sent">
          <CheckCircle2 className="size-4 shrink-0 text-primary" aria-hidden />
          <span>Parabéns enviado para {greetingName(item)}.</span>
        </p>
      )}

      {result && !result.sent && !result.alreadyGreeted && (
        <p className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <Info className="size-4 shrink-0" aria-hidden />
          <span>Esta pessoa ainda não tem acesso ao app. Use o WhatsApp.</span>
        </p>
      )}

      {result === null && (
        <>
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm font-medium leading-none">Modelos</p>
            <ul className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="Modelos de parabéns">
              {GREETING_TEMPLATES.map((tpl) => (
                <li key={tpl.key} className="shrink-0">
                  <button
                    type="button"
                    disabled={alreadySent}
                    onClick={() => setMessage(tpl.build(greetingName(item), group))}
                    className="min-h-11 rounded-full border bg-card px-3 py-1.5 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 md:min-h-0"
                  >
                    {tpl.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <Label htmlFor="greet-message">Mensagem</Label>
              <span className={tooLong ? "text-destructive" : "text-muted-foreground"}>
                {text.length}/{GREETING_MAX}
              </span>
            </div>
            <Textarea
              id="greet-message"
              rows={4}
              value={message}
              disabled={alreadySent}
              aria-invalid={tooLong || undefined}
              onChange={(e) => {
                setMessage(e.target.value);
                setError(null);
              }}
            />
            {item.userId === null && !alreadySent && (
              <p className="text-xs text-muted-foreground">
                Esta pessoa não tem acesso ao app: a notificação não chega. Use o WhatsApp para parabenizar.
              </p>
            )}
          </div>
        </>
      )}

      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter className="gap-2 sm:gap-0">
        <Button type="button" variant="outline" disabled={greet.isPending} onClick={onClose}>
          {result ? "Fechar" : "Cancelar"}
        </Button>
        {whatsapp && (
          <Button asChild variant="secondary">
            <a href={whatsapp} target="_blank" rel="noopener noreferrer">
              <MessageCircle /> WhatsApp
            </a>
          </Button>
        )}
        {result === null && (
          <Button type="submit" disabled={!canSend}>
            {greet.isPending ? <Loader2 className="animate-spin" /> : <Send />}
            {greet.isPending ? "Enviando…" : "Enviar parabéns"}
          </Button>
        )}
      </DialogFooter>
    </form>
  );
}
