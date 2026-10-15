import { useEffect, useState, type ReactNode } from "react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface StrongConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Texto de apoio (o quê será apagado). */
  description?: ReactNode;
  /** Linha de impacto ("Isto apagará 3 aulas e 12 presenças. Não pode ser desfeito."), quando já carregada. */
  impact?: ReactNode;
  /** Impacto ainda carregando: o botão fica desabilitado. */
  impactLoading?: boolean;
  /** Erro ao buscar o impacto: aparece no lugar da linha de impacto e o botão fica desabilitado. */
  impactError?: string | null | undefined;
  /** Texto que a pessoa precisa digitar (nome da turma, "APAGAR"...), sem diferenciar maiúsculas/minúsculas. */
  phrase: string;
  confirmLabel?: string;
  /** Pode ser assíncrona: o botão fica em loading até resolver; o diálogo fecha em sucesso e permanece em erro. */
  onConfirm: () => void | Promise<unknown>;
}

const norm = (text: string) => text.trim().toLocaleLowerCase("pt-BR");

/**
 * Confirmação FORTE para ações irreversíveis (apagar de verdade): mostra o impacto e só habilita o botão vermelho
 * quando a pessoa digita a frase pedida. Diferente do ConfirmDialog (um clique), serve para apagar turma/aula.
 */
export function StrongConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  impact,
  impactLoading = false,
  impactError,
  phrase,
  confirmLabel = "Apagar definitivamente",
  onConfirm,
}: StrongConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!open) setTyped("");
  }, [open]);

  const matches = norm(typed) === norm(phrase) && norm(phrase) !== "";
  const ready = matches && !impactLoading && !impactError && !pending;

  async function handleConfirm() {
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      // O chamador já notifica o erro (toast); o diálogo permanece aberto para nova tentativa.
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              {description && <p>{description}</p>}
              {impactLoading ? (
                <p data-testid="strong-confirm-impact">Calculando o que será apagado…</p>
              ) : impactError ? (
                <p data-testid="strong-confirm-impact" className="font-semibold text-destructive">
                  {impactError}
                </p>
              ) : (
                impact && (
                  <p data-testid="strong-confirm-impact" className="font-semibold text-destructive">
                    {impact}
                  </p>
                )
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-1.5">
          <label htmlFor="strong-confirm-input" className="text-sm font-medium">
            Para confirmar, digite <span className="rounded bg-muted px-1 font-mono">{phrase}</span>
          </label>
          <Input
            id="strong-confirm-input"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={phrase}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <Button variant="destructive" disabled={!ready} onClick={() => void handleConfirm()}>
            {pending ? "Aguarde…" : confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
