import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRootRoute, createRouter } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { DataTable, type Column } from "@/components/painel/data-table";
import { MobileNav } from "@/components/painel/mobile-nav";
import { InstallAppButton, OfflineBanner, UpdatePrompt } from "@/components/painel/pwa-prompts";
import { RowActions } from "@/components/painel/row-actions";
import { NAV_ITEMS, mobileMoreFor, mobileTabsFor, navItemsFor } from "@/lib/nav";
import { __pwaTest } from "@/lib/pwa";
import type { OrgRole } from "@/lib/session";
import { clearSession, loginAs } from "./login-as";

const labels = (items: { label: string }[]) => items.map((i) => i.label);

describe("navegação mobile (lib/nav.ts)", () => {
  it("MESTRE: Dashboard, Alunos, Frequência e Financeiro na barra; o resto em 'Mais'", () => {
    expect(mobileTabsFor("MESTRE").map((i) => i.to)).toEqual(["/dashboard", "/alunos", "/frequencia", "/financeiro"]);
    const more = labels(mobileMoreFor("MESTRE"));
    expect(more).toEqual(expect.arrayContaining(["Equipe", "Turmas", "Configurações", "Transferências", "Atividade do grupo"]));
    expect(more).not.toContain("Financeiro");
  });

  it("sem Financeiro (PROFESSOR/INSTRUTOR) entra Turmas; MONITOR não tem Dashboard e ganha Turmas + Aulas", () => {
    expect(mobileTabsFor("PROFESSOR").map((i) => i.to)).toEqual(["/dashboard", "/alunos", "/frequencia", "/turmas"]);
    expect(mobileTabsFor("INSTRUTOR").map((i) => i.to)).toEqual(["/dashboard", "/alunos", "/frequencia", "/turmas"]);
    expect(mobileTabsFor("MONITOR").map((i) => i.to)).toEqual(["/alunos", "/frequencia", "/turmas", "/aulas"]);
  });

  it("respeita as permissões do menu: nunca expõe rota que o papel não enxerga, sem duplicar nem perder item", () => {
    for (const role of ["MESTRE", "PROFESSOR", "INSTRUTOR", "MONITOR"] as OrgRole[]) {
      const allowed = navItemsFor(role).map((i) => i.to);
      const tabs = mobileTabsFor(role).map((i) => i.to);
      const more = mobileMoreFor(role).map((i) => i.to);
      expect([...tabs, ...more].sort()).toEqual([...allowed].sort());
      expect(new Set([...tabs, ...more]).size).toBe(tabs.length + more.length);
    }
    expect(mobileMoreFor("PROFESSOR").map((i) => i.to)).not.toContain("/financeiro");
    expect(mobileMoreFor("MONITOR").map((i) => i.to)).not.toContain("/configuracoes");
    // sem papel: nada
    expect(mobileTabsFor(undefined).map((i) => i.to)).toEqual(
      NAV_ITEMS.filter((i) => !i.roles && ["/alunos", "/frequencia", "/turmas", "/aulas"].includes(i.to))
        .map((i) => i.to)
        .sort((a, b) => ["/alunos", "/frequencia", "/turmas", "/aulas"].indexOf(a) - ["/alunos", "/frequencia", "/turmas", "/aulas"].indexOf(b)),
    );
  });
});

function renderNav() {
  const rootRoute = createRootRoute({ component: () => <MobileNav onLogout={vi.fn()} /> });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <RouterProvider router={router as never} />
    </QueryClientProvider>,
  );
}

describe("MobileNav (barra inferior + 'Mais')", () => {
  afterEach(() => {
    cleanup();
    clearSession();
  });

  it("MESTRE vê Início/Alunos/Frequência/Financeiro/Mais; o 'Mais' lista o resto e a conta", async () => {
    loginAs("MESTRE");
    renderNav();
    const nav = await screen.findByTestId("mobile-nav");
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Início", "Alunos", "Frequência", "Financeiro"]);
    fireEvent.click(within(nav).getByRole("button", { name: "Mais" }));
    const list = await screen.findByTestId("mobile-more-list");
    expect(within(list).getByRole("link", { name: "Configurações" })).toHaveAttribute("href", "/configuracoes");
    expect(within(list).queryByRole("link", { name: "Financeiro" })).toBeNull();
    expect(screen.getByRole("button", { name: "Alterar senha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sair" })).toBeInTheDocument();
  });

  it("PROFESSOR não vê Financeiro/Configurações em lugar nenhum", async () => {
    loginAs("PROFESSOR");
    renderNav();
    const nav = await screen.findByTestId("mobile-nav");
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Início", "Alunos", "Frequência", "Turmas"]);
    fireEvent.click(within(nav).getByRole("button", { name: "Mais" }));
    const list = await screen.findByTestId("mobile-more-list");
    expect(within(list).queryByRole("link", { name: "Configurações" })).toBeNull();
    expect(within(list).queryByRole("link", { name: "Financeiro" })).toBeNull();
    expect(within(list).getByRole("link", { name: "Aulas" })).toBeInTheDocument();
  });
});

