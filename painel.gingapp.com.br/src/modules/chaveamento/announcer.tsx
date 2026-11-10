import { useCallback, useMemo, useState, type ReactNode } from "react";
import { AnnounceContext } from "./announce-context";

/**
 * Região `aria-live` do chaveamento: o resultado salvo, a luta iniciada etc. são anunciados sem tirar o foco. Também
 * fica visível como uma faixa discreta de "última ação" (útil para quem opera de pé, olhando de relance).
 */
export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const announce = useCallback((text: string) => {
    // Limpa antes para que a MESMA frase repetida seja lida de novo.
    setMessage("");
    queueMicrotask(() => setMessage(text));
  }, []);
  const value = useMemo(() => announce, [announce]);
  return (
    <AnnounceContext.Provider value={value}>
      {children}
      <div role="status" aria-live="polite" aria-atomic="true" data-testid="chaveamento-live" className="sr-only">
        {message}
      </div>
    </AnnounceContext.Provider>
  );
}
