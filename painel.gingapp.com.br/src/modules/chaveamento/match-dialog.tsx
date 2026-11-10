import { useEffect, useState } from "react";
import { Play, Undo2 } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/modules/rodas/native-select";
import { useAnnounce } from "./announce-context";
import { useRecordResult, useStartMatch, useUndoMatch, useUpdateMatch } from "./api";
import { chaveamentoErrorMessage } from "./errors";
import { competitorMap, EMPTY_SLOT, lastMainRound, matLabel, parseOptionalInt, scoreText, sideName, stageLabel, statusText } from "./helpers";
import { LIMITS, MATCH_STATUS_LABEL, RESULT_TYPE_LABEL, type OperatorCategory, type OperatorMatch, type ResultType } from "./types";

interface MatchDialogProps {
  eventId: number;
  category: OperatorCategory;
  matchId: number | null;
  canEdit: boolean;
  onClose: () => void;
}

/**
 * Luta aberta: no celular vira bottom sheet (o DialogContent já ancora no rodapé em telas pequenas) e no desktop, caixa
 * de diálogo. Mostra sempre a luta MAIS RECENTE da categoria (a consulta de 5 s atualiza por baixo).
 */
export function MatchDialog({ eventId, category, matchId, canEdit, onClose }: MatchDialogProps) {
  const match = matchId === null ? null : (category.matches.find((m) => m.id === matchId) ?? null);
  // A luta pode sumir (ex.: mata-mata apagado por um desfazer em grupos): fecha em vez de mostrar uma luta fantasma.
  useEffect(() => {
    if (matchId !== null && match === null) onClose();
  }, [matchId, match, onClose]);

  return (
    <Dialog open={match !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg" data-testid="match-dialog">
        {match && <MatchPanel key={match.id} eventId={eventId} category={category} match={match} canEdit={canEdit} onClose={onClose} />}
      </DialogContent>
    </Dialog>
  );
}

function MatchPanel({
  eventId,
  category,
  match,
  canEdit,
  onClose,
}: {
  eventId: number;
  category: OperatorCategory;
  match: OperatorMatch;
  canEdit: boolean;
  onClose: () => void;
}) {
  const announce = useAnnounce();
  const competitors = competitorMap(category);
  const start = useStartMatch(eventId);
  const record = useRecordResult(eventId);
  const undo = useUndoMatch(eventId);
  const update = useUpdateMatch(eventId);
  const busy = start.isPending || record.isPending || undo.isPending || update.isPending;

  const [error, setError] = useState("");
  const [confirmUndo, setConfirmUndo] = useState(false);
  const [resultType, setResultType] = useState<ResultType>("NORMAL");
  const [scoreA, setScoreA] = useState(match.scoreA === null ? "" : String(match.scoreA));
  const [scoreB, setScoreB] = useState(match.scoreB === null ? "" : String(match.scoreB));
  const [mat, setMat] = useState(match.mat === null ? "" : String(match.mat));
  const [queue, setQueue] = useState(match.queueOrder === null ? "" : String(match.queueOrder));

  const nameA = sideName(competitors, match.slotAId);
  const nameB = sideName(competitors, match.slotBId);
  const titleA = nameA ?? EMPTY_SLOT;
  const titleB = nameB ?? EMPTY_SLOT;
  const hasBoth = match.slotAId !== null && match.slotBId !== null;
  const lastRound = lastMainRound(category.matches);
  const canScore = canEdit && !match.isBye && hasBoth && (match.status === "READY" || match.status === "LIVE");

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setError("");
    try {
      return await action();
    } catch (e) {
      setError(chaveamentoErrorMessage(e));
      return undefined;
    }
  }

  async function onStart() {
    const done = await run(() => start.mutateAsync(match.id));
    if (done) announce(`Luta iniciada: ${titleA} contra ${titleB}.`);
  }

  async function onWinner(winnerId: number, winnerName: string) {
    const a = parseOptionalInt(scoreA, 0, LIMITS.scoreMax);
    const b = parseOptionalInt(scoreB, 0, LIMITS.scoreMax);
    if (a === undefined || b === undefined) {
      setError(`O placar deve ser um número inteiro de 0 a ${String(LIMITS.scoreMax)}.`);
      return;
    }
    const done = await run(() =>
      record.mutateAsync({ matchId: match.id, body: { winnerId, scoreA: a, scoreB: b, resultType } }),
    );
    if (done) {
      announce(`Resultado salvo: ${winnerName} venceu ${titleA} contra ${titleB}.`);
      onClose();
    }
  }

  async function onDraw() {
    const a = parseOptionalInt(scoreA, 0, LIMITS.scoreMax);
    const b = parseOptionalInt(scoreB, 0, LIMITS.scoreMax);
    if (a === undefined || b === undefined) {
      setError(`O placar deve ser um número inteiro de 0 a ${String(LIMITS.scoreMax)}.`);
      return;
    }
    const done = await run(() => record.mutateAsync({ matchId: match.id, body: { scoreA: a, scoreB: b, resultType: "DRAW" } }));
    if (done) {
      announce(`Resultado salvo: empate entre ${titleA} e ${titleB}.`);
      onClose();
    }
  }

  async function onUndo() {
    const done = await run(() => undo.mutateAsync(match.id));
    if (done) announce(`Luta desfeita: ${titleA} contra ${titleB}.`);
  }

  async function onSaveSchedule() {
    const matValue = parseOptionalInt(mat, 0, LIMITS.matMax);
    const queueValue = parseOptionalInt(queue, 0, LIMITS.queueOrderMax);
    if (matValue === undefined) return setError(`Tatame: informe um número de 0 a ${String(LIMITS.matMax)} (vazio = sem tatame).`);
    if (queueValue === undefined) return setError(`Ordem: informe um número de 0 a ${String(LIMITS.queueOrderMax)} (vazio = sem ordem).`);
    await run(() => update.mutateAsync({ matchId: match.id, data: { mat: matValue, queueOrder: queueValue } }));
  }

  const score = scoreText(match);
  const winnerName = match.winnerId === null ? null : sideName(competitors, match.winnerId);

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {titleA} <span className="font-normal text-muted-foreground">x</span> {titleB}
        </DialogTitle>
        <DialogDescription>
          {stageLabel(match, lastRound)}
          {match.stage === "GROUP" && match.groupIndex !== null && category.format === "GROUPS_KNOCKOUT" ? ` · Grupo ${String.fromCharCode(65 + match.groupIndex)}` : ""}
          {" · "}
          <Badge variant={match.status === "LIVE" ? "destructive" : "outline"} className="align-middle">
            {match.status === "LIVE" ? "AO VIVO" : statusText(match)}
          </Badge>
          {matLabel(match.mat) ? ` · ${matLabel(match.mat) ?? ""}` : ""}
        </DialogDescription>
      </DialogHeader>

      {error && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" data-testid="match-error">
          {error}
        </p>
      )}

      {match.isBye ? (
        <p className="text-sm text-muted-foreground">Folga: este atleta avança automaticamente. Não há luta para registrar.</p>
      ) : match.status === "PENDING" || !hasBoth ? (
        <p className="text-sm text-muted-foreground">Aguardando os atletas das lutas anteriores. Termine essas lutas primeiro.</p>
      ) : null}

      {match.status === "FINISHED" && !match.isBye && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm" data-testid="match-result">
          <p className="font-semibold">
            {winnerName ? `Vencedor: ${winnerName}` : match.resultType === "DRAW" ? "Empate" : "Encerrada"}
          </p>
          <p className="text-muted-foreground">
            {[score ? `Placar ${score}` : null, match.resultType ? RESULT_TYPE_LABEL[match.resultType] : null].filter(Boolean).join(" · ") || MATCH_STATUS_LABEL.FINISHED}
          </p>
        </div>
      )}

      {!canEdit && <p className="text-sm text-muted-foreground">Somente leitura: seu papel não permite registrar resultados.</p>}

      {canEdit && match.status === "READY" && !match.isBye && hasBoth && (
        <Button type="button" variant="outline" size="lg" className="h-12" disabled={busy} onClick={() => void onStart()}>
          <Play /> Iniciar luta
        </Button>
      )}

      {canScore && (
        <fieldset className="grid gap-3" disabled={busy}>
          <legend className="sr-only">Registrar resultado</legend>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="match-score-a">Placar de {titleA}</Label>
              <Input id="match-score-a" inputMode="numeric" value={scoreA} onChange={(e) => setScoreA(e.target.value)} placeholder="0" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="match-score-b">Placar de {titleB}</Label>
              <Input id="match-score-b" inputMode="numeric" value={scoreB} onChange={(e) => setScoreB(e.target.value)} placeholder="0" />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="match-type">Tipo de resultado</Label>
            <NativeSelect id="match-type" value={resultType} onChange={(e) => setResultType(e.target.value as ResultType)}>
              <option value="NORMAL">{RESULT_TYPE_LABEL.NORMAL}</option>
              <option value="WALKOVER">{RESULT_TYPE_LABEL.WALKOVER} (o adversário não compareceu)</option>
              <option value="DISQUALIFICATION">{RESULT_TYPE_LABEL.DISQUALIFICATION}</option>
              {match.stage === "GROUP" && <option value="DRAW">{RESULT_TYPE_LABEL.DRAW} (só na fase de grupos)</option>}
            </NativeSelect>
          </div>
          {resultType === "DRAW" ? (
            <Button type="button" size="lg" className="h-14 whitespace-normal text-base" onClick={() => void onDraw()}>
              Registrar empate
            </Button>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              <Button
                type="button"
                size="lg"
                className="h-auto min-h-14 whitespace-normal py-2 text-base"
                onClick={() => void onWinner(match.slotAId!, titleA)}
              >
                Vencedor: {titleA}
              </Button>
              <Button
                type="button"
                size="lg"
                className="h-auto min-h-14 whitespace-normal py-2 text-base"
                onClick={() => void onWinner(match.slotBId!, titleB)}
              >
                Vencedor: {titleB}
              </Button>
            </div>
          )}
        </fieldset>
      )}

      {canEdit && !match.isBye && (
        <fieldset className="grid gap-3 border-t pt-3" disabled={busy}>
          <legend className="sr-only">Tatame e ordem de chamada</legend>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="match-mat">Tatame (0 a {LIMITS.matMax})</Label>
              <Input id="match-mat" inputMode="numeric" value={mat} onChange={(e) => setMat(e.target.value)} placeholder="Sem tatame" />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="match-queue">Ordem de chamada</Label>
              <Input id="match-queue" inputMode="numeric" value={queue} onChange={(e) => setQueue(e.target.value)} placeholder="Sem ordem" />
            </div>
          </div>
          <Button type="button" variant="secondary" onClick={() => void onSaveSchedule()}>
            Salvar tatame e ordem
          </Button>
        </fieldset>
      )}

      {canEdit && !match.isBye && (match.status === "LIVE" || match.status === "FINISHED") && (
        <Button type="button" variant="outline" className="h-12 border-destructive/50 text-destructive" disabled={busy} onClick={() => setConfirmUndo(true)}>
          <Undo2 /> Desfazer
        </Button>
      )}

      <ConfirmDialog
        open={confirmUndo}
        onOpenChange={setConfirmUndo}
        title={match.status === "FINISHED" ? "Desfazer o resultado?" : "Desfazer o início da luta?"}
        description={
          match.status === "FINISHED"
            ? `O resultado de ${titleA} contra ${titleB} será apagado e a luta volta a "${MATCH_STATUS_LABEL.READY}". O vencedor sai da próxima luta.`
            : `A luta ${titleA} contra ${titleB} volta a "${MATCH_STATUS_LABEL.READY}".`
        }
        confirmLabel="Desfazer"
        onConfirm={() => onUndo()}
      />
    </>
  );
}
