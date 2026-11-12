export type ShareResult = "shared" | "copied" | "cancelled" | "failed";

export interface SharePayload {
  title: string;
  text?: string;
  url: string;
}

/** Cópia por textarea oculto para navegadores sem Clipboard API (ou fora de HTTPS). */
function legacyCopy(text: string): boolean {
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
    document.body.appendChild(area);
    area.select();
    const ok = typeof document.execCommand === "function" && document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/**
 * Compartilha o link: abre a folha de compartilhamento do aparelho (`navigator.share`) quando existe; sem ela (ou se falhar
 * por outro motivo que não o cancelamento), copia o link. Nunca lança: devolve o que aconteceu.
 */
export async function shareLink(payload: SharePayload): Promise<ShareResult> {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share(payload.text ? { title: payload.title, text: payload.text, url: payload.url } : { title: payload.title, url: payload.url });
        return "shared";
      } catch (error) {
        if ((error as { name?: string } | null)?.name === "AbortError") return "cancelled";
        // Outro erro (ex.: contexto sem permissão): tenta copiar.
      }
    }
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(payload.url);
        return "copied";
      }
    } catch {
      /* cai para a cópia antiga */
    }
    return legacyCopy(payload.url) ? "copied" : "failed";
  } catch {
    return "failed";
  }
}
