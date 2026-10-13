import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RopeSwatch } from "@/components/painel/rope-swatch";
import { ropeLabel, ropeOf } from "@/lib/rope";
import { GraduacoesPage } from "@/modules/graduacoes/graduacoes-page";
import { levelDefaults, toLevelInput, toLevelUpdate } from "@/modules/graduacoes/graduacoes-forms";
import { clearSession, loginAs } from "./login-as";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const GRAY = "#9ca3af";
const YELLOW = "#facc15";
const BLUE = "#2563eb";
const GREEN = "#16a34a";
const CRUA = "#f5f1e6";

describe("RopeSwatch com pontas", () => {
  afterEach(cleanup);

  it("desenha as duas pontas como retângulos nas extremidades, com a cor de cada uma e o aria-label", () => {
    render(<RopeSwatch style="SOLID" colors={[GRAY]} tipStart={YELLOW} tipEnd={BLUE} size="lg" />);
    const svg = screen.getByRole("img", { name: "Corda cinza com ponta amarela e ponta azul" });
    expect(svg).toHaveAttribute("data-tips");
    const start = svg.querySelector("[data-tip='start']")!;
    const end = svg.querySelector("[data-tip='end']")!;
    expect(start.getAttribute("fill")).toBe(YELLOW);
    expect(end.getAttribute("fill")).toBe(BLUE);
    // lg = 150 de comprimento; cada ponta ~20% (30), a de baixo encostada no fim
    expect(Number(start.getAttribute("y"))).toBe(0);
    expect(Number(start.getAttribute("height"))).toBeCloseTo(30, 5);
    expect(Number(end.getAttribute("y"))).toBeCloseTo(120, 5);
    expect(Number(end.getAttribute("height"))).toBeCloseTo(30, 5);
    // o corpo ocupa so o trecho entre as pontas (nao sobrepoe) e ha um fio separando cada ponta
    const body = svg.querySelector("[data-stripe]")!;
    expect(Number(body.getAttribute("y"))).toBeCloseTo(30, 5);
    expect(Number(body.getAttribute("height"))).toBeCloseTo(90, 5);
    expect(svg.querySelectorAll("[data-tip-divider]")).toHaveLength(2);
  });

  it("horizontal desenha o mesmo conjunto; corpo trancado/dividido tambem fica entre as pontas", () => {
    const { unmount } = render(<RopeSwatch style="BRAIDED" colors={[GREEN, YELLOW]} tipStart={BLUE} orientation="horizontal" />);
    const braided = screen.getByRole("img", { name: "Corda trançada verde e amarela com ponta de cima azul" });
    expect(braided.querySelector("[data-tip='start']")).not.toBeNull();
    expect(braided.querySelector("[data-tip='end']")).toBeNull();
    const braid = braided.querySelector("[data-braid]")!;
    expect(Number(braid.getAttribute("y"))).toBeGreaterThan(0);
    expect(Number(braided.getAttribute("width"))).toBeGreaterThan(Number(braided.getAttribute("height")));
    unmount();
    render(<RopeSwatch style="SPLIT" colors={[GREEN, YELLOW]} tipEnd={BLUE} />);
    const split = screen.getByRole("img", { name: "Corda dividida verde e amarela com ponta de baixo azul" });
    for (const stripe of split.querySelectorAll("[data-stripe]")) expect(Number(stripe.getAttribute("y"))).toBe(0);
    expect(Number(split.querySelector("[data-stripe]")!.getAttribute("height"))).toBeLessThan(Number(split.getAttribute("height")));
  });

  it("sem pontas (ou ponta invalida) continua igual a antes", () => {
    render(<RopeSwatch style="SOLID" colors={[GREEN]} tipStart={null} tipEnd="lixo" />);
    const svg = screen.getByRole("img", { name: "Corda sólida verde" });
    expect(svg.querySelector("[data-tip]")).toBeNull();
    expect(svg).not.toHaveAttribute("data-tips");
    expect(Number(svg.querySelector("[data-stripe]")!.getAttribute("y"))).toBe(0);
  });

  it("ropeLabel/ropeOf: duas pontas, uma ponta e sem pontas", () => {
    expect(ropeLabel({ style: "SOLID", colors: [GRAY], tipStart: YELLOW, tipEnd: BLUE })).toBe("Corda cinza com ponta amarela e ponta azul");
    expect(ropeLabel({ style: "SOLID", colors: [CRUA], tipStart: GREEN })).toBe("Corda branca com ponta de cima verde");
    expect(ropeLabel({ style: "SOLID", colors: [GREEN] })).toBe("Corda sólida verde");
    expect(ropeOf({ colors: [GRAY], tipStart: YELLOW, tipEnd: null })).toEqual({ style: "SOLID", colors: [GRAY], tipStart: YELLOW });
    expect(ropeOf({ colors: [GRAY], tipStart: "x" })).toEqual({ style: "SOLID", colors: [GRAY] });
  });
});

