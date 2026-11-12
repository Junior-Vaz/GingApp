import { API_URL, api, ApiError } from "@/lib/api";

/** Mesmos limites do backend (POST /uploads): JPEG/PNG/WebP até 5 MB. O servidor continua sendo a validação de verdade. */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
export const UPLOAD_ACCEPT = "image/jpeg,image/png,image/webp";
const UPLOAD_PATH = /^\/api\/uploads\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(webp|jpg|png)$/;

/** Caminho de imagem enviada ao próprio backend (`/api/uploads/<uuid>.<ext>`). */
export const isUploadPath = (value: string): boolean => UPLOAD_PATH.test(value);

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Valor aceito nos campos de imagem: URL http(s) completa OU o caminho devolvido por `uploadImage`. */
export const isImageRef = (value: string): boolean => isHttpUrl(value) || isUploadPath(value);

/**
 * Valor guardado -> `src` do <img>. O caminho de upload é relativo à API (`/api/uploads/...`): em produção o
 * painel e a API dividem o domínio (VITE_API_URL=/api) e nada muda; em desenvolvimento (API em outra porta) o
 * caminho é prefixado com a origem da API. URLs externas passam direto.
 */
export function imageSrc(value: string | null | undefined): string {
  if (!value) return "";
  if (!isUploadPath(value)) return value;
  const origin = API_URL.replace(/\/api\/?$/, "");
  return `${origin}${value}`;
}

/** Erro amigável (pt-BR) antes de gastar rede; `null` = ok. Aceita o `File` escolhido ou o Blob já preparado (`PhotoPicker`). */
export function validateImageFile(file: Blob): string | null {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return "Formato não suportado: envie uma imagem JPEG, PNG ou WebP.";
  }
  if (file.size > UPLOAD_MAX_BYTES) return "A imagem excede o limite de 5 MB.";
  if (file.size === 0) return "O arquivo está vazio.";
  return null;
}

/** Nome do arquivo no multipart: o do `File` escolhido; um Blob já preparado vira `foto.webp` (ou .jpg/.png pelo tipo). */
export function uploadFileName(file: Blob): string {
  if (file instanceof File && file.name) return file.name;
  if (file.type === "image/jpeg") return "foto.jpg";
  if (file.type === "image/png") return "foto.png";
  return "foto.webp";
}

/**
 * Envia a imagem (POST /uploads) e devolve o caminho a gravar no campo (foto, logo, capa). Aceita o `File` ou o Blob
 * que o `PhotoPicker`/`prepareImage` devolve (já recortado e comprimido, normalmente `foto.webp` abaixo de 400 KB).
 */
export async function uploadImage(file: Blob): Promise<string> {
  const invalid = validateImageFile(file);
  if (invalid) throw new ApiError(invalid, 400);
  const form = new FormData();
  form.append("file", file, uploadFileName(file));
  const result = await api.postForm<{ url: string }>("/uploads", form);
  return result.url;
}
