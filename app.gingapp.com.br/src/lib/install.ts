import { useSyncExternalStore } from "react";
import { isIos, isStandalone } from "@/lib/push";

/**
 * Instalação do PWA (fonte única para o Perfil, o menu e o cartão da Home).
 *
 * O Chrome dispara `beforeinstallprompt` UMA vez, logo no começo da vida da página; se ninguém estiver ouvindo, o
 * evento se perde e o app não consegue mais abrir o prompt nativo com um toque. Por isso a captura é GLOBAL:
 * `startInstallCapture()` é chamada no `main.tsx` antes de o React montar, e qualquer tela só LÊ o resultado
 * (useSyncExternalStore). iPhone/iPad não permitem instalar por código: nesses aparelhos só dá para guiar o usuário.
 */

export type InstallPlatform = "android" | "ios" | "desktop" | "other";

/** Evento não padronizado do Chrome/Edge/Samsung Internet (não existe no lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice?: Promise<{ outcome: "accepted" | "dismissed"; platform?: string }>;
}

export interface InstallSnapshot {
  /** Há um prompt nativo guardado: um toque abre a instalação (só Chrome/Edge/Samsung Internet; nunca no iOS). */
  canPrompt: boolean;
  /** O app já roda instalado (display-mode standalone / navigator.standalone) ou acabou de ser instalado (appinstalled). */
  installed: boolean;
  platform: InstallPlatform;
  /** No iOS: o navegador é o Safari? (Chrome, Firefox, Edge e navegadores de apps no iOS não oferecem o caminho garantido.) */
  iosBrowserIsSafari: boolean;
  /** iPad (inclui iPadOS em "site para computador"): o botão Compartilhar fica no canto superior direito, não embaixo. */
  isIpad: boolean;
}

export type PromptInstallResult = "accepted" | "dismissed" | "unavailable";

/** Navegadores que no iOS NÃO são o Safari (todos usam WebKit, mas mudam onde fica o Compartilhar e a instalação). */
const IOS_NON_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|Brave|YaBrowser|UCBrowser|FBAN|FBAV|FB_IAB|Instagram|Line\/|MicroMessenger|TikTok|Snapchat|Twitter|LinkedInApp/i;

/** Plataforma a partir do user agent (função pura, para teste). `touchPoints` distingue o iPadOS (que se diz Macintosh). */
export function detectPlatform(userAgent: string, touchPoints = 0): InstallPlatform {
  if (/iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1)) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  if (/Windows|Macintosh|X11|Linux|CrOS/.test(userAgent)) return "desktop";
  return "other";
}

/** Safari de verdade no iOS: nenhum dos marcadores de outros navegadores/apps no user agent. */
export function isIosSafari(userAgent: string): boolean {
  return !IOS_NON_SAFARI.test(userAgent);
}

export function isIpadDevice(userAgent: string, touchPoints = 0): boolean {
  return /iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && touchPoints > 1);
}

function readEnvironment(): Pick<InstallSnapshot, "platform" | "iosBrowserIsSafari" | "isIpad"> {
  if (typeof navigator === "undefined") return { platform: "other", iosBrowserIsSafari: false, isIpad: false };
  const ua = navigator.userAgent;
  const touch = navigator.maxTouchPoints ?? 0;
  // `isIos()` (lib/push) é a mesma regra usada pelas notificações; a detecção por UA aqui só complementa Android/desktop.
  const platform = isIos() ? "ios" : detectPlatform(ua, touch);
  return {
    platform,
    iosBrowserIsSafari: platform === "ios" && isIosSafari(ua),
    isIpad: platform === "ios" && isIpadDevice(ua, touch),
  };
}

/* ----------------------------------------- store ----------------------------------------- */

let deferred: BeforeInstallPromptEvent | null = null;
let installedFlag = false;
let started = false;
let teardown: (() => void) | null = null;
let snapshot: InstallSnapshot | null = null;
const listeners = new Set<() => void>();

function compute(): InstallSnapshot {
  const env = readEnvironment();
  return {
    canPrompt: deferred !== null,
    installed: installedFlag || isStandalone(),
    ...env,
  };
}

