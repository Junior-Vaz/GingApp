import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { dayOnly, fmt, toDate } from "@/lib/format";

/** `evento` = QR de check-in do evento; `aula` = QR de presença da aula. */
export type CheckinKind = "evento" | "aula";

export const isCheckinKind = (value: string): value is CheckinKind => value === "evento" || value === "aula";

/** Contrato de GET /events/:id/checkin-token e GET /attendance/lessons/:id/checkin-token. */
export interface CheckinToken {
  kind: "EVENT" | "LESSON";
  id: number;
  /** Título do evento ou nome da turma. */
  title: string;
  /** ISO. Na aula é meia-noite UTC (use dayOnly para exibir). */
  date: string;
  /** Só aula (HH:mm). */
  startTime?: string | null;
  endTime?: string | null;
  /** Código curto que o aluno também pode digitar. */
  token: string;
  /** `data:image/png;base64,...` */
  qrDataUrl: string;
  /** Janela em que o check-in é aceito (ISO). */
  opensAt: string;
  closesAt: string;
}

export const checkinPath = (kind: CheckinKind, id: number): string =>
  kind === "evento" ? `/events/${String(id)}/checkin-token` : `/attendance/lessons/${String(id)}/checkin-token`;

/** Rota (SPA) da tela cheia do QR. */
export const checkinHref = (kind: CheckinKind, id: number): string => `/checkin/${kind}/${String(id)}`;

export function useCheckinToken(kind: CheckinKind, id: number) {
  return useQuery({
    queryKey: ["checkin-token", kind, id],
    queryFn: () => api.get<CheckinToken>(checkinPath(kind, id)),
    enabled: Number.isInteger(id) && id > 0,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });
}

export const DATE_TIME_FORMAT = "dd/MM/yyyy HH:mm";

/** Quando: evento = data e hora; aula = dia civil + horário (se houver). */
export function checkinWhen(data: CheckinToken): string {
  if (data.kind === "LESSON") {
    const day = fmt(dayOnly(data.date), "dd/MM/yyyy");
    return data.startTime ? `${day} · ${data.startTime}${data.endTime ? ` às ${data.endTime}` : ""}` : day;
  }
  return fmt(toDate(data.date), DATE_TIME_FORMAT);
}
