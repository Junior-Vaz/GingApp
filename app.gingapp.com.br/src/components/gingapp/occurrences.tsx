import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronRight, Info, MessageSquareText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, api, errorMessage } from "@/lib/api";
import { fmt, toDate } from "@/lib/format";
import { useOccurrences, type OccurrenceKind, type OccurrenceStatus, type PersonOccurrenceView } from "@/lib/queries";
import { PageHeading, StateMessage } from "./shared";

export const CONTEST_MAX = 280;

const KIND_LABEL: Record<OccurrenceKind, string> = {
  ADVERTENCIA: "Advertência",
  SUSPENSAO: "Suspensão",
  EXPULSAO: "Expulsão",
  OUTRA: "Outra ocorrência",
};

const STATUS_LABEL: Record<OccurrenceStatus, string> = {
  ACTIVE: "Registrada",
  CONTESTED: "Contestada",
  RETRACTED: "Retratada pelo grupo",
};

const day = (iso: string) => fmt(toDate(iso), "dd/MM/yyyy");

/** Mensagem clara para os erros de negócio da contestação (404 e 409 OCCURRENCE_NOT_CONTESTABLE). */
function contestErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "OCCURRENCE_NOT_CONTESTABLE")
      return "Esta ocorrência não pode mais ser contestada (já foi contestada ou retratada). A lista foi atualizada.";
    if (error.status === 404) return "Ocorrência não encontrada ou você não tem permissão para contestá-la.";
  }
  return errorMessage(error, "Não foi possível enviar a contestação. Tente novamente.");
}

