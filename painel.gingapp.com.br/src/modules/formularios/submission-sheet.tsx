import { useEffect, useState } from "react";
import { Eye, EyeOff, Link2, Paperclip, ShieldOff, UserCheck } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { StrongConfirmDialog } from "@/components/painel/strong-confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  formsErrorMessage,
  useAnonymizeSubmission,
  useIsMestre,
  useSaveInternalNote,
  useSubmission,
  useSubmissionAction,
} from "./api";
import { FileViewer } from "./file-viewer";
import { TextAreaField } from "./form-controls";
import {
  availableActions,
  formatAnswer,
  formatBytes,
  formatDateTime,
  formatPhone,
  type ActionSpec,
} from "./submission-utils";
import {
  PAYMENT_STATUS_LABEL,
  SUBMISSION_STATUS_LABEL,
  SUBMISSION_STATUS_VARIANT,
  type Id,
  type SubmissionDetail,
  type SubmissionFile,
} from "./types";

/** Texto das ações do histórico (o servidor manda um código; o que for desconhecido aparece como veio). */
const TIMELINE_LABEL: Record<string, string> = {
  CREATED: "Inscrição enviada",
  SUBMITTED: "Inscrição enviada",
  PAYMENT_CONFIRMED: "Pagamento confirmado",
  APPROVED: "Inscrição aprovada",
  REJECTED: "Inscrição recusada",
  CANCELLED: "Inscrição cancelada",
  WAITLISTED: "Movida para a lista de espera",
  PROMOTED: "Promovida da lista de espera",
  NOTE_UPDATED: "Nota interna alterada",
  ANONYMIZED: "Inscrição anonimizada",
  STUDENT_LINKED: "Vinculada à ficha de um aluno",
};

interface SubmissionSheetProps {
  formId: Id;
  submissionId: Id | null;
  /** Formulário arquivado: só leitura (sem ações). */
  readOnly: boolean;
  onClose: () => void;
}

