import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
import { canAccessRoute, navItemsFor } from "@/lib/nav";
import { RankingPage } from "@/modules/ranking/ranking-page";
import { deltaInfo, leagueColor, rankingCsvRows, readableTextColor, seasonLabel } from "@/modules/ranking/ranking-api";
import { clearSession, loginAs } from "./login-as";

vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: { success: vi.fn(), error: vi.fn() },
}));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });

const student = (rank: number, name: string, code: string, color: string, over: Record<string, unknown> = {}) => ({
  rank,
  studentId: rank,
  displayName: name,
  avatarUrl: null,
  groupId: 1,
  groupName: "Grupo Capoeira",
  groupLogoUrl: null,
  city: "Salvador",
  state: "BA",
  points: 1000 - rank * 100,
  level: { code, name: code.charAt(0) + code.slice(1).toLowerCase(), color },
  rankDelta: 0,
  isMe: false,
  ...over,
});

const STUDENTS = [
  student(1, "Ana Souza", "PRETA", "#111827", { rankDelta: 2 }),
  student(2, "Bruno Lima", "ROXA", "#8B5CF6", { rankDelta: -1 }),
  student(3, "Carla Dias", "VERDE", "#22C55E", { rankDelta: null }),
  student(4, "Diego Reis", "CRUA", "#E5E5E5"),
];

const OVERVIEW = { topStudents: STUDENTS.slice(0, 3), inactiveCount: 7, totalPoints: 12500, avgPoints: 312.5, activeStudents: 40 };
const SEASONS = {
  current: "2026-10",
  items: [
    { season: "2026-10", champions: { country: null, group: null } },
    {
      season: "2026-09",
      champions: {
        country: { studentId: 99, displayName: "Zeca Campeão", points: 5000 },
        group: { studentId: 1, displayName: "Ana Souza", points: 1900 },
      },
    },
  ],
};
const GROUPS = {
  items: [
    { rank: 1, groupId: 9, name: "Grupo Rival", logoUrl: null, city: "Recife", state: "PE", studentsCount: 80, totalPoints: 90000, avgPoints: 1125, isMine: false },
    { rank: 3, groupId: 1, name: "Grupo Capoeira", logoUrl: null, city: "Salvador", state: "BA", studentsCount: 40, totalPoints: 12500, avgPoints: 312.5, isMine: true },
  ],
  total: 40,
  season: "2026-10",
  scope: "COUNTRY",
};

interface Overrides {
  students?: () => Response;
  groups?: () => Response;
}

function mockApi(overrides: Overrides = {}) {
  const urls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      urls.push(url);
      const path = url.replace(/^https?:\/\/[^/]+\/api/, "").split("?")[0];
      if (path === "/ranking/students")
        return Promise.resolve(overrides.students?.() ?? json(200, { items: STUDENTS, me: null, total: 4, season: "2026-10", scope: "GROUP", category: "GENERAL", band: null }));
      if (path === "/ranking/group-overview") return Promise.resolve(json(200, OVERVIEW));
      if (path === "/ranking/seasons") return Promise.resolve(json(200, SEASONS));
      if (path === "/ranking/groups") return Promise.resolve(overrides.groups?.() ?? json(200, GROUPS));
      return Promise.resolve(json(404, { message: "não mockado: " + path }));
    }),
  );
  return urls;
}

const lastStudentsUrl = (urls: string[]) => new URL([...urls].reverse().find((u) => u.includes("/ranking/students"))!);

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <RankingPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => loginAs("MESTRE"));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearSession();
});

