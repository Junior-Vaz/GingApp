/**
 * Privacidade das listas de participantes (eventos e rodas) — LGPD, menor privilégio.
 *
 * Para quem NÃO organiza (ALUNO/RESPONSAVEL, membros de outro grupo, anônimos), a lista de
 * participantes continua com o MESMO formato e o mesmo tamanho (o app usa `length` para o
 * "N na roda" e procura a própria participação nela para cancelar), mas as entradas de
 * TERCEIROS saem sem identificação: sem studentId/userId/guestName e sem `student`/`user`
 * (nomes). A própria participação (e a de dependentes) vem completa.
 */
export function redactParticipant<T extends object>(participant: T): T {
  const redacted = { ...participant } as Record<string, unknown>;
  for (const key of ['studentId', 'userId', 'guestName', 'student', 'user'] as const) {
    if (key in redacted) redacted[key] = null;
  }
  return redacted as T;
}

/** Resumo de participação anexado a cada item das listagens GET /events e GET /rodas: evita o
 * N+1 do app (antes: um GET .../participants por card). */
export interface MyParticipation {
  /** id do EventParticipant/RodaParticipant — o que o app passa no DELETE .../participants/:id. */
  id: number;
  studentId: number | null;
  status: string;
}
