import {
  WIDE_DIMENSIONS,
  buildDrawPlan,
  buildLadder,
  fromNormalized,
  sourceSideFor,
} from "./crop-math";
import { HEIC_UNSUPPORTED_MESSAGE, PHOTO_ERROR_MESSAGES } from "./messages";
import { DEFAULT_MAX_BYTES, MAX_INPUT_BYTES, PhotoError, type PrepareImageOptions } from "./types";

/** Imagem decodificada (já na orientação correta) e como liberá-la. */
interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}

const isHeicType = (type: string): boolean => /^image\/(heic|heif)(-sequence)?$/i.test(type);

/** Aceita imagens (e arquivos sem tipo, comum em fotos da câmera do aparelho); recusa o resto e SVG. */
function assertImageType(input: Blob): void {
  const type = input.type.toLowerCase();
  if (type === "") return;
  if (!type.startsWith("image/") || type.startsWith("image/svg")) {
    throw new PhotoError("UNSUPPORTED_FORMAT", PHOTO_ERROR_MESSAGES.UNSUPPORTED_FORMAT);
  }
}

/** `createImageBitmap(..., {imageOrientation:'from-image'})`; falha/indisponível => null (cai no <img>). */
async function decodeWithBitmap(input: Blob): Promise<DecodedImage | null> {
  if (typeof createImageBitmap !== "function") return null;
  try {
    const bitmap = await createImageBitmap(input, { imageOrientation: "from-image" });
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      release: () => bitmap.close(),
    };
  } catch {
    return null;
  }
}

