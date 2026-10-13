import * as React from "react";

export const MOBILE_BREAKPOINT = 768;

const isNarrow = () => typeof window !== "undefined" && window.innerWidth < MOBILE_BREAKPOINT;

/** Largura de celular (< md = 768px). Já nasce com o valor certo (sem piscar a tabela antes dos cards). */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean>(isNarrow);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(isNarrow());
    };
    mql.addEventListener("change", onChange);
    setIsMobile(isNarrow());
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
