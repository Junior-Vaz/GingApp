import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { REPORT_NOTE_MAX, feedErrorMessage, useReport, type ReportReason } from "@/lib/feed";
import { FeedSheet } from "./feed-sheet";

const REPORT_REASONS: readonly { value: ReportReason; label: string }[] = [
  { value: "OFENSIVO", label: "Ofensivo ou desrespeitoso" },
  { value: "IMPROPRIO", label: "Conteúdo impróprio" },
  { value: "SPAM", label: "Spam ou propaganda" },
  { value: "MENOR", label: "Expõe um menor de idade" },
  { value: "OUTRO", label: "Outro motivo" },
];

export interface ReportTarget {
  kind: "post" | "comment";
  id: number;
}

/** Denúncia de post ou comentário: motivo obrigatório + observação opcional (300). */
export function ReportSheet({ target, onClose }: { target: ReportTarget | null; onClose: () => void }) {
  const report = useReport();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const open = target !== null;

  // Cada denúncia começa limpa.
  useEffect(() => {
    if (!open) return;
    setReason(null);
    setNote("");
    report.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, target?.kind, target?.id]);

  function submit() {
    if (!target || !reason || report.isPending) return;
    const trimmed = note.trim();
    report.mutate(
      { kind: target.kind, id: target.id, reason, ...(trimmed ? { note: trimmed } : {}) },
      {
        onSuccess: () => {
          toast.success("Denúncia enviada. Obrigado por ajudar a cuidar do grupo.");
          onClose();
        },
        onError: (error) => {
          if (error instanceof ApiError && error.status === 409) {
            toast.info("Você já denunciou este conteúdo.");
            onClose();
            return;
          }
          toast.error(feedErrorMessage(error, "Não foi possível enviar a denúncia. Tente de novo."));
        },
      },
    );
  }

  return (
    <FeedSheet
      open={open}
      onOpenChange={(next) => !next && !report.isPending && onClose()}
      title={target?.kind === "comment" ? "Denunciar comentário" : "Denunciar publicação"}
      description="Sua denúncia é anônima para o grupo. A equipe vai analisar."
      testId="report-sheet"
    >
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <fieldset className="grid gap-1" disabled={report.isPending}>
          <legend className="mb-1 text-sm font-semibold">Qual é o problema?</legend>
          {REPORT_REASONS.map((item) => (
            <label
              key={item.value}
              className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-secondary"
            >
              <input
                type="radio"
                name="report-reason"
                value={item.value}
                checked={reason === item.value}
                onChange={() => setReason(item.value)}
                className="size-4 accent-[var(--primary)]"
              />
              {item.label}
            </label>
          ))}
        </fieldset>
        <label className="field-label" htmlFor="report-note">
          Quer explicar melhor? (opcional)
        </label>
        <Textarea
          id="report-note"
          value={note}
          maxLength={REPORT_NOTE_MAX}
          rows={3}
          disabled={report.isPending}
          onChange={(event) => setNote(event.target.value.slice(0, REPORT_NOTE_MAX))}
        />
        <p className="mt-1 text-right text-xs text-muted-foreground" aria-live="polite">
          {note.length}/{REPORT_NOTE_MAX}
        </p>
        <Button type="button" className="mt-3 h-11 w-full" disabled={!reason || report.isPending} onClick={submit} data-testid="report-submit">
          {report.isPending ? "Enviando…" : "Enviar denúncia"}
        </Button>
      </div>
    </FeedSheet>
  );
}