/** Detalhe da inscrição (painel lateral; folha de baixo no celular): respostas, comprovantes, histórico, nota e ações. */
export function SubmissionSheet({ formId, submissionId, readOnly, onClose }: SubmissionSheetProps) {
  const isMobile = useIsMobile();
  return (
    <Sheet open={submissionId !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={
          isMobile
            ? "max-h-[92dvh] overflow-y-auto rounded-t-2xl p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            : "w-full overflow-y-auto sm:max-w-lg"
        }
        data-testid="submission-sheet"
      >
        {submissionId !== null && (
          <SubmissionBody formId={formId} submissionId={submissionId} readOnly={readOnly} />
        )}
      </SheetContent>
    </Sheet>
  );
}

function SubmissionBody({
  formId,
  submissionId,
  readOnly,
}: {
  formId: Id;
  submissionId: Id;
  readOnly: boolean;
}) {
  const query = useSubmission(formId, submissionId);
  const action = useSubmissionAction(formId);
  const saveNote = useSaveInternalNote(formId);
  const anonymize = useAnonymizeSubmission(formId);
  const isMestre = useIsMestre();
  const [viewing, setViewing] = useState<SubmissionFile | null>(null);
  const [confirming, setConfirming] = useState<ActionSpec | null>(null);
  // Vínculo com o aluno de mesmo CPF: marcado na faixa (`linkMarked`) e decidido no diálogo (`linkChecked`).
  const [linkMarked, setLinkMarked] = useState(false);
  const [linking, setLinking] = useState<ActionSpec | null>(null);
  const [linkChecked, setLinkChecked] = useState(false);
  const [anonymizing, setAnonymizing] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const data = query.data;

  // A nota é editável: reinicia só quando troca de inscrição ou o valor salvo muda.
  const savedNote = data?.internalNote ?? "";
  useEffect(() => setNote(savedNote), [savedNote, submissionId]);

  if (query.isLoading) {
    return (
      <div className="grid gap-3 pt-6" aria-busy="true" data-testid="submission-loading">
        <SheetHeader>
          <SheetTitle>Inscrição</SheetTitle>
          <SheetDescription>Carregando…</SheetDescription>
        </SheetHeader>
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }
  if (query.error || !data) {
    return (
      <div className="grid gap-3 pt-6">
        <SheetHeader>
          <SheetTitle>Inscrição</SheetTitle>
          <SheetDescription>Não foi possível abrir.</SheetDescription>
        </SheetHeader>
        <p role="alert" className="text-sm text-destructive">
          {formsErrorMessage(query.error, "Inscrição não encontrada.")}
        </p>
        <Button
          type="button"
          variant="outline"
          className="justify-self-start"
          onClick={() => void query.refetch()}
        >
          Tentar de novo
        </Button>
      </div>
    );
  }

  const anonymized = !!data.anonymizedAt;
  // Confirmar pagamento é só do Mestre (o backend responde 403 aos demais): nem aparece para eles.
  const actions = readOnly
    ? []
    : availableActions(data).filter((spec) => isMestre || spec.action !== "confirm-payment");
  const filesByKey = new Map<string, SubmissionFile[]>();
  for (const file of data.files)
    filesByKey.set(file.fieldKey, [...(filesByKey.get(file.fieldKey) ?? []), file]);
  const answeredKeys = new Set(data.answers.map((a) => a.fieldKey));
  const looseFiles = data.files.filter((f) => !answeredKeys.has(f.fieldKey));
  const student = data.suggestedStudent ?? null;
  const hasFileAnswers = data.answers.some((a) => a.type === "FILE" && a.value);
  // Só quem não é Mestre (ou o servidor marcou `filesRestricted`) e só quando há anexo a esconder.
  const filesNote = !anonymized && hasFileAnswers && (data.filesRestricted === true || !isMestre);

  function run(spec: ActionSpec) {
    if (spec.confirm) {
      setReason("");
      setConfirming(spec);
    } else if (student && (spec.action === "confirm-payment" || spec.action === "approve")) {
      setLinkChecked(linkMarked);
      setLinking(spec);
    } else action.mutate({ sid: submissionId, action: spec.action });
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <SheetHeader>
        <SheetTitle className="break-words">{data.name}</SheetTitle>
        <SheetDescription>
          Protocolo <span className="font-mono">{data.protocol}</span> · enviada em{" "}
          {formatDateTime(data.createdAt)}
        </SheetDescription>
        <div className="flex flex-wrap gap-1.5 pt-1">
          <Badge variant={SUBMISSION_STATUS_VARIANT[data.status]}>
            {SUBMISSION_STATUS_LABEL[data.status]}
          </Badge>
          <Badge variant={data.paymentStatus === "PENDING" ? "destructive" : "outline"}>
            {PAYMENT_STATUS_LABEL[data.paymentStatus]}
          </Badge>
          {anonymized && (
            <Badge variant="secondary" data-testid="anonymized-badge">
              Anonimizada
            </Badge>
          )}
        </div>
      </SheetHeader>

      {anonymized && (
        <p
          role="status"
          className="flex items-start gap-2 rounded-md border bg-muted/50 p-3 text-sm"
          data-testid="anonymized-notice"
        >
          <ShieldOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Esta inscrição foi anonimizada em {formatDateTime(data.anonymizedAt!)}: nome, contatos,
            respostas e comprovantes foram removidos. O protocolo e a contagem continuam. Não há
            mais ações possíveis.
          </span>
        </p>
      )}

      {actions.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Ações da inscrição">
          {actions.map((spec) => (
            <Button
              key={spec.action}
              type="button"
              variant={spec.variant ?? "outline"}
              size="sm"
              disabled={action.isPending || anonymized}
              onClick={() => run(spec)}
            >
              {spec.label}
            </Button>
          ))}
        </div>
      )}

      {student && !anonymized && !readOnly && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm"
          data-testid="student-suggestion"
        >
          <p className="flex min-w-0 items-start gap-2">
            <UserCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span className="break-words">
              {linkMarked
                ? `Vínculo marcado: ao aprovar ou confirmar o pagamento, esta inscrição será ligada à ficha de ${student.name}.`
                : `Este CPF pertence ao aluno ${student.name}. Vincular à ficha dele?`}
            </span>
          </p>
          <Button
            type="button"
            variant={linkMarked ? "ghost" : "outline"}
            size="sm"
            onClick={() => setLinkMarked((value) => !value)}
          >
            <Link2 /> {linkMarked ? "Desfazer" : "Vincular"}
          </Button>
        </div>
      )}

      <Identification data={data} />

      <section aria-label="Respostas" className="grid gap-2">
        <h3 className="text-sm font-semibold">Respostas</h3>
        {data.answers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem respostas registradas.</p>
        ) : (
          <dl className="grid gap-3">
            {data.answers.map((answer) => {
              const files = filesByKey.get(answer.fieldKey) ?? [];
              return (
                <div key={answer.fieldKey} className="grid gap-0.5" data-testid="submission-answer">
                  <dt className="text-xs text-muted-foreground">{answer.label}</dt>
                  <dd className="min-w-0 break-words text-sm">
                    {answer.type === "FILE" && files.length > 0 ? (
                      <FileList files={files} canView={isMestre} onView={setViewing} />
                    ) : (
                      <span className="whitespace-pre-line">{formatAnswer(answer)}</span>
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
        {looseFiles.length > 0 && (
          <div className="grid gap-1">
            <p className="text-xs text-muted-foreground">Anexos</p>
            <FileList files={looseFiles} canView={isMestre} onView={setViewing} />
          </div>
        )}
        {filesNote && (
          <p
            className="flex items-center gap-2 rounded-md border bg-muted/40 p-2 text-xs text-muted-foreground"
            data-testid="files-restricted"
          >
            <EyeOff className="size-4 shrink-0" aria-hidden /> Somente o Mestre vê comprovantes.
          </p>
        )}
      </section>

      {data.reviewNote && (
        <p className="rounded-md border bg-muted/40 p-3 text-sm">
          <span className="font-medium">Motivo informado: </span>
          {data.reviewNote}
        </p>
      )}

      <section aria-label="Anotações da equipe" className="grid gap-2">
        <TextAreaField
          label="Nota interna"
          hint="Só a equipe vê. Não aparece para o inscrito."
          rows={3}
          maxLength={2000}
          value={note}
          disabled={readOnly || anonymized}
          onChange={(e) => setNote(e.target.value)}
        />
        {!readOnly && !anonymized && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start"
            disabled={note === savedNote || saveNote.isPending}
            onClick={() => saveNote.mutate({ sid: submissionId, internalNote: note })}
          >
            Salvar nota
          </Button>
        )}
      </section>

      <section aria-label="Histórico" className="grid gap-2">
        <h3 className="text-sm font-semibold">Histórico</h3>
        {data.timeline.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nada registrado ainda.</p>
        ) : (
          <ol className="grid gap-2 border-l pl-3">
            {data.timeline.map((entry, index) => (
              <li
                key={`${entry.at}-${String(index)}`}
                className="text-sm"
                data-testid="submission-timeline-entry"
              >
                <p className="font-medium">{TIMELINE_LABEL[entry.action] ?? entry.action}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(entry.at)}
                  {entry.by ? ` · ${entry.by}` : ""}
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {isMestre && !anonymized && (
        <section aria-label="Privacidade" className="grid gap-2 border-t pt-4">
          <h3 className="text-sm font-semibold">Privacidade (LGPD)</h3>
          <p className="text-xs text-muted-foreground">
            Para atender um pedido de exclusão de dados, anonimize esta inscrição.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="justify-self-start text-destructive"
            disabled={anonymize.isPending}
            onClick={() => setAnonymizing(true)}
          >
            <ShieldOff /> Anonimizar inscrição
          </Button>
        </section>
      )}

      <FileViewer
        formId={formId}
        submissionId={submissionId}
        file={viewing}
        onClose={() => setViewing(null)}
      />

      <ConfirmDialog
        open={linking !== null}
        onOpenChange={(open) => !open && setLinking(null)}
        variant="default"
        title={linking?.action === "approve" ? "Aprovar esta inscrição?" : "Confirmar o pagamento?"}
        description={
          <span className="grid gap-3">
            <span>{`Inscrição de ${data.name} (${data.protocol}).`}</span>
            {student && (
              <label className="flex min-h-11 items-start gap-2 text-left text-foreground">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-[var(--color-primary)]"
                  checked={linkChecked}
                  onChange={(e) => setLinkChecked(e.target.checked)}
                />
                <span className="text-sm">{`Vincular ao aluno ${student.name}`}</span>
              </label>
            )}
          </span>
        }
        confirmLabel={linking?.label ?? "Confirmar"}
        cancelLabel="Voltar"
        onConfirm={() => {
          if (!linking) return undefined;
          return action.mutateAsync({
            sid: submissionId,
            action: linking.action,
            ...(linkChecked && student ? { linkStudentId: Number(student.id) } : {}),
          });
        }}
      />

      <StrongConfirmDialog
        open={anonymizing}
        onOpenChange={setAnonymizing}
        title="Anonimizar esta inscrição?"
        description="Remove nome, contatos, respostas e comprovantes; mantém o protocolo e a contagem. Não pode ser desfeito."
        phrase="APAGAR"
        confirmLabel="Anonimizar definitivamente"
        onConfirm={() => anonymize.mutateAsync(submissionId)}
      />

      <ConfirmDialog
        open={confirming?.confirm === "cancel"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Cancelar esta inscrição?"
        description={`A inscrição de ${data.name} (${data.protocol}) será cancelada e a vaga é liberada.`}
        confirmLabel="Cancelar inscrição"
        cancelLabel="Voltar"
        onConfirm={() => action.mutateAsync({ sid: submissionId, action: "cancel" })}
      />
      <ConfirmDialog
        open={confirming?.confirm === "reject"}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Recusar esta inscrição?"
        description={
          <span className="grid gap-2">
            <span>{`A inscrição de ${data.name} (${data.protocol}) será recusada.`}</span>
            <label className="grid gap-1 text-left text-foreground">
              <span className="text-sm font-medium">Motivo (opcional)</span>
              <textarea
                className="min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          </span>
        }
        confirmLabel="Recusar inscrição"
        cancelLabel="Voltar"
        onConfirm={() =>
          action.mutateAsync({ sid: submissionId, action: "reject", reason: reason.trim() })
        }
      />
    </div>
  );
}

function Identification({ data }: { data: SubmissionDetail }) {
  const rows: [string, string | null][] = [
    ["E-mail", data.email],
    ["Telefone", data.phone ? formatPhone(data.phone) : null],
    ["Documento", data.document],
  ];
  return (
    <dl
      className="grid gap-2 rounded-md border bg-muted/30 p-3 text-sm sm:grid-cols-2"
      aria-label="Identificação"
    >
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="break-all">{value || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function FileList({
  files,
  canView,
  onView,
}: {
  files: SubmissionFile[];
  /** Só o Mestre baixa/abre comprovantes (os demais recebem 403). */
  canView: boolean;
  onView: (file: SubmissionFile) => void;
}) {
  return (
    <ul className="grid gap-1.5">
      {files.map((file) => (
        <li
          key={String(file.id)}
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2"
        >
          <span className="flex min-w-0 items-center gap-1.5 text-sm">
            <Paperclip className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="break-all">{file.originalName}</span>
            <span className="shrink-0 text-xs text-muted-foreground">
              ({formatBytes(file.sizeBytes)})
            </span>
          </span>
          {canView && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-label={`Ver comprovante ${file.originalName}`}
              onClick={() => onView(file)}
            >
              <Eye /> Ver comprovante
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
