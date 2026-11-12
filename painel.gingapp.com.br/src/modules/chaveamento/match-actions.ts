import { useState } from "react";
import { useAnnounce } from "./announce-context";
import { useRecordResult, useStartMatch, useUndoMatch, useUpdateMatch } from "./api";
import { chaveamentoErrorMessage } from "./errors";
import { competitorMap, EMPTY_SLOT, parseOptionalInt, sideName } from "./helpers";
import { useQuickUndo } from "./quick-undo-context";
import { LIMITS, type OperatorCategory, type OperatorMatch, type ResultType } from "./types";

/**
 * Ações do operador sobre UMA luta (iniciar, resultado, desfazer, tatame/ordem), compartilhadas pela ação rápida (bottom
 * sheet) e pela mesa de controle: mesma validação, mesmas mensagens, mesmo anúncio para leitor de tela. O resultado
 * salvo abre a janela do "desfazer rápido" (barra por ~10 s).
 */
export function useMatchActions(eventId: number, category: OperatorCategory, match: OperatorMatch) {
  const announce = useAnnounce();
  const quick = useQuickUndo();
  const start = useStartMatch(eventId);
  const record = useRecordResult(eventId);
  const undo = useUndoMatch(eventId);
  const update = useUpdateMatch(eventId);
  const [error, setError] = useState("");
  const busy = start.isPending || record.isPending || undo.isPending || update.isPending;

  const competitors = competitorMap(category);
  const titleA = sideName(competitors, match.slotAId) ?? EMPTY_SLOT;
  const titleB = sideName(competitors, match.slotBId) ?? EMPTY_SLOT;

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setError("");
    try {
      return await action();
    } catch (e) {
      setError(chaveamentoErrorMessage(e));
      return undefined;
    }
  }

  const scoreError = `O placar deve ser um número inteiro de 0 a ${String(LIMITS.scoreMax)}.`;

  /** Inicia a luta. */
  async function onStart(): Promise<boolean> {
    const done = await run(() => start.mutateAsync(match.id));
    if (done) announce(`Luta iniciada: ${titleA} contra ${titleB}.`);
    return Boolean(done);
  }

  /** Registra o vencedor (`winnerId`) com placar opcional (texto dos campos) e tipo de resultado. */
  async function onWinner(winnerId: number, winnerName: string, scoreA: string, scoreB: string, resultType: ResultType): Promise<boolean> {
    const a = parseOptionalInt(scoreA, 0, LIMITS.scoreMax);
    const b = parseOptionalInt(scoreB, 0, LIMITS.scoreMax);
    if (a === undefined || b === undefined) {
      setError(scoreError);
      return false;
    }
    const done = await run(() => record.mutateAsync({ matchId: match.id, body: { winnerId, scoreA: a, scoreB: b, resultType } }));
    if (!done) return false;
    announce(`Resultado salvo: ${winnerName} venceu ${titleA} contra ${titleB}.`);
    quick.offer({ matchId: match.id, categoryId: category.id, label: `${winnerName} venceu · ${category.name}` });
    return true;
  }

  /** Empate (só na fase de grupos). */
  async function onDraw(scoreA: string, scoreB: string): Promise<boolean> {
    const a = parseOptionalInt(scoreA, 0, LIMITS.scoreMax);
    const b = parseOptionalInt(scoreB, 0, LIMITS.scoreMax);
    if (a === undefined || b === undefined) {
      setError(scoreError);
      return false;
    }
    const done = await run(() => record.mutateAsync({ matchId: match.id, body: { scoreA: a, scoreB: b, resultType: "DRAW" } }));
    if (!done) return false;
    announce(`Resultado salvo: empate entre ${titleA} e ${titleB}.`);
    quick.offer({ matchId: match.id, categoryId: category.id, label: `Empate · ${category.name}` });
    return true;
  }

  /** Desfazer com o servidor (a CONFIRMAÇÃO fica por conta da tela; o desfazer rápido pula a confirmação). */
  async function onUndo(): Promise<boolean> {
    const done = await run(() => undo.mutateAsync(match.id));
    if (done) {
      if (quick.current?.matchId === match.id) quick.dismiss();
      announce(`Luta desfeita: ${titleA} contra ${titleB}.`);
    }
    return Boolean(done);
  }

  async function onSaveSchedule(mat: string, queue: string): Promise<boolean> {
    const matValue = parseOptionalInt(mat, 0, LIMITS.matMax);
    const queueValue = parseOptionalInt(queue, 0, LIMITS.queueOrderMax);
    if (matValue === undefined) {
      setError(`Tatame: informe um número de 0 a ${String(LIMITS.matMax)} (vazio = sem tatame).`);
      return false;
    }
    if (queueValue === undefined) {
      setError(`Ordem: informe um número de 0 a ${String(LIMITS.queueOrderMax)} (vazio = sem ordem).`);
      return false;
    }
    const done = await run(() => update.mutateAsync({ matchId: match.id, data: { mat: matValue, queueOrder: queueValue } }));
    return Boolean(done);
  }

  return { error, setError, busy, titleA, titleB, competitors, onStart, onWinner, onDraw, onUndo, onSaveSchedule };
}
