import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/modules/alunos/native-select";
import {
  CONTEST_NOTE_MAX,
  CONTEST_REASON_LABEL,
  transferErrorMessage,
  useContestTransfer,
  type ContestReason,
  type TransferView,
} from "./transfer-api";

export const CONTEST_SENT_MESSAGE = "Contestação registrada. Ela é informativa e não bloqueia a saída.";

/**
 * Contestação do grupo ANTIGO (POST /transfers/:id/contest): motivo estruturado + texto curto. É só um registro para a
 * pessoa e o grupo novo verem; NÃO impede a transferência.
 */
export function ContestarTransferenciaDialog({
  transfer,
  onClose,
}: {
  transfer: TransferView | null;
  onClose: () => void;
}) {
  const contest = useContestTransfer();
  const [reason, setReason] = useState<ContestReason | "">("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setReason("");
    setNote("");
    setError(null);
  }, [transfer?.id]);

  async function submit() {
    if (!transfer) return;
    if (reason === "") {
      setError("Escolha o motivo da contestação.");
      return;
    }
    setError(null);
    try {
      await contest.mutateAsync({ id: transfer.id, data: { reason, note: note.trim() || undefined } });
      toast.success(CONTEST_SENT_MESSAGE);
      onClose();
    } catch (e) {
      setError(transferErrorMessage(e, "Não foi possível registrar a contestação. Tente novamente."));
    }
  }

  return (
    <Dialog open={transfer !== null} onOpenChange={(o) => !o && !contest.isPending && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Contestar transferência</DialogTitle>
          <DialogDescription>
            {transfer ? `Transferência de ${transfer.person.name} para ${transfer.toOrganization.name}. ` : ""}
            A contestação é apenas um aviso registrado: ela NÃO bloqueia a saída nem impede a transferência.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="contest-reason">Motivo</Label>
            <NativeSelect
              id="contest-reason"
              value={reason}
              disabled={contest.isPending}
              onChange={(e) => setReason(e.target.value as ContestReason | "")}
            >
              <option value="">Selecione…</option>
              {(Object.keys(CONTEST_REASON_LABEL) as ContestReason[]).map((r) => (
                <option key={r} value={r}>
                  {CONTEST_REASON_LABEL[r]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="contest-note">Explicação (opcional)</Label>
            <Textarea
              id="contest-note"
              value={note}
              maxLength={CONTEST_NOTE_MAX}
              disabled={contest.isPending}
              onChange={(e) => setNote(e.target.value)}
            />
            <p className="text-right text-xs text-muted-foreground">
              {note.length}/{CONTEST_NOTE_MAX}
            </p>
          </div>
          {error && (
            <p role="alert" data-testid="contest-error" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={contest.isPending} onClick={onClose}>
              Fechar
            </Button>
            <Button type="submit" disabled={contest.isPending}>
              {contest.isPending ? "Enviando…" : "Registrar contestação"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
