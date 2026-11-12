import { useEffect, useState } from "react";

/** Tipos que o navegador pode mostrar sem executar nada. Qualquer outro vira download (nunca é aberto na origem do painel). */
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export const PDF_TYPE = "application/pdf";

/** Tipo SEGURO do blob: o que o servidor declarou só vale se estiver na lista; o resto é binário opaco. */
export function safeBlobType(mimeType: string): string {
  const type = mimeType.toLowerCase();
  return (IMAGE_TYPES as readonly string[]).includes(type) || type === PDF_TYPE
    ? type
    : "application/octet-stream";
}

/**
 * URL temporária (blob) do arquivo baixado com o token; revogada ao trocar/fechar. O blob é recriado com o tipo da
 * lista segura, para que HTML/SVG disfarçado de comprovante nunca seja interpretado pelo navegador.
 */
export function useBlobUrl(blob: Blob | undefined, mimeType: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const created = URL.createObjectURL(new Blob([blob], { type: safeBlobType(mimeType ?? "") }));
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [blob, mimeType]);
  return url;
}
