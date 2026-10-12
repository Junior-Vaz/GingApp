import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { clearSession, loginAs } from "./login-as";
import { ExportRowsButton } from "@/components/painel/export-csv-button";
import { FinanceiroPage } from "@/modules/financeiro/financeiro-page";
import { FrequenciaPage } from "@/modules/frequencia/frequencia-page";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const csvResponse = () => new Response("﻿A;B\r\n", { status: 200, headers: { "Content-Type": "text/csv" } });

function mockApi(routes: Record<string, () => Response>) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      urls.push(url);
      const path = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?")[0] ?? "";
      const handler = routes[path];
      return Promise.resolve(handler ? handler() : json(200, [], { "X-Total-Count": "0" }));
    }),
  );
  return urls;
}

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

beforeEach(() => {
  loginAs("MESTRE");
  URL.createObjectURL = vi.fn(() => "blob:teste");
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

/** Lê os bytes (FileReader.readAsText descartaria o BOM) e decodifica mantendo o BOM. */
const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new TextDecoder("utf-8", { ignoreBOM: true }).decode(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });

describe("Exportar CSV nas páginas", () => {
  it("Financeiro: lançamentos exportam com os filtros da tela; a aba Inadimplentes exporta os inadimplentes", async () => {
    const urls = mockApi({
      "/finance/summary": () => json(200, { paid: 0, pending: 0, overdue: 0, count: 0, paidCount: 0, pendingCount: 0, overdueCount: 0 }),
      "/finance/delinquents/summary": () => json(200, { students: 0, overdueCents: 0, overdueCount: 0 }),
      "/finance/export.csv": csvResponse,
      "/finance/delinquents/export.csv": csvResponse,
    });
    renderWithClient(<FinanceiroPage />);
    fireEvent.change(await screen.findByRole("combobox", { name: "Filtrar por status" }), { target: { value: "OVERDUE" } });
    fireEvent.click(screen.getByRole("button", { name: /exportar csv/i }));
    await waitFor(() => expect(urls.some((u) => u.includes("/finance/export.csv?status=OVERDUE"))).toBe(true));

    const tab = screen.getByRole("tab", { name: /inadimplentes/i });
    fireEvent.mouseDown(tab, { button: 0 });
    fireEvent.click(tab);
    fireEvent.click(await screen.findByRole("button", { name: /exportar csv/i }));
    await waitFor(() => expect(urls.some((u) => u.includes("/finance/delinquents/export.csv"))).toBe(true));
  });

  it("Frequência: o CSV vai para /reports/attendance/export.csv com turma e período escolhidos", async () => {
    const urls = mockApi({
      "/classes": () => json(200, [{ id: 3, name: "Turma Adulto" }], { "X-Total-Count": "1" }),
      "/reports/attendance/export.csv": csvResponse,
    });
    renderWithClient(<FrequenciaPage />);
    fireEvent.change(await screen.findByLabelText("De"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-10-10" } });
    await screen.findByRole("option", { name: "Turma Adulto" });
    fireEvent.change(screen.getByLabelText("Turma"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: /exportar csv/i }));
    await waitFor(() => expect(urls.some((u) => u.includes("/reports/attendance/export.csv"))).toBe(true));
    const url = new URL(urls.find((u) => u.includes("/reports/attendance/export.csv"))!);
    expect(url.searchParams.get("classId")).toBe("3");
    expect(url.searchParams.get("from")).toBe("2026-10-01");
    expect(url.searchParams.get("to")).toBe("2026-10-10");
  });

  it("exportação no cliente (tabelas agregadas): arquivo com BOM, ';' e fórmula neutralizada", async () => {
    render(
      <ExportRowsButton
        filename="teste"
        build={() => ({ headers: ["Nome", "Valor"], rows: [["=SOMA(A1)", 10]] })}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /exportar csv/i }));
    const blob = (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Blob;
    expect(await readBlob(blob)).toBe("﻿Nome;Valor\r\n'=SOMA(A1);10\r\n");
  });
});
