import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
const enablePushMock = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({ children, to, ...rest }: { children?: React.ReactNode; to?: string } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
// enablePush é a ÚNICA peça de push simulada: o resto (isPushSupported, needsIosInstall, usePushConfig...) é o código real.
vi.mock("@/lib/push", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/push")>()),
  enablePush: enablePushMock,
}));

import { HomeOnboarding } from "@/components/gingapp/onboarding/home-onboarding";
import { HomePage } from "@/components/gingapp/home";
import { InstallRow } from "@/components/gingapp/profile-parts";
import { resetInstallStoreForTests, startInstallCapture } from "@/lib/install";
import { PushPermissionDeniedError } from "@/lib/push";
import { PUSH_DENIED_HINT_KEY, SNOOZE_KEYS } from "@/lib/snooze";
import { $, $$, buttonByText, cleanup, click, json, mockFeedApi, mount, settle, until } from "./feed-fixtures";
import { env } from "./onboarding-env";

/**
 * Convites da Home: "Instalar o GingApp" (prioridade 1) e "Ativar notificações" (prioridade 2), sempre UM por vez.
 * Cobre Android (prompt capturado antes do mount), iPhone/iPad (folha guiada, sem prompt), iOS fora do Safari,
 * app instalado, "Agora não" por 3 dias (relógio injetado), permissão negada e o Perfil.
 */

const UA = env.UA;
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 9, 31, 12, 0, 0);

const installCard = () => $("[data-testid=onboarding-install-card]");
const pushCard = () => $("[data-testid=onboarding-push-card]");
const deniedCard = () => $("[data-testid=onboarding-push-denied]");
const guide = () => $("[data-testid=ios-install-guide]");
const shown = () => $$("[data-testid^=onboarding-]");
const exactButton = (label: string) => buttonByText(new RegExp(`^${label}$`));

const PUSH_CONFIG = { enabled: true, provider: "webpush", publicKey: "BKeyDeTeste", firebase: null };

