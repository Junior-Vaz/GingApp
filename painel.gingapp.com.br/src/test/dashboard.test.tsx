import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DashboardPage } from "@/modules/dashboard/dashboard-page";
import type { DashboardSummary } from "@/lib/dashboard";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const BASE: Omit<DashboardSummary, "finance"> = {
  students: { active: 40, new30d: 3, inactive: 5 },
  classes: { active: 6 },
  lessonsToday: 2,
  attendance: { last30dPercent: 87 },
  graduations: { last30d: 2 },
  upcomingEvents: [],
};

const FINANCE = { pendingCount: 4, pendingCents: 120000, overdueCount: 1, overdueCents: 30050 };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DashboardPage />
    </QueryClientProvider>,
  );
}

describe("DashboardPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("MESTRE (backend envia finance): mostra os cards financeiros", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, { ...BASE, finance: FINANCE })));
    renderPage();
    expect(await screen.findByTestId("dashboard-content")).toBeInTheDocument();
    expect(screen.getByText("Mensalidades previstas")).toBeInTheDocument();
    expect(screen.getByText("Mensalidades atrasadas")).toBeInTheDocument();
    expect(screen.getByText("4 lançamento(s) pendente(s)")).toBeInTheDocument();
    expect(screen.getByText("1 lançamento(s) atrasado(s)")).toBeInTheDocument();
    expect(screen.getByText("Graduações (30d)")).toBeInTheDocument();
  });

  it("PROFESSOR (backend NÃO envia finance): sem cards financeiros, sem erro, demais cards intactos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(200, BASE)));
    renderPage();
    expect(await screen.findByTestId("dashboard-content")).toBeInTheDocument();
    expect(screen.queryByText("Mensalidades previstas")).not.toBeInTheDocument();
    expect(screen.queryByText("Mensalidades atrasadas")).not.toBeInTheDocument();
    expect(screen.queryByText(/R\$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/lançamento/)).not.toBeInTheDocument();
    expect(screen.getByText("Alunos ativos")).toBeInTheDocument();
    expect(screen.getByText("Turmas ativas")).toBeInTheDocument();
    expect(screen.getByText("Frequência (30d)")).toBeInTheDocument();
    expect(screen.getByText("Graduações (30d)")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