/** Contestação em dois passos: escrever (com contador) e confirmar sabendo que o grupo verá o texto. */
function ContestForm({ occurrence, onClose }: { occurrence: PersonOccurrenceView; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const trimmed = note.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= CONTEST_MAX;
  const guardian = occurrence.decidingAs === "GUARDIAN";

  const contest = useMutation({
    mutationFn: () => api.post<PersonOccurrenceView>(`/people/me/occurrences/${occurrence.id}/contest`, { note: trimmed }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["people", "me", "occurrences"] });
      toast.success(`Contestação enviada. ${occurrence.organization.name} poderá ler o que você escreveu.`);
      onClose();
    },
    onError: async (error) => {
      toast.error(contestErrorMessage(error));
      // 404/409: o estado real mudou no servidor; recarrega a lista para refletir.
      await queryClient.invalidateQueries({ queryKey: ["people", "me", "occurrences"] });
      setConfirming(false);
    },
  });

  return (
    <div className="mt-4 rounded-md border border-primary/40 bg-primary/5 p-4" role="group" aria-label="Contestar ocorrência" data-testid="occurrence-contest-form">
      {!confirming ? (
        <>
          <p className="text-sm font-semibold">Contestar esta ocorrência</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Conte, com calma e em poucas palavras, por que {guardian ? `${occurrence.person.name} discorda` : "você discorda"}.{" "}
            <strong>{occurrence.organization.name}</strong> vai ler a contestação e poderá manter ou retratar o registro.
          </p>
          <label className="field-label" htmlFor={`contest-note-${occurrence.id}`}>
            Sua contestação
          </label>
          <Textarea
            id={`contest-note-${occurrence.id}`}
            value={note}
            maxLength={CONTEST_MAX}
            rows={4}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Escreva aqui o seu ponto de vista."
          />
          <p className="mt-1 text-right text-xs text-muted-foreground" data-testid="contest-counter" aria-live="polite">
            {note.length}/{CONTEST_MAX}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={!valid} onClick={() => setConfirming(true)}>
              Revisar e enviar
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="flex items-center gap-2 text-sm font-semibold">
            <MessageSquareText size={16} />
            Enviar esta contestação?
          </p>
          <p className="mt-2 text-sm">
            O grupo <strong>{occurrence.organization.name}</strong> verá o texto abaixo. Depois de enviado, ele não pode ser editado por aqui.
          </p>
          <blockquote className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-card p-3 text-sm" data-testid="contest-preview">
            {trimmed}
          </blockquote>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={contest.isPending} onClick={() => contest.mutate()}>
              {contest.isPending ? "Enviando…" : "Confirmar contestação"}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={contest.isPending} onClick={() => setConfirming(false)}>
              Voltar
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

export function OccurrenceCard({ occurrence }: { occurrence: PersonOccurrenceView }) {
  const [contesting, setContesting] = useState(false);
  const guardian = occurrence.decidingAs === "GUARDIAN";
  const active = occurrence.status === "ACTIVE";

  return (
    <article className="notice-item" data-testid="occurrence-card" data-occurrence-id={occurrence.id}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3>{KIND_LABEL[occurrence.kind]}</h3>
          {guardian && (
            <p className="mt-1 text-sm font-medium" data-testid="occurrence-person">
              Sobre {occurrence.person.name}
            </p>
          )}
          <p className="mt-1 text-sm">
            <strong>{occurrence.organization.name}</strong>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Registrada em {day(occurrence.occurredAt)}
            {occurrence.kind === "SUSPENSAO" && occurrence.endsAt ? ` · suspensão até ${day(occurrence.endsAt)}` : ""}
          </p>
        </div>
        <span className={`badge ${active ? "badge-warm" : ""}`} data-testid="occurrence-status">
          {STATUS_LABEL[occurrence.status]}
        </span>
      </div>
      <p className="mt-3 whitespace-pre-wrap text-sm" data-testid="occurrence-reason">
        <span className="text-muted-foreground">Motivo informado pelo grupo: </span>
        {occurrence.reason}
      </p>
      {occurrence.status === "CONTESTED" && (
        <div className="mt-3 rounded-md border border-border p-3 text-sm" data-testid="occurrence-contested">
          <p className="flex items-center gap-2 font-semibold">
            <Info size={15} />
            Contestada{occurrence.contestedAt ? ` em ${day(occurrence.contestedAt)}` : ""}
          </p>
          {occurrence.contestNote && (
            <p className="mt-1 whitespace-pre-wrap">
              <span className="text-muted-foreground">{guardian ? "A contestação enviada: " : "Sua contestação: "}</span>
              {occurrence.contestNote}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">O grupo foi avisado e pode manter ou retratar o registro.</p>
        </div>
      )}
      {occurrence.status === "RETRACTED" && (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="occurrence-retracted">
          O grupo retratou este registro{occurrence.retractedAt ? ` em ${day(occurrence.retractedAt)}` : ""}. Ele não vale mais.
        </p>
      )}
      {active && !occurrence.canContest && (
        <p className="mt-3 text-sm text-muted-foreground" data-testid="occurrence-read-only">
          Quem pode contestar é a própria pessoa, quando maior de idade, ou o responsável, quando menor de idade.
        </p>
      )}
      {active && occurrence.canContest && !contesting && (
        <div className="mt-4">
          <Button type="button" size="sm" variant="outline" onClick={() => setContesting(true)}>
            Contestar
          </Button>
        </div>
      )}
      {active && occurrence.canContest && contesting && <ContestForm occurrence={occurrence} onClose={() => setContesting(false)} />}
    </article>
  );
}

export function OccurrencesPage() {
  const occurrences = useOccurrences();
  const list = occurrences.data ?? [];

  return (
    <>
      <PageHeading
        title="Minhas ocorrências"
        subtitle="Registros feitos pelos grupos sobre você (ou sobre quem você acompanha). Se discordar de algum, você pode contestar."
      />
      {occurrences.isLoading ? (
        <StateMessage>Carregando ocorrências…</StateMessage>
      ) : occurrences.error ? (
        <StateMessage tone="error">{errorMessage(occurrences.error, "Não foi possível carregar as ocorrências.")}</StateMessage>
      ) : list.length === 0 ? (
        <StateMessage>Nenhuma ocorrência registrada.</StateMessage>
      ) : (
        <div className="notice-list" data-testid="occurrences-list">
          {list.map((occurrence) => (
            <OccurrenceCard key={occurrence.id} occurrence={occurrence} />
          ))}
        </div>
      )}
    </>
  );
}

/** Atalho do Perfil. Sem nenhuma ocorrência (ou erro/backend antigo) não renderiza nada. */
export function OccurrencesShortcut({ className = "content-band" }: { className?: string }) {
  const { data } = useOccurrences();
  if (!data || data.length === 0) return null;
  const dependents = [...new Set(data.filter((o) => o.decidingAs === "GUARDIAN").map((o) => o.person.name))];
  const toContest = data.filter((o) => o.status === "ACTIVE" && o.canContest).length;
  return (
    <section className={className} data-testid="occurrences-shortcut">
      <Link to="/ocorrencias" className="flex items-center gap-3 no-underline">
        <div className="min-w-0 flex-1">
          <strong className="block text-base">Minhas ocorrências</strong>
          <span className="text-sm text-muted-foreground" data-testid="occurrences-shortcut-text">
            {dependents.length > 0 ? `Inclui registros sobre ${dependents.join(", ")}. ` : ""}
            {toContest > 0 ? "Leia os registros e, se discordar, conteste." : "Acompanhe os registros feitos pelos grupos."}
          </span>
        </div>
        <ChevronRight size={16} className="flex-none text-muted-foreground" />
      </Link>
    </section>
  );
}
