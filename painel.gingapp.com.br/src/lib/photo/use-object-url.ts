import { useEffect, useState } from "react";

/**
 * URL temporária (`URL.createObjectURL`) de um Blob, REVOGADA ao trocar o Blob e ao desmontar. Fica só no navegador:
 * nada vai para localStorage/sessionStorage nem para a rede. Compatível com StrictMode (cria e revoga dentro do efeito).
 */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const created = URL.createObjectURL(blob);
    setUrl(created);
    return () => {
      URL.revokeObjectURL(created);
    };
  }, [blob]);
  return url;
}
