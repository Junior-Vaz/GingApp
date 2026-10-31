import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectPlatform,
  getInstallSnapshot,
  isIosSafari,
  isIpadDevice,
  promptInstall,
  resetInstallStoreForTests,
  shouldOfferInstall,
  startInstallCapture,
} from "@/lib/install";
import { env } from "./onboarding-env";

/**
 * Captura GLOBAL do beforeinstallprompt (lib/install): o evento chega antes de qualquer tela montar e continua
 * disponível; um toque chama prompt() uma única vez. Plataforma/Safari detectados pelo user agent.
 */

const UA = env.UA;

beforeEach(() => resetInstallStoreForTests());
afterEach(() => {
  resetInstallStoreForTests();
  env.restore();
});

describe("detecção de plataforma", () => {
  it("Android, iOS (iPhone/iPad/iPadOS como Mac), desktop e outros", () => {
    expect(detectPlatform(UA.androidChrome)).toBe("android");
    expect(detectPlatform(UA.iphoneSafari)).toBe("ios");
    expect(detectPlatform(UA.iphoneChrome)).toBe("ios");
    expect(detectPlatform(UA.ipadSafari)).toBe("ios");
    expect(detectPlatform(UA.macDesktop, 5)).toBe("ios"); // iPadOS 13+ se diz Macintosh, mas tem toque
    expect(detectPlatform(UA.macDesktop, 0)).toBe("desktop"); // Mac de verdade
    expect(detectPlatform(UA.windowsChrome)).toBe("desktop");
    expect(detectPlatform("Mozilla/5.0 (PlayStation)")).toBe("other");
  });

  it("iOS: Safari só quando nenhum marcador de outro navegador/app aparece", () => {
    expect(isIosSafari(UA.iphoneSafari)).toBe(true);
    expect(isIosSafari(UA.ipadSafari)).toBe(true);
    expect(isIosSafari(UA.iphoneChrome)).toBe(false); // CriOS
    expect(isIosSafari(UA.iphoneFirefox)).toBe(false); // FxiOS
    expect(isIosSafari(UA.iphoneEdge)).toBe(false); // EdgiOS
    expect(isIosSafari(UA.iphoneInstagram)).toBe(false); // navegador embutido de app
  });

  it("iPad (inclusive iPadOS em modo desktop) x iPhone", () => {
    expect(isIpadDevice(UA.ipadSafari)).toBe(true);
    expect(isIpadDevice(UA.macDesktop, 5)).toBe(true);
    expect(isIpadDevice(UA.iphoneSafari)).toBe(false);
  });
});

describe("captura do beforeinstallprompt", () => {
  it("o evento que chega ANTES de qualquer tela fica guardado, com preventDefault (sem mini-barra do Chrome)", () => {
    env.setUserAgent(UA.androidChrome);
    startInstallCapture();
    expect(getInstallSnapshot().canPrompt).toBe(false);
    const event = env.dispatchInstallPrompt();
    expect(event.defaultPrevented).toBe(true);
    expect(getInstallSnapshot()).toMatchObject({ canPrompt: true, installed: false, platform: "android" });
  });

  it("promptInstall() chama prompt() UMA vez (no mesmo tick do toque) e descarta o evento", async () => {
    env.setUserAgent(UA.androidChrome);
    startInstallCapture();
    const event = env.dispatchInstallPrompt("accepted");
    const pending = promptInstall();
    expect(event.prompt).toHaveBeenCalledTimes(1); // síncrono: antes de qualquer await
    expect(await pending).toBe("accepted");
    expect(getInstallSnapshot().canPrompt).toBe(false);
    expect(await promptInstall()).toBe("unavailable");
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it("fechar o prompt nativo sem instalar devolve 'dismissed'", async () => {
    env.setUserAgent(UA.androidChrome);
    startInstallCapture();
    env.dispatchInstallPrompt("dismissed");
    expect(await promptInstall()).toBe("dismissed");
  });

  it("start é idempotente: um único ouvinte, um único evento guardado", () => {
    env.setUserAgent(UA.androidChrome);
    const add = vi.spyOn(window, "addEventListener");
    startInstallCapture();
    startInstallCapture();
    startInstallCapture();
    expect(add.mock.calls.filter(([type]) => type === "beforeinstallprompt")).toHaveLength(1);
    add.mockRestore();
  });

  it("appinstalled marca instalado e limpa o prompt guardado", () => {
    env.setUserAgent(UA.androidChrome);
    startInstallCapture();
    env.dispatchInstallPrompt();
    window.dispatchEvent(new Event("appinstalled"));
    expect(getInstallSnapshot()).toMatchObject({ installed: true, canPrompt: false });
  });

  it("ouvintes são avisados nas mudanças e o snapshot é estável quando nada muda", () => {
    env.setUserAgent(UA.androidChrome);
    startInstallCapture();
    const before = getInstallSnapshot();
    expect(getInstallSnapshot()).toBe(before);
    env.dispatchInstallPrompt();
    const after = getInstallSnapshot();
    expect(after).not.toBe(before);
    expect(getInstallSnapshot()).toBe(after);
  });
});

describe("app já instalado", () => {
  it("display-mode: standalone => instalado", () => {
    env.setUserAgent(UA.androidChrome);
    env.setStandalone("display-mode");
    startInstallCapture();
    expect(getInstallSnapshot().installed).toBe(true);
  });

  it("navigator.standalone (iOS) => instalado", () => {
    env.setUserAgent(UA.iphoneSafari);
    env.setStandalone("navigator");
    startInstallCapture();
    expect(getInstallSnapshot()).toMatchObject({ installed: true, platform: "ios" });
  });
});

describe("shouldOfferInstall", () => {
  it("só instalável: prompt guardado (Android/desktop) ou iPhone/iPad; nunca instalado", () => {
    expect(shouldOfferInstall({ installed: false, canPrompt: true, platform: "android" })).toBe(true);
    expect(shouldOfferInstall({ installed: false, canPrompt: true, platform: "desktop" })).toBe(true);
    expect(shouldOfferInstall({ installed: false, canPrompt: false, platform: "ios" })).toBe(true);
    expect(shouldOfferInstall({ installed: false, canPrompt: false, platform: "android" })).toBe(false); // sem prompt: nada a oferecer
    expect(shouldOfferInstall({ installed: false, canPrompt: false, platform: "desktop" })).toBe(false);
    expect(shouldOfferInstall({ installed: true, canPrompt: true, platform: "android" })).toBe(false);
    expect(shouldOfferInstall({ installed: true, canPrompt: false, platform: "ios" })).toBe(false);
  });
});
