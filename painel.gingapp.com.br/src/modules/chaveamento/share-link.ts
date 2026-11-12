import { copyText } from "@/modules/formularios/share";

/** Estado da tentativa: compartilhou pelo sistema, copiou para a área de transferência ou o operador desistiu. */
export type ShareOutcome = "shared" | "copied" | "cancelled";

export interface SharePayload {
  title: string;
  text?: string;
  url: string;
}

/**
 * "Compartilhar": usa a folha de compartilhamento do aparelho (`navigator.share`) quando existe; sem ela (desktop, WebView
 * antigo) ou se falhar, COPIA o link. Fechar a folha sem escolher (AbortError) não é erro: nada é copiado nem avisado.
 */
export async function shareOrCopy(payload: SharePayload, copiedMessage = "Link copiado."): Promise<ShareOutcome> {
  if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
    try {
      await navigator.share({ title: payload.title, ...(payload.text ? { text: payload.text } : {}), url: payload.url });
      return "shared";
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return "cancelled";
      // qualquer outra falha (ex.: NotAllowedError): plano B = copiar
    }
  }
  await copyText(payload.url, copiedMessage);
  return "copied";
}

/** Copia o link e avisa por toast (plano B já embutido). */
export async function copyLink(url: string, message = "Link copiado."): Promise<void> {
  await copyText(url, message);
}
