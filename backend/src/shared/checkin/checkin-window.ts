/**
 * Janelas em que o check-in por QR e aceito. Fuso do produto: America/Sao_Paulo (UTC-3 fixo — o Brasil nao tem horario
 * de verao desde 2019), o mesmo usado para formatar datas em format-br.ts.
 */
const HOUR_MS = 60 * 60 * 1000;
const SAO_PAULO_UTC_OFFSET_H = 3;

/** Evento so tem o instante de inicio: aceita de 2h antes ate 6h depois (eventos de capoeira costumam durar o dia). */
export const EVENT_CHECKIN_BEFORE_MS = 2 * HOUR_MS;
export const EVENT_CHECKIN_AFTER_MS = 6 * HOUR_MS;
/** Aula: de 2h antes do inicio ate 2h depois do fim. */
export const LESSON_CHECKIN_BEFORE_MS = 2 * HOUR_MS;
export const LESSON_CHECKIN_AFTER_MS = 2 * HOUR_MS;

export interface CheckinWindow {
  opensAt: Date;
  closesAt: Date;
}

export function isInsideWindow(window: CheckinWindow, now: Date = new Date()): boolean {
  return now.getTime() >= window.opensAt.getTime() && now.getTime() <= window.closesAt.getTime();
}

export function eventCheckinWindow(eventDate: Date): CheckinWindow {
  return {
    opensAt: new Date(eventDate.getTime() - EVENT_CHECKIN_BEFORE_MS),
    closesAt: new Date(eventDate.getTime() + EVENT_CHECKIN_AFTER_MS),
  };
}

/** "dia civil (meia-noite UTC) + HH:mm de Sao Paulo" -> instante. */
function civilDateTime(date: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), h + SAO_PAULO_UTC_OFFSET_H, m));
}

/**
 * Janela de uma aula (Lesson.date = dia civil; startTime/endTime = "HH:mm" opcionais). Sem horario a aula vale o dia
 * inteiro; so com inicio, assume 2h de duracao.
 */
export function lessonCheckinWindow(
  date: Date,
  startTime: string | null | undefined,
  endTime: string | null | undefined,
): CheckinWindow {
  const dayStart = civilDateTime(date, '00:00');
  const dayEnd = new Date(dayStart.getTime() + 24 * HOUR_MS);
  const start = startTime ? civilDateTime(date, startTime) : dayStart;
  const end = endTime ? civilDateTime(date, endTime) : startTime ? new Date(start.getTime() + 2 * HOUR_MS) : dayEnd;
  return {
    opensAt: new Date(start.getTime() - LESSON_CHECKIN_BEFORE_MS),
    closesAt: new Date(end.getTime() + LESSON_CHECKIN_AFTER_MS),
  };
}
