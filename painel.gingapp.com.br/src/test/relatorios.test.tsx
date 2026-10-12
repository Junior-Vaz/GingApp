import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RelatoriosPage } from "@/modules/relatorios/relatorios-page";
import { buildSections } from "@/modules/relatorios/sections";
import type { DashboardSummary } from "@/lib/dashboard";
import { clearSession, loginAs } from "./login-as";
import { monthLabel, percentLabel } from "@/modules/relatorios/relatorios-api";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

const SUMMARY: DashboardSummary = {
  students: { active: 40, new30d: 3, inactive: 5 },
  classes: { active: 6 },
  lessonsToday: 2,
  finance: { pendingCount: 4, pendingCents: 120000, overdueCount: 1, overdueCents: 30050 },
  attendance: { last30dPercent: 87 },
  graduations: { last30d: 2 },
  upcomingEvents: [],
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RelatoriosPage />
    </QueryClientProvider>,
  );
}

describe("RelatoriosPage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearSession();
  });

  it("buildSections usa só os agregados do dashboard (frequência nula vira traço)", () => {
    const sections = buildSections({ ...SUMMARY, attendance: { last30dPercent: null } });
    expect(sections.map((s) => s.title)).toEqual(["Alunos", "Frequência", "Financeiro", "Graduações"]);
    expect(sections[1]!.rows[1]!.value).toBe("-");
    expect(sections[2]!.rows[3]!.value).toMatch(/300,50/);
  });

  it("sem finance no dashboard (PROFESSOR): a seção Financeiro some e o resto continua", async () => {
    const { finance: _omit, ...withoutFinance } = SUMMARY;
    void _omit;
    const sections = buildSections(withoutFinance);
    expect(sections.map((s) => s.title)).toEqual(["Alunos", "Frequência", "Graduações"]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, withoutFinance)));
    renderPage();
    expect(await screen.findByTestId("relatorio-content")).toBeInTheDocument();
    expect(screen.queryByText("Valor em atraso")).not.toBeInTheDocument();
    expect(screen.queryByText("Lançamentos pendentes")).not.toBeInTheDocument();
    expect(screen.getByText("87%")).toBeInTheDocument();
  });

  it("renderiza as seções a partir de GET /dashboard e imprime", async () => {
    const fetchMock = vi.fn().mockResolvedValue(json(200, SUMMARY));
    vi.stubGlobal("fetch", fetchMock);
    const print = vi.fn();
    vi.stubGlobal("print", print);
    renderPage();
    expect(await screen.findByTestId("relatorio-content")).toBeInTheDocument();
    expect(screen.getByText("87%")).toBeInTheDocument();
    expect(screen.getByText("Valor em atraso")).toBeInTheDocument();
    expect((fetchMock.mock.calls[0] as [string])[0]).toMatch(/\/dashboard$/);
    fireEvent.click(screen.getByRole("button", { name: /imprimir/i }));
    expect(print).toHaveBeenCalled();
  });

  it("mostra erro do backend com nova tentativa", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(403, { message: "Sem permissão." })));
    renderPage();
    expect(await screen.findByText("Sem permissão.")).toBeInTheDocument();
  });

  describe("relatórios detalhados", () => {
    const ATTENDANCE = {
      period: { from: "2026-09-12", to: "2026-10-11" },
      filters: { classId: null, unitId: null },
      totals: { lessons: 3, lessonsWithRecords: 3, records: 6, present: 4, absent: 2, percent: 66.7 },
      byClass: [{ classId: 1, name: "Turma Infantil", unitId: null, lessons: 3, lessonsWithRecords: 3, records: 6, present: 4, absent: 2, percent: 66.7 }],
      byMonth: [{ month: "2026-09", records: 2, present: 1, absent: 1, percent: 50 }, { month: "2026-10", records: 4, present: 3, absent: 1, percent: 75 }],
      byStudent: [{ studentId: 9, name: "Carla Faltosa", records: 2, present: 0, absent: 2, percent: 0 }],
      byStudentTotal: 1,
    };
    const FINANCE = {
      period: { from: "2026-05-01", to: "2026-10-31" },
      basis: "Por mês de vencimento; lançamentos cancelados ficam fora.",
      totals: { count: 4, expectedCents: 65000, receivedCents: 9000, pendingCents: 20000, overdueCents: 35000, overdueCount: 2, overdueRatePercent: 53.8, receivedInPeriodCents: 9000 },
      byMonth: [{ month: "2026-10", count: 4, expectedCents: 65000, receivedCents: 9000, pendingCents: 20000, overdueCents: 35000, overdueCount: 2, overdueRatePercent: 53.8 }],
    };

    /** fetch roteado por caminho; guarda as URLs chamadas. */
    function mockReports(routes: Record<string, () => Response>) {
      const urls: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn((url: string) => {
          urls.push(url);
          const path = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?")[0] ?? "";
          const handler = routes[path];
          return Promise.resolve(handler ? handler() : json(404, { message: `sem rota ${path}` }));
        }),
      );
      return urls;
    }
    const openTab = async (name: RegExp | string) => {
      const tab = await screen.findByRole("tab", { name });
      fireEvent.mouseDown(tab, { button: 0 }); // Radix Tabs ativa no mouseDown
      fireEvent.click(tab);
    };

    it("aba Frequência: busca /reports/attendance, mostra cards, turma e aluno; o período digitado vai na query", async () => {
      loginAs("MESTRE");
      const urls = mockReports({
        "/dashboard": () => json(200, SUMMARY),
        "/reports/attendance": () => json(200, ATTENDANCE),
        "/classes": () => json(200, [{ id: 1, name: "Turma Infantil" }], { "X-Total-Count": "1" }),
      });
      renderPage();
      await openTab("Frequência");
      const section = await screen.findByTestId("report-attendance");
      expect(within(section).getAllByText("66,7%").length).toBeGreaterThan(0);
      expect(within(section).getByText("Carla Faltosa")).toBeInTheDocument();
      expect(within(section).getAllByText("Turma Infantil").length).toBeGreaterThan(0);
      expect(screen.getByTestId("report-period")).toHaveTextContent("12/09/2026 a 11/10/2026");
      expect(screen.getByRole("button", { name: /exportar csv/i })).toBeInTheDocument();
      expect(urls.some((u) => u.endsWith("/reports/attendance"))).toBe(true); // sem filtros: sem query string
      fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-10-01" } });
      await waitFor(() => expect(urls.some((u) => u.endsWith("/reports/attendance?from=2026-10-01"))).toBe(true));
    });

    it("aba Financeiro: só para quem pode ver o financeiro (Mestre); mostra os valores e a inadimplência", async () => {
      loginAs("PROFESSOR");
      mockReports({ "/dashboard": () => json(200, SUMMARY) });
      const prof = renderPage();
      await screen.findByRole("tab", { name: "Frequência" });
      expect(screen.queryByRole("tab", { name: "Financeiro" })).not.toBeInTheDocument();
      prof.unmount();
      clearSession();

      loginAs("MESTRE");
      mockReports({ "/dashboard": () => json(200, SUMMARY), "/reports/finance": () => json(200, FINANCE) });
      renderPage();
      await openTab("Financeiro");
      const section = await screen.findByTestId("report-finance");
      expect(within(section).getAllByText(/650,00/).length).toBeGreaterThan(0); // previsto
      expect(within(section).getAllByText(/53,8%/).length).toBeGreaterThan(0); // inadimplência
      expect(monthLabel("2026-10")).toBe("out/2026");
      expect(percentLabel(null)).toBe("—");
    });

    it("erro do backend num relatório aparece com nova tentativa (e o botão Imprimir chama window.print)", async () => {
      loginAs("MESTRE");
      mockReports({ "/dashboard": () => json(200, SUMMARY), "/reports/students": () => json(403, { message: "Sem acesso a alunos." }) });
      const print = vi.fn();
      vi.stubGlobal("print", print);
      renderPage();
      await openTab("Alunos");
      expect(await screen.findByText("Sem acesso a alunos.")).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name: /tentar novamente/i }).length).toBeGreaterThan(0);
      fireEvent.click(screen.getByRole("button", { name: /imprimir/i }));
      expect(print).toHaveBeenCalled();
    });
  });
});
