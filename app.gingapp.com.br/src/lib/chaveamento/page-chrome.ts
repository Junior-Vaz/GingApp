import { useEffect } from "react";

/** Cor da barra do navegador/PWA e do fundo atrás da página (escuro, como o resto do telão). */
export const CHROME_COLOR = "#070b14";

/**
 * Enquanto o telão está na tela: `viewport-fit=cover` (a página usa a área toda, com `env(safe-area-inset-*)` no CSS),
 * `theme-color` escuro e fundo escuro no <html> (sem faixa branca ao puxar a página). Restaura tudo ao sair, porque o
 * `index.html` é do app inteiro. Tudo em try/catch.
 */
export function usePageChrome(): void {
  useEffect(() => {
    const undo: Array<() => void> = [];
    try {
      const viewport = document.querySelector('meta[name="viewport"]');
      if (viewport) {
        const old = viewport.getAttribute("content") ?? "";
        if (!/viewport-fit\s*=/.test(old)) viewport.setAttribute("content", old === "" ? "viewport-fit=cover" : `${old}, viewport-fit=cover`);
        undo.push(() => viewport.setAttribute("content", old));
      }
      let theme = document.querySelector('meta[name="theme-color"]');
      const created = theme === null;
      const oldTheme = theme?.getAttribute("content") ?? null;
      if (!theme) {
        theme = document.createElement("meta");
        theme.setAttribute("name", "theme-color");
        document.head.appendChild(theme);
      }
      const themeEl = theme;
      themeEl.setAttribute("content", CHROME_COLOR);
      undo.push(() => {
        if (created) themeEl.remove();
        else themeEl.setAttribute("content", oldTheme ?? "#ffffff");
      });
      const root = document.documentElement;
      const previousBackground = root.style.backgroundColor;
      const previousScheme = root.style.colorScheme;
      root.style.backgroundColor = CHROME_COLOR;
      root.style.colorScheme = "dark";
      undo.push(() => {
        root.style.backgroundColor = previousBackground;
        root.style.colorScheme = previousScheme;
      });
    } catch {
      /* sem DOM completo: o telão funciona igual */
    }
    return () => {
      for (const fn of undo.reverse()) {
        try {
          fn();
        } catch {
          /* nada a fazer */
        }
      }
    };
  }, []);
}
