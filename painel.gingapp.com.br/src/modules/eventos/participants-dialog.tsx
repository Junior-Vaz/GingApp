import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, api, errorMessage } from "@/lib/api";
import { notifyError } from "@/lib/crud";
import { PARTICIPANT_STATUS_LABEL } from "@/modules/rodas/types";
import { AddParticipantForm } from "./add-participant-form";
import type { EventItem, EventParticipant, ParticipantPayload } from "./types";

const participantName = (p: EventParticipant) => p.student?.name ?? p.guestName ?? "—";

/** Participantes do evento: listar, adicionar (aluno/convidado), check-in (ATTENDED) e remover. */
export function ParticipantsDialog({ event, onClose }: { event: EventItem | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<EventParticipant | null>(null);
  /** Inscrição barrada por evento lotado (409 EVENT_FULL): aguarda o aceite de entrar na lista de espera. */
  const [waitlistOffer, setWaitlistOffer] = useState<ParticipantPayload | null>(null);
  const base = `/events/${String(event?.id)}/participants`;
  const key = ["eventos", "participants", event?.id];
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });

  const list = useQuery({
    queryKey: key,
    queryFn: () => api.get<EventParticipant[]>(base),
    enabled: event !== null,
  });

  const add = useMutation({
    mutationFn: (payload: ParticipantPayload) => api.post<EventParticipant>(base, payload),
    onSuccess: (_data, payload) => {
      void refresh();
      void queryClient.invalidateQueries({ queryKey: ["crud", "/events"] }); // vagas/lista de espera da tabela
      toast.success(payload.joinWaitlist ? "Participante adicionado à lista de espera." : "Participante adicionado.");
    },
    onError: (error, payload) => {
      if (error instanceof ApiError && error.status === 409 && error.code === "EVENT_FULL" && !payload.joinWaitlist) {
        setWaitlistOffer(payload);
        return;
      }
      notifyError(error, "Não foi possível adicionar o participante.");
    },
  });

  const checkIn = useMutation({
    mutationFn: (participantId: number) =>
      api.patch<EventParticipant>(`${base}/${String(participantId)}/check-in`),
    onSuccess: () => {
      void refresh();
      toast.success("Presença confirmada.");
    },
    onError: (error) => notifyError(error, "Não foi possível confirmar a presença."),
  });

  const remove = useMutation({
    mutationFn: (participantId: number) => api.delete<void>(`${base}/${String(participantId)}`),
    onSuccess: () => {
      void refresh();
      toast.success("Participante removido.");
    },
    onError: (error) => notifyError(error, "Não foi possível remover o participante."),
  });

  return (
    <>
      <Dialog open={event !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Participantes</DialogTitle>
            <DialogDescription>{event?.title}</DialogDescription>
          </DialogHeader>

          <AddParticipantForm onAdd={(payload) => add.mutateAsync(payload)} />

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
                  <span className="min-w-0 truncate font-medium">
                    {participantName(participant)}
                    {participant.studentId === null && (
                      <span className="ml-2 text-xs text-muted-foreground">(convidado)</span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <Badge
                      variant={
                        participant.status === "ATTENDED" ? "default" : participant.status === "WAITLIST" ? "outline" : "secondary"
                      }
                    >
                      {PARTICIPANT_STATUS_LABEL[participant.status]}
                    </Badge>
                    {participant.status !== "ATTENDED" && participant.status !== "WAITLIST" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={checkIn.isPending}
                        onClick={() => checkIn.mutate(participant.id)}
                        aria-label={`Check-in de ${participantName(participant)}`}
                      >
                        Check-in
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRemoving(participant)}
                      aria-label={`Remover ${participantName(participant)}`}
                    >
                      Remover
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="py-4 text-center text-sm text-muted-foreground">Nenhum participante ainda.</p>
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={waitlistOffer !== null}
        onOpenChange={(open) => !open && setWaitlistOffer(null)}
        title="Evento lotado"
        description="Todas as vagas deste evento estão ocupadas. Deseja adicionar o participante à lista de espera? Ele será confirmado automaticamente quando uma vaga abrir."
        confirmLabel="Adicionar à lista de espera"
        variant="default"
        onConfirm={() => add.mutateAsync({ ...waitlistOffer!, joinWaitlist: true })}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remover participante?"
        description={removing ? `Remover "${participantName(removing)}" deste evento?` : undefined}
        confirmLabel="Remover"
        onConfirm={() => remove.mutateAsync(removing!.id)}
      />
    </>
  );
}