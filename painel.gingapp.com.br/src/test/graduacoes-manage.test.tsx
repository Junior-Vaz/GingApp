import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { GraduacoesPage } from "@/modules/graduacoes/graduacoes-page";
import type { GraduationSystem } from "@/modules/graduacoes/graduacoes-api";
import { toLevelUpdate, toRegistrationUpdate, toSystemUpdate } from "@/modules/graduacoes/graduacoes-forms";
import { clearSession, loginAs } from "./login-as";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const level = (id: number, name: string, order: number, color: string | null, systemId = 1) => ({
  id,
  graduationSystemId: systemId,
  name,
  order,
  color,
  style: "SOLID" as const,
  colors: color ? [color] : [],
});
const systemsData: GraduationSystem[] = [
  { id: 1, name: "Cordas", description: "Sistema de cordas", isActive: true, levels: [level(1, "Crua", 0, "#f5f5dc"), level(2, "Amarela", 1, null)] },
  { id: 2, name: "Antigo", description: null, isActive: false, levels: [] },
];
const historyData = [
  { id: 100, studentId: 5, graduationLevelId: 2, graduatedAt: "2026-02-10T00:00:00.000Z", notes: "Batizado", graduationLevel: level(2, "Amarela", 1, null) },
];

interface Call { url: string; method: string; body: unknown }

