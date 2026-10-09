import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { notifyError } from "@/lib/crud";
import { PARTICIPANT_STATUS_LABEL, type Roda, type RodaParticipant } from "./types";

const participantName = (p: RodaParticipant) => p.student?.name ?? p.user?.name ?? p.guestName ?? "—";

interface Props {
  roda: Roda | null;
  /** Só a organização dona da roda pode remover participantes (regra do backend). */
  canManage: boolean;
  onClose: () => void;
}

/** Lista pública de quem confirmou presença (GET /rodas/:id/participants) + remoção pelo dono. */
export function RodaParticipantsDialog({ roda, canManage, onClose }: Props) {
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<RodaParticipant | null>(null);
  const key = ["rodas", "participants", roda?.id];

  const list = useQuery({
    queryKey: key,
    queryFn: () => api.get<RodaParticipant[]>(`/rodas/${String(roda?.id)}/participants`),
    enabled: roda !== null,
  });

  const remove = useMutation({
    mutationFn: (participantId: number) =>
      api.delete<void>(`/rodas/${String(roda?.id)}/participants/${String(participantId)}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: key });
      toast.success("Participante removido.");
    },
    onError: (error) => notifyError(error, "Não foi possível remover o participante."),
  });

  return (
    <>
      <Dialog open={roda !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Participantes</DialogTitle>
            <DialogDescription>{roda?.title}</DialogDescription>
          </DialogHeader>

          {list.isLoading ? (
            <Skeleton className="h-16 w-full" data-testid="participants-loading" />
          ) : list.error ? (
            <div className="space-y-2 text-center">
              <p className="text-sm text-destructive">
                {errorMessage(list.error, "Não foi possível carregar os participantes.")}
              </p>
              <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : list.data?.length ? (
            <ul className="divide-y rounded-md border">
              {list.data.map((participant) => (
                <li key={participant.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate font-medium">{participantName(participant)}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <Badge variant="secondary">{PARTICIPANT_STATUS_LABEL[participant.status]}</Badge>
                    {canManage && (
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(participant)}>
                        Remover
                      </Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">Ninguém confirmou presença ainda.</p>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remover participante?"
        description={removing ? participantName(removing) : undefined}
        confirmLabel="Remover"
        onConfirm={() => remove.mutateAsync(removing!.id)}
      />
    </>
  );
}