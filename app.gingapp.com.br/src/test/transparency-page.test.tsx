import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/react-router";
import { routeTree } from "@/routeTree.gen";
import { saveSession, type AuthUser } from "@/lib/session";

/**
 * Página pública /transparencia (docs/CONTRATO_TRANSPARENCIA.md, seção 6): renderiza o corpo de GET /transparency
 * (formato da seção 4; a fixture REAL capturada do backend é conferida pelo coordenador) sem login e sem pedir pagamento.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MONTH_OCT = {
  month: "2026-10",
  publishedAt: "2026-11-02T10:00:00.000Z",
  note: "Mês tranquilo.",
  revenueCents: 280000,
  expenseCents: 250000,
  balanceCents: 30000,
  revenueBySource: [{ category: "PATROCINIO", label: "Patrocínios", cents: 280000 }],
  expensesByCategory: [
    { category: "HOSPEDAGEM", label: "Hospedagem e servidores", cents: 150000 },
    { category: "MAPAS", label: "Mapas", cents: 60000 },
    { category: "EMAIL", label: "E-mail", cents: 40000 },
  ],
  activeStudents: 1200,
  activeGroups: 30,
  costPerActiveStudentCents: 208,
  goalCents: 300000,
  goalCoveragePct: 93,
};
const BODY = {
  generatedAt: "2026-11-07T12:00:00.000Z",
  entityName: "Associação X",
  introText: "A plataforma é gratuita e mostramos todo mês quanto ela custa.",
  surplusText: "O que sobrar fica na reserva para os meses mais caros.",
  monthlyGoalCents: 300000,
  reserveCents: 123400,
  months: [MONTH_OCT],
};

const USER: AuthUser = {
  id: 1,
  name: "Aluno",
  email: "a@b.c",
  userType: "MEMBER",
  isSuperAdmin: false,
  organizationId: 1,
  organizationSlug: "g",
  role: "ALUNO",
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
let calls: { method: string; path: string; headers: Record<string, string> }[] = [];
function mockTransparency(handlers: Array<() => Response>) {
  calls = [];
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.replace(/^https?:\/\/[^/]+\/api/, "");
      calls.push({ method: init.method ?? "GET", path, headers: (init.headers ?? {}) as Record<string, string> });
      if (path !== "/transparency") return json(404, { message: `sem rota ${path}` });
      const handler = handlers[Math.min(i, handlers.length - 1)]!;
      i += 1;
      return handler();
    }),
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 30));
  });
const plain = (text: string | null | undefined) => (text ?? "").replace(/\u00a0/g, " ");
const byTestId = (id: string) => container!.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const allByTestId = (id: string) => [...container!.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)];
const pageText = () => plain(container!.textContent);

function mountRoute(path: string) {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient: new QueryClient() },
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<QueryClientProvider client={queryClient}><RouterProvider router={router} /></QueryClientProvider>));
  return router;
}
async function openPage(body: unknown = BODY) {
  mockTransparency([() => json(200, body)]);
  const router = mountRoute("/transparencia");
  await router.load();
  await settle();
  return router;
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  vi.unstubAllGlobals();
});

describe("/transparencia: página pública", () => {
  it("abre sem login (rota fora de _app) e a chamada vai SEM token, mesmo com sessão guardada no aparelho", async () => {
    saveSession("tok-secreto", USER);
    const router = await openPage();
    expect(router.state.location.pathname).toBe("/transparencia");
    expect(calls.map((c) => c.path)).toEqual(["/transparency"]);
    expect(Object.keys(calls[0]!.headers).map((h) => h.toLowerCase())).not.toContain("authorization");
    expect(JSON.stringify(calls[0])).not.toContain("tok-secreto");
    expect(byTestId("tp-content")).not.toBeNull();
  });

  it("sem sessão: renderiza a resposta no formato do contrato, sem adaptação", async () => {
    await openPage();
    const text = pageText();
    expect(container!.querySelector("h1")?.textContent).toBe("Transparência: para onde vai o dinheiro");
    // card do mês mais recente
    expect(byTestId("tp-latest")?.textContent).toContain("Mês mais recente");
    expect(text).toContain("outubro de 2026");
    expect(plain(byTestId("tp-revenue")?.textContent)).toContain("R$ 2.800,00");
    expect(plain(byTestId("tp-expense")?.textContent)).toContain("R$ 2.500,00");
    expect(plain(byTestId("tp-balance")?.textContent)).toContain("R$ 300,00");
    expect(plain(byTestId("tp-balance")?.textContent)).toContain("Sobrou neste mês");
    expect(plain(byTestId("tp-cost-per-student")?.textContent)).toContain("R$ 2,08");
    expect(plain(byTestId("tp-cost-per-student")?.textContent)).toContain("1.200 alunos ativos em 30 grupos");
    expect(byTestId("tp-coverage-value")?.textContent).toBe("93%");
    expect(plain(byTestId("tp-coverage-text")?.textContent)).toBe("A receita cobriu 93% da meta de R$ 3.000,00.");
    expect(text).toContain("Mês tranquilo.");
    // para onde vai / de onde vem
    expect(byTestId("tp-expenses")?.querySelector("h2")?.textContent).toBe("Para onde vai o dinheiro");
    expect(allByTestId("tp-category").map((li) => plain(li.textContent))).toEqual([
      "Hospedagem e servidores R$ 1.500,00 (60%)",
      "Mapas R$ 600,00 (24%)",
      "E-mail R$ 400,00 (16%)",
      "Patrocínios R$ 2.800,00 (100%)",
    ]);
    expect(byTestId("tp-revenues")?.querySelector("h2")?.textContent).toBe("De onde vem");
    // reserva, textos do dono, histórico, aviso
    expect(plain(byTestId("tp-reserve-value")?.textContent)).toBe("R$ 1.234,00");
    expect(byTestId("tp-entity")?.textContent).toContain("Associação X");
    expect(byTestId("tp-intro")?.textContent).toBe(BODY.introText);
    expect(byTestId("tp-surplus")?.textContent).toContain(BODY.surplusText);
    expect(allByTestId("tp-history-item")).toHaveLength(1);
    expect(byTestId("tp-updated")?.textContent).toBe("Atualizado todo mês · valores publicados pela equipe");
  });

  it("barras têm texto equivalente: cada categoria traz valor e participação escritos; a barra é decorativa", async () => {
    await openPage();
    for (const li of allByTestId("tp-category")) {
      expect(plain(li.textContent)).toMatch(/R\$ [\d.]+,\d{2} \(\d+%\)/);
      expect(li.querySelector('[aria-hidden="true"]')).not.toBeNull();
    }
    // a barra de meta é decorativa e a frase equivalente fica visível/lida
    expect(byTestId("tp-coverage")!.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(byTestId("tp-coverage-text")?.textContent).toMatch(/cobriu 93%/);
  });

  it("estado vazio (months: []): mensagem amigável, textos do dono mantidos, sem erro nem cards de números", async () => {
    await openPage({ ...BODY, months: [], reserveCents: 0 });
    expect(byTestId("tp-empty")?.textContent).toContain("Ainda não publicamos o primeiro mês");
    expect(byTestId("tp-error")).toBeNull();
    expect(byTestId("tp-latest")).toBeNull();
    expect(byTestId("tp-history")).toBeNull();
    expect(byTestId("tp-reserve")).toBeNull();
    expect(byTestId("tp-intro")?.textContent).toBe(BODY.introText);
    expect(byTestId("tp-surplus")).not.toBeNull();
    expect(byTestId("tp-entity")?.textContent).toContain("Associação X");
    expect(byTestId("tp-updated")).not.toBeNull();
  });

  it("textos opcionais nulos: não aparece entidade, intro nem 'E se sobrar dinheiro?'", async () => {
    await openPage({ ...BODY, entityName: null, introText: null, surplusText: null });
    expect(byTestId("tp-entity")).toBeNull();
    expect(byTestId("tp-intro")).toBeNull();
    expect(byTestId("tp-surplus")).toBeNull();
    expect(byTestId("tp-latest")).not.toBeNull();
  });

  it("custo por aluno null: mostra traço e explica, sem 'R$ 0,00'", async () => {
    await openPage({ ...BODY, months: [{ ...MONTH_OCT, activeStudents: 0, activeGroups: 0, costPerActiveStudentCents: null }] });
    const cost = plain(byTestId("tp-cost-per-student")?.textContent);
    expect(cost).toContain("—");
    expect(cost).toContain("Sem alunos ativos neste mês");
    expect(cost).not.toContain("R$ 0,00");
  });

  it("meta null: percentual vira traço, a barra fica vazia e o texto explica", async () => {
    await openPage({ ...BODY, monthlyGoalCents: 0, months: [{ ...MONTH_OCT, goalCents: 0, goalCoveragePct: null }] });
    expect(byTestId("tp-coverage-value")?.textContent).toBe("—");
    expect(byTestId("tp-coverage-text")?.textContent).toBe("Este mês não teve meta definida.");
    const fill = byTestId("tp-coverage")!.querySelector<HTMLElement>(".progress-fill")!;
    expect(fill.style.width).toBe("0%");
  });

  it("cobertura acima de 100%: barra cheia e o número real (120%) na tela", async () => {
    await openPage({ ...BODY, months: [{ ...MONTH_OCT, revenueCents: 360000, balanceCents: 110000, goalCoveragePct: 120 }] });
    expect(byTestId("tp-coverage-value")?.textContent).toBe("120%");
    expect(plain(byTestId("tp-coverage-text")?.textContent)).toBe("A receita foi de 120% da meta de R$ 3.000,00: passou da meta.");
    const fill = byTestId("tp-coverage")!.querySelector<HTMLElement>(".progress-fill")!;
    expect(fill.style.width).toBe("100%");
  });

  it("reserva negativa: valor com sinal e o texto avisa; saldo negativo do mês diz 'Faltou'", async () => {
    await openPage({
      ...BODY,
      reserveCents: -15000,
      months: [{ ...MONTH_OCT, revenueCents: 100000, expenseCents: 250000, balanceCents: -150000, goalCoveragePct: 33 }],
    });
    expect(plain(byTestId("tp-reserve-value")?.textContent)).toBe("-R$ 150,00");
    expect(byTestId("tp-reserve")?.textContent).toContain("Está negativa");
    expect(plain(byTestId("tp-balance")?.textContent)).toContain("-R$ 1.500,00");
    expect(byTestId("tp-balance")?.textContent).toContain("Faltou neste mês");
  });

  it("histórico: até 12 meses, do mais recente para o mais antigo, cada um com mês por extenso", async () => {
    // 14 meses distintos de 2026-12 para trás (o servidor manda só 12, mas o app também corta por garantia).
    const months = Array.from({ length: 14 }, (_, i) => {
      const index = 2026 * 12 + 11 - i;
      return { ...MONTH_OCT, month: `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}` };
    });
    await openPage({ ...BODY, months });
    const items = allByTestId("tp-history-item");
    expect(items).toHaveLength(12);
    const keys = items.map((li) => li.getAttribute("data-month")!);
    expect(keys).toEqual([...keys].sort().reverse());
    expect(new Set(keys).size).toBe(12);
    expect(items[0]!.textContent).toContain("de 2026");
    expect(plain(items[0]!.textContent)).toMatch(/Receita R\$ 2\.800,00 · Despesa R\$ 2\.500,00/);
  });

  it("erro de rede: aviso com 'Tentar de novo' que busca de novo e mostra os números", async () => {
    mockTransparency([() => json(500, { message: "falhou" }), () => json(200, BODY)]);
    const router = mountRoute("/transparencia");
    await router.load();
    await settle();
    expect(byTestId("tp-error")?.getAttribute("role")).toBe("alert");
    expect(byTestId("tp-error")?.textContent).toContain("Não foi possível carregar os números agora");
    expect(byTestId("tp-latest")).toBeNull();
    const retry = [...container!.querySelectorAll("button")].find((b) => b.textContent?.includes("Tentar de novo"))!;
    expect(retry).toBeDefined();
    act(() => retry.click());
    await settle();
    expect(calls.map((c) => c.path)).toEqual(["/transparency", "/transparency"]);
    expect(byTestId("tp-error")).toBeNull();
    expect(byTestId("tp-latest")).not.toBeNull();
  });

  it("corpo fora do contrato (não é objeto) também cai no erro com 'Tentar de novo', nunca em tela quebrada", async () => {
    mockTransparency([() => json(200, "oi")]);
    const router = mountRoute("/transparencia");
    await router.load();
    await settle();
    expect(byTestId("tp-error")).not.toBeNull();
    expect(byTestId("tp-latest")).toBeNull();
  });

  it("nenhum pedido de pagamento: sem Pix, doação, cobrança, botão de pagar nem link externo", async () => {
    await openPage();
    const text = pageText();
    expect(text).not.toMatch(/pix|pagamento|pagar|doa[çc]|doe |contribu|assin(e|atura)|cart[ãa]o|qr ?code|boleto|apoie|apoiar/i);
    const hrefs = [...container!.querySelectorAll("a")].map((a) => a.getAttribute("href"));
    expect(hrefs.every((h) => h?.startsWith("/"))).toBe(true);
    expect(container!.querySelectorAll("form, input")).toHaveLength(0);
    // o único botão possível é o de tentar de novo (e só no erro)
    expect(container!.querySelectorAll("button")).toHaveLength(0);
  });

  it("estado vazio e erro também não pedem pagamento", async () => {
    await openPage({ ...BODY, months: [] });
    expect(pageText()).not.toMatch(/pix|pagamento|pagar|doa[çc]|contribu|apoie/i);
  });

  it("moldura: margem pela variável --page-gutter e links para termos, privacidade e login", async () => {
    await openPage();
    const frame = container!.querySelector<HTMLElement>("div.min-h-screen")!;
    expect(frame.getAttribute("style")).toContain("var(--page-gutter)");
    const hrefs = [...container!.querySelectorAll("nav a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/termos", "/privacidade", "/login"]);
  });
});

describe("links de entrada para /transparencia", () => {
  it("rodapé da tela de login: link presente, e os dois links legais seguem como estavam", async () => {
    mockTransparency([() => json(200, BODY)]);
    const router = mountRoute("/login");
    await router.load();
    await settle();
    const link = container!.querySelector<HTMLAnchorElement>('[data-testid="transparency-link"] a')!;
    expect(link.getAttribute("href")).toBe("/transparencia");
    expect(link.textContent).toBe("Transparência: para onde vai o dinheiro");
    const legal = [...container!.querySelectorAll('[data-testid="legal-links"] a')].map((a) => a.getAttribute("href"));
    expect(legal).toEqual(["/termos", "/privacidade"]);
  });
});