interface Row {
  id: number;
  name: string;
  status: string;
}
const rows: Row[] = [
  { id: 1, name: "Ana", status: "Ativo" },
  { id: 2, name: "Bia", status: "Inativo" },
];
const columns: Column<Row>[] = [
  { id: "name", header: "Nome", sortValue: (r) => r.name },
  { id: "status", header: "Status", sortValue: (r) => r.status },
];

describe("DataTable no celular: tabela vira cards", () => {
  const original = window.innerWidth;
  const setWidth = (w: number) => Object.defineProperty(window, "innerWidth", { configurable: true, writable: true, value: w });
  beforeEach(() => setWidth(375));
  afterEach(() => setWidth(original));

  const renderTable = () =>
    render(
      <DataTable
        columns={columns}
        data={rows}
        getRowId={(r) => r.id}
        searchText={(r) => r.name}
        toolbar={<select aria-label="Filtrar por status" defaultValue="" />}
        rowActions={(r) => (
          <RowActions subject={r.name} actions={[{ key: "e", label: "Editar", icon: Pencil, primary: true, onSelect: vi.fn() }]} />
        )}
      />,
    );

  it("sem <table>: um cartão por linha com o título, rótulo/valor e as ações da linha", () => {
    renderTable();
    expect(screen.queryByRole("table")).toBeNull();
    const cards = screen.getAllByTestId("auto-card");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText("Ana")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("Status")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("Ativo")).toBeInTheDocument();
    expect(within(cards[0]!).getByRole("button", { name: "Editar" })).toBeInTheDocument();
  });

  it("a busca continua visível e os filtros ficam recolhidos atrás do botão 'Filtros'", () => {
    renderTable();
    expect(screen.getByLabelText("Buscar")).toBeVisible();
    const toggle = screen.getByTestId("filters-toggle");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByLabelText("Filtrar por status")).not.toBeVisible();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Filtrar por status")).toBeVisible();
  });

  it("paginação continua funcionando (botões 'Próxima/Anterior')", () => {
    render(
      <DataTable
        columns={columns}
        data={Array.from({ length: 12 }, (_, i) => ({ id: i, name: `P${i}`, status: "Ativo" }))}
        getRowId={(r) => r.id}
        pageSize={5}
      />,
    );
    expect(screen.getAllByTestId("auto-card")).toHaveLength(5);
    fireEvent.click(screen.getByLabelText("Próxima página"));
    expect(screen.getByText("Página 2 de 3")).toBeInTheDocument();
  });

  it("no desktop continua a tabela (sem cards e sem botão Filtros)", () => {
    setWidth(1280);
    renderTable();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.queryByTestId("auto-card")).toBeNull();
    expect(screen.queryByTestId("filters-toggle")).toBeNull();
  });
});

describe("PWA: atualizar, instalar e offline", () => {
  beforeEach(() => __pwaTest.reset());
  afterEach(() => {
    __pwaTest.reset();
    vi.unstubAllGlobals();
  });

  it("'Nova versão disponível — Atualizar': aparece só com versão nova e chama o update", async () => {
    render(<UpdatePrompt />);
    expect(screen.queryByTestId("update-prompt")).toBeNull();
    const update = vi.fn().mockResolvedValue(undefined);
    act(() => __pwaTest.setNeedRefresh(true, update));
    expect(screen.getByTestId("update-prompt")).toHaveTextContent("Nova versão disponível");
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(true));
  });

  it("'Instalar app': escondido sem convite; com beforeinstallprompt abre o diálogo nativo", async () => {
    render(<InstallAppButton />);
    expect(screen.queryByRole("button", { name: "Instalar app" })).toBeNull();
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = Object.assign(new Event("beforeinstallprompt"), {
      prompt,
      userChoice: Promise.resolve({ outcome: "accepted" as const }),
    });
    act(() => __pwaTest.setInstallEvent(event));
    fireEvent.click(await screen.findByRole("button", { name: "Instalar app" }));
    await waitFor(() => expect(prompt).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("button", { name: "Instalar app" })).toBeNull());
  });

  it("no iPhone mostra a dica 'Adicionar à Tela de Início'", () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      standalone: false,
    });
    render(<InstallAppButton />);
    fireEvent.click(screen.getByRole("button", { name: "Instalar app" }));
    expect(screen.getByRole("note")).toHaveTextContent("Adicionar à Tela de Início");
  });

  it("faixa 'Sem conexão' aparece ao perder a rede e some ao voltar", () => {
    render(<OfflineBanner />);
    expect(screen.queryByTestId("offline-banner")).toBeNull();
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });
    expect(screen.getByTestId("offline-banner")).toHaveTextContent("Sem conexão");
    act(() => {
      window.dispatchEvent(new Event("online"));
    });
    expect(screen.queryByTestId("offline-banner")).toBeNull();
  });
});