describe("Formulario de nivel: pontas", () => {
  const base = { name: " Cinza ", order: "2", style: "SOLID" as const, colors: [GRAY.toUpperCase()] };

  it("payload leva tipStart/tipEnd (minusculo) ligado e null desligado; ponta vazia vira null", () => {
    expect(toLevelInput({ ...base, tipsEnabled: true, tipStart: "#FACC15", tipEnd: "#2563EB" })).toEqual({
      name: "Cinza",
      order: 2,
      style: "SOLID",
      colors: [GRAY],
      tipStart: YELLOW,
      tipEnd: BLUE,
    });
    expect(toLevelUpdate({ ...base, tipsEnabled: true, tipStart: "", tipEnd: BLUE })).toMatchObject({ tipStart: null, tipEnd: BLUE });
    expect(toLevelUpdate({ ...base, tipsEnabled: false, tipStart: YELLOW, tipEnd: BLUE })).toMatchObject({ tipStart: null, tipEnd: null });
  });

  it("levelDefaults: nivel com pontas abre ligado (uma ponta so mantem a outra vazia); sem pontas abre desligado", () => {
    const withTips = levelDefaults({ id: 1, graduationSystemId: 1, name: "X", order: 1, color: GRAY, style: "SOLID", colors: [GRAY], tipEnd: BLUE }, 0);
    expect(withTips).toMatchObject({ tipsEnabled: true, tipStart: "", tipEnd: BLUE });
    expect(levelDefaults(null, 3)).toMatchObject({ tipsEnabled: false });
  });
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const lv = (id: number, name: string, order: number, extra: Record<string, unknown> = {}) => ({
  id,
  graduationSystemId: 1,
  name,
  order,
  color: CRUA,
  style: "SOLID",
  colors: [CRUA],
  ...extra,
});
const systemsData = [
  {
    id: 1,
    name: "Cordas",
    description: null,
    isActive: true,
    levels: [lv(1, "Crua", 0), lv(2, "Cinza com pontas", 1, { color: GRAY, colors: [GRAY], tipStart: YELLOW, tipEnd: BLUE })],
  },
];

interface Call { url: string; method: string; body: unknown }
function setup() {
  const calls: Call[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string, init: RequestInit = {}) => {
      const method = init.method ?? "GET";
      const url = input.replace(/^.*\/api/, "");
      calls.push({ url, method, body: init.body ? JSON.parse(init.body as string) : undefined });
      if (method === "GET" && url === "/graduations/systems") return Promise.resolve(json(200, systemsData));
      if (method === "GET") return Promise.resolve(json(200, []));
      return Promise.resolve(json(200, { id: 1 }));
    }),
  );
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <GraduacoesPage />
    </QueryClientProvider>,
  );
  return { calls };
}
const writes = (calls: Call[]) => calls.filter((c) => c.method !== "GET");

