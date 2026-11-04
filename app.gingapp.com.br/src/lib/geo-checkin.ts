import { useQuery } from "@tanstack/react-query";
import { ApiError, api } from "@/lib/api";

/**
 * Check-in por localização (GPS): o aluno (ou o responsável por um dependente) toca em "Estou aqui" e o servidor confere se
 * ele está a até R metros do local da turma, na janela da aula. Contrato: docs/CONTRATO_CHECKIN_GEOLOCALIZACAO.md.
 *
 * PRIVACIDADE (LGPD): a posição é lida UMA vez por toque, vai direto no corpo do POST e NÃO é guardada em lugar nenhum do
 * app (nem estado, nem cache do Query, nem storage, nem log). `registerGeoCheckin` mantém as coordenadas só em variáveis
 * locais, descartadas ao terminar.
 */

/** Id da seção na página de check-in (âncora do cartão da Home). */
export const GEO_CHECKIN_SECTION_ID = "checkin-por-localizacao";

/** Opção devolvida por GET /attendance/geo-checkin/available (nunca traz coordenadas). */
export interface GeoCheckinOption {
  lessonId: number;
  studentId: number;
  studentName: string;
  className: string;
  /** Dia da aula (ISO, meia-noite UTC). */
  date: string;
  startTime: string | null;
  endTime: string | null;
  opensAt: string;
  closesAt: string;
  radiusMeters: number;
  /** Presença já registrada. */
  alreadyCheckedIn: boolean;
}

/** Resposta 200 de POST /attendance/geo-checkin. */
export interface GeoCheckinResult {
  lessonId: number;
  studentId: number;
  present: true;
  alreadyCheckedIn: boolean;
  distanceMeters: number;
}

/** Corpo do POST (whitelist do servidor: campo extra = 400). */
interface GeoCheckinBody {
  lessonId: number;
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  studentId?: number;
}

export const GEO_AVAILABLE_KEY = ["geo-checkin", "available"] as const;

/** Chave estável de uma opção (aula + aluno): uma aula pode aparecer para o usuário e para cada dependente. */
export const geoOptionKey = (option: Pick<GeoCheckinOption, "lessonId" | "studentId">) => `${option.lessonId}:${option.studentId}`;

/** Opções dentro da janela e ainda sem presença registrada. */
export const pendingGeoOptions = (options: GeoCheckinOption[] | undefined): GeoCheckinOption[] =>
  (options ?? []).filter((option) => !option.alreadyCheckedIn);

/**
 * Lista o que está disponível AGORA (janela da aula) para o usuário e seus dependentes. `enabled` deve ser falso quando a
 * conta não tem aluno (sem requisição). `staleTime` curto: a janela abre e fecha durante o dia.
 */
export function useGeoCheckinAvailable(enabled: boolean) {
  return useQuery({
    queryKey: GEO_AVAILABLE_KEY,
    queryFn: () => api.get<GeoCheckinOption[]>("/attendance/geo-checkin/available"),
    enabled,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
  });
}

export type GeoFailureKind = "unsupported" | "denied" | "unavailable" | "timeout";

/** Falha ao LER a posição no aparelho (antes de falar com o servidor). */
export class GeolocationFailure extends Error {
  kind: GeoFailureKind;
  constructor(kind: GeoFailureKind) {
    super(GEO_FAILURE_MESSAGE[kind]);
    this.name = "GeolocationFailure";
    this.kind = kind;
  }
}

export const GEO_FAILURE_MESSAGE: Record<GeoFailureKind, string> = {
  unsupported:
    "Este navegador não tem localização disponível. Use o QR code da aula ou peça ao professor para marcar sua presença.",
  denied:
    "A localização está bloqueada para o GingApp. Libere nas configurações do navegador (ou do aparelho, em Privacidade > Localização) e toque em “Estou aqui” de novo.",
  unavailable: "Não foi possível obter sua posição agora. Confira se o GPS está ligado, vá para um lugar aberto e tente de novo.",
  timeout: "A localização demorou demais para responder. Vá para um lugar aberto e tente de novo.",
};

/** Opções da leitura: alta precisão, sem cache e com limite de 15 s. Só é lida UMA vez, por toque do usuário. */
export const GEO_POSITION_OPTIONS = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 } as const;

function readPosition(): Promise<GeolocationPosition> {
  if (typeof navigator === "undefined" || !navigator.geolocation) return Promise.reject(new GeolocationFailure("unsupported"));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      resolve,
      (error) => reject(new GeolocationFailure(error.code === 1 ? "denied" : error.code === 3 ? "timeout" : "unavailable")),
      GEO_POSITION_OPTIONS,
    );
  });
}

/**
 * Lê a posição e envia o check-in. Nada do que foi lido sai desta função (só o resultado do servidor): sem estado, cache,
 * storage ou log. Envia SEMPRE o `studentId` da opção (o responsável pode ter vários alunos na mesma turma).
 */
export async function registerGeoCheckin(option: Pick<GeoCheckinOption, "lessonId" | "studentId">): Promise<GeoCheckinResult> {
  const position = await readPosition();
  const { latitude, longitude, accuracy } = position.coords;
  const body: GeoCheckinBody = { lessonId: option.lessonId, latitude, longitude, studentId: option.studentId };
  // accuracyMeters é opcional (0..100000): só vai quando o aparelho informou um número válido.
  if (typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy >= 0 && accuracy <= 100000) body.accuracyMeters = accuracy;
  return api.post<GeoCheckinResult>("/attendance/geo-checkin", body);
}

const readNumber = (body: unknown, key: string): number | null => {
  const value = (body as Record<string, unknown> | null | undefined)?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/**
 * Mensagem para o usuário a partir de qualquer falha do check-in: leitura da posição (permissão negada, tempo esgotado,
 * indisponível, sem suporte) ou erro do servidor (contrato §3; usa a mensagem do servidor, com texto próprio em GEO_TOO_FAR
 * e no limite de uso).
 */
export function geoCheckinErrorMessage(error: unknown): string {
  if (error instanceof GeolocationFailure) return error.message;
  if (error instanceof ApiError) {
    if (error.code === "GEO_TOO_FAR") {
      const distance = readNumber(error.body, "distanceMeters");
      const radius = readNumber(error.body, "radiusMeters");
      if (distance !== null && radius !== null) return `Você está a ${Math.round(distance)} m do local; chegue a até ${Math.round(radius)} m.`;
    }
    if (error.status === 429) return "Muitas tentativas seguidas. Espere um minuto e tente de novo.";
    return error.message;
  }
  return "Não foi possível registrar sua presença. Verifique a conexão e tente de novo.";
}
