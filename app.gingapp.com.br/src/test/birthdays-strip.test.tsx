import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { birthdayShortName, fichaBirthdayVisible, formatBirthdayDate, isMinorByBirthDate, type BirthdayWeekItem } from "@/lib/birthdays";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { BirthdaysStrip } from "@/components/gingapp/birthdays-strip";

/** Faixa "Aniversariantes da semana" (API mockada via fetch; sem @testing-library/dom: act + createRoot). */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const item = (over: Partial<BirthdayWeekItem> & { personId: number }): BirthdayWeekItem => ({
  name: "Fulano de Tal",
  nickname: null,
  photo: null,
  day: 5,
  month: 3,
  isToday: false,
  canCongratulate: true,
  congratulatedByMe: false,
  ...over,
});

interface Reply {
  status?: number;
  body: unknown;
}
type Handler = (path: string, init: RequestInit) => Reply | undefined;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let requests: { path: string; method: string }[] = [];

function mockApi(handler: Handler) {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = String(input).replace(/^https?:\/\/[^/]+\/api/, "");
      requests.push({ path, method: init.method ?? "GET" });
      const reply = handler(path, init) ?? { status: 404, body: { message: `sem rota ${path}` } };
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
    }),
  );
}

function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}><BirthdaysStrip /></QueryClientProvider>));
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
const waitFor = (assertion: () => void) => act(async () => void (await vi.waitFor(assertion, { timeout: 2000 })));
const text = () => (container?.textContent ?? "");
const buttons = () => [...container!.querySelectorAll("button")];
const buttonByLabel = (label: string) => buttons().find((b) => b.getAttribute("aria-label") === label);

