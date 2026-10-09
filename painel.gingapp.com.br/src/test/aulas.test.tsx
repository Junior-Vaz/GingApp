import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { AulasPage } from "@/modules/aulas/aulas-page";
import { toPayload } from "@/modules/aulas/aulas-form";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const classes = [
  { id: 1, name: "Infantil" },
  { id: 2, name: "Adulto" },
];
const teachers = [{ id: 10, role: "MESTRE", status: "ACTIVE", user: { id: 7, name: "Mestre Bimba", email: "b@x.com", phone: null } }];
const baseLessons = [
  { id: 1, classId: 1, unitId: null, teacherUserId: 7, date: "2026-03-05T00:00:00.000Z", startTime: "18:00", endTime: "19:00", notes: "Roda", status: "ACTIVE" },
  { id: 2, classId: 2, unitId: null, teacherUserId: null, date: "2026-03-06T00:00:00.000Z", startTime: null, endTime: null, notes: null, status: "INACTIVE" },
];

interface Call { url: string; method: string; body: unknown }

function setup(overrides: { lessons?: Response | (() => Response); onMutation?: (call: Call) => Response } = {}) {
  const calls: Call[] = [];
  const fetchMock = vi.fn((input: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const url = input.replace(/^.*\/api/, "");
    const body = init.body ? JSON.parse(init.body as string) : undefined;
    calls.push({ url, method, body });
    if (method === "GET" && url === "/lessons") {
      const o = overrides.lessons;
      return Promise.resolve(typeof o === "function" ? o() : (o ?? json(200, baseLessons)));
    }
    if (method === "GET" && url === "/classes") return Promise.resolve(json(200, classes));
    if (method === "GET" && url === "/teachers") return Promise.resolve(json(200, teachers));
    return Promise.resolve(overrides.onMutation?.({ url, method, body }) ?? json(200, { id: 99 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <AulasPage />
    </QueryClientProvider>,
  );
  return { calls };
}

const mutations = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("AulasPage", () => {
  it("lista aulas com turma, data (sem voltar um dia), horário e professor resolvidos", async () => {
    setup();
    await screen.findByRole("cell", { name: "Infantil" });
    const row = screen.getByRole("cell", { name: "Infantil" }).closest("tr")!;
    expect(within(row).getByText("05/03/2026")).toBeInTheDocument();
    expect(within(row).getByText("18:00 – 19:00")).toBeInTheDocument();
    expect(within(row).getByText("Mestre Bimba")).toBeInTheDocument();
    expect(within(row).getByText("Ativa")).toBeInTheDocument();
    const cancelled = screen.getByRole("cell", { name: "Adulto" }).closest("tr")!;
    expect(within(cancelled).getByText("Cancelada")).toBeInTheDocument();
    // aula cancelada não oferece "Cancelar"
    expect(within(cancelled).queryByRole("button", { name: /Cancelar aula/ })).toBeNull();
  });

  it("filtra por turma, por status e pela busca", async () => {
    setup();
    await screen.findByRole("cell", { name: "Infantil" });
    fireEvent.change(screen.getByLabelText("Filtrar por turma"), { target: { value: "2" } });
    expect(screen.queryByRole("cell", { name: "Infantil" })).toBeNull();
    expect(screen.getByRole("cell", { name: "Adulto" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filtrar por turma"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "ACTIVE" } });
    expect(screen.queryByRole("cell", { name: "Adulto" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "2026-03-06" } });
    expect(screen.queryByRole("cell", { name: "Infantil" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Buscar"), { target: { value: "bimba" } });
    expect(screen.getByRole("cell", { name: "Infantil" })).toBeInTheDocument();
    expect(screen.queryByRole("cell", { name: "Adulto" })).toBeNull();
  });

  it("mostra erro com retry quando a lista falha e vazio quando não há aulas", async () => {
    setup({ lessons: json(500, { message: "Falhou feio." }) });
    expect(await screen.findByTestId("table-error")).toHaveTextContent("Falhou feio.");
  });

  it("estado vazio", async () => {
    setup({ lessons: json(200, []) });
    expect(await screen.findByTestId("table-empty")).toHaveTextContent("Nenhuma aula cadastrada ainda.");
  });

  it("valida turma e data antes de enviar (nenhuma chamada de escrita)", async () => {
    const { calls } = setup();
    await screen.findByRole("cell", { name: "Infantil" });
    fireEvent.click(screen.getByRole("button", { name: "Nova aula" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("Selecione a turma.")).toBeInTheDocument();
    expect(screen.getByText("Informe a data da aula.")).toBeInTheDocument();
    expect(mutations(calls)).toHaveLength(0);
  });

  it("valida fim depois do início", async () => {
    const { calls } = setup();
    await screen.findByRole("cell", { name: "Infantil" });
    fireEvent.click(screen.getByRole("button", { name: "Nova aula" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Turma"), { target: { value: "1" } });
    fireEvent.change(within(dialog).getByLabelText("Data"), { target: { value: "2026-04-01" } });
    fireEvent.change(within(dialog).getByLabelText("Início"), { target: { value: "19:00" } });
    fireEvent.change(within(dialog).getByLabelText("Fim"), { target: { value: "18:00" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await screen.findByText("O fim deve ser depois do início.")).toBeInTheDocument();
    expect(mutations(calls)).toHaveLength(0);
  });

  it("cria aula: POST /lessons com números e sem campos vazios + toast", async () => {
    const { calls } = setup();
    await screen.findByRole("cell", { name: "Infantil" });
    fireEvent.click(screen.getByRole("button", { name: "Nova aula" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Turma"), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText("Data"), { target: { value: "2026-04-01" } });
    fireEvent.change(within(dialog).getByLabelText("Professor"), { target: { value: "7" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(mutations(calls)).toHaveLength(1));
    expect(mutations(calls)[0]).toEqual({
      url: "/lessons",
      method: "POST",
      body: { classId: 2, date: "2026-04-01", teacherUserId: 7 },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Aula criada."));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("edita aula: PATCH /lessons/:id, campos limpos vão como null e status é enviado", async () => {
    const { calls } = setup();
    await screen.findByRole("cell", { name: "Infantil" });
    fireEvent.click(screen.getByRole("button", { name: "Editar aula de Infantil" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Início")).toHaveValue("18:00");
    fireEvent.change(within(dialog).getByLabelText("Início"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("Fim"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("Professor"), { target: { value: "" } });
    fireEvent.change(within(dialog).getByLabelText("Status"), { target: { value: "INACTIVE" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(mutations(calls)).toHaveLength(1));
    expect(mutations(calls)[0]).toEqual({
      url: "/lessons/1",
      method: "PATCH",
      body: { classId: 1, date: "2026-03-05", startTime: null, endTime: null, teacherUserId: null, notes: "Roda", status: "INACTIVE" },
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Aula atualizada."));
  });

  it("erro do backend na criação vira toast e mantém o diálogo aberto", async () => {
    const { calls } = setup({ onMutation: () => json(400, { message: "Turma inválida para esta organização." }) });
    await screen.findByRole("cell", { name: "Infantil" });
    fireEvent.click(screen.getByRole("button", { name: "Nova aula" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Turma"), { target: { value: "1" } });
    fireEvent.change(within(dialog).getByLabelText("Data"), { target: { value: "2026-04-01" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Turma inválida para esta organização."));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(mutations(calls)).toHaveLength(1);
  });

  it("cancelar aula pede confirmação e só então faz DELETE /lessons/:id", async () => {
    const { calls } = setup();
    await screen.findByRole("cell", { name: "Infantil" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar aula de Infantil" }));
    const alert = await screen.findByRole("alertdialog");
    expect(alert).toHaveTextContent("O histórico é preservado.");
    expect(mutations(calls)).toHaveLength(0);
    fireEvent.click(within(alert).getByRole("button", { name: "Cancelar aula" }));
    await waitFor(() => expect(mutations(calls)).toHaveLength(1));
    expect(mutations(calls)[0]).toMatchObject({ url: "/lessons/1", method: "DELETE" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Aula cancelada."));
  });

  it("'Voltar' no diálogo de cancelamento não chama a API", async () => {
    const { calls } = setup();
    await screen.findByRole("cell", { name: "Infantil" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar aula de Infantil" }));
    const alert = await screen.findByRole("alertdialog");
    fireEvent.click(within(alert).getByRole("button", { name: "Voltar" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mutations(calls)).toHaveLength(0);
  });
});

describe("toPayload", () => {
  const base = { classId: "3", date: "2026-05-01", startTime: "", endTime: "", teacherUserId: "", notes: "  ", status: "ACTIVE" as const };
  it("criação omite vazios e não envia status", () => {
    expect(toPayload(base, false)).toEqual({ classId: 3, date: "2026-05-01" });
  });
  it("edição envia null nos vazios e o status", () => {
    expect(toPayload(base, true)).toEqual({
      classId: 3, date: "2026-05-01", startTime: null, endTime: null, teacherUserId: null, notes: null, status: "ACTIVE",
    });
  });
});
