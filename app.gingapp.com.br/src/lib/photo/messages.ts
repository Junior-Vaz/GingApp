import type { CameraErrorCode, PhotoErrorCode } from "./types";

/** Mensagens (pt-BR) de cada erro tipado. Dizem o que houve e o que a pessoa pode fazer em seguida. */
export const PHOTO_ERROR_MESSAGES: Record<PhotoErrorCode, string> = {
  UNSUPPORTED_FORMAT:
    "Formato de imagem não suportado. Envie uma foto JPG, PNG ou WebP, ou tire a foto na hora.",
  DECODE_FAILED:
    "Não foi possível abrir esta imagem. O arquivo pode estar danificado: escolha outra foto ou tire uma na hora.",
  TOO_LARGE_INPUT:
    "Esta imagem é grande demais (acima de 25 MB). Escolha uma foto menor ou tire a foto na hora.",
  ENCODE_FAILED:
    "Não foi possível preparar a foto para envio. Tente de novo ou escolha outra imagem.",
};

export const HEIC_UNSUPPORTED_MESSAGE =
  "Este navegador não abre fotos no formato HEIC. Tire a foto na hora ou envie uma imagem em JPG ou PNG.";

export const CAMERA_ERROR_MESSAGES: Record<CameraErrorCode, string> = {
  DENIED:
    "O acesso à câmera foi negado. Permita a câmera nas configurações do navegador (ícone de cadeado ao lado do endereço) e tente de novo, ou use a câmera do aparelho.",
  NOT_FOUND:
    "Nenhuma câmera foi encontrada neste aparelho. Use a câmera do aparelho ou envie uma foto da galeria.",
  IN_USE:
    "Não foi possível usar a câmera: outro aplicativo ou aba pode estar usando. Feche-o e tente de novo.",
  INSECURE_CONTEXT:
    "A câmera só funciona em conexão segura (HTTPS). Use a câmera do aparelho ou envie uma foto da galeria.",
  UNSUPPORTED:
    "Este navegador não permite abrir a câmera aqui. Use a câmera do aparelho ou envie uma foto da galeria.",
};

export const CAPTURE_FAILED_MESSAGE = "Não foi possível capturar a foto. Tente de novo.";
export const GENERIC_PHOTO_MESSAGE = "Não foi possível processar a foto. Tente de novo.";

interface MaybeTyped {
  code?: unknown;
  heic?: unknown;
  message?: unknown;
}

/** Texto pt-BR de qualquer erro vindo da biblioteca (aceita desconhecidos: nunca devolve o texto técnico cru). */
export function photoErrorMessage(error: unknown): string {
  const typed = (error ?? {}) as MaybeTyped;
  const code = typeof typed.code === "string" ? typed.code : "";
  if (code === "UNSUPPORTED_FORMAT" && typed.heic === true) return HEIC_UNSUPPORTED_MESSAGE;
  if (code in PHOTO_ERROR_MESSAGES) return PHOTO_ERROR_MESSAGES[code as PhotoErrorCode];
  if (code in CAMERA_ERROR_MESSAGES) return CAMERA_ERROR_MESSAGES[code as CameraErrorCode];
  return GENERIC_PHOTO_MESSAGE;
}
