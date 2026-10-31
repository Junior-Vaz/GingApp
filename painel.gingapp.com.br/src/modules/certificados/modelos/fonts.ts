import { useEffect } from "react";
import type { CertificateLayout, FontKey } from "./types";

/**
 * Fontes da prévia do canvas (as MESMAS famílias do PDF, pacotes @fontsource, subset latin = acentos do português).
 * Carregadas SOB DEMANDA (import dinâmico por fonte usada) para não inflar o bundle principal do painel.
 */
const LOADERS: Record<FontKey, (() => Promise<unknown>)[]> = {
  helvetica: [],
  playfair: [
    () => import("@fontsource/playfair-display/latin-400.css"),
    () => import("@fontsource/playfair-display/latin-700.css"),
    () => import("@fontsource/playfair-display/latin-400-italic.css"),
    () => import("@fontsource/playfair-display/latin-700-italic.css"),
  ],
  cinzel: [() => import("@fontsource/cinzel/latin-400.css"), () => import("@fontsource/cinzel/latin-700.css")],
  lora: [
    () => import("@fontsource/lora/latin-400.css"),
    () => import("@fontsource/lora/latin-700.css"),
    () => import("@fontsource/lora/latin-400-italic.css"),
    () => import("@fontsource/lora/latin-700-italic.css"),
  ],
  montserrat: [
    () => import("@fontsource/montserrat/latin-400.css"),
    () => import("@fontsource/montserrat/latin-700.css"),
    () => import("@fontsource/montserrat/latin-400-italic.css"),
    () => import("@fontsource/montserrat/latin-700-italic.css"),
  ],
  greatvibes: [() => import("@fontsource/great-vibes/latin-400.css")],
};

const loading = new Map<FontKey, Promise<void>>();

/** Carrega (uma vez só) os arquivos das fontes pedidas. Falha de rede não quebra a tela: cai na fonte genérica. */
export function loadFonts(keys: Iterable<FontKey>): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  for (const key of new Set(keys)) {
    let task = loading.get(key);
    if (!task) {
      task = Promise.all(LOADERS[key].map((load) => load())).then(
        () => undefined,
        () => {
          loading.delete(key); // permite tentar de novo depois
        },
      );
      loading.set(key, task);
    }
    tasks.push(task);
  }
  return Promise.all(tasks).then(() => undefined);
}

export function fontKeysOf(layout: CertificateLayout): FontKey[] {
  const keys = new Set<FontKey>();
  for (const el of layout.elements) if (el.type === "text") keys.add(el.fontKey);
  return [...keys];
}

/** Pede ao navegador as fontes que o desenho usa (chamado pelo canvas; barato depois da 1ª vez). */
export function useLayoutFonts(layout: CertificateLayout): void {
  const signature = fontKeysOf(layout).sort().join(",");
  useEffect(() => {
    if (signature) void loadFonts(signature.split(",") as FontKey[]);
  }, [signature]);
}
