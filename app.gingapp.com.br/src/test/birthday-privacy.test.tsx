import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Ficha, Student } from "@/lib/queries";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

import { FichaEditSection } from "@/components/gingapp/ficha-edit";

/** Privacidade do aniversário na edição do perfil: switch "Mostrar meu aniversário ao grupo" (backend mockado via fetch). */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const student: Student = { id: 7, userId: 3, unitId: null, name: "Ana", photo: null, coverPhoto: null, socialLinks: null, joinedAt: null };

const ficha = (person: Partial<Ficha["person"]> = {}, root: Partial<Ficha> = {}): Ficha =>
  ({
    person: { id: 1, gingappCode: "GING-AAAA-BBBB", name: "Ana", nickname: "Aninha", birthDate: "1990-05-10T00:00:00.000Z", photo: null, documentMasked: null, documentKind: null, ...person },
    enrollments: [],
    graduations: [],
    attendanceByGroup: [],
    certificates: [],
    sharedFromOtherGroups: [],
    scope: "SELF",
    ...root,
  }) as Ficha;

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let requests: { path: string; method: string; body: unknown }[] = [];
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });

function mockApi(data: Ficha, patch: () => Response = () => json(200, {})) {
  requests = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const path = String(input).replace(/^https?:\/\/[^/]+\/api/, "");
      requests.push({ path, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (path.startsWith("/students/me")) return json(200, [student]);
      if (path.startsWith("/people/me/ficha")) return json(200, data);
      if (path === "/people/me" && init.method === "PATCH") return patch();
      return json(404, { message: `sem rota ${path}` });
    }),
  );
}

async function mount() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}><FichaEditSection /></QueryClientProvider>));
  await settle();
  await settle();
}

const toggle = () => container!.querySelector<HTMLButtonElement>("#ficha-birthday-visible");
const patches = () => requests.filter((r) => r.method === "PATCH");

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

describe("Perfil: privacidade do aniversário", () => {
  it("mostra o switch ligado por padrão, com o texto de privacidade; desligar envia PATCH /people/me {birthdayVisible:false}", async () => {
    mockApi(ficha());
    await mount();
    const sw = toggle()!;
    expect(sw).toBeTruthy();
    expect(sw.getAttribute("role")).toBe("switch");
    expect(sw.getAttribute("aria-checked")).toBe("true");
    const label = container!.querySelector<HTMLLabelElement>("label[for=ficha-birthday-visible]")!;
    expect(label.textContent).toBe("Mostrar meu aniversário ao grupo");
    expect(container!.textContent).toContain("Seu dia e mês aparecem para o grupo na faixa de aniversariantes; a idade nunca é mostrada");

    await act(async () => sw.click());
    await settle();
    expect(patches()).toEqual([{ path: "/people/me", method: "PATCH", body: { birthdayVisible: false } }]);
    expect(toastMock.success).toHaveBeenCalledWith("Seu aniversário não aparece mais para o grupo.");
  });

  it("lê birthdayVisible=false da ficha (em person ou na raiz): nasce desligado e ligar envia true", async () => {
    mockApi(ficha({ birthdayVisible: false }));
    await mount();
    expect(toggle()!.getAttribute("aria-checked")).toBe("false");
    await act(async () => toggle()!.click());
    await settle();
    expect(patches()[0]!.body).toEqual({ birthdayVisible: true });
    expect(toastMock.success).toHaveBeenCalledWith("Seu aniversário aparece para o grupo.");

    act(() => root?.unmount());
    container?.remove();
    mockApi(ficha({}, { birthdayVisible: false }));
    await mount();
    expect(toggle()!.getAttribute("aria-checked")).toBe("false");
  });

  it("clicar no rótulo também alterna", async () => {
    mockApi(ficha());
    await mount();
    await act(async () => container!.querySelector<HTMLLabelElement>("label[for=ficha-birthday-visible]")!.click());
    await settle();
    expect(patches()[0]!.body).toEqual({ birthdayVisible: false });
  });

  it("menor de 18 anos: o switch some (regra fixa), o restante da ficha continua", async () => {
    const year = new Date().getFullYear() - 12;
    mockApi(ficha({ birthDate: `${year}-03-15T00:00:00.000Z` }));
    await mount();
    expect(toggle()).toBeNull();
    expect(container!.querySelector("[data-testid=birthday-privacy]")).toBeNull();
    expect(container!.querySelector("#ficha-nickname")).toBeTruthy();
  });

  it("sem data de nascimento na ficha não há como saber: mantém o switch", async () => {
    mockApi(ficha({ birthDate: null }));
    await mount();
    expect(toggle()).toBeTruthy();
  });

  it("erro ao salvar: volta ao valor anterior e avisa", async () => {
    mockApi(ficha(), () => json(500, { message: "Falha ao salvar." }));
    await mount();
    await act(async () => toggle()!.click());
    await settle();
    expect(toastMock.error).toHaveBeenCalledWith("Falha ao salvar.");
    expect(toggle()!.getAttribute("aria-checked")).toBe("true");
    expect(toastMock.success).not.toHaveBeenCalled();
  });

  it("o formulário de apelido/telefone continua salvando SEM birthdayVisible", async () => {
    mockApi(ficha());
    await mount();
    const save = [...container!.querySelectorAll("button")].find((b) => /Salvar dados da ficha/.test(b.textContent ?? ""))!;
    await act(async () => save.click());
    await settle();
    expect(patches()[0]!.body).toEqual({ nickname: "Aninha" });
  });
});
