import { useEffect, useRef, useState, type RefObject } from "react";

/** Tamanho (clientWidth/clientHeight) de um elemento, atualizado por ResizeObserver; o observador é desligado ao desmontar. */
export function useElementSize<T extends HTMLElement = HTMLDivElement>(): [RefObject<T | null>, { width: number; height: number; fontSize: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0, fontSize: 16 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = (): void => {
      let fontSize = 16;
      try {
        fontSize = Number.parseFloat(window.getComputedStyle(el).fontSize) || 16;
      } catch {
        /* sem estilo calculado: 16 px */
      }
      setSize((previous) => (previous.width === el.clientWidth && previous.height === el.clientHeight && previous.fontSize === fontSize ? previous : { width: el.clientWidth, height: el.clientHeight, fontSize }));
    };
    read();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", read);
      return () => window.removeEventListener("resize", read);
    }
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}
