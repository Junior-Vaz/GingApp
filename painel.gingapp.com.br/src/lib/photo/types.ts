/** Tipos compartilhados da biblioteca de foto (enviar, tirar na hora, recortar, comprimir). Contrato: docs/CONTRATO_FOTO_UPLOAD_CAMERA.md (§4). */

/** `square` = foto de pessoa (recorte quadrado 800x800); `wide` = logo/capa (só compressão, lado maior <= 1600). */
export type PhotoShape = "square" | "wide";

/** Câmera: `user` = frontal (selfie), `environment` = traseira. */
export type CameraFacing = "user" | "environment";

export type PhotoErrorCode =
  "UNSUPPORTED_FORMAT" | "DECODE_FAILED" | "TOO_LARGE_INPUT" | "ENCODE_FAILED";

export type CameraErrorCode =
  "DENIED" | "NOT_FOUND" | "IN_USE" | "INSECURE_CONTEXT" | "UNSUPPORTED";

/** Tipos que o seletor de arquivo oferece (HEIC/HEIF só decodificam onde o navegador consegue). */
export const PHOTO_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif";

/** Entrada acima disso nem é decodificada (evita travar o celular com um arquivo gigante). */
export const MAX_INPUT_BYTES = 25 * 1024 * 1024;

/** Teto padrão do arquivo enviado ao servidor. */
export const DEFAULT_MAX_BYTES = 400 * 1024;

/** Erro tipado da preparação da imagem. `heic` = o arquivo era HEIC/HEIF e o navegador não o decodifica. */
export class PhotoError extends Error {
  readonly code: PhotoErrorCode;
  readonly heic: boolean;

  constructor(
    code: PhotoErrorCode,
    message: string,
    options?: { heic?: boolean; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PhotoError";
    this.code = code;
    this.heic = options?.heic ?? false;
  }
}

/** Erro tipado da câmera (`getUserMedia`). */
export class CameraError extends Error {
  readonly code: CameraErrorCode;

  constructor(code: CameraErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "CameraError";
    this.code = code;
  }
}

export const isPhotoError = (error: unknown): error is PhotoError => error instanceof PhotoError;
export const isCameraError = (error: unknown): error is CameraError => error instanceof CameraError;

/** Retângulo quadrado em pixels da imagem (já orientada). */
export interface CropRect {
  x: number;
  y: number;
  size: number;
}

/** Recorte em frações (0..1) da largura/altura da imagem: independe da escala em que a imagem foi decodificada. */
export interface NormalizedCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PrepareImageOptions {
  /** Padrão `square`. */
  shape?: PhotoShape;
  /** Teto do arquivo de saída em bytes (padrão 400 KB). */
  maxBytes?: number;
  /** Só `square`: região escolhida no recorte. Sem ela, recorte centralizado (cover). */
  crop?: NormalizedCrop;
}
