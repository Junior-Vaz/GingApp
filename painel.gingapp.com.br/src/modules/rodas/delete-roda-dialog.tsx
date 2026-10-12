import { useState } from "react";
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
import { isSeriesParent, type Roda } from "./types";

interface Props {
  roda: Roda | null;
  onClose: () => void;
  /** `series` = apagar a roda mãe e todas as ocorrências (DELETE /rodas/:id?series=true). */
  onDelete: (roda: Roda, series: boolean) => Promise<unknown>;
}

/** Confirmação de exclusão; para a roda mãe de uma série oferece também "Excluir a série inteira". */
export function DeleteRodaDialog({ roda, onClose, onDelete }: Props) {
  const [pending, setPending] = useState(false);
  const series = roda !== null && isSeriesParent(roda);

  async function run(wholeSeries: boolean) {
    if (!roda) return;
    setPending(true);
    try {
      await onDelete(roda, wholeSeries);
      onClose();
    } catch {
      // O chamador já notificou o erro (toast); o diálogo permanece aberto.
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={roda !== null} onOpenChange={(open) => !open && !pending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{series ? "Excluir roda recorrente?" : "Excluir roda?"}</AlertDialogTitle>
          {roda && (
            <AlertDialogDescription>
              {series
                ? `"${roda.title}" é a roda de origem de uma série. Você pode excluir só esta roda ou a série inteira (esta roda e todas as ocorrências geradas). Os participantes registrados também serão removidos.`
                : `"${roda.title}" - os participantes registrados também serão removidos.`}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancelar</AlertDialogCancel>
          <Button variant="destructive" disabled={pending} onClick={() => void run(false)}>
            {pending ? "Aguarde…" : series ? "Excluir só esta roda" : "Excluir"}
          </Button>
          {series && (
            <Button variant="destructive" disabled={pending} onClick={() => void run(true)}>
              Excluir a série inteira
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