function sameSnapshot(a: InstallSnapshot, b: InstallSnapshot): boolean {
  return (
    a.canPrompt === b.canPrompt &&
    a.installed === b.installed &&
    a.platform === b.platform &&
    a.iosBrowserIsSafari === b.iosBrowserIsSafari &&
    a.isIpad === b.isIpad
  );
}

/** Recalcula e só avisa os ouvintes quando algo mudou (a identidade do snapshot precisa ser estável). */
function refresh(): void {
  const next = compute();
  if (snapshot && sameSnapshot(snapshot, next)) return;
  snapshot = next;
  listeners.forEach((listener) => listener());
}

/**
 * Registra os ouvintes globais (idempotente). Chame o mais cedo possível: `main.tsx`, antes de `createRoot`.
 * Não é um import "só por efeito" de propósito: o package.json declara `sideEffects: false`, e uma chamada de função
 * nunca é descartada pelo bundler.
 */
export function startInstallCapture(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  const onPrompt = (event: Event) => {
    // Sem preventDefault o Chrome mostraria a mini-barra por conta própria; guardamos o evento para abrir no toque.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    refresh();
  };
  const onInstalled = () => {
    installedFlag = true;
    deferred = null;
    refresh();
  };
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);

  // O app pode passar a rodar em modo standalone sem recarregar (instalado e aberto pelo próprio navegador).
  let media: MediaQueryList | null = null;
  try {
    media = typeof window.matchMedia === "function" ? window.matchMedia("(display-mode: standalone)") : null;
  } catch {
    media = null;
  }
  media?.addEventListener?.("change", refresh);

  teardown = () => {
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
    media?.removeEventListener?.("change", refresh);
  };
  refresh();
}

/** Só para testes: desfaz a captura e limpa o estado, como num carregamento novo da página. */
export function resetInstallStoreForTests(): void {
  teardown?.();
  teardown = null;
  started = false;
  deferred = null;
  installedFlag = false;
  snapshot = null;
}

function subscribe(listener: () => void): () => void {
  startInstallCapture();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getInstallSnapshot(): InstallSnapshot {
  snapshot ??= compute();
  return snapshot;
}

/**
 * Abre o prompt nativo de instalação. TEM que ser chamada direto no toque do usuário (o navegador exige gesto):
 * `prompt()` roda de forma síncrona, antes de qualquer `await`. O evento só vale uma vez; depois do uso ele é descartado.
 */
export async function promptInstall(): Promise<PromptInstallResult> {
  const event = deferred;
  if (!event) return "unavailable";
  let shown: Promise<unknown>;
  try {
    shown = Promise.resolve(event.prompt()); // 1ª coisa, ainda dentro do gesto do usuário
  } catch {
    shown = Promise.resolve(undefined);
  } finally {
    deferred = null; // o evento só pode ser usado uma vez
    refresh();
  }
  try {
    const result = (await shown) as { outcome?: string } | undefined;
    const choice = event.userChoice ? await event.userChoice : result;
    return choice?.outcome === "accepted" ? "accepted" : "dismissed";
  } catch {
    return "dismissed";
  }
}

export interface InstallState extends InstallSnapshot {
  promptInstall: () => Promise<PromptInstallResult>;
}

/** Estado de instalação ao vivo. Seguro para chamar de qualquer tela; a captura já foi iniciada no main. */
export function useInstall(): InstallState {
  const state = useSyncExternalStore(subscribe, getInstallSnapshot, getInstallSnapshot);
  return { ...state, promptInstall };
}

/**
 * Vale mostrar um convite de instalação? Sim quando o app ainda não está instalado e (a) o navegador guardou o prompt
 * nativo (Android/desktop) ou (b) é iPhone/iPad (não há prompt: o convite abre a folha guiada).
 */
export function shouldOfferInstall(state: Pick<InstallSnapshot, "installed" | "canPrompt" | "platform">): boolean {
  if (state.installed) return false;
  return state.canPrompt || state.platform === "ios";
}
