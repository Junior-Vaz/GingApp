import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RelatoriosPage } from "@/modules/relatorios/relatorios-page";
import { buildSections } from "@/modules/relatorios/sections";
import type { DashboardSummary } from "@/lib/dashboard";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

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
  afterEach(() => vi.unstubAllGlobals());

  it("buildSections usa só os agregados do dashboard (frequência nula vira traço)", () => {
    const sections = buildSections({ ...SUMMARY, attendance: { last30dPercent: null } });
    expect(sections.map((s) => s.title)).toEqual(["Alunos", "Frequência", "Financeiro", "Graduações"]);
    expect(sections[1]!.rows[1]!.value).toBe("-");
    expect(sections[2]!.rows[3]!.value).toMatch(/300,50/);
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
});
