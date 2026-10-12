import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { GraduacoesPage } from "@/modules/graduacoes/graduacoes-page";
import { moveItem } from "@/modules/graduacoes/level-utils";
import { clearSession, loginAs } from "./login-as";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const lv = (id: number, name: string, order: number, style: "SOLID" | "SPLIT" | "BRAIDED", colors: string[], studentCount?: number) => ({
  id,
  graduationSystemId: 1,
  name,
  order,
  color: colors[0] ?? null,
  style,
  colors,
  ...(studentCount === undefined ? {} : { studentCount }),
});
const systemsData = [
  {
    id: 1,
    name: "Cordas",
    description: null,
    isActive: true,
    levels: [
      lv(1, "Crua", 0, "SOLID", ["#f5f1e6"], 3),
      lv(2, "Verde e amarela", 1, "SPLIT", ["#16a34a", "#facc15"], 1),
      lv(3, "Trançada", 2, "BRAIDED", ["#16a34a", "#facc15", "#2563eb"]),
    ],
  },
];
const templates = [
  {
    code: "capoeira",
    name: "Capoeira tradicional",
    description: "Cordas clássicas.",
    levels: [
      { name: "Crua", style: "SOLID", colors: ["#f5f1e6"] },
      { name: "Crua e amarela", style: "SPLIT", colors: ["#f5f1e6", "#facc15"] },
      { name: "Trançada", style: "BRAIDED", colors: ["#16a34a", "#facc15", "#2563eb"] },
    ],
  },
  { code: "jiu", name: "Faixas", description: "", levels: [{ name: "Branca", style: "SOLID", colors: ["#ffffff"] }] },
];

interface Call { url: string; method: string; body: unknown }

function setup() {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const url = input.replace(/^.*\/api/, "");
      calls.push({ url, method, body: init.body ? JSON.parse(init.body as string) : undefined });
      if (method === "GET" && url === "/graduations/systems") return Promise.resolve(json(200, systemsData));
      if (method === "GET" && url === "/graduations/templates") return Promise.resolve(json(200, templates));
      return Promise.resolve(json(200, { id: 1 }));
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GraduacoesPage />
    </QueryClientProvider>,
  );
  return { calls };
}
const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

