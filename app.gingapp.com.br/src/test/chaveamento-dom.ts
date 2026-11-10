import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LivePage } from "@/components/chaveamento/live-page";
import type { PublicSnapshot } from "@/lib/chaveamento/types";
import { lastSource } from "./chaveamento-mocks";

/** Montagem do telão em jsdom (sem @testing-library/dom, que o app não instala): createRoot + act. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

export interface Mounted {
  host: HTMLDivElement;
  root: Root;
  unmount: () => void;
}

const mounted: Mounted[] = [];

export function mountLive(token = "tok", tv = false): Mounted {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => root.render(createElement(LivePage, { token, tv })));
  const m: Mounted = {
    host,
    root,
    unmount: () => {
      act(() => root.unmount());
      host.remove();
    },
  };
  mounted.push(m);
  return m;
}

export function cleanupMounted(): void {
  for (const m of mounted.splice(0)) {
    try {
      m.unmount();
    } catch {
      /* já desmontado */
    }
  }
}

/** O servidor abre o stream e manda um snapshot (objeto, ou o texto bruto do evento SSE). */
export function feed(snapshot: PublicSnapshot | string): void {
  act(() => {
    lastSource().emit("open");
    lastSource().emit("snapshot", typeof snapshot === "string" ? snapshot : JSON.stringify(snapshot));
  });
}

export function click(element: Element | null): void {
  if (!element) throw new Error("elemento não encontrado para clicar");
  act(() => (element as HTMLElement).click());
}

export const tabs = (host: HTMLElement): HTMLButtonElement[] => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')];

export const selectedTab = (host: HTMLElement): string | undefined => tabs(host).find((t) => t.getAttribute("aria-selected") === "true")?.textContent?.trim();

/** Faz o `prefers-reduced-motion: reduce` valer (ou não) para os componentes que montarem depois. */
export function setReducedMotion(reduce: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => ({
      matches: reduce && query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
