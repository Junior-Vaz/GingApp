import { CAMERA_ERROR_MESSAGES, CAPTURE_FAILED_MESSAGE } from "./messages";
import { CameraError, PhotoError, type CameraFacing } from "./types";

/**
 * Resolução IDEAL modesta: o recorte final é 800x800, então 1280x720 basta (e não carrega 4K de uma webcam à toa).
 * São "ideal", nunca "exact": o navegador escolhe o mais próximo que a câmera tiver.
 */
export const CAMERA_IDEAL_WIDTH = 1280;
export const CAMERA_IDEAL_HEIGHT = 720;
/** Qualidade do quadro capturado (vai ao recorte; a compressão final é do `prepareImage`). */
const CAPTURE_QUALITY = 0.92;

/** Contexto seguro (HTTPS/localhost). Só `false` explícito conta como inseguro (jsdom/testes não definem). */
export const isSecureForCamera = (): boolean =>
  typeof window === "undefined" || window.isSecureContext !== false;

/** O navegador expõe `getUserMedia`? (Em HTTP puro `navigator.mediaDevices` nem existe.) */
export const isCameraSupported = (): boolean =>
  typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getUserMedia === "function";

/** Câmera frontal é espelhada só no PREVIEW (como um espelho); a traseira nunca. */
export const isMirroredFacing = (facing: CameraFacing): boolean => facing === "user";

const cameraError = (code: CameraError["code"], cause?: unknown): CameraError =>
  new CameraError(code, CAMERA_ERROR_MESSAGES[code], cause === undefined ? undefined : { cause });

/** Converte o que `getUserMedia` lança (DOMException) no erro tipado. Já é `CameraError`? passa direto. */
export function mapCameraError(error: unknown): CameraError {
  if (error instanceof CameraError) return error;
  const name =
    typeof (error as { name?: unknown } | null)?.name === "string"
      ? (error as { name: string }).name
      : "";
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
      return cameraError(isSecureForCamera() ? "DENIED" : "INSECURE_CONTEXT", error);
    case "SecurityError":
      return cameraError(isSecureForCamera() ? "DENIED" : "INSECURE_CONTEXT", error);
    case "NotFoundError":
    case "DevicesNotFoundError":
    case "OverconstrainedError":
      return cameraError("NOT_FOUND", error);
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return cameraError("IN_USE", error);
    default:
      return cameraError("UNSUPPORTED", error);
  }
}

/** Quanto a câmera está de fato espelhada: `facingMode` real da trilha (celulares) ou o pedido (webcam sem esse dado). */
export function streamIsMirrored(stream: MediaStream, requested: CameraFacing): boolean {
  const track = stream.getVideoTracks?.()[0];
  const actual = track?.getSettings?.().facingMode;
  if (actual === "user" || actual === "environment") return isMirroredFacing(actual);
  return isMirroredFacing(requested);
}

/**
 * Abre a câmera (`audio: false` sempre). Quem chama é dono do stream e DEVE chamar `stopCamera`.
 * @throws CameraError `DENIED` | `NOT_FOUND` | `IN_USE` | `INSECURE_CONTEXT` | `UNSUPPORTED`
 */
export async function openCamera({ facing }: { facing: CameraFacing }): Promise<MediaStream> {
  if (!isSecureForCamera()) throw cameraError("INSECURE_CONTEXT");
  if (!isCameraSupported()) throw cameraError("UNSUPPORTED");
  const devices = navigator.mediaDevices;
  try {
    return await devices.getUserMedia({
      video: {
        facingMode: { ideal: facing },
        width: { ideal: CAMERA_IDEAL_WIDTH },
        height: { ideal: CAMERA_IDEAL_HEIGHT },
      },
      audio: false,
    });
  } catch (error) {
    // Restrição de tamanho/facing que a câmera não atende: tenta de novo sem exigências antes de desistir.
    if ((error as { name?: string } | null)?.name === "OverconstrainedError") {
      try {
        return await devices.getUserMedia({ video: true, audio: false });
      } catch (retryError) {
        throw mapCameraError(retryError);
      }
    }
    throw mapCameraError(error);
  }
}

/** Para TODAS as trilhas (a luz da câmera só apaga quando todas param). Aceita `null`. */
export function stopCamera(stream: MediaStream | null | undefined): void {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* trilha já encerrada */
    }
  }
}

export interface FacingSupport {
  /** Há mais de uma câmera de vídeo? (então vale oferecer "trocar câmera") */
  canSwitch: boolean;
  /** Quantidade de câmeras de vídeo vistas. */
  devices: number;
}

/** Descobre se dá para alternar frontal/traseira. Sem `enumerateDevices` => não oferece a troca. */
export async function listFacingSupport(): Promise<FacingSupport> {
  try {
    const all = (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
    const devices = all.filter((device) => device.kind === "videoinput").length;
    return { canSwitch: devices > 1, devices };
  } catch {
    return { canSwitch: false, devices: 0 };
  }
}

/**
 * Captura o quadro atual do <video> como JPEG, SEM espelhar (o espelho do preview é só CSS: o `drawImage` copia o quadro cru).
 * @throws PhotoError `ENCODE_FAILED` quando a câmera ainda não tem imagem ou o canvas não codifica.
 */
export function captureFrame(video: HTMLVideoElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const width = video.videoWidth;
    const height = video.videoHeight;
    const fail = () => reject(new PhotoError("ENCODE_FAILED", CAPTURE_FAILED_MESSAGE));
    if (!(width > 0 && height > 0)) return fail();
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return fail();
    ctx.drawImage(video, 0, 0, width, height);
    canvas.toBlob(
      (blob) => {
        canvas.width = 0;
        canvas.height = 0;
        if (blob && blob.size > 0) resolve(blob);
        else fail();
      },
      "image/jpeg",
      CAPTURE_QUALITY,
    );
  });
}
