import { toast } from "sonner";

/**
 * Link público da inscrição: SÓ o `publicUrl` do servidor. Antes da 1ª publicação ele vem `null` (o slug ainda é
 * provisório), então não há o que copiar nem divulgar.
 */
export function publicLink(form: { publicUrl?: string | null | undefined }): string | null {
  return form.publicUrl?.trim() || null;
}

/** Copia o texto e avisa por toast (com plano B para navegadores sem a API de área de transferência). */
export async function copyText(text: string, done = "Link copiado."): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(done);
  } catch {
    toast.error("Não foi possível copiar. Selecione o link e copie manualmente.");
  }
}

/** Texto pronto para o WhatsApp. */
export function whatsappMessage(title: string, url: string): string {
  return `Inscrições abertas: ${title}\nFaça a sua pelo link: ${url}`;
}

export const whatsappUrl = (text: string): string =>
  `https://wa.me/?text=${encodeURIComponent(text)}`;
