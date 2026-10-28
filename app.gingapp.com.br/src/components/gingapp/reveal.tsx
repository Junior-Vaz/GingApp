import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Entrada suave de um bloco que aparece depois de carregar (altura 0 -> natural + fade, ~300 ms), para a Home não
 * "pular" quando chegam os stories ou a prévia do Grupo. O conteúdo já está no DOM desde o primeiro render; só a
 * apresentação anima. Com `prefers-reduced-motion` a regra global do app desliga a transição.
 */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    // Um frame com a altura 0 pintada, depois abre (sem rAF, cai para um timeout curto).
    if (typeof requestAnimationFrame === "function") {
      const id = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(id);
    }
    const id = setTimeout(() => setShown(true), 16);
    return () => clearTimeout(id);
  }, []);
  return (
    <div
      className={cn(
        "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
        shown ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        className,
      )}
      data-reveal={shown ? "open" : "closed"}
    >
      {/* clip só na vertical (a altura anima de 0): na horizontal o conteúdo pode sangrar até a borda da tela no celular. */}
      <div className="min-h-0 min-w-0 overflow-y-clip">{children}</div>
    </div>
  );
}
