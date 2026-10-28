import { useEffect, useState } from "react";

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

/** `prefers-reduced-motion: reduce` ao vivo (sem autoplay e sem animação; a navegação segue manual). */
export function useReducedMotion(): boolean {
  const read = () => {
    try {
      return window.matchMedia(reducedMotionQuery).matches;
    } catch {
      return false;
    }
  };
  const [reduced, setReduced] = useState(read);
  useEffect(() => {
    let mql: MediaQueryList | null = null;
    try {
      mql = window.matchMedia(reducedMotionQuery);
    } catch {
      return;
    }
    const onChange = () => setReduced(mql!.matches);
    mql.addEventListener?.("change", onChange);
    return () => mql!.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}
