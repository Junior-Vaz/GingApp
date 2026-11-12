import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { ChaveamentoPage } from "@/modules/chaveamento";
import { useCategory, useDeskCategories } from "@/modules/chaveamento/api";
import { CategoryLinkActions, CategoryLinkPicker } from "@/modules/chaveamento/category-link";
import { numericField, STICKY_FOOTER, textField } from "@/modules/chaveamento/fields";
import { categoryLiveUrl, liveUrl } from "@/modules/chaveamento/helpers";
import { useResumeEffect } from "@/modules/chaveamento/page-activity";
import { shareOrCopy } from "@/modules/chaveamento/share-link";
import { clearSession, loginAs } from "./login-as";
import { mkCategory, mkCompetitor, mkMatch, mkTournament, summaryOf } from "./chaveamento-fixtures";
import { installFakeBackend, newFake, sent, type Fake } from "./chaveamento-server";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// jsdom não tem PointerEvent: sem ele o `clientY` do gesto de arrastar se perde.
if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === "undefined") {
  (globalThis as unknown as { PointerEvent: unknown }).PointerEvent = class PointerEventPolyfill extends MouseEvent {
    pointerId = 1;
  };
}

let fake: Fake;
const TOKEN = "tok_abcdefghijklmnopqrstuvwx";

const ANA = mkCompetitor(101, "Ana", { groupName: "Academia A" });
const BIA = mkCompetitor(102, "Bia", { groupName: "Academia B" });

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client()}>{children}</QueryClientProvider>;
}
function renderPage() {
  return render(
    <QueryClientProvider client={client()}>
      <ChaveamentoPage eventId={7} />
    </QueryClientProvider>,
  );
}
/** Categoria 5 em andamento com uma luta ao vivo (Ana x Bia). */
function oneLive() {
  const category = mkCategory({
    id: 5,
    name: "Adulto",
    status: "RUNNING",
    competitors: [ANA, BIA],
    matches: [mkMatch(50, { slotAId: 101, slotBId: 102, status: "LIVE", mat: 1 })],
  });
  fake.category = category;
  fake.tournament = mkTournament({ publicEnabled: true, categories: [summaryOf(category)] });
  return category;
}

// --- visibilidade da aba e conexão (o jsdom não muda sozinho) -----------------------------------------------------------
function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  act(() => void document.dispatchEvent(new Event("visibilitychange")));
}
function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  act(() => void window.dispatchEvent(new Event(online ? "online" : "offline")));
}
const categoryGets = () => fake.calls.filter((c) => c.method === "GET" && c.path === "/events/7/tournament/categories/5").length;

beforeEach(() => {
  loginAs("MESTRE");
  fake = newFake();
  installFakeBackend(fake);
  vi.stubEnv("VITE_APP_URL", "https://app.gingapp.com.br");
});

afterEach(() => {
  setOnline(true); // o onlineManager do TanStack é um singleton: não pode vazar "offline" para o próximo teste
  setVisibility("visible");
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  delete (document as unknown as Record<string, unknown>)["visibilityState"];
  delete (window.navigator as unknown as Record<string, unknown>)["onLine"];
  delete (window.navigator as unknown as Record<string, unknown>)["share"];
  clearSession();
});

