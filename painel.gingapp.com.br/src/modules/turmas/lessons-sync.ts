import { plural } from "@/lib/plural";
import type { ClassStatus } from "./schema";

/**
 * Resultado da troca do dia da semana de uma turma (campo opcional `lessonsSync` da resposta do PATCH /classes/:id).
 * Só vem quando o servidor aplicou a regra (weekday número -> outro número, turma ATIVA e com aulas contínuas).
 * `created` é `null` quando a geração das aulas novas falhou e ficou para o job diário.
 */
export interface ClassLessonsSync {
  cancelled: number;
  kept: number;
  created: number | null;
  oldWeekday: number;
  newWeekday: number;
}

/** Aviso mostrado no formulário de edição ANTES de salvar, quando o dia da semana muda (texto do contrato). */
export const WEEKDAY_CHANGE_WARNING =
  "Ao salvar, as aulas futuras do dia antigo que não têm presença, aviso de ausência nem observação serão canceladas e novas aulas serão geradas no dia novo.";

/** Texto de "mantidas" (só quando `kept > 0`). */
function keptSentence(kept: number): string {
  return kept === 1
    ? "1 aula do dia antigo foi mantida por ter presença, aviso ou observação — revise em Aulas."
    : `${kept} aulas do dia antigo foram mantidas por terem presença, aviso ou observação — revise em Aulas.`;
}

/**
 * Mensagem exibida depois de salvar, conforme o `lessonsSync` do PATCH:
 * - "Dia alterado: N aulas do dia antigo canceladas, M geradas no dia novo."
 * - `created === null`: "Dia alterado: N aulas do dia antigo canceladas. As novas aulas serão geradas automaticamente em breve."
 * - `kept > 0`: acrescenta "K aulas do dia antigo foram mantidas por terem presença, aviso ou observação — revise em Aulas."
 */
export function lessonsSyncMessage(sync: Pick<ClassLessonsSync, "cancelled" | "kept" | "created">): string {
  const cancelled = `${plural(sync.cancelled, "aula")} do dia antigo ${sync.cancelled === 1 ? "cancelada" : "canceladas"}`;
  const head =
    sync.created === null
      ? `Dia alterado: ${cancelled}. As novas aulas serão geradas automaticamente em breve.`
      : `Dia alterado: ${cancelled}, ${sync.created} ${sync.created === 1 ? "gerada" : "geradas"} no dia novo.`;
  return sync.kept > 0 ? `${head} ${keptSentence(sync.kept)}` : head;
}

/**
 * Mostrar o aviso de troca de dia? Só na EDIÇÃO, quando a turma já tinha dia da semana e o formulário agora aponta para
 * OUTRO dia (não vazio), com "Aulas contínuas" ligado e status Ativa — as mesmas condições em que o servidor aplica a regra.
 * `newWeekday` é o valor do campo (string: "" = sem dia, "0".."6").
 */
export function shouldWarnWeekdayChange(args: {
  isEdit: boolean;
  originalWeekday: number | null | undefined;
  newWeekday: string | undefined;
  autoGenerateLessons: boolean | undefined;
  status: ClassStatus | undefined;
}): boolean {
  const { isEdit, originalWeekday, newWeekday, autoGenerateLessons, status } = args;
  if (!isEdit) return false;
  if (originalWeekday === null || originalWeekday === undefined) return false;
  if (newWeekday === undefined || newWeekday === "") return false;
  if (Number(newWeekday) === originalWeekday) return false;
  return autoGenerateLessons === true && status === "ACTIVE";
}