describe("RankingPage", () => {
  it("renderiza os 4 cards do grupo, o pódio, a tabela com ligas/variação e os campeões", async () => {
    const urls = mockApi();
    renderPage();

    const overview = await screen.findByTestId("ranking-overview");
    const cards = within(overview).getAllByTestId("stat-card");
    expect(cards).toHaveLength(4);
    expect(within(cards[0]!).getByText("Alunos ativos")).toBeInTheDocument();
    expect(within(cards[0]!).getByText("40")).toBeInTheDocument();
    expect(within(cards[1]!).getByText("12.500")).toBeInTheDocument();
    expect(within(cards[2]!).getByText("312,5")).toBeInTheDocument();
    expect(within(cards[3]!).getByText("Sem pontos na temporada")).toBeInTheDocument();
    expect(within(cards[3]!).getByText("7")).toBeInTheDocument();

    const table = await screen.findByRole("table");
    await within(table).findByText("Ana Souza");
    expect(within(table).getByText("Diego Reis")).toBeInTheDocument();
    expect(within(table).getByText("#1")).toBeInTheDocument();
    const badges = within(table).getAllByTestId("league-badge");
    expect(badges.map((b) => b.getAttribute("data-league"))).toEqual(["PRETA", "ROXA", "VERDE", "CRUA"]);
    expect(badges[2]).toHaveStyle({ backgroundColor: "#22C55E" });
    expect(within(table).getAllByTestId("rank-avatar-ring")[1]).toHaveStyle({ boxShadow: "0 0 0 2px #8B5CF6" });
    expect(within(table).getByLabelText("Subiu 2 posições")).toBeInTheDocument();
    expect(within(table).getByLabelText("Caiu 1 posição")).toBeInTheDocument();
    expect(within(table).getByLabelText("Sem comparação com a temporada anterior")).toBeInTheDocument();
    expect(screen.getByTestId("table-count")).toHaveTextContent("4 registros");

    expect(screen.getAllByTestId("podium-card")).toHaveLength(3);
    expect(await screen.findByText("Zeca Campeão (5.000 pts)")).toBeInTheDocument();
    expect(screen.getByText("Ana Souza (1.900 pts)")).toBeInTheDocument();

    const first = lastStudentsUrl(urls);
    expect(first.searchParams.get("scope")).toBe("GROUP");
    expect(first.searchParams.get("category")).toBe("GENERAL");
    expect(first.searchParams.get("limit")).toBe("20");
    expect(first.searchParams.get("offset")).toBe("0");
    expect(first.searchParams.has("season")).toBe(false);
    expect(first.searchParams.has("band")).toBe(false);
  });

  it("trocar categoria, faixa etária e temporada chama /ranking/students com os parâmetros certos", async () => {
    const urls = mockApi();
    renderPage();
    await screen.findAllByText("Ana Souza");

    fireEvent.change(screen.getByLabelText("Filtrar por categoria"), { target: { value: "RODAS" } });
    await waitFor(() => expect(lastStudentsUrl(urls).searchParams.get("category")).toBe("RODAS"));

    fireEvent.change(screen.getByLabelText("Filtrar por faixa etária"), { target: { value: "KIDS" } });
    await waitFor(() => expect(lastStudentsUrl(urls).searchParams.get("band")).toBe("KIDS"));

    await screen.findByRole("option", { name: "setembro de 2026" });
    fireEvent.change(screen.getByLabelText("Temporada"), { target: { value: "2026-09" } });
    await waitFor(() => expect(lastStudentsUrl(urls).searchParams.get("season")).toBe("2026-09"));
    fireEvent.change(screen.getByLabelText("Temporada"), { target: { value: "ALL" } });
    await waitFor(() => expect(lastStudentsUrl(urls).searchParams.get("season")).toBe("ALL"));
    const url = lastStudentsUrl(urls);
    expect(url.searchParams.get("category")).toBe("RODAS");
    expect(url.searchParams.get("band")).toBe("KIDS");
    expect(url.searchParams.get("offset")).toBe("0");
  });

  it("aba 'Meu grupo no Brasil' destaca o meu grupo e mostra a posição", async () => {
    const urls = mockApi();
    renderPage();
    await screen.findAllByText("Ana Souza");

    const tab = screen.getByRole("tab", { name: "Meu grupo no Brasil" });
    fireEvent.mouseDown(tab, { button: 0 }); // Radix Tabs ativa no mouseDown
    fireEvent.click(tab);

    expect(await screen.findByText("Você está em #3 de 40")).toBeInTheDocument();
    const table = await screen.findByRole("table");
    const mineRow = (await within(table).findByText("Seu grupo")).closest("tr")!;
    expect(mineRow).toHaveClass("bg-primary/10");
    expect(within(mineRow).getByText("#3")).toBeInTheDocument();
    expect(within(table).getByText("Grupo Rival").closest("tr")).not.toHaveClass("bg-primary/10");

    const groupUrls = urls.filter((u) => u.includes("/ranking/groups")).map((u) => new URL(u));
    expect(groupUrls.some((u) => u.searchParams.get("scope") === "COUNTRY" && u.searchParams.get("limit") === "20")).toBe(true);

    fireEvent.change(screen.getByLabelText("Comparar com"), { target: { value: "STATE" } });
    await waitFor(() =>
      expect(urls.some((u) => u.includes("/ranking/groups") && new URL(u).searchParams.get("scope") === "STATE")).toBe(true),
    );
  });

  it("estado vazio: nenhum aluno com pontos", async () => {
    mockApi({ students: () => json(200, { items: [], me: null, total: 0, season: "2026-10", scope: "GROUP", category: "GENERAL", band: null }) });
    renderPage();
    expect(await screen.findByText("Nenhum aluno com pontos neste filtro.")).toBeInTheDocument();
    expect(screen.queryByTestId("ranking-podium")).not.toBeInTheDocument();
  });

  it("estado de carregando e de erro (com 'Tentar novamente')", async () => {
    mockApi({ students: () => json(500, { message: "Falha ao calcular o ranking." }) });
    renderPage();
    expect(screen.getByTestId("ranking-overview-loading")).toBeInTheDocument();
    expect(await screen.findByText("Falha ao calcular o ranking.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeInTheDocument();
  });

  it("imprimir chama window.print", async () => {
    mockApi();
    const print = vi.fn();
    vi.stubGlobal("print", print);
    renderPage();
    await screen.findAllByText("Ana Souza");
    fireEvent.click(screen.getByRole("button", { name: /imprimir/i }));
    expect(print).toHaveBeenCalled();
  });

  it("exportar CSV baixa a tabela no formato da lista (BOM, ';', variação numérica)", async () => {
    mockApi();
    URL.createObjectURL = vi.fn(() => "blob:teste");
    URL.revokeObjectURL = vi.fn();
    HTMLAnchorElement.prototype.click = vi.fn();
    renderPage();
    await screen.findAllByText("Ana Souza");
    fireEvent.click(screen.getByRole("button", { name: /exportar csv/i }));
    const blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0]![0] as Blob;
    const text = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new TextDecoder("utf-8", { ignoreBOM: true }).decode(reader.result as ArrayBuffer));
      reader.readAsArrayBuffer(blob);
    });
    expect(text.startsWith("﻿Posição;Aluno;Liga;Pontos;Variação;Grupo;Cidade;UF\r\n")).toBe(true);
    expect(text).toContain("1;Ana Souza;Preta;900;2;Grupo Capoeira;Salvador;BA");
    expect(text).toContain("2;Bruno Lima;Roxa;800;-1;");
    expect(text).toContain("3;Carla Dias;Verde;700;Novo;");
  });

  it("PROFESSOR também vê o ranking", async () => {
    clearSession();
    loginAs("PROFESSOR");
    mockApi();
    renderPage();
    expect((await screen.findAllByText("Ana Souza")).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "Ranking" })).toBeInTheDocument();
  });
});

