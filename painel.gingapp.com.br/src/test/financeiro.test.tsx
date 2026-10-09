import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import { FinanceiroPage } from "@/modules/financeiro/financeiro-page";
import {
  computeTotals,
  effectiveStatus,
  parseReaisToCents,
  toCreatePayload,
  toUpdatePayload,
  type FinanceRecord,
} from "@/modules/financeiro/finance-utils";
import { formatCurrency } from "@/lib/format";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const rec = (o: Partial<FinanceRecord> & { id: number }): FinanceRecord => ({
  studentId: 1,
  unitId: null,
  description: "Mensalidade",
  amountCents: 15000,
  type: "Mensalidade",
  dueDate: "2099-01-10T00:00:00.000Z",
  paidAt: null,
  status: "PENDING",
  ...o,
});

const records: FinanceRecord[] = [
  rec({ id: 1, description: "Mensalidade Ana", amountCents: 15000, status: "PAID", paidAt: "2024-01-05T10:00:00.000Z", dueDate: "2024-01-10T00:00:00.000Z" }),
  rec({ id: 2, description: "Mensalidade Bia", amountCents: 20050, status: "PENDING", dueDate: "2099-02-10T00:00:00.000Z" }),
  rec({ id: 3, description: "Camiseta", type: null, amountCents: 5000, status: "PENDING", dueDate: "2020-01-10T00:00:00.000Z" }),
];

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

function setup(handler?: (url: string, init: RequestInit) => Response | undefined) {
  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const custom = handler?.(url, init);
    if (custom) return custom;
    if (url.endsWith("/students")) return json(200, [{ id: 1, name: "Ana" }, { id: 2, name: "Bia" }]);
    if (url.endsWith("/finance") && (init.method ?? "GET") === "GET") return json(200, records);
    return json(200, {});
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <FinanceiroPage />
    </QueryClientProvider>,
  );
  return fetchMock;
}

const calls = (m: ReturnType<typeof vi.fn>, method: string) =>
  m.mock.calls.filter((c) => ((c[1] as RequestInit | undefined)?.method ?? "GET") === method);

describe("financeiro utils", () => {
  it("parse de reais e BRL", () => {
    expect(parseReaisToCents("12,50")).toBe(1250);
    expect(parseReaisToCents("1.234,56")).toBe(123456);
    expect(parseReaisToCents("12.5")).toBe(1250);
    expect(parseReaisToCents("abc")).toBeNaN();
    expect(formatCurrency(20050).replace(/\s/g, " ")).toBe("R$ 200,50");
  });
  it("status efetivo e totais", () => {
    expect(effectiveStatus(records[2]!)).toBe("OVERDUE");
    expect(effectiveStatus(records[1]!)).toBe("PENDING");
    expect(computeTotals(records)).toEqual({ paid: 15000, pending: 20050, overdue: 5000 });
  });
  it("payloads respeitam os DTOs (create sem status; update com paidAt só se PAID)", () => {
    const v = { description: " X ", studentId: "2", type: "", amountReais: "10,00", dueDate: "2025-03-01", status: "PAID" as const, paidAt: "2025-03-02" };
    expect(toCreatePayload(v)).toEqual({ description: "X", amountCents: 1000, dueDate: "2025-03-01", studentId: 2 });
    expect(toUpdatePayload(v)).toMatchObject({ status: "PAID", paidAt: "2025-03-02" });
    expect(toUpdatePayload({ ...v, status: "PENDING" })).not.toHaveProperty("paidAt");
  });
});