function setup(write?: (call: Call) => Response) {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const url = input.replace(/^.*\/api/, "");
      const call = { url, method, body: init.body ? JSON.parse(init.body as string) : undefined };
      calls.push(call);
      if (method === "GET" && url === "/graduations/systems") return Promise.resolve(json(200, systemsData));
      if (method === "GET" && url.split("?")[0] === "/students") return Promise.resolve(json(200, [{ id: 5, name: "Ana", status: "ACTIVE" }]));
      if (method === "GET" && url.startsWith("/graduations/students/")) return Promise.resolve(json(200, historyData));
      return Promise.resolve(write?.(call) ?? json(200, { id: 1 }));
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

async function goStudents() {
  const tab = await screen.findByRole("tab", { name: "Graduação de alunos" });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
  await screen.findByLabelText("Aluno");
  await waitFor(() => expect(within(screen.getByLabelText("Aluno")).getAllByRole("option")).toHaveLength(2));
  fireEvent.change(screen.getByLabelText("Aluno"), { target: { value: "5" } });
  await screen.findByRole("cell", { name: /Amarela$/ });
}

beforeEach(() => clearSession());
afterEach(() => {
  cleanup();
  clearSession();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("Graduações - editar/remover sistemas e níveis", () => {
  it("MESTRE edita o sistema: PATCH /graduations/systems/1 com descrição vazia virando null", async () => {
    loginAs("MESTRE");
    const { calls } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Editar sistema Cordas" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Nome")).toHaveValue("Cordas");
    fireEvent.change(within(dialog).getByLabelText("Nome"), { target: { value: " Faixas " } });
    fireEvent.change(within(dialog).getByLabelText("Descrição (opcional)"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toEqual({ url: "/graduations/systems/1", method: "PATCH", body: { name: "Faixas", description: null } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Sistema de graduação atualizado."));
  });

  it("MESTRE edita o nível: PATCH /graduations/levels/1 com style e colors (cor preservada, 2ª cor completada)", async () => {
    loginAs("MESTRE");
    const { calls } = setup();
    fireEvent.click(await screen.findByRole("button", { name: "Editar nível Crua" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Nome do nível")).toHaveValue("Crua");
    fireEvent.click(within(dialog).getByRole("radio", { name: "Trançada 2 cores" }));
    fireEvent.change(within(dialog).getByLabelText("Ordem"), { target: { value: "4" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toEqual({ url: "/graduations/levels/1", method: "PATCH", body: { name: "Crua", order: 4, style: "BRAIDED", colors: ["#f5f5dc", "#16a34a"] } });
  });

  it("remover sistema pede confirmação (nada é enviado antes) e faz DELETE; cancelar não envia", async () => {
    loginAs("MESTRE");
    const { calls } = setup((c) => (c.method === "DELETE" ? json(200, { id: 1, isActive: false }) : json(200, {})));
    fireEvent.click(await screen.findByRole("button", { name: "Remover sistema Cordas" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(writes(calls)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(writes(calls)).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Remover sistema Cordas" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ url: "/graduations/systems/1", method: "DELETE" });
    // resposta sem `deleted` = inativado (histórico preservado)
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Sistema inativado. O histórico dos alunos foi preservado."));
  });

  it("sistema inativo oferece Reativar (PATCH isActive:true) e não oferece Remover", async () => {
    loginAs("MESTRE");
    const { calls } = setup();
    await screen.findByRole("button", { name: "Editar sistema Antigo" });
    expect(screen.queryByRole("button", { name: "Remover sistema Antigo" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reativar sistema Antigo" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toEqual({ url: "/graduations/systems/2", method: "PATCH", body: { isActive: true } });
  });

  it("remover nível: 409 do backend (nível já concedido) vira toast e o diálogo continua aberto", async () => {
    loginAs("MESTRE");
    const { calls } = setup((c) =>
      c.method === "DELETE" ? json(409, { message: "Este nível já foi concedido a alunos e não pode ser removido." }) : json(200, {}),
    );
    fireEvent.click(await screen.findByRole("button", { name: "Remover nível Crua" }));
    fireEvent.click(within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Este nível já foi concedido a alunos e não pode ser removido."));
    expect(writes(calls)[0]).toMatchObject({ url: "/graduations/levels/1", method: "DELETE" });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
  });

  it("PROFESSOR (graduations: view/create/edit, sem delete) vê Editar mas não Remover", async () => {
    loginAs("PROFESSOR");
    setup();
    await screen.findByRole("button", { name: "Editar sistema Cordas" });
    expect(screen.getByRole("button", { name: "Editar nível Crua" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Remover (sistema|nível)/ })).not.toBeInTheDocument();
  });

  it("sem sessão/permissão nenhuma ação de editar/remover é renderizada", async () => {
    setup();
    await screen.findByRole("list", { name: "Níveis de Cordas" });
    expect(screen.queryByRole("button", { name: /^(Editar|Remover|Reativar)/ })).not.toBeInTheDocument();
  });
});

describe("Graduações - editar/remover graduação do aluno", () => {
  it("MESTRE corrige nível/data/observação: PATCH /graduations/students/5/100; observação vazia vira null", async () => {
    loginAs("MESTRE");
    const { calls } = setup();
    await goStudents();
    fireEvent.click(screen.getByRole("button", { name: "Editar graduação Amarela" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("option", { selected: true, name: /Amarela/ })).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Data")).toHaveValue("2026-02-10");
    fireEvent.click(within(dialog).getByRole("option", { name: /Crua/ }));
    fireEvent.change(within(dialog).getByLabelText("Data"), { target: { value: "2026-03-01" } });
    fireEvent.change(within(dialog).getByLabelText("Observação (opcional)"), { target: { value: "" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toEqual({
      url: "/graduations/students/5/100",
      method: "PATCH",
      body: { graduationLevelId: 1, graduatedAt: "2026-03-01", notes: null },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Graduação atualizada."));
  });

  it("MESTRE desfaz um lançamento: confirma e DELETE /graduations/students/5/100", async () => {
    loginAs("MESTRE");
    const { calls } = setup();
    await goStudents();
    fireEvent.click(screen.getByRole("button", { name: "Remover graduação Amarela" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(writes(calls)).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Remover" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toMatchObject({ url: "/graduations/students/5/100", method: "DELETE" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Graduação removida."));
  });

  it("PROFESSOR edita mas não vê Remover; sem sessão não vê nenhum", async () => {
    loginAs("PROFESSOR");
    setup();
    await goStudents();
    expect(screen.getByRole("button", { name: "Editar graduação Amarela" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remover graduação Amarela" })).not.toBeInTheDocument();
    cleanup();
    vi.unstubAllGlobals();
    clearSession();
    setup();
    await goStudents();
    expect(screen.queryByRole("button", { name: /graduação Amarela/ })).not.toBeInTheDocument();
  });
});

describe("conversores de PATCH", () => {
  it("campos opcionais vazios viram null", () => {
    expect(toSystemUpdate({ name: " A ", description: " " })).toEqual({ name: "A", description: null });
    expect(toLevelUpdate({ name: "N", order: "3", style: "BRAIDED", colors: ["#FF0000", "#00FF00"] })).toEqual({ name: "N", order: 3, style: "BRAIDED", colors: ["#ff0000", "#00ff00"] });
    expect(toRegistrationUpdate({ graduationLevelId: "2", graduatedAt: "2026-01-01", notes: " " })).toEqual({
      graduationLevelId: 2,
      graduatedAt: "2026-01-01",
      notes: null,
    });
  });
});