/** Plano B: <img> (os navegadores aplicam o EXIF por padrão em <img>). */
function decodeWithImageElement(input: Blob): Promise<DecodedImage | null> {
  return new Promise((resolve) => {
    if (
      typeof Image !== "function" ||
      typeof URL === "undefined" ||
      typeof URL.createObjectURL !== "function"
    ) {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(input);
    const image = new Image();
    let done = false;
    const finish = (value: DecodedImage | null) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    image.onload = () =>
      finish({
        source: image,
        width: image.naturalWidth,
        height: image.naturalHeight,
        release: () => URL.revokeObjectURL(url),
      });
    image.onerror = () => {
      URL.revokeObjectURL(url);
      finish(null);
    };
    image.src = url;
  });
}

async function decode(input: Blob): Promise<DecodedImage> {
  const decoded = (await decodeWithBitmap(input)) ?? (await decodeWithImageElement(input));
  if (!decoded) {
    if (isHeicType(input.type))
      throw new PhotoError("UNSUPPORTED_FORMAT", HEIC_UNSUPPORTED_MESSAGE, { heic: true });
    throw new PhotoError("DECODE_FAILED", PHOTO_ERROR_MESSAGES.DECODE_FAILED);
  }
  if (!(decoded.width > 0 && decoded.height > 0)) {
    decoded.release();
    throw new PhotoError("DECODE_FAILED", PHOTO_ERROR_MESSAGES.DECODE_FAILED);
  }
  return decoded;
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number | undefined,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    try {
      canvas.toBlob((blob) => resolve(blob), type, quality);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Prepara a imagem para envio: decodifica respeitando a orientação EXIF, recorta (cover quadrado) ou só reduz (`wide`),
 * e re-codifica em WebP (JPEG quando o navegador não codifica WebP: detectado por `blob.type`) descendo a escada de
 * qualidade (0,9 -> 0,5) e depois de dimensão (800 -> 600 -> 480) até caber em `maxBytes`. `wide` devolve a ORIGINAL quando já cabe (lado maior <= 1600 e <= maxBytes) e preserva a transparência (sem fundo branco;
 * WebP, depois PNG). No `square` a original nunca sai daqui e os metadados (EXIF/GPS) se perdem na re-codificação.
 *
 * @throws PhotoError `UNSUPPORTED_FORMAT` | `DECODE_FAILED` | `TOO_LARGE_INPUT` | `ENCODE_FAILED`
 */
export async function prepareImage(
  input: File | Blob,
  opts: PrepareImageOptions = {},
): Promise<Blob> {
  const shape = opts.shape ?? "square";
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;

  if (input.size > MAX_INPUT_BYTES)
    throw new PhotoError("TOO_LARGE_INPUT", PHOTO_ERROR_MESSAGES.TOO_LARGE_INPUT);
  assertImageType(input);

  const decoded = await decode(input);
  const canvas = document.createElement("canvas");
  try {
    const image = { width: decoded.width, height: decoded.height };
    const crop = shape === "square" && opts.crop ? fromNormalized(opts.crop, image) : undefined;
    const ladder = buildLadder(shape, sourceSideFor(shape, image, crop));

    // `wide` (logo/capa): se a original já é JPEG/PNG/WebP, tem lado maior <= 1600 e cabe em `maxBytes`, vai SEM recomprimir
    // (preserva qualidade e transparência). Só desce a escada quando não couber.
    if (
      shape === "wide" &&
      /^image\/(jpeg|png|webp)$/i.test(input.type) &&
      input.size <= maxBytes &&
      Math.max(image.width, image.height) <= WIDE_DIMENSIONS[0]!
    ) {
      return input;
    }

    // `wide` que pode ter transparência (tudo que não é JPEG): sem fundo branco; WebP e PNG guardam o canal alfa.
    // `square` mantém o fundo branco sempre.
    const alphaCapable = shape === "wide" && !/^image\/jpe?g$/i.test(input.type);
    let format: "image/webp" | "image/png" | "image/jpeg" = "image/webp";
    let lastPngDimension = -1;
    for (let index = 0; index < ladder.length; index++) {
      const step = ladder[index]!;
      if (format === "image/png" && step.dimension === lastPngDimension) continue; // PNG ignora a qualidade
      const plan = buildDrawPlan(shape, image, step.dimension, crop);
      let blob: Blob | null = null;
      for (;;) {
        canvas.width = plan.dw;
        canvas.height = plan.dh;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new PhotoError("ENCODE_FAILED", PHOTO_ERROR_MESSAGES.ENCODE_FAILED);
        if (!alphaCapable || format === "image/jpeg") {
          // Fundo branco: transparência não pode virar fundo preto no JPEG.
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, plan.dw, plan.dh);
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(decoded.source, plan.sx, plan.sy, plan.sw, plan.sh, 0, 0, plan.dw, plan.dh);

        blob = await canvasToBlob(
          canvas,
          format,
          format === "image/png" ? undefined : step.quality,
        );
        // O navegador que não codifica o formato devolve outro tipo (PNG no Safari) ou null: detecta pelo `blob.type`.
        // Reserva: WebP -> PNG (se pode ter alfa) -> JPEG.
        if (format === "image/webp" && blob?.type !== "image/webp") {
          format = alphaCapable ? "image/png" : "image/jpeg";
          continue;
        }
        if (format === "image/png" && blob?.type !== "image/png") {
          format = "image/jpeg";
          continue;
        }
        break;
      }
      if (!blob || blob.size === 0)
        throw new PhotoError("ENCODE_FAILED", PHOTO_ERROR_MESSAGES.ENCODE_FAILED);
      if (blob.size <= maxBytes) return blob;
      if (format === "image/png") {
        lastPngDimension = step.dimension;
        // PNG não coube em nenhuma dimensão: último recurso, JPEG com fundo branco (recomeça a escada).
        if (ladder.slice(index + 1).every((later) => later.dimension === step.dimension)) {
          format = "image/jpeg";
          index = -1;
        }
      }
    }
    // Nada coube nem na menor dimensão com a pior qualidade: não envia algo que o servidor vai recusar.
    throw new PhotoError("ENCODE_FAILED", PHOTO_ERROR_MESSAGES.ENCODE_FAILED);
  } finally {
    decoded.release();
    canvas.width = 0;
    canvas.height = 0;
  }
}