beforeEach(() => clearSession());
afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Graduações - régua de cordas", () => {
  it("cada nível mostra a corda desenhada, o nome, a ordem e o nº de alunos; a régua traz todas as cordas", async () => {
    loginAs("MESTRE");
    setup();
    const list = await screen.findByRole("list", { name: "Níveis de Cordas" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0]!.textContent).toContain("Ordem 0 · 3 alunos");
    expect(items[1]!.textContent).toContain("Ordem 1 · 1 aluno");
    expect(items[2]!.textContent).not.toContain("alunos");
    expect(within(items[1]!).getByRole("img", { name: "Corda dividida verde e amarela" })).toBeInTheDocument();
    expect(within(items[2]!).getByRole("img", { name: "Corda trançada verde, amarela e azul" })).toBeInTheDocument();
    expect(screen.getByTestId("ruler-1").querySelectorAll("svg[data-rope]")).toHaveLength(3);
  });

  it("subir/descer: PUT /graduations/systems/1/levels/reorder com a nova sequência de ids; extremos desabilitados", async () => {
    loginAs("MESTRE");
    const { calls } = setup();
    await screen.findByRole("list", { name: "Níveis de Cordas" });
    expect(screen.getByRole("button", { name: "Subir nível Crua" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Descer nível Trançada" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Descer nível Crua" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toEqual({ url: "/graduations/systems/1/levels/reorder", method: "PUT", body: { order: [2, 1, 3] } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ordem dos níveis atualizada."));
  });

  it("arrastar e soltar um nível reordena (HTML5 drag-and-drop)", async () => {
    loginAs("MESTRE");
    const { calls } = setup();
    const list = await screen.findByRole("list", { name: "Níveis de Cordas" });
    const [first, , last] = within(list).getAllByRole("listitem");
    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    fireEvent.dragStart(first!, { dataTransfer });
    fireEvent.dragOver(last!, { dataTransfer });
    fireEvent.drop(last!, { dataTransfer });
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toEqual({ url: "/graduations/systems/1/levels/reorder", method: "PUT", body: { order: [2, 3, 1] } });
  });

  it("duplicar nível: POST /graduations/levels/2/duplicate", async () => {
    loginAs("MESTRE");
    const { calls } = setup();
    await screen.findByRole("list", { name: "Níveis de Cordas" });
    fireEvent.click(screen.getByRole("button", { name: "Duplicar nível Verde e amarela" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ url: "/graduations/levels/2/duplicate", method: "POST" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Nível duplicado."));
  });

  it("sem permissão não há subir/descer/duplicar/arrastar", async () => {
    setup();
    const list = await screen.findByRole("list", { name: "Níveis de Cordas" });
    expect(screen.queryByRole("button", { name: /^(Subir|Descer|Duplicar) nível/ })).not.toBeInTheDocument();
    expect(within(list).getAllByRole("listitem")[0]).toHaveAttribute("draggable", "false");
  });

  it("moveItem move sem mutar e ignora índices inválidos", () => {
    const base = [1, 2, 3];
    expect(moveItem(base, 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem(base, 2, 0)).toEqual([3, 1, 2]);
    expect(base).toEqual([1, 2, 3]);
    expect(moveItem(base, 0, 0)).toBe(base);
    expect(moveItem(base, 0, 5)).toBe(base);
  });
});

describe("Graduações - criar a partir de um modelo", () => {
  it("lista os modelos com a prévia das cordas, sugere o nome e faz POST /graduations/systems/from-template", async () => {
    loginAs("MESTRE");
    const { calls } = setup();
    await screen.findByRole("list", { name: "Níveis de Cordas" });
    fireEvent.click(screen.getByRole("button", { name: "Criar a partir de um modelo" }));
    const dialog = await screen.findByRole("dialog");
    const group = await within(dialog).findByRole("radiogroup", { name: "Modelo" });
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    expect(within(screen.getByTestId("template-preview-capoeira")).getAllByRole("img")).toHaveLength(3);
    expect(within(dialog).getByRole("img", { name: "Corda trançada verde, amarela e azul" })).toBeInTheDocument();

    // sem escolher modelo: valida
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar sistema" }));
    expect(await within(dialog).findByText("Escolha um modelo.")).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);

    fireEvent.click(within(group).getByRole("radio", { name: /Capoeira tradicional/ }));
    expect(within(dialog).getByLabelText("Nome do sistema")).toHaveValue("Capoeira tradicional");
    fireEvent.change(within(dialog).getByLabelText("Nome do sistema"), { target: { value: " Minha escola " } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Criar sistema" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toEqual({
      url: "/graduations/systems/from-template",
      method: "POST",
      body: { code: "capoeira", name: "Minha escola" },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Sistema criado a partir do modelo."));
  });
});

describe("Graduações - editor de nível", () => {
  it("a prévia grande acompanha o estilo e as cores ao vivo", async () => {
    loginAs("MESTRE");
    setup();
    await screen.findByRole("list", { name: "Níveis de Cordas" });
    fireEvent.click(screen.getByRole("button", { name: "Editar nível Verde e amarela" }));
    const dialog = await screen.findByRole("dialog");
    const preview = within(dialog).getByTestId("level-preview");
    expect(preview.querySelectorAll("svg[data-rope]")).toHaveLength(2); // vertical + horizontal
    expect(within(dialog).getByTestId("level-preview-label")).toHaveTextContent("Corda dividida verde e amarela");
    expect(within(dialog).getByRole("radio", { name: "Dividida 2 cores" })).toHaveAttribute("aria-checked", "true");

    fireEvent.click(within(dialog).getByRole("button", { name: "Cor 2: Roxa" }));
    expect(within(dialog).getByTestId("level-preview-label")).toHaveTextContent("Corda dividida verde e roxa");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Trançada 2 cores" }));
    expect(within(dialog).getByTestId("level-preview-label")).toHaveTextContent("Corda trançada verde e roxa");
    expect(preview.querySelector("svg[data-style='BRAIDED']")).not.toBeNull();
  });
});
