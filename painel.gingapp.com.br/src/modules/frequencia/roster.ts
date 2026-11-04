/** Como a presença foi registrada pelo próprio aluno: QR da aula ou localização (GPS). Nulo = chamada manual. */
export type CheckinSource = "QR" | "GEO";

/** Texto do selo discreto "Check-in por …" (ou null quando a presença veio da chamada manual). */
export function checkinSourceLabel(source: CheckinSource | null | undefined): string | null {
  if (source === "GEO") return "Check-in por GPS";
  if (source === "QR") return "Check-in por QR";
  return null;
}

/** Item de GET /attendance/lessons/:lessonId (present === null: chamada ainda não feita). */
export interface RosterEntry {
  studentId: number;
  studentName: string;
  present: boolean | null;
  justification: string | null;
  /** Foto do aluno (caminho de /uploads ou URL http(s)); ausente/nula = iniciais. */
  photo?: string | null;
  /** Origem do check-in feito pelo aluno (QR/GEO); nulo/ausente = marcada à mão pelo professor. */
  checkinSource?: CheckinSource | null;
}

/** Linha editável da chamada. `present: null` = o professor ainda não decidiu. */
export interface RosterRow {
  studentId: number;
  studentName: string;
  present: boolean | null;
  justification: string;
  photo: string | null;
  /** Origem do check-in do aluno; some assim que o professor muda a marcação desta linha (o servidor também zera). */
  checkinSource: CheckinSource | null;
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
    photo: e.photo ?? null,
    checkinSource: e.checkinSource ?? null,
  }));
}

/** Ciclo do checkbox: sem marcação -> presente -> falta -> presente... */
export function nextPresence(current: boolean | null): boolean {
  return current === null ? true : !current;
}

export function setPresence(rows: RosterRow[], studentId: number, present: boolean): RosterRow[] {
  // Mudar a marcação à mão tira o selo de check-in (o servidor também volta `checkinSource` para null).
  return rows.map((r) =>
    r.studentId === studentId ? { ...r, present, checkinSource: r.present === present ? r.checkinSource : null } : r,
  );
}

export function setJustification(rows: RosterRow[], studentId: number, justification: string): RosterRow[] {
  return rows.map((r) => (r.studentId === studentId ? { ...r, justification } : r));
}

/** Marca todos (ou só os ainda sem marcação, com `onlyUndecided`) como presentes/ausentes. */
export function markAll(rows: RosterRow[], present: boolean, onlyUndecided = false): RosterRow[] {
  return rows.map((r) =>
    onlyUndecided && r.present !== null ? r : { ...r, present, checkinSource: r.present === present ? r.checkinSource : null },
  );
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
