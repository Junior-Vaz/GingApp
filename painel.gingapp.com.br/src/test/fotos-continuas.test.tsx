import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSession, loginAs } from "./login-as";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AulasPage } from "@/modules/aulas/aulas-page";
import { ProfessoresPage } from "@/modules/professores/professores-page";
import { TurmasPage } from "@/modules/turmas/turmas-page";
import { UnidadesPage } from "@/modules/unidades/unidades-page";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

type Call = { method: string; path: string; query: URLSearchParams; body: unknown };
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const page = <T,>(rows: T[]) => json(200, rows, { "X-Total-Count": String(rows.length) });

const UPLOADED = "/api/uploads/3f2b8c1e-5d4a-4c3b-9a7e-1b2c3d4e5f60.webp";
const PHOTO_URL = "https://exemplo.com/turma.jpg";
const fileOf = () => new File([new Uint8Array(10)], "foto.png", { type: "image/png" });

/** fetch falso: roteia por "METHOD /caminho" (sem prefixo da API NEM query) e registra as chamadas. */
function mockApi(routes: Record<string, (call: Call) => Response> = {}) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit = {}) => {
      const [path = "", search = ""] = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?");
      const method = init.method ?? "GET";
      const isForm = init.body instanceof FormData;
      calls.push({
        method,
        path,
        query: new URLSearchParams(search),
        body: init.body && !isForm ? JSON.parse(init.body as string) : undefined,
      });
      const handler = routes[`${method} ${path}`];
      if (handler) return Promise.resolve(handler(calls.at(-1)!));
      if (method === "POST" && path === "/uploads") return Promise.resolve(json(201, { url: UPLOADED }));
      if (method === "GET" && path === "/units") return Promise.resolve(page([]));
      if (method === "GET" && path === "/teachers") return Promise.resolve(page([]));
      return Promise.resolve(json(404, { message: `sem rota ${method} ${path}` }));
    }),
  );
  return calls;
}

