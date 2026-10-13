import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";
import { todayStamp } from "@/lib/csv";
import { dayOnly, fmt } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NativeSelect } from "./native-select";
import {
  OCCURRENCE_KIND_LABEL,
  OCCURRENCE_REASON_MAX,
  OCCURRENCE_STATUS_LABEL,
  occurrenceBody,
  occurrenceErrorMessage,
  useCreateOccurrence,
  useOccurrences,
  useRetractOccurrence,
  type OccurrenceKind,
  type OccurrenceStatus,
  type OccurrenceView,
} from "./ocorrencias";

const date = (iso: string) => fmt(dayOnly(iso), "dd/MM/yyyy");

export const OCCURRENCE_CONFIDENTIAL_NOTICE =
  "Informação confidencial, visível só ao Mestre. A pessoa pode contestar uma ocorrência; o Mestre pode retratá-la.";

/** Selo do estado da ocorrência: "Contestada" e "Retratada" chamam atenção; "Ativa" fica discreta. */
export function OccurrenceStatusBadge({ status }: { status: OccurrenceStatus }) {
  return (
    <Badge variant={status === "ACTIVE" ? "secondary" : status === "CONTESTED" ? "destructive" : "outline"}>
      {OCCURRENCE_STATUS_LABEL[status]}
    </Badge>
  );
}