describe("Editor de nivel: Pontas da corda", () => {
  beforeEach(() => loginAs("MESTRE"));
  afterEach(() => {
    clearSession();
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("a regua mostra a corda com pontas (aria-label do RopeSwatch)", async () => {
    setup();
    await screen.findByRole("list", { name: "Níveis de Cordas" });
    expect(screen.getAllByRole("img", { name: "Corda cinza com ponta amarela e ponta azul" }).length).toBeGreaterThan(0);
  });

  it("a chave liga e desliga: com ela desligada nao ha seletores de ponta e o PATCH leva tipStart/tipEnd null", async () => {
    const { calls } = setup();
    await screen.findByRole("list", { name: "Níveis de Cordas" });
    fireEvent.click(screen.getByRole("button", { name: "Editar nível Crua" }));
    const dialog = await screen.findByRole("dialog");
    const toggle = within(dialog).getByRole("switch", { name: "Corda com pontas" });
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(within(dialog).queryByLabelText("Hex da ponta de cima")).not.toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toEqual({
      url: "/graduations/levels/1",
      method: "PATCH",
      body: { name: "Crua", order: 0, style: "SOLID", colors: [CRUA], tipStart: null, tipEnd: null },
    });
  });

  it("ligar mostra os dois seletores, a previa ao vivo e envia tipStart/tipEnd; 'mesma cor' copia a de cima", async () => {
    const { calls } = setup();
    await screen.findByRole("list", { name: "Níveis de Cordas" });
    fireEvent.click(screen.getByRole("button", { name: "Editar nível Crua" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("switch", { name: "Corda com pontas" }));
    expect(within(dialog).getByLabelText("Hex da ponta de cima")).toHaveValue(GREEN);
    expect(within(dialog).getByLabelText("Hex da ponta de baixo")).toHaveValue(YELLOW);
    expect(within(dialog).getByTestId("level-preview-label")).toHaveTextContent("Corda branca com ponta verde e ponta amarela");
    expect(within(dialog).getByTestId("level-preview").querySelectorAll("[data-tip]")).toHaveLength(4); // 2 desenhos x 2 pontas

    fireEvent.click(within(dialog).getByRole("button", { name: "Ponta de cima: Azul" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Usar a mesma cor nas duas pontas" }));
    expect(within(dialog).getByLabelText("Hex da ponta de baixo")).toHaveValue(BLUE);
    fireEvent.click(within(dialog).getByRole("button", { name: "Ponta de baixo: Amarela" }));
    expect(within(dialog).getByTestId("level-preview-label")).toHaveTextContent("Corda branca com ponta azul e ponta amarela");

    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]).toEqual({
      url: "/graduations/levels/1",
      method: "PATCH",
      body: { name: "Crua", order: 0, style: "SOLID", colors: [CRUA], tipStart: BLUE, tipEnd: YELLOW },
    });
  });

  it("editar nivel que ja tem pontas abre ligado com as cores atuais; hex invalido da ponta bloqueia o envio", async () => {
    const { calls } = setup();
    await screen.findByRole("list", { name: "Níveis de Cordas" });
    fireEvent.click(screen.getByRole("button", { name: "Editar nível Cinza com pontas" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("switch", { name: "Corda com pontas" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByLabelText("Hex da ponta de cima")).toHaveValue(YELLOW);
    expect(within(dialog).getByLabelText("Hex da ponta de baixo")).toHaveValue(BLUE);

    fireEvent.change(within(dialog).getByLabelText("Hex da ponta de baixo"), { target: { value: "#zz" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    expect(await within(dialog).findByText("Cor da ponta de baixo inválida (use o formato #RRGGBB).")).toBeInTheDocument();
    expect(writes(calls)).toHaveLength(0);

    // 'Sem ponta' limpa uma so (as pontas sao independentes)
    fireEvent.click(within(dialog).getByRole("button", { name: "Ponta de baixo: Azul" }));
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Sem ponta" })[0]!);
    fireEvent.click(within(dialog).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(writes(calls)).toHaveLength(1));
    expect(writes(calls)[0]!.body).toMatchObject({ tipStart: null, tipEnd: BLUE });
  });
});