describe("FinanceiroPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("lista com valores em BRL, status e totais", async () => {
    setup();
    await screen.findByText("Mensalidade Ana");
    expect(screen.getByText("Camiseta")).toBeInTheDocument();
    const cards = screen.getAllByTestId("stat-card").map((c) => c.textContent ?? "");
    expect(cards[0]).toMatch(/Recebido.*150,00/);
    expect(cards[1]).toMatch(/A receber.*200,50/);
    expect(cards[2]).toMatch(/Atrasado.*50,00/);
    expect(screen.getAllByText("Atrasado").length).toBeGreaterThan(1);
  });

  it("filtra por status e por período", async () => {
    setup();
    await screen.findByText("Mensalidade Ana");
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "OVERDUE" } });
    expect(screen.queryByText("Mensalidade Ana")).not.toBeInTheDocument();
    expect(screen.getByText("Camiseta")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Filtrar por status"), { target: { value: "ALL" } });
    fireEvent.change(screen.getByLabelText("Vencimento de"), { target: { value: "2099-01-01" } });
    expect(screen.getByText("Mensalidade Bia")).toBeInTheDocument();
    expect(screen.queryByText("Camiseta")).not.toBeInTheDocument();
  });

  it("estado de erro com retry", async () => {
    setup((url) => (url.endsWith("/finance") ? json(403, { message: "Sem permissão." }) : undefined));
    expect(await screen.findByTestId("table-error")).toHaveTextContent("Sem permissão.");
    expect(screen.getByText("Tentar novamente")).toBeInTheDocument();
  });

  it("estado vazio", async () => {
    setup((url) => (url.endsWith("/finance") ? json(200, []) : undefined));
    expect(await screen.findByTestId("table-empty")).toHaveTextContent("Nenhum lançamento financeiro ainda.");
  });

  it("valida o formulário e cria (POST /finance com centavos)", async () => {
    const fetchMock = setup();
    await screen.findByText("Mensalidade Ana");
    fireEvent.click(screen.getByText("Novo lançamento", { selector: "button" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByText("Salvar"));
    expect(await within(dialog).findByText("Informe a descrição do lançamento.")).toBeInTheDocument();
    expect(within(dialog).getByText("Informe um valor válido (maior que zero).")).toBeInTheDocument();
    expect(within(dialog).getByText("Informe a data de vencimento.")).toBeInTheDocument();
    expect(calls(fetchMock, "POST")).toHaveLength(0);

    fireEvent.change(within(dialog).getByLabelText("Descrição"), { target: { value: "Mensalidade Cris" } });
    fireEvent.change(within(dialog).getByLabelText("Valor (R$)"), { target: { value: "199,90" } });
    fireEvent.change(within(dialog).getByLabelText("Vencimento"), { target: { value: "2099-05-10" } });
    fireEvent.change(within(dialog).getByLabelText("Aluno"), { target: { value: "2" } });
    fireEvent.click(within(dialog).getByText("Salvar"));
    await waitFor(() => expect(calls(fetchMock, "POST")).toHaveLength(1));
    const [url, init] = calls(fetchMock, "POST")[0] as [string, RequestInit];
    expect(url).toMatch(/\/finance$/);
    expect(JSON.parse(init.body as string)).toEqual({
      description: "Mensalidade Cris",
      amountCents: 19990,
      dueDate: "2099-05-10",
      studentId: 2,
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Lançamento criado."));
  });

  it("edita marcando como pago (PATCH /finance/:id)", async () => {
    const fetchMock = setup();
    await screen.findByText("Mensalidade Bia");
    const row = screen.getByText("Mensalidade Bia").closest("tr")!;
    fireEvent.click(within(row).getByText("Editar"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByLabelText("Valor (R$)")).toHaveValue("200.50");
    fireEvent.change(within(dialog).getByLabelText("Status"), { target: { value: "PAID" } });
    fireEvent.change(await within(dialog).findByLabelText("Data de pagamento"), { target: { value: "2099-02-11" } });
    fireEvent.click(within(dialog).getByText("Salvar"));
    await waitFor(() => expect(calls(fetchMock, "PATCH")).toHaveLength(1));
    const [url, init] = calls(fetchMock, "PATCH")[0] as [string, RequestInit];
    expect(url).toMatch(/\/finance\/2$/);
    expect(JSON.parse(init.body as string)).toMatchObject({ amountCents: 20050, status: "PAID", paidAt: "2099-02-11" });
  });

  it("exclui só depois de confirmar (DELETE /finance/:id)", async () => {
    const fetchMock = setup();
    await screen.findByText("Camiseta");
    const row = screen.getByText("Camiseta").closest("tr")!;
    fireEvent.click(within(row).getByText("Excluir"));
    expect(calls(fetchMock, "DELETE")).toHaveLength(0);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("R$");
    fireEvent.click(within(dialog).getByText("Excluir"));
    await waitFor(() => expect(calls(fetchMock, "DELETE")).toHaveLength(1));
    expect((calls(fetchMock, "DELETE")[0] as [string])[0]).toMatch(/\/finance\/3$/);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Lançamento excluído."));
  });
});