describe("Ranking: permissões e helpers", () => {
  it("menu e rota: MESTRE e PROFESSOR têm acesso; ALUNO e sem papel não", () => {
    expect(navItemsFor("MESTRE").map((i) => i.label)).toContain("Ranking");
    expect(navItemsFor("PROFESSOR").map((i) => i.label)).toContain("Ranking");
    expect(navItemsFor("ALUNO").map((i) => i.label)).not.toContain("Ranking");
    expect(canAccessRoute("MESTRE", "/ranking")).toBe(true);
    expect(canAccessRoute("PROFESSOR", "/ranking")).toBe(true);
    expect(canAccessRoute("ALUNO", "/ranking")).toBe(false);
    expect(canAccessRoute(undefined, "/ranking")).toBe(false);
  });

  const makeRouter = (path: string) =>
    createRouter({
      routeTree,
      history: createMemoryHistory({ initialEntries: [path] }),
      context: { queryClient: new QueryClient() },
    });

  it("PROFESSOR entra em /ranking; ALUNO (sem acesso ao painel) é redirecionado ao login", async () => {
    clearSession();
    loginAs("PROFESSOR");
    const ok = makeRouter("/ranking");
    await ok.load();
    expect(ok.state.location.pathname).toBe("/ranking");

    clearSession();
    loginAs("ALUNO");
    const denied = makeRouter("/ranking");
    await denied.load();
    expect(denied.state.location.pathname).toBe("/login");
  });

  it("ligas, contraste, variação, temporada e linhas do CSV", () => {
    expect(leagueColor({ code: "AMARELA", color: "#000000" })).toBe("#FACC15");
    expect(leagueColor({ code: "NOVA", color: "#123456" })).toBe("#123456");
    expect(leagueColor({ code: "NOVA", color: "x" })).toBe("#E5E5E5");
    expect(readableTextColor("#FACC15")).toBe("#111827");
    expect(readableTextColor("#111827")).toBe("#FFFFFF");
    expect(deltaInfo(0).kind).toBe("same");
    expect(deltaInfo(null).kind).toBe("new");
    expect(seasonLabel("2026-09")).toBe("setembro de 2026");
    expect(seasonLabel("ALL")).toBe("Geral (todas as temporadas)");
    expect(rankingCsvRows([STUDENTS[3]! as never])[0]).toEqual([4, "Diego Reis", "Crua", 600, 0, "Grupo Capoeira", "Salvador", "BA"]);
  });
});
