/** Item de GET /attendance/lessons/:lessonId (present === null: chamada ainda não feita). */
export interface RosterEntry {
  studentId: number;
  studentName: string;
  present: boolean | null;
  justification: string | null;
}

/** Linha editável da chamada. `present: null` = o professor ainda não decidiu. */
export interface RosterRow {
  studentId: number;
  studentName: string;
  present: boolean | null;
  justification: string;
}

/** Item de POST /attendance/lessons/:lessonId (corpo é um array). */
export interface AttendancePayloadEntry {
  studentId: number;
  present: boolean;
  justification?: string;
}

export function toRows(entries: RosterEntry[]): RosterRow[] {
  return entries.map((e) => ({
    studentId: e.studentId,
    studentName: e.studentName,
    present: e.present,
    justification: e.justification ?? "",
  }));
}

/** Ciclo do checkbox: sem marcação -> presente -> falta -> presente... */
export function nextPresence(current: boolean | null): boolean {
  return current === null ? true : !current;
}

export function setPresence(rows: RosterRow[], studentId: number, present: boolean): RosterRow[] {
  return rows.map((r) => (r.studentId === studentId ? { ...r, present } : r));
}

export function setJustification(rows: RosterRow[], studentId: number, justification: string): RosterRow[] {
  return rows.map((r) => (r.studentId === studentId ? { ...r, justification } : r));
}

/** Marca todos (ou só os ainda sem marcação, com `onlyUndecided`) como presentes/ausentes. */
export function markAll(rows: RosterRow[], present: boolean, onlyUndecided = false): RosterRow[] {
  return rows.map((r) => (onlyUndecided && r.present !== null ? r : { ...r, present }));
}

export function summarize(rows: RosterRow[]) {
  const present = rows.filter((r) => r.present === true).length;
  const absent = rows.filter((r) => r.present === false).length;
  return { total: rows.length, present, absent, undecided: rows.length - present - absent };
}

/**
 * Corpo da chamada em lote. Só envia alunos com decisão (presente/falta): quem segue sem marcação
 * continua "sem chamada" no backend em vez de virar falta por engano. A justificativa só vale para
 * falta (como no Vue) e é omitida quando vazia.
 */
export function buildPayload(rows: RosterRow[]): AttendancePayloadEntry[] {
  return rows
    .filter((r) => r.present !== null)
    .map((r) => {
      const present = r.present === true;
      const justification = present ? undefined : r.justification.trim() || undefined;
      return { studentId: r.studentId, present, ...(justification ? { justification } : {}) };
    });
}
