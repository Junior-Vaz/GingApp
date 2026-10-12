import { format } from "date-fns";
import { toDate } from "@/lib/format";

/** ISO do backend -> valor de <input type="datetime-local"> na hora LOCAL (o Vue cortava o UTC). */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return format(toDate(iso), "yyyy-MM-dd'T'HH:mm");
}

/** Valor de datetime-local -> ISO UTC aceito pelo @IsDateString do backend. */
export function fromLocalInput(value: string): string {
  return new Date(value).toISOString();
}

/** Valor aceito num campo de imagem: URL http(s) OU o caminho `/api/uploads/<arquivo>` devolvido pelo envio. */
export { isImageRef } from "@/lib/uploads";

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** Texto opcional: vazio vira undefined (campo omitido no POST). */
export const optionalText = (value: string): string | undefined => value.trim() || undefined;

export const optionalId = (value: string): number | undefined => (value ? Number(value) : undefined);

export const idToField = (id: number | null | undefined): string => (id ? String(id) : "");
/** Edição (PATCH): texto vazio vira `null` (o backend limpa a coluna); `undefined` não mexeria. */
export const nullableText = (value: string): string | null => value.trim() || null;

export const nullableId = (value: string): number | null => (value ? Number(value) : null);