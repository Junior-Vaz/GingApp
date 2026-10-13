import type { ReactNode } from "react";

/**
 * Pilha dos botões flutuantes (FABs) do painel, no canto inferior direito. Posiciona TODOS de forma consistente: no
 * celular fica acima da barra inferior (4rem + área segura) e no desktop volta ao canto da tela. Os filhos entram de
 * baixo para cima (o primeiro fica no fundo) e nunca se sobrepõem. Filhos que renderizam `null` (sem permissão) não
 * ocupam espaço. O contêiner não captura toques: só os botões.
 */
export function FloatingActions({ children }: { children: ReactNode }) {
  return (
    <div
      data-testid="floating-actions"
      style={{ right: "calc(1rem + env(safe-area-inset-right))" }}
      className="pointer-events-none fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] z-40 flex flex-col-reverse items-end gap-3 md:bottom-[calc(1rem+env(safe-area-inset-bottom))] [&>*]:pointer-events-auto"
    >
      {children}
    </div>
  );
}
