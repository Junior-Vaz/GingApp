import { useCallback, useEffect, useRef, useState, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import "./chaveamento.css";

/**
 * Faixa que rola para os lados (filtro de tatame, abas das categorias): esmaece a borda onde ainda há conteúdo escondido,
 * para o operador perceber que dá para rolar. Sem barra de rolagem (a faixa é de toque).
 */
export function ScrollFade({ className, children, ...props }: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState({ left: false, right: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 4;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
    setFade((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [update, children]);

  return (
    <div
      ref={ref}
      onScroll={update}
      data-fade-left={fade.left ? "true" : undefined}
      data-fade-right={fade.right ? "true" : undefined}
      className={cn("chv-fade-x overflow-x-auto", className)}
      {...props}
    >
      {children}
    </div>
  );
}