/** fetch simulado: só /push/config responde (o que os convites consultam). */
function mockPushConfig(config: Record<string, unknown> = PUSH_CONFIG) {
  const fetchMock = vi.fn(async (url: string) => (String(url).endsWith("/push/config") ? json(200, config) : json(404, { message: "x" })));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
const configRequests = (fetchMock: ReturnType<typeof mockPushConfig>) =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/push/config")).length;

/** Android/Chrome: o evento chega ANTES de o React montar (o ouvinte global já existe, como no main.tsx). */
function androidWithPrompt(outcome: "accepted" | "dismissed" = "accepted") {
  env.setUserAgent(UA.androidChrome);
  startInstallCapture();
  return env.dispatchInstallPrompt(outcome);
}

beforeEach(() => {
  resetInstallStoreForTests();
  enablePushMock.mockReset();
  Object.values(toastMock).forEach((fn) => fn.mockReset());
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  resetInstallStoreForTests();
  Reflect.deleteProperty(navigator, "clipboard");
  env.restore();
});

describe("Android: instalar com UM toque", () => {
  it("o prompt capturado antes do mount faz o cartão aparecer; tocar em Instalar chama prompt() uma vez e o cartão some", async () => {
    const event = androidWithPrompt("accepted");
    await mount(<HomeOnboarding />);

    const card = installCard();
    expect(card).not.toBeNull();
    expect(card!.getAttribute("aria-label")).toBe("Instalar o GingApp");
    expect(card!.textContent).toContain("Instalar o GingApp");
    expect(event.prompt).not.toHaveBeenCalled(); // nunca sozinho

    click(exactButton("Instalar"));
    expect(event.prompt).toHaveBeenCalledTimes(1);
    await settle();
    expect(installCard()).toBeNull();

    window.dispatchEvent(new Event("appinstalled")); // o Chrome confirma a instalação
    await settle();
    expect(shown()).toHaveLength(0);
  });

  it("sem o evento (Chrome não ofereceu / já instalado): nenhum cartão", async () => {
    env.setUserAgent(UA.androidChrome);
    await mount(<HomeOnboarding />);
    expect(shown()).toHaveLength(0);
  });

  it("o evento que chega DEPOIS do mount também mostra o cartão", async () => {
    env.setUserAgent(UA.androidChrome);
    await mount(<HomeOnboarding />);
    expect(installCard()).toBeNull();
    env.dispatchInstallPrompt();
    await settle();
    expect(installCard()).not.toBeNull();
  });

  it("app já instalado (display-mode standalone) ou instalado agora (appinstalled): cartão some", async () => {
    env.setStandalone("display-mode");
    androidWithPrompt();
    await mount(<HomeOnboarding />);
    expect(shown()).toHaveLength(0);

    cleanup();
    resetInstallStoreForTests();
    env.setStandalone(null);
    androidWithPrompt();
    await mount(<HomeOnboarding />);
    expect(installCard()).not.toBeNull();
    window.dispatchEvent(new Event("appinstalled"));
    await settle();
    expect(installCard()).toBeNull();
  });

  it("fechar o prompt nativo sem instalar conta como 'Agora não' (volta só depois de 3 dias)", async () => {
    androidWithPrompt("dismissed");
    await mount(<HomeOnboarding clock={() => T0} />);
    click(exactButton("Instalar"));
    await settle();
    expect(installCard()).toBeNull();
    expect(localStorage.getItem(SNOOZE_KEYS.install)).toBe(String(T0));
  });
});

describe("'Agora não': o cartão só volta depois de 3 dias", () => {
  it("antes de 3 dias não aparece; depois aparece (relógio falso)", async () => {
    androidWithPrompt();
    await mount(<HomeOnboarding clock={() => T0} />);
    click(exactButton("Agora não"));
    await settle();
    expect(installCard()).toBeNull();
    expect(localStorage.getItem(SNOOZE_KEYS.install)).toBe(String(T0));

    cleanup();
    await mount(<HomeOnboarding clock={() => T0 + 2 * DAY} />);
    expect(installCard()).toBeNull(); // 2 dias depois: ainda dispensado

    cleanup();
    await mount(<HomeOnboarding clock={() => T0 + 3 * DAY + 1} />);
    expect(installCard()).not.toBeNull(); // passaram 3 dias
  });

  it("storage indisponível não quebra: o cartão some nesta visita", async () => {
    androidWithPrompt();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("bloqueado");
    });
    await mount(<HomeOnboarding clock={() => T0} />);
    click(exactButton("Agora não"));
    await settle();
    expect(installCard()).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("iPhone/iPad: folha guiada, sem prompt", () => {
  it("Safari no iPhone: tocar em Instalar abre a folha com 3 passos e a seta no rodapé; NÃO chama prompt()", async () => {
    env.setUserAgent(UA.iphoneSafari, 5);
    startInstallCapture();
    const stray = env.dispatchInstallPrompt(); // defensivo: mesmo que algo dispare o evento, o iOS não usa o prompt
    await mount(<HomeOnboarding />);

    expect(installCard()).not.toBeNull();
    expect(guide()).toBeNull();
    click(exactButton("Instalar"));
    await settle();

    const sheet = guide();
    expect(sheet).not.toBeNull();
    expect(sheet!.textContent).toContain("Instalar o GingApp no iPhone");
    expect(sheet!.textContent).toContain("Toque em Compartilhar");
    expect(sheet!.textContent).toContain("Adicionar à Tela de Início");
    expect($("[data-testid=ios-step-3]")!.textContent).toContain("Adicionar");
    expect($$("[data-testid^=ios-step-]")).toHaveLength(3);
    expect($("[data-testid=ios-not-safari]")).toBeNull();
    const arrow = $("[data-testid=ios-share-arrow]");
    expect(arrow).not.toBeNull();
    expect(arrow!.getAttribute("aria-hidden")).toBe("true");
    expect(arrow!.className).toContain("bottom-"); // iPhone: barra inferior do Safari
    expect(stray.prompt).not.toHaveBeenCalled();
  });

  it("iPad: o Compartilhar é apontado no canto superior direito", async () => {
    env.setUserAgent(UA.ipadSafari, 5);
    await mount(<HomeOnboarding />);
    click(exactButton("Instalar"));
    await settle();
    expect(guide()!.textContent).toContain("Instalar o GingApp no iPad");
    expect(guide()!.textContent).toContain("canto superior direito do Safari");
    expect($("[data-testid=ios-share-arrow]")!.className).toContain("top-2");
  });

  it("iPadOS em 'site para computador' (se diz Mac, mas tem toque) também é tratado como iPad", async () => {
    env.setUserAgent(UA.macDesktop, 5);
    await mount(<HomeOnboarding />);
    expect(installCard()).not.toBeNull();
    click(exactButton("Instalar"));
    await settle();
    expect(guide()!.textContent).toContain("iPad");
  });

  it("iPhone fora do Safari (Chrome/Firefox/Edge/app): manda abrir o link no Safari e oferece 'Copiar link'", async () => {
    env.setUserAgent(UA.iphoneChrome, 5);
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    await mount(<HomeOnboarding />);
    click(exactButton("Instalar"));
    await settle();

    const warning = $("[data-testid=ios-not-safari]");
    expect(warning).not.toBeNull();
    expect(warning!.textContent).toContain("Abra este link no Safari");
    expect($("[data-testid=ios-share-arrow]")).toBeNull(); // a seta só vale para o Safari
    click(exactButton("Copiar link"));
    await settle();
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/`);
    expect(toastMock.success).toHaveBeenCalledTimes(1);
  });

  it("'Copiar link' sem permissão de área de transferência avisa o endereço em vez de falhar", async () => {
    env.setUserAgent(UA.iphoneFirefox, 5);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn(async () => Promise.reject(new Error("negado"))) },
    });
    await mount(<HomeOnboarding />);
    click(exactButton("Instalar"));
    await settle();
    click(exactButton("Copiar link"));
    await settle();
    expect(toastMock.info).toHaveBeenCalledTimes(1);
    expect(String(toastMock.info.mock.calls[0]![0])).toContain(window.location.origin);
  });

  it("prefers-reduced-motion: a seta fica parada; sem a preferência ela anima", async () => {
    env.setUserAgent(UA.iphoneSafari, 5);
    env.setReducedMotion(true);
    await mount(<HomeOnboarding />);
    click(exactButton("Instalar"));
    await settle();
    expect($("[data-testid=ios-share-arrow]")!.getAttribute("data-animated")).toBe("false");
    expect($("[data-testid=ios-share-arrow]")!.className).not.toContain("animate-bounce");

    cleanup();
    resetInstallStoreForTests();
    env.setReducedMotion(false);
    env.setUserAgent(UA.iphoneSafari, 5);
    await mount(<HomeOnboarding />);
    click(exactButton("Instalar"));
    await settle();
    expect($("[data-testid=ios-share-arrow]")!.getAttribute("data-animated")).toBe("true");
    expect($("[data-testid=ios-share-arrow]")!.className).toContain("animate-bounce");
  });

  it("iOS com o app aberto pelo ícone (navigator.standalone): nenhum cartão de instalar", async () => {
    env.setUserAgent(UA.iphoneSafari, 5);
    env.setStandalone("navigator");
    await mount(<HomeOnboarding />);
    expect(installCard()).toBeNull();
    expect(shown()).toHaveLength(0);
  });
});

describe("Ativar notificações", () => {
  it("só pede a permissão no TOQUE: nada é solicitado ao montar; o botão chama enablePush(config) e o cartão some", async () => {
    env.setUserAgent(UA.androidChrome); // sem prompt de instalação => o cartão de avisos é o primeiro
    const { requestPermission } = env.stubPushCapableBrowser("default");
    mockPushConfig();
    enablePushMock.mockResolvedValue({ provider: "webpush", subscription: {} });
    await mount(<HomeOnboarding />);
    await until(() => pushCard() !== null, "cartão de avisos");

    expect(pushCard()!.getAttribute("aria-label")).toBe("Ativar notificações");
    expect(enablePushMock).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();

    click(exactButton("Ativar notificações"));
    await settle();
    expect(enablePushMock).toHaveBeenCalledTimes(1);
    expect(enablePushMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: true, publicKey: "BKeyDeTeste" }));
    expect(toastMock.success).toHaveBeenCalledTimes(1);
    expect(shown()).toHaveLength(0);
  });

  it("servidor com push desligado: não mostra o cartão", async () => {
    env.setUserAgent(UA.androidChrome);
    env.stubPushCapableBrowser("default");
    mockPushConfig({ enabled: false, publicKey: null });
    await mount(<HomeOnboarding />);
    await settle();
    expect(shown()).toHaveLength(0);
  });

  it("permissão já concedida ou negada: nenhum cartão (e nem consulta o servidor)", async () => {
    for (const permission of ["granted", "denied"] as const) {
      env.setUserAgent(UA.androidChrome);
      env.stubPushCapableBrowser(permission);
      const fetchMock = mockPushConfig();
      await mount(<HomeOnboarding />);
      await settle();
      expect(shown(), permission).toHaveLength(0);
      expect(configRequests(fetchMock), permission).toBe(0);
      cleanup();
      env.restore();
    }
  });

  it("navegador sem suporte a push: nenhum cartão", async () => {
    env.setUserAgent(UA.androidChrome);
    mockPushConfig();
    await mount(<HomeOnboarding />);
    await settle();
    expect(shown()).toHaveLength(0);
  });

  it("NEGAR no pedido: o próprio cartão mostra UMA vez como reativar, sem insistir (nem depois de recarregar)", async () => {
    env.setUserAgent(UA.androidChrome);
    env.stubPushCapableBrowser("default");
    mockPushConfig();
    enablePushMock.mockImplementation(async () => {
      env.setNotificationPermission("denied");
      throw new PushPermissionDeniedError();
    });
    await mount(<HomeOnboarding />);
    await until(() => pushCard() !== null, "cartão de avisos");

    click(exactButton("Ativar notificações"));
    await until(() => deniedCard() !== null, "dica de permissão negada");
    expect(pushCard()).toBeNull();
    expect(deniedCard()!.textContent).toContain("Notificações bloqueadas");
    expect(deniedCard()!.textContent).toContain("configurações do aparelho");
    expect($("[data-testid=onboarding-push-denied] a")!.getAttribute("href")).toBe("/perfil");
    expect(localStorage.getItem(PUSH_DENIED_HINT_KEY)).toBe("1");
    expect(toastMock.error).not.toHaveBeenCalled();

    click(exactButton("Entendi"));
    await settle();
    expect(shown()).toHaveLength(0);

    // recarregar: o navegador agora reporta "denied" => nada mais é mostrado (nem consulta o servidor)
    cleanup();
    env.stubPushCapableBrowser("denied");
    const fetchMock = mockPushConfig();
    await mount(<HomeOnboarding />);
    await settle();
    expect(shown()).toHaveLength(0);
    expect(configRequests(fetchMock)).toBe(0);
  });

  it("a dica de negado nunca repete se já foi mostrada antes", async () => {
    env.setUserAgent(UA.androidChrome);
    env.stubPushCapableBrowser("default");
    mockPushConfig();
    localStorage.setItem(PUSH_DENIED_HINT_KEY, "1");
    enablePushMock.mockImplementation(async () => {
      env.setNotificationPermission("denied");
      throw new PushPermissionDeniedError();
    });
    await mount(<HomeOnboarding />);
    await until(() => pushCard() !== null, "cartão de avisos");
    click(exactButton("Ativar notificações"));
    await settle();
    expect(shown()).toHaveLength(0);
  });

  it("fechar o pedido sem escolher (permissão continua 'default'): nada foi bloqueado; vira 'Agora não' por 3 dias", async () => {
    env.setUserAgent(UA.androidChrome);
    env.stubPushCapableBrowser("default");
    mockPushConfig();
    enablePushMock.mockRejectedValue(new PushPermissionDeniedError());
    await mount(<HomeOnboarding clock={() => T0} />);
    await until(() => pushCard() !== null, "cartão de avisos");
    click(exactButton("Ativar notificações"));
    await settle();
    expect(shown()).toHaveLength(0);
    expect(localStorage.getItem(SNOOZE_KEYS.push)).toBe(String(T0));
    expect(localStorage.getItem(PUSH_DENIED_HINT_KEY)).toBeNull();
    expect(toastMock.info).toHaveBeenCalledTimes(1);
  });

  it("falha técnica ao ativar: avisa com erro e mantém o cartão para tentar de novo", async () => {
    env.setUserAgent(UA.androidChrome);
    env.stubPushCapableBrowser("default");
    mockPushConfig();
    enablePushMock.mockRejectedValue(new Error("sem rede"));
    await mount(<HomeOnboarding />);
    await until(() => pushCard() !== null, "cartão de avisos");
    click(exactButton("Ativar notificações"));
    await settle();
    expect(toastMock.error).toHaveBeenCalledTimes(1);
    expect(pushCard()).not.toBeNull();
  });

  it("'Agora não' nas notificações: volta só depois de 3 dias (chave própria, separada da de instalar)", async () => {
    env.setUserAgent(UA.androidChrome);
    env.stubPushCapableBrowser("default");
    mockPushConfig();
    await mount(<HomeOnboarding clock={() => T0} />);
    await until(() => pushCard() !== null, "cartão de avisos");
    click(exactButton("Agora não"));
    await settle();
    expect(pushCard()).toBeNull();
    expect(localStorage.getItem(SNOOZE_KEYS.push)).toBe(String(T0));
    expect(localStorage.getItem(SNOOZE_KEYS.install)).toBeNull();
    expect(enablePushMock).not.toHaveBeenCalled();

    // cleanup() também desfaz os stubs globais (Notification, PushManager, fetch): refaz o aparelho a cada remontagem.
    cleanup();
    env.stubPushCapableBrowser("default");
    const fetchMock = mockPushConfig();
    await mount(<HomeOnboarding clock={() => T0 + 2 * DAY} />);
    await settle();
    await settle();
    expect(pushCard()).toBeNull();
    expect(configRequests(fetchMock)).toBe(1); // o aparelho era elegível: só a dispensa escondeu o cartão

    cleanup();
    env.stubPushCapableBrowser("default");
    mockPushConfig();
    await mount(<HomeOnboarding clock={() => T0 + 3 * DAY + 1} />);
    await until(() => pushCard() !== null, "cartão volta depois de 3 dias");
  });

  it("iPhone fora do modo standalone: só o cartão de instalar (o de avisos não existe e nem consulta o servidor)", async () => {
    env.setUserAgent(UA.iphoneSafari, 5);
    env.stubPushCapableBrowser("default");
    const fetchMock = mockPushConfig();
    await mount(<HomeOnboarding />);
    await settle();
    expect(installCard()).not.toBeNull();
    expect(pushCard()).toBeNull();
    expect(configRequests(fetchMock)).toBe(0);

    // dispensou o convite de instalar: no iPhone ainda não dá para pedir avisos
    click(exactButton("Agora não"));
    await settle();
    expect(shown()).toHaveLength(0);
  });

  it("iPhone com o app instalado (standalone): o cartão de avisos aparece", async () => {
    env.setUserAgent(UA.iphoneSafari, 5);
    env.setStandalone("navigator");
    env.stubPushCapableBrowser("default");
    mockPushConfig();
    await mount(<HomeOnboarding />);
    await until(() => pushCard() !== null, "cartão de avisos no iPhone instalado");
    expect(installCard()).toBeNull();
  });
});

describe("um cartão por vez", () => {
  it("com instalar E avisos disponíveis, só o de instalar aparece; ao dispensá-lo entra o de avisos", async () => {
    androidWithPrompt();
    env.stubPushCapableBrowser("default");
    mockPushConfig();
    await mount(<HomeOnboarding clock={() => T0} />);
    await settle();
    await settle();
    expect(shown()).toHaveLength(1);
    expect(installCard()).not.toBeNull();
    expect(pushCard()).toBeNull();

    click(exactButton("Agora não"));
    await until(() => pushCard() !== null, "cartão de avisos depois de dispensar o de instalar");
    expect(shown()).toHaveLength(1);
    expect(installCard()).toBeNull();
  });

  it("acessibilidade: região nomeada, botões com alvo >= 44px (min-h-11) e foco visível herdado do Button", async () => {
    androidWithPrompt();
    await mount(<HomeOnboarding />);
    const region = installCard()!;
    expect(region.tagName).toBe("SECTION");
    expect(region.getAttribute("aria-label")).toBeTruthy();
    const buttons = [...region.querySelectorAll("button")];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button.className).toContain("min-h-11");
    expect(region.querySelector("h2")!.textContent).toBe("Instalar o GingApp");
    expect(region.querySelector("img")!.getAttribute("alt")).toBe(""); // ícone decorativo
  });
});

describe("Perfil: InstallRow usa o mesmo store", () => {
  it("Android com prompt capturado: um toque chama prompt() (sem abrir o texto de ajuda)", async () => {
    const event = androidWithPrompt();
    await mount(<InstallRow />);
    expect($("[data-testid=profile-install]")).not.toBeNull();
    click(exactButton("Instalar o GingApp"));
    await settle();
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain("Leve sua capoeira com você");
  });

  it("sem prompt (ex.: Firefox/desktop): abre o texto de ajuda manual", async () => {
    env.setUserAgent(UA.windowsChrome);
    await mount(<InstallRow />);
    click(exactButton("Instalar o GingApp"));
    await settle();
    expect(document.body.textContent).toContain("Leve sua capoeira com você");
    expect(guide()).toBeNull();
  });

  it("iPhone: abre a folha guiada (não chama prompt)", async () => {
    env.setUserAgent(UA.iphoneSafari, 5);
    startInstallCapture();
    const stray = env.dispatchInstallPrompt();
    await mount(<InstallRow />);
    click(exactButton("Instalar o GingApp"));
    await settle();
    expect(guide()).not.toBeNull();
    expect(stray.prompt).not.toHaveBeenCalled();
  });

  it("app instalado: a linha some", async () => {
    env.setStandalone("display-mode");
    await mount(<InstallRow />);
    expect($("[data-testid=profile-install]")).toBeNull();
  });
});

describe("Home", () => {
  it("o cartão fica logo abaixo do título e acima do banner/stories", async () => {
    androidWithPrompt();
    mockFeedApi({
      respond: (call) => (call.method === "GET" && !["/classes/me", "/students/me", "/organizations", "/passport/me", "/feed", "/feed/settings"].includes(call.path) ? json(200, []) : undefined),
    });
    await mount(<HomePage />);
    await until(() => installCard() !== null && $("[data-testid=hero-carousel]") !== null, "Home com o cartão");
    const heading = $(".page-heading")!;
    const card = installCard()!;
    const banner = $("[data-testid=hero-carousel]")!;
    expect(heading.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.compareDocumentPosition(banner) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(shown()).toHaveLength(1);
  });

  it("nada na tela de login", () => {
    const login = readFileSync(resolve(__dirname, "../components/gingapp/login.tsx"), "utf8");
    expect(login).not.toMatch(/onboarding|lib\/install|HomeOnboarding/);
  });
});
