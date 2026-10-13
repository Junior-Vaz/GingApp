import { useSyncExternalStore } from "react";

/**
 * PWA do painel: registro do service worker (vite-plugin-pwa, registerType "prompt"), aviso de nova versão e
 * instalação ("Instalar app"). O SW só faz precache do shell e dos assets: NUNCA de /api/.
 */

interface PwaState {
  /** Há uma versão nova do app esperando (service worker "waiting"). */
  needRefresh: boolean;
  /** O navegador ofereceu a instalação (beforeinstallprompt) e ela ainda não foi usada. */
  canInstall: boolean;
}

/** Evento não padronizado do Chrome/Edge/Android (não existe no lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let state: PwaState = { needRefresh: false, canInstall: false };
const listeners = new Set<() => void>();
let updateWorker: ((reloadPage?: boolean) => Promise<void>) | undefined;
let deferredInstall: BeforeInstallPromptEvent | null = null;

function setState(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePwaState(): PwaState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/** Ativa o service worker novo e recarrega a página. */
export async function applyUpdate(): Promise<void> {
  await updateWorker?.(true);
}

/** Abre o diálogo nativo de instalação; devolve se o usuário aceitou. */
export async function promptInstall(): Promise<boolean> {
  const event = deferredInstall;
  if (!event) return false;
  await event.prompt();
  const choice = await event.userChoice;
  deferredInstall = null;
  setState({ canInstall: false });
  return choice.outcome === "accepted";
}

/** iPhone/iPad (o Safari não tem beforeinstallprompt: a instalação é "Adicionar à Tela de Início"). */
export function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iPadOs = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPhone|iPad|iPod/.test(ua) || iPadOs;
}

/** O app já roda instalado (janela standalone)? */
export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

let installListening = false;
/** Captura o convite de instalação do navegador (chamar uma vez, cedo). */
export function listenForInstall() {
  if (installListening || typeof window === "undefined") return;
  installListening = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstall = event as BeforeInstallPromptEvent;
    setState({ canInstall: true });
  });
  window.addEventListener("appinstalled", () => {
    deferredInstall = null;
    setState({ canInstall: false });
  });
}

/**
 * Registra o service worker só em produção, fora de iframes e sem `?sw=off`. Em dev (ou recusado) remove SWs antigos
 * deste escopo para não servir um shell velho.
 */
export async function registerAppWorker() {
  listenForInstall();
  if (!("serviceWorker" in navigator)) return;
  const refused =
    !import.meta.env.PROD ||
    window.self !== window.top ||
    new URLSearchParams(location.search).get("sw") === "off";
  if (refused) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((registration) =>
          [registration.active, registration.waiting, registration.installing].some(
            (worker) => worker && new URL(worker.scriptURL).pathname === "/sw.js",
          ),
        )
        .map((registration) => registration.unregister()),
    );
    return;
  }
  const { registerSW } = await import("virtual:pwa-register");
  updateWorker = registerSW({
    immediate: true,
    onNeedRefresh: () => setState({ needRefresh: true }),
  });
}

/** Só para testes: zera o estado e simula eventos. */
export const __pwaTest = {
  reset() {
    state = { needRefresh: false, canInstall: false };
    deferredInstall = null;
    updateWorker = undefined;
    listeners.forEach((listener) => listener());
  },
  setNeedRefresh(value: boolean, update?: () => Promise<void>) {
    updateWorker = update;
    setState({ needRefresh: value });
  },
  setInstallEvent(event: BeforeInstallPromptEvent | null) {
    deferredInstall = event;
    setState({ canInstall: event !== null });
  },
};