function OccurrenceItem({ occurrence: o, studentId }: { occurrence: OccurrenceView; studentId: number }) {
  const retract = useRetractOccurrence(studentId);
  const [retracting, setRetracting] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function confirmRetract() {
    setError(null);
    try {
      await retract.mutateAsync({ id: o.id, note: note.trim() || undefined });
      toast.success("Ocorrência retratada.");
      setRetracting(false);
      setNote("");
    } catch (e) {
      setError(occurrenceErrorMessage(e, "Não foi possível retratar a ocorrência. Tente novamente."));
    }
  }

  return (
    <li
      data-testid="ocorrencia-item"
      className={cn("grid gap-1.5 rounded-md border p-2 text-sm", o.status === "RETRACTED" && "bg-muted/40")}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Badge variant="default">{OCCURRENCE_KIND_LABEL[o.kind]}</Badge>
        <span className="text-muted-foreground">
          {date(o.occurredAt)}
          {o.kind === "SUSPENSAO" && o.endsAt ? ` até ${date(o.endsAt)}` : ""}
        </span>
        <OccurrenceStatusBadge status={o.status} />
        {o.expelledEnrollment && <Badge variant="outline">Matrícula encerrada</Badge>}
        {o.createdBy && <span className="text-xs text-muted-foreground">por {o.createdBy.name}</span>}
      </div>
      <p className={cn(o.status === "RETRACTED" && "text-muted-foreground line-through")}>{o.reason}</p>
      {o.status === "CONTESTED" && (
        <p className="text-xs text-muted-foreground" data-testid="ocorrencia-contestacao">
          Contestação da pessoa{o.contestedAt ? ` em ${date(o.contestedAt)}` : ""}: {o.contestNote ?? "sem texto"}
        </p>
      )}
      {o.status === "RETRACTED" && (
        <p className="text-xs text-muted-foreground">
          Retratada{o.retractedAt ? ` em ${date(o.retractedAt)}` : ""}
          {o.retractNote ? `: ${o.retractNote}` : "."}
        </p>
      )}

      {o.status !== "RETRACTED" && !retracting && (
        <div>
          <Button type="button" variant="outline" size="sm" onClick={() => setRetracting(true)}>
            Retratar
          </Button>
        </div>
      )}
      {retracting && (
        <div className="grid gap-2 rounded-md border bg-muted/30 p-2">
          <Label htmlFor={`retract-note-${o.id}`}>Nota da retratação (opcional)</Label>
          <Textarea
            id={`retract-note-${o.id}`}
            value={note}
            maxLength={OCCURRENCE_REASON_MAX}
            disabled={retract.isPending}
            onChange={(e) => setNote(e.target.value)}
          />
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={retract.isPending} onClick={() => void confirmRetract()}>
              {retract.isPending ? "Retratando…" : "Confirmar retratação"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={retract.isPending}
              onClick={() => {
                setRetracting(false);
                setError(null);
              }}
            >
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

function OccurrenceForm({ studentId, onDone }: { studentId: number; onDone: () => void }) {
  const create = useCreateOccurrence(studentId);
  const [kind, setKind] = useState<OccurrenceKind>("ADVERTENCIA");
  const [occurredAt, setOccurredAt] = useState(todayStamp());
  const [endsAt, setEndsAt] = useState("");
  const [reason, setReason] = useState("");
  const [expel, setExpel] = useState(false);
  const [confirmExpel, setConfirmExpel] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setError(null);
    const body = occurrenceBody({ kind, occurredAt, reason, endsAt, expel });
    try {
      await create.mutateAsync(body);
      toast.success(body.expel ? "Expulsão registrada e matrícula encerrada." : "Ocorrência registrada.");
      onDone();
    } catch (e) {
      setError(occurrenceErrorMessage(e, "Não foi possível registrar a ocorrência. Tente novamente."));
    }
  }

  function submit() {
    if (reason.trim() === "") return setError("Descreva o motivo da ocorrência.");
    if (occurredAt === "") return setError("Informe a data da ocorrência.");
    if (kind === "SUSPENSAO" && endsAt !== "" && endsAt < occurredAt) {
      return setError("O fim da suspensão não pode ser antes da data da ocorrência.");
    }
    setError(null);
    if (kind === "EXPULSAO" && expel) return setConfirmExpel(true);
    void send();
  }

  return (
    <form
      className="grid gap-3 rounded-md border bg-muted/30 p-3"
      data-testid="ocorrencia-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="occ-kind">Tipo</Label>
          <NativeSelect
            id="occ-kind"
            value={kind}
            disabled={create.isPending}
            onChange={(e) => {
              setKind(e.target.value as OccurrenceKind);
              if (e.target.value !== "EXPULSAO") setExpel(false);
            }}
          >
            {(Object.keys(OCCURRENCE_KIND_LABEL) as OccurrenceKind[]).map((k) => (
              <option key={k} value={k}>
                {OCCURRENCE_KIND_LABEL[k]}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="occ-date">Data</Label>
          <Input id="occ-date" type="date" value={occurredAt} disabled={create.isPending} onChange={(e) => setOccurredAt(e.target.value)} />
        </div>
        {kind === "SUSPENSAO" && (
          <div className="grid gap-1.5">
            <Label htmlFor="occ-ends">Fim da suspensão</Label>
            <Input id="occ-ends" type="date" value={endsAt} disabled={create.isPending} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
        )}
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="occ-reason">Motivo</Label>
        <Textarea
          id="occ-reason"
          value={reason}
          maxLength={OCCURRENCE_REASON_MAX}
          disabled={create.isPending}
          onChange={(e) => setReason(e.target.value)}
        />
        <p className="text-right text-xs text-muted-foreground">
          {reason.length}/{OCCURRENCE_REASON_MAX}
        </p>
      </div>
      {kind === "EXPULSAO" && (
        <div className="flex items-start gap-2">
          <Checkbox id="occ-expel" checked={expel} disabled={create.isPending} onCheckedChange={(v) => setExpel(v === true)} />
          <Label htmlFor="occ-expel" className="leading-snug">
            Encerrar a matrícula (expulsão): a pessoa passa a ex-aluna neste grupo.
          </Label>
        </div>
      )}
      {error && (
        <p role="alert" data-testid="ocorrencia-error" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={create.isPending}>
          {create.isPending ? "Registrando…" : "Registrar"}
        </Button>
        <Button type="button" variant="outline" size="sm" disabled={create.isPending} onClick={onDone}>
          Cancelar
        </Button>
      </div>

      <AlertDialog open={confirmExpel} onOpenChange={(open) => !open && !create.isPending && setConfirmExpel(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar expulsão?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta ação encerra a matrícula da pessoa neste grupo: ela passa a ex-aluna e deixa de aparecer entre os alunos
              ativos. A ocorrência fica registrada e só pode ser retratada pelo Mestre.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={create.isPending}>Voltar</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={create.isPending}
              onClick={() => {
                void send().finally(() => setConfirmExpel(false));
              }}
            >
              {create.isPending ? "Registrando…" : "Expulsar e encerrar a matrícula"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  );
}

/**
 * "Ocorrências" da ficha (advertência, suspensão, expulsão, outra). Dado SENSÍVEL: só o papel MESTRE monta esta seção
 * (o backend devolve 403 aos demais papéis). Lista as ocorrências do PRÓPRIO grupo e permite registrar e retratar.
 */
export function OcorrenciasSection({ studentId }: { studentId: number }) {
  const list = useOccurrences(studentId, true);
  const [adding, setAdding] = useState(false);

  return (
    <section className="grid gap-2" data-testid="ficha-ocorrencias">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Ocorrências</h3>
        {!adding && (
          <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)}>
            Registrar ocorrência
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground" data-testid="ocorrencias-aviso">
        {OCCURRENCE_CONFIDENTIAL_NOTICE}
      </p>

      {adding && <OccurrenceForm studentId={studentId} onDone={() => setAdding(false)} />}

      {list.isLoading && <p className="text-sm text-muted-foreground">Carregando as ocorrências…</p>}
      {list.error && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(list.error, "Não foi possível carregar as ocorrências.")}
        </p>
      )}
      {list.data && list.data.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma ocorrência registrada.</p>}
      {list.data && list.data.length > 0 && (
        <ul className="grid gap-1.5">
          {list.data.map((o) => (
            <OccurrenceItem key={o.id} occurrence={o} studentId={studentId} />
          ))}
        </ul>
      )}
    </section>
  );
}