function renderUi(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => loginAs("MESTRE"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("Fotos nos formulários", () => {
  it("Turma: envia a foto (POST /uploads) e o POST /classes leva `photo` + `autoGenerateLessons: true` (contínuo é o padrão)", async () => {
    const calls = mockApi({
      "GET /classes": () => page([]),
      "POST /classes": () => json(201, { id: 9 }),
    });
    renderUi(<TurmasPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Nova turma/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Juvenil" } });
    expect(within(dialog).getByRole("switch", { name: "Contínuo (sem data final)" })).toBeChecked();
    expect(within(dialog).getByText(/mantém ~60 dias de aulas à frente automaticamente/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByTestId("image-file-input"), { target: { files: [fileOf()] } });
    await waitFor(() => expect(calls.some((c) => c.path === "/uploads")).toBe(true));
    await waitFor(() => expect(within(dialog).getByAltText("Foto da turma")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/classes")).toBe(true));
    expect(calls.find((c) => c.method === "POST" && c.path === "/classes")!.body).toMatchObject({
      name: "Juvenil",
      photo: UPLOADED,
      autoGenerateLessons: true,
    });
  });

  it("Turma: remover a foto e desligar o contínuo na edição envia photo: null e autoGenerateLessons: false", async () => {
    const calls = mockApi({
      "GET /classes": () =>
        page([{ id: 1, unitId: null, name: "Infantil", description: null, weekday: 2, startTime: null, endTime: null, teacherUserId: null, status: "ACTIVE", photo: PHOTO_URL, autoGenerateLessons: true }]),
      "PATCH /classes/1": () => json(200, {}),
    });
    renderUi(<TurmasPage />);
    await screen.findByText("Infantil");
    fireEvent.click(screen.getAllByText("Editar")[0]!);
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByAltText("Foto da turma")).toHaveAttribute("src", PHOTO_URL));
    fireEvent.click(within(dialog).getByRole("button", { name: /Remover/ }));
    fireEvent.click(within(dialog).getByRole("switch", { name: "Contínuo (sem data final)" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")!.body).toMatchObject({ photo: null, autoGenerateLessons: false });
  });

  it("Unidade: o link/envio da foto vai em `photo` no POST /units", async () => {
    const calls = mockApi({ "GET /units": () => page([]), "POST /units": () => json(201, { id: 3 }) });
    renderUi(<UnidadesPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Nova unidade/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Filial Sul" } });
    fireEvent.change(within(dialog).getByLabelText("Foto ou logo da unidade (URL)"), { target: { value: PHOTO_URL } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/units")).toBe(true));
    expect(calls.find((c) => c.method === "POST" && c.path === "/units")!.body).toMatchObject({ name: "Filial Sul", photo: PHOTO_URL });
  });

  it("Professor: o envio da foto vai em `photo` no POST /teachers", async () => {
    const calls = mockApi({ "GET /teachers": () => page([]), "POST /teachers": () => json(201, { id: 5 }) });
    renderUi(<ProfessoresPage />);
    fireEvent.click(await screen.findByRole("button", { name: /Novo professor/ }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: "Prof Novo" } });
    fireEvent.change(within(dialog).getByLabelText("E-mail"), { target: { value: "novo@x.com" } });
    fireEvent.change(within(dialog).getByLabelText("Senha inicial"), { target: { value: "123456" } });
    fireEvent.change(within(dialog).getByTestId("image-file-input"), { target: { files: [fileOf()] } });
    await waitFor(() => expect(within(dialog).getByAltText("Foto do professor")).toBeInTheDocument());
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST" && c.path === "/teachers")).toBe(true));
    expect(calls.find((c) => c.method === "POST" && c.path === "/teachers")!.body).toMatchObject({ name: "Prof Novo", photo: UPLOADED });
  });
});

describe("Miniaturas nas listas", () => {
  it("Turmas: mostra a foto da turma e da unidade, o selo 'Aulas contínuas' só na turma contínua e fallback sem imagem quebrada", async () => {
    mockApi({
      "GET /classes": () =>
        page([
          { id: 1, unitId: 7, name: "Infantil", description: null, weekday: 2, startTime: "18:00", endTime: "19:00", teacherUserId: 8, status: "ACTIVE", photo: PHOTO_URL, autoGenerateLessons: true, unit: { id: 7, name: "Sede Centro", photo: "https://exemplo.com/sede.png" }, teacher: { id: 8, name: "Prof Pastinha", photo: null } },
          { id: 2, unitId: null, name: "Adulto", description: null, weekday: null, startTime: null, endTime: null, teacherUserId: null, status: "ACTIVE", photo: null, autoGenerateLessons: false, unit: null, teacher: null },
        ]),
    });
    const { container } = renderUi(<TurmasPage />);
    expect(await screen.findByText("Infantil")).toBeInTheDocument();
    expect(screen.getAllByText("Aulas contínuas")).toHaveLength(1);
    const srcs = Array.from(container.querySelectorAll("img")).map((i) => i.getAttribute("src"));
    expect(srcs).toContain(PHOTO_URL);
    expect(srcs).toContain("https://exemplo.com/sede.png");
    // turma sem foto: ícone de fallback (nenhum <img> com src vazio)
    expect(srcs.every((s) => !!s)).toBe(true);
    // imagem que falha ao carregar cai no fallback (sem ícone de imagem quebrada)
    const broken = container.querySelector(`img[src="${PHOTO_URL}"]`)!;
    fireEvent.error(broken);
    expect(container.querySelector(`img[src="${PHOTO_URL}"]`)).toBeNull();
  });

  it("Aulas: mostra a foto da turma e do professor vindas do servidor (class/teacher)", async () => {
    mockApi({
      "GET /classes": () => page([]),
      "GET /lessons": () =>
        page([
          { id: 1, classId: 1, unitId: null, teacherUserId: 8, date: "2026-11-03T00:00:00.000Z", startTime: "18:00", endTime: "19:00", notes: null, status: "ACTIVE", class: { id: 1, name: "Infantil", photo: PHOTO_URL }, unit: null, teacher: { id: 8, name: "Prof Pastinha", photo: "https://exemplo.com/prof.jpg" } },
        ]),
    });
    const { container } = renderUi(<AulasPage />);
    expect(await screen.findByText("Infantil")).toBeInTheDocument();
    expect(screen.getByText("Prof Pastinha")).toBeInTheDocument();
    const srcs = Array.from(container.querySelectorAll("img")).map((i) => i.getAttribute("src"));
    expect(srcs).toEqual(expect.arrayContaining([PHOTO_URL, "https://exemplo.com/prof.jpg"]));
  });
});
