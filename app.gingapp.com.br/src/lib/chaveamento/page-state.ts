import { useEffect, useState } from "react";

/** A aba/app está em segundo plano (tela apagada, outra aba, outro app)? */
export function isPageHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/** O aparelho SABE que está sem rede (`navigator.onLine === false`; `true` não prova que há internet). */
export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** true enquanto a página está em primeiro plano; acompanha `visibilitychange`. Timers e animações infinitas pausam em oculto. */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState<boolean>(() => !isPageHidden());
  useEffect(() => {
    const update = (): void => setVisible(!isPageHidden());
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/** false quando o aparelho avisa que está offline; acompanha os eventos `online`/`offline`. */
export function useOnline(): boolean {
  const [online, setOnline] = useState<boolean>(() => !isOffline());
  useEffect(() => {
    const update = (): void => setOnline(!isOffline());
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

/** `matchMedia` ao vivo (false sem suporte). Usado para só montar o que a tela realmente mostra (ex.: o QR do link). */
export function useMediaQuery(query: string): boolean {
  const read = (): boolean => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  };
  const [matches, setMatches] = useState<boolean>(read);
  useEffect(() => {
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(query);
    } catch {
      return;
    }
    const onChange = (): void => setMatches(mql.matches);
    onChange();
    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, [query]);
  return matches;
}