beforeEach(() => {
  localStorage.clear();
  Object.values(toastMock).forEach((fn) => fn.mockClear());
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("BirthdaysStrip", () => {
  it("renderiza os cartões: apelido ou primeiro nome, 'Hoje 🎉' ou dd/MM, botão com aria-label por pessoa", async () => {
    mockApi((path) =>
      path === "/birthdays/week"
        ? {
            body: {
              items: [
                item({ personId: 1, name: "Maria Aparecida", nickname: "Cida", isToday: true, day: 21, month: 10 }),
                item({ personId: 2, name: "João Pedro Souza", day: 5, month: 3 }),
              ],
            },
          }
        : undefined,
    );
    mount();
    await waitFor(() => expect(container!.querySelector("[data-testid=birthdays-strip]")).toBeTruthy());

    expect(text()).toContain("Aniversariantes da semana");
    const cida = container!.querySelector("[data-testid=birthday-card-1]")!;
    expect(cida.textContent).toContain("Cida");
    expect(cida.textContent).not.toContain("Maria");
    expect(cida.textContent).toContain("Hoje 🎉");
    const joao = container!.querySelector("[data-testid=birthday-card-2]")!;
    expect(joao.textContent).toContain("João");
    expect(joao.textContent).not.toContain("Pedro");
    expect(joao.textContent).toContain("05/03");
    expect(buttonByLabel("Parabenizar Cida")).toBeTruthy();
    expect(buttonByLabel("Parabenizar João")).toBeTruthy();
    // rolagem horizontal fica DENTRO da faixa
    const list = container!.querySelector("ul")!;
    expect(list.className).toContain("overflow-x-auto");
    expect(list.className).toContain("max-w-full");
    // alvo de toque >= 44px (min-h-11)
    expect(buttonByLabel("Parabenizar Cida")!.className).toContain("min-h-11");
  });

  it("parabenizar: POST /birthdays/:id/congratulate, toast de sucesso e botão vira 'Parabenizado ✓' desabilitado", async () => {
    mockApi((path, init) => {
      if (path === "/birthdays/week") return { body: { items: [item({ personId: 7, name: "Ana Lima" })] } };
      if (path === "/birthdays/7/congratulate" && init.method === "POST") return { status: 201, body: { sent: true } };
      return undefined;
    });
    mount();
    await waitFor(() => expect(buttonByLabel("Parabenizar Ana")).toBeTruthy());

    await act(async () => buttonByLabel("Parabenizar Ana")!.click());
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("Parabéns enviado para Ana!"));
    expect(requests.filter((r) => r.method === "POST")).toEqual([{ path: "/birthdays/7/congratulate", method: "POST" }]);

    const done = buttonByLabel("Você já parabenizou Ana")!;
    expect(done).toBeTruthy();
    expect(done.disabled).toBe(true);
    expect(done.textContent).toContain("Parabenizado ✓");
    expect(buttonByLabel("Parabenizar Ana")).toBeUndefined();
  });

  it("já parabenizado no servidor (congratulatedByMe): nasce desabilitado, sem POST ao clicar", async () => {
    mockApi((path) => (path === "/birthdays/week" ? { body: { items: [item({ personId: 3, name: "Bia Rocha", congratulatedByMe: true })] } } : undefined));
    mount();
    await waitFor(() => expect(buttonByLabel("Você já parabenizou Bia")).toBeTruthy());
    const done = buttonByLabel("Você já parabenizou Bia")!;
    expect(done.disabled).toBe(true);
    await act(async () => done.click());
    expect(requests.some((r) => r.method === "POST")).toBe(false);
  });

  it("409 ALREADY_CONGRATULATED não é erro: avisa que já parabenizou e marca como parabenizado", async () => {
    mockApi((path, init) => {
      if (path === "/birthdays/week") return { body: { items: [item({ personId: 9, name: "Caio Neves" })] } };
      if (path === "/birthdays/9/congratulate" && init.method === "POST") {
        return { status: 409, body: { code: "ALREADY_CONGRATULATED", message: "Você já parabenizou esta pessoa neste ano." } };
      }
      return undefined;
    });
    mount();
    await waitFor(() => expect(buttonByLabel("Parabenizar Caio")).toBeTruthy());
    await act(async () => buttonByLabel("Parabenizar Caio")!.click());
    await waitFor(() => expect(toastMock.info).toHaveBeenCalledWith("Você já parabenizou Caio."));
    expect(toastMock.error).not.toHaveBeenCalled();
    expect(toastMock.success).not.toHaveBeenCalled();
    expect(buttonByLabel("Você já parabenizou Caio")!.disabled).toBe(true);
  });

  it("outro erro (403) mostra aviso de erro e mantém o botão disponível", async () => {
    mockApi((path, init) => {
      if (path === "/birthdays/week") return { body: { items: [item({ personId: 4, name: "Duda Melo" })] } };
      if (init.method === "POST") return { status: 403, body: { message: "Não é possível parabenizar esta pessoa." } };
      return undefined;
    });
    mount();
    await waitFor(() => expect(buttonByLabel("Parabenizar Duda")).toBeTruthy());
    await act(async () => buttonByLabel("Parabenizar Duda")!.click());
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("Não é possível parabenizar esta pessoa."));
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("o próprio usuário (canCongratulate=false) aparece sem botão", async () => {
    mockApi((path) =>
      path === "/birthdays/week"
        ? { body: { items: [item({ personId: 5, name: "Eu Mesmo", canCongratulate: false, isToday: true }), item({ personId: 6, name: "Fábio Dias" })] } }
        : undefined,
    );
    mount();
    await waitFor(() => expect(container!.querySelector("[data-testid=birthday-card-5]")).toBeTruthy());
    const mine = container!.querySelector("[data-testid=birthday-card-5]")!;
    expect(mine.textContent).toContain("Eu");
    expect(mine.querySelector("button")).toBeNull();
    expect(container!.querySelector("[data-testid=birthday-card-6] button")).toBeTruthy();
  });

  it("esconde-se sozinha quando não há ninguém (lista vazia) ou quando a API falha - sem erro visível", async () => {
    mockApi((path) => (path === "/birthdays/week" ? { body: { items: [] } } : undefined));
    mount();
    await settle();
    expect(requests.map((r) => r.path)).toContain("/birthdays/week");
    expect(container!.querySelector("[data-testid=birthdays-strip]")).toBeNull();
    expect(text()).toBe("");
    act(() => root?.unmount());
    container?.remove();
    root = null;

    mockApi((path) => (path === "/birthdays/week" ? { status: 500, body: { message: "boom" } } : undefined));
    mount();
    await settle();
    expect(container!.querySelector("[data-testid=birthdays-strip]")).toBeNull();
    expect(text()).toBe("");
    expect(toastMock.error).not.toHaveBeenCalled();
  });
});

describe("helpers de aniversário", () => {
  it("birthdayShortName: apelido ou primeiro nome; formatBirthdayDate: dd/MM", () => {
    expect(birthdayShortName({ name: "  Maria  da Silva ", nickname: null })).toBe("Maria");
    expect(birthdayShortName({ name: "Maria da Silva", nickname: " Cida " })).toBe("Cida");
    expect(formatBirthdayDate({ day: 3, month: 9 })).toBe("03/09");
    expect(formatBirthdayDate({ day: 29, month: 12 })).toBe("29/12");
  });

  it("isMinorByBirthDate: menor de 18 hoje; sem data = não é possível saber (false)", () => {
    const now = new Date(2026, 9, 21); // 21/10/2026
    expect(isMinorByBirthDate("2008-10-22T00:00:00.000Z", now)).toBe(true); // faz 18 amanhã
    expect(isMinorByBirthDate("2008-10-21T00:00:00.000Z", now)).toBe(false); // faz 18 hoje
    expect(isMinorByBirthDate("2012-01-01T00:00:00.000Z", now)).toBe(true);
    expect(isMinorByBirthDate("1990-05-10T00:00:00.000Z", now)).toBe(false);
    expect(isMinorByBirthDate(null, now)).toBe(false);
    expect(isMinorByBirthDate("lixo", now)).toBe(false);
  });

  it("fichaBirthdayVisible: raiz, depois person, default true", () => {
    expect(fichaBirthdayVisible({ person: {} })).toBe(true);
    expect(fichaBirthdayVisible({ person: { birthdayVisible: false } })).toBe(false);
    expect(fichaBirthdayVisible({ birthdayVisible: false, person: { birthdayVisible: true } })).toBe(false);
  });
});
