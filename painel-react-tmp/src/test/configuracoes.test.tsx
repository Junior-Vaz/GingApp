import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConfiguracoesPage } from "@/modules/configuracoes/configuracoes-page";
import { usagePercent } from "@/modules/configuracoes/plan";

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const ORG = { id: 1, name: "Ginga Brasil", slug: "ginga-brasil", type: "GROUP", status: "ACTIVE", document: "12.345.678/0001-90", email: "contato@gb.com", phone: null };
const SUB = { id: 1, status: "ACTIVE", currentPeriodEnd: "2026-11-15T00:00:00.000Z", plan: { id: 1, name: "Pro", priceCents: 9900, maxStudents: 50, maxUnits: 2 } };
const dashboard = (active: number) => ({
  students: { active, new30d: 1, inactive: 0 }, classes: { active: 1 }, lessonsToday: 0,
  finance: { pendingCount: 0, pendingCents: 0, overdueCount: 0, overdueCents: 0 },
  attendance: { last30dPercent: null }, graduations: { last30d: 0 }, upcomingEvents: [],
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ConfiguracoesPage />
    </QueryClientProvider>,
  );
}

function stub(routes: Record<string, () => Response>) {
  const fetchMock = vi.fn((url: string) => {
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    return Promise.resolve(key ? routes[key]!() : json(404, { message: "?" }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("usagePercent", () => {
  it("calcula o percentual, limita em 100 e trata ilimitado", () => {
    expect(usagePercent(25, 50)).toBe(50);
    expect(usagePercent(80, 50)).toBe(100);
    expect(usagePercent(5, null)).toBeNull();
  });
});

describe("ConfiguracoesPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("mostra a organização (objeto) e o plano com uso vindo do dashboard", async () => {
    const fetchMock = stub({
      "/organizations": () => json(200, ORG),
      "/subscriptions/me": () => json(200, SUB),
      "/dashboard": () => json(200, dashboard(30)),
    });
    renderPage();
    expect(await screen.findByText("Ginga Brasil")).toBeInTheDocument();
    expect(screen.getByText("12.345.678/0001-90")).toBeInTheDocument();
    expect(await screen.findByText("Pro")).toBeInTheDocument();
    expect(screen.getByText("Ativa")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("plan-usage")).toHaveTextContent("30 / 50"));
    expect(fetchMock.mock.calls.some(([u]) => String(u).endsWith("/students"))).toBe(false);
  });

  it("aceita lista (usuário PLATFORM) e avisa limite atingido", async () => {
    stub({
      "/organizations": () => json(200, [ORG]),
      "/subscriptions/me": () => json(200, SUB),
      "/dashboard": () => json(200, dashboard(50)),
    });
    renderPage();
    expect(await screen.findByText("Ginga Brasil")).toBeInTheDocument();
    expect(await screen.findByText(/Limite de alunos do plano atingido/)).toBeInTheDocument();
  });

  it("sem assinatura mostra mensagem; erro da API mostra alerta", async () => {
    stub({
      "/organizations": () => json(403, { message: "Sem acesso." }),
      "/subscriptions/me": () => new Response("null", { status: 200 }),
      "/dashboard": () => json(200, dashboard(3)),
    });
    renderPage();
    expect(await screen.findByText(/Nenhuma assinatura ativa/)).toBeInTheDocument();
    expect(await screen.findByText("Sem acesso.")).toBeInTheDocument();
  });
});