describe("consulta periódica: pausa com a aba oculta/offline e retoma com refetch imediato", () => {
  async function flush() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
  async function tick(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("useCategory: a cada 5 s com a aba visível; parada oculta; ao voltar consulta NA HORA", async () => {
    oneLive();
    vi.useFakeTimers();
    renderHook(() => useCategory(7, 5), { wrapper });
    await flush();
    expect(categoryGets()).toBe(1);
    await tick(5_000);
    expect(categoryGets()).toBe(2);

    setVisibility("hidden");
    await tick(30_000);
    expect(categoryGets()).toBe(2); // nada enquanto oculta

    setVisibility("visible");
    await flush();
    expect(categoryGets()).toBe(3); // refetch imediato, sem esperar 5 s
    await tick(5_000);
    expect(categoryGets()).toBe(4); // e o ciclo de 5 s volta
  });

  it("useCategory: offline pausa a consulta e a reconexão refaz na hora", async () => {
    oneLive();
    vi.useFakeTimers();
    renderHook(() => useCategory(7, 5), { wrapper });
    await flush();
    expect(categoryGets()).toBe(1);

    setOnline(false);
    await tick(30_000);
    expect(categoryGets()).toBe(1);

    setOnline(true);
    await flush();
    expect(categoryGets()).toBe(2);
  });

  it("mesa de controle (useDeskCategories): TODAS as categorias em andamento pausam e retomam juntas", async () => {
    oneLive();
    const second = mkCategory({ id: 6, name: "Infantil", position: 1, status: "RUNNING", competitors: [ANA, BIA], matches: [mkMatch(60, { slotAId: 101, slotBId: 102, status: "READY" })] });
    fake.overrides["GET /events/7/tournament/categories/6"] = () => new Response(JSON.stringify(second), { status: 200 });
    vi.useFakeTimers();
    renderHook(() => useDeskCategories(7, [5, 6]), { wrapper });
    await flush();
    const total = () => fake.calls.filter((c) => c.method === "GET" && /\/categories\/[56]$/.test(c.path)).length;
    expect(total()).toBe(2);
    await tick(5_000);
    expect(total()).toBe(4);

    setVisibility("hidden");
    await tick(60_000);
    expect(total()).toBe(4);

    setVisibility("visible");
    await flush();
    expect(total()).toBe(6); // as duas voltam na hora
  });

  it("useResumeEffect: não dispara na montagem, só na volta a ativo", () => {
    const onResume = vi.fn();
    const { rerender } = renderHook(({ active }) => useResumeEffect(active, onResume), { initialProps: { active: true } });
    expect(onResume).not.toHaveBeenCalled();
    rerender({ active: false });
    expect(onResume).not.toHaveBeenCalled();
    rerender({ active: true });
    expect(onResume).toHaveBeenCalledTimes(1);
  });
});

describe("offline: botões de resultado desabilitados, aviso claro e nenhuma escrita na fila", () => {
  it("mesa de controle: 'Sem conexão — as ações ficam indisponíveis' + VENCEU/Desfazer desabilitados; ao reconectar voltam", async () => {
    oneLive();
    renderPage();
    const card = await screen.findByTestId("desk-live-50");
    const winner = within(card).getByRole("button", { name: "Vencedor: Bia" });
    expect(winner).toBeEnabled();
    expect(screen.queryByTestId("chv-offline")).not.toBeInTheDocument();

    setOnline(false);
    expect(screen.getAllByTestId("chv-offline")[0]).toHaveTextContent("Sem conexão — as ações ficam indisponíveis.");
    expect(within(card).getByRole("button", { name: "Vencedor: Bia" })).toBeDisabled();
    expect(within(card).getByRole("button", { name: "Vencedor: Ana" })).toBeDisabled();
    expect(within(card).getByRole("button", { name: "Aumentar placar de Ana" })).toBeDisabled();
    expect(within(card).getByRole("button", { name: /Desfazer início da luta/ })).toBeDisabled();
    fireEvent.click(within(card).getByRole("button", { name: "Vencedor: Bia" }));
    expect(sent(fake, "POST", "/matches/50/result")).toHaveLength(0); // nada foi escrito nem enfileirado

    setOnline(true);
    expect(screen.queryByTestId("chv-offline")).not.toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Vencedor: Bia" })).toBeEnabled();
  });

  it("'Iniciar luta' da próxima da fila também fica desabilitado offline", async () => {
    const category = mkCategory({ id: 5, name: "Adulto", status: "RUNNING", competitors: [ANA, BIA], matches: [mkMatch(50, { slotAId: 101, slotBId: 102, status: "READY", queueOrder: 1, mat: 1 })] });
    fake.category = category;
    fake.tournament = mkTournament({ categories: [summaryOf(category)] });
    renderPage();
    const start = await screen.findByRole("button", { name: /Iniciar luta: Ana contra Bia/ });
    expect(start).toBeEnabled();
    setOnline(false);
    expect(screen.getByRole("button", { name: /Iniciar luta: Ana contra Bia/ })).toBeDisabled();
    // "Abrir" (só leitura) continua disponível
    expect(screen.getByRole("button", { name: /Abrir a luta Ana contra Bia/ })).toBeEnabled();
  });

  it("a barra 'Resultado registrado · DESFAZER' desabilita o DESFAZER offline", async () => {
    oneLive();
    renderPage();
    fireEvent.click(within(await screen.findByTestId("desk-live-50")).getByRole("button", { name: "Vencedor: Bia" }));
    const bar = await screen.findByTestId("undo-bar");
    expect(within(bar).getByRole("button", { name: /DESFAZER/ })).toBeEnabled();
    setOnline(false);
    expect(within(bar).getByRole("button", { name: /DESFAZER/ })).toBeDisabled();
    expect(bar).toHaveTextContent("Sem conexão");
  });
});

describe("link da categoria: ?categoria=<id>, copiar e compartilhar", () => {
  function stubClipboard() {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "clipboard", { configurable: true, value: { writeText } });
    return writeText;
  }

  it("monta <APP_URL>/ao-vivo/<token>?categoria=<id>", () => {
    expect(liveUrl(TOKEN)).toBe(`https://app.gingapp.com.br/ao-vivo/${TOKEN}`);
    expect(categoryLiveUrl(TOKEN, 5)).toBe(`https://app.gingapp.com.br/ao-vivo/${TOKEN}?categoria=5`);
  });

  it("categoria aberta: 'Copiar link desta categoria' copia o link com ?categoria=", async () => {
    const writeText = stubClipboard();
    oneLive();
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Copiar link desta categoria" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`https://app.gingapp.com.br/ao-vivo/${TOKEN}?categoria=5`));
  });

  it("Compartilhar COM navigator.share: usa a folha do sistema com título, texto e o link da categoria (sem copiar)", async () => {
    const writeText = stubClipboard();
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window.navigator, "share", { configurable: true, value: share });
    render(<CategoryLinkActions token={TOKEN} categoryId={5} categoryName="Adulto" />);
    fireEvent.click(screen.getByRole("button", { name: "Compartilhar" }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(share).toHaveBeenCalledWith({ title: "Adulto · ao vivo", text: "Acompanhe ao vivo: Adulto", url: `https://app.gingapp.com.br/ao-vivo/${TOKEN}?categoria=5` });
    expect(writeText).not.toHaveBeenCalled();
  });

  it("Compartilhar SEM navigator.share: copia o link (plano B)", async () => {
    const writeText = stubClipboard();
    expect("share" in window.navigator && typeof window.navigator.share === "function").toBe(false);
    render(<CategoryLinkActions token={TOKEN} categoryId={7} categoryName="Infantil" />);
    fireEvent.click(screen.getByRole("button", { name: "Compartilhar" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`https://app.gingapp.com.br/ao-vivo/${TOKEN}?categoria=7`));
  });

  it("shareOrCopy: fechar a folha (AbortError) não copia; outra falha cai para copiar", async () => {
    const writeText = stubClipboard();
    Object.defineProperty(window.navigator, "share", { configurable: true, value: vi.fn().mockRejectedValue(new DOMException("cancelado", "AbortError")) });
    await expect(shareOrCopy({ title: "t", url: "https://x/y" })).resolves.toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
    Object.defineProperty(window.navigator, "share", { configurable: true, value: vi.fn().mockRejectedValue(new DOMException("negado", "NotAllowedError")) });
    await expect(shareOrCopy({ title: "t", url: "https://x/y" })).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith("https://x/y");
  });

  it("cartão do telão: escolher a categoria muda o ?categoria= do link copiado", async () => {
    const writeText = stubClipboard();
    render(
      <CategoryLinkPicker
        token={TOKEN}
        categories={[
          { id: 5, name: "Adulto" },
          { id: 6, name: "Infantil" },
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Copiar link desta categoria" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(`https://app.gingapp.com.br/ao-vivo/${TOKEN}?categoria=5`));
    fireEvent.change(screen.getByLabelText("Link direto de uma categoria"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Copiar link desta categoria" }));
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith(`https://app.gingapp.com.br/ao-vivo/${TOKEN}?categoria=6`));
  });

  it("a página mostra o seletor no cartão do telão e a ação na categoria aberta", async () => {
    oneLive();
    renderPage();
    expect(await screen.findByTestId("category-link-picker")).toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Copiar link desta categoria" })).toHaveLength(2)); // cartão do telão + categoria aberta
    expect(screen.getAllByRole("button", { name: "Compartilhar" })).toHaveLength(2);
  });
});

describe("atributos críticos de toque, teclado e área segura", () => {
  it("campos do placar: teclado numérico, tecla OK, sem autopreenchimento e padrão de dígitos", async () => {
    oneLive();
    renderPage();
    const card = await screen.findByTestId("desk-live-50");
    const inputs = within(card).getAllByRole("textbox");
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    for (const input of inputs) {
      expect(input).toHaveAttribute("inputmode", "numeric");
      expect(input).toHaveAttribute("enterkeyhint", "done");
      expect(input).toHaveAttribute("autocomplete", "off");
      expect(input).toHaveAttribute("pattern", "[0-9]*");
      expect(input.style.fontSize).toBe("1.875rem"); // bem acima de 16 px: sem zoom do iOS
    }
  });

  it("tatame e ordem (ação rápida): numéricos, com a tecla OK", async () => {
    oneLive();
    renderPage();
    fireEvent.click(await screen.findByTestId("match-50"));
    const dialog = await screen.findByTestId("match-dialog");
    for (const label of [/Tatame \(0 a/, /Ordem de chamada/]) {
      const input = within(dialog).getByLabelText(label);
      expect(input).toHaveAttribute("inputmode", "numeric");
      expect(input).toHaveAttribute("enterkeyhint", "done");
      expect(input).toHaveAttribute("autocomplete", "off");
    }
  });

  it("folha da luta: altura máxima em dvh com rolagem interna, alça de gesto e fechar por Esc", async () => {
    oneLive();
    renderPage();
    fireEvent.click(await screen.findByTestId("match-50"));
    const dialog = await screen.findByTestId("match-dialog");
    expect(dialog.className).toContain("max-h-[92dvh]");
    expect(dialog.className).toContain("overflow-y-auto");
    expect(dialog.className).toContain("pb-[calc(1rem+env(safe-area-inset-bottom))]");
    expect(within(dialog).getByTestId("sheet-grabber")).toHaveAttribute("aria-hidden", "true");
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("match-dialog")).not.toBeInTheDocument());
  });

  it("deslizar a alça para baixo fecha a folha", async () => {
    oneLive();
    renderPage();
    fireEvent.click(await screen.findByTestId("match-50"));
    const grabber = within(await screen.findByTestId("match-dialog")).getByTestId("sheet-grabber");
    fireEvent.pointerDown(grabber, { clientY: 100 });
    fireEvent.pointerMove(grabber, { clientY: 140 });
    expect(screen.getByTestId("match-dialog")).toBeInTheDocument(); // ainda não passou do limite
    fireEvent.pointerMove(grabber, { clientY: 200 });
    await waitFor(() => expect(screen.queryByTestId("match-dialog")).not.toBeInTheDocument());
  });

  it("barra 'Resultado registrado': acima da barra inferior e do home indicator (safe-area) e DESFAZER >= 48 px", async () => {
    oneLive();
    renderPage();
    fireEvent.click(within(await screen.findByTestId("desk-live-50")).getByRole("button", { name: "Vencedor: Bia" }));
    const bar = await screen.findByTestId("undo-bar");
    expect(bar.className).toContain("env(safe-area-inset-bottom)");
    expect(bar.className).toContain("var(--chv-nav,4rem)");
    expect(within(bar).getByRole("button", { name: /DESFAZER/ }).className).toContain("h-12");
  });

  it("campos e rodapé dos diálogos: texto sem autopreenchimento e rodapé sticky com área segura", () => {
    expect(textField).toMatchObject({ autoComplete: "off", enterKeyHint: "done" });
    expect(numericField).toMatchObject({ inputMode: "numeric", enterKeyHint: "done", autoComplete: "off", pattern: "[0-9]*" });
    expect(STICKY_FOOTER).toContain("sticky bottom-[calc(-1rem-env(safe-area-inset-bottom))]");
    expect(STICKY_FOOTER).toContain("env(safe-area-inset-bottom)");
  });

  it("filtro de tatame e abas de categoria rolam para os lados (faixa com esmaecimento) e nomes longos têm title", async () => {
    const long = "Absoluto misto livre internacional open de capoeira — todas as graduações e idades acima de 18 anos";
    const category = mkCategory({ id: 5, name: long, status: "RUNNING", competitors: [ANA, BIA], matches: [mkMatch(50, { slotAId: 101, slotBId: 102, status: "LIVE", mat: 1 }), mkMatch(51, { key: "MAIN-1-1", position: 1, slotAId: 101, slotBId: 102, status: "READY", mat: 2, queueOrder: 1 })] });
    fake.category = category;
    fake.tournament = mkTournament({ categories: [summaryOf(category)] });
    renderPage();
    const filter = await screen.findByTestId("mat-filter");
    expect(filter.className).toContain("chv-fade-x");
    expect(filter.className).toContain("overflow-x-auto");
    const tabs = screen.getByTestId("category-tabs");
    expect(tabs.className).toContain("chv-fade-x");
    expect(within(tabs).getByText(long)).toHaveAttribute("title", long);
  });
});
