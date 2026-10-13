import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Hierarchy, HierarchyLevel, StudentGraduation } from "@/lib/queries";

/**
 * Cordas desenhadas (Rope), cartão "Minha graduação", régua do sistema e Hierarquia do grupo na Jornada.
 * Os hooks de dados são mockados; o foco é o que a tela desenha e como pan/zoom mexem no transform.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state: {
  hierarchy: { data: Hierarchy | null; isLoading: boolean; error: Error | null };
  graduations: StudentGraduation[];
} = { hierarchy: { data: null, isLoading: false, error: null }, graduations: [] };

vi.mock("@/lib/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries")>();
  const idle = { data: undefined, isLoading: false, error: null };
  return {
    ...actual,
    useHierarchy: () => ({ ...state.hierarchy, refetch: vi.fn() }),
    useGraduations: () => ({ data: state.graduations, isLoading: false, error: null }),
    useMyRoles: () => [],
    useMyStudent: () => ({ student: { id: 7, name: "Camila" }, isLoading: false, error: null }),
    usePassport: () => ({ data: { organization: { name: "Grupo Semente" }, stats: { rodas: 2, eventos: 1, graduacoes: 1 } }, isLoading: false, error: null }),
    useCertificates: () => ({ ...idle, data: [] }),
    useAttendance: () => ({ ...idle, data: { last30dPercent: 80, records: [] } }),
  };
});
vi.mock("@/components/gingapp/class-parts", () => ({ MyClasses: () => null }));

import { GraduationCard, RopeRuler } from "@/components/gingapp/graduation-parts";
import { HierarchyCanvas } from "@/components/gingapp/hierarchy";
import { Rope } from "@/components/gingapp/rope";
import { JourneyPage } from "@/components/gingapp/journey";
import { buildLayout, centerOn, clampScale, MAX_SCALE, MIN_SCALE, progressOf, shortName, zoomAt } from "@/lib/hierarchy";
import { colorName, normalizeRope, ropeLabel } from "@/lib/rope";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function render(ui: React.ReactNode) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(ui));
}
const text = () => container?.textContent ?? "";
const q = (sel: string) => container!.querySelector<HTMLElement>(sel);
const click = (el: Element | null) => act(() => void el!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
const button = (label: string) => q(`button[aria-label="${label}"]`);

beforeEach(() => {
  localStorage.clear();
  state.hierarchy = { data: null, isLoading: false, error: null };
  state.graduations = [];
  // jsdom não tem layout: o viewport do canvas "mede" 1000x700.
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(700);
});
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

const GREEN = { id: 1, name: "Corda verde", order: 1, color: "#22c55e" };
const MIXED = { id: 2, name: "Corda verde, amarela e azul", order: 2, color: "#22c55e", style: "BRAIDED" as const, colors: ["#22c55e", "#facc15", "#3b82f6"] };
const BLUE = { id: 3, name: "Corda azul", order: 3, color: "#3b82f6", style: "SPLIT" as const, colors: ["#3b82f6", "#ffffff"] };

function level(base: typeof GREEN | typeof MIXED | typeof BLUE, over: Partial<HierarchyLevel> = {}): HierarchyLevel {
  const count = over.count ?? 5;
  return {
    ...base,
    count,
    isMine: false,
    students: Array.from({ length: Math.min(count, 12) }, (_, i) => ({ studentId: base.id * 100 + i, displayName: `Aluno ${base.id} Sobrenome${i}`, photo: null, isMe: false })),
    ...over,
  };
}

function sample(over: Partial<Hierarchy> = {}): Hierarchy {
  const mine = level(MIXED, {
    isMine: true,
    count: 4,
    students: [
      { studentId: 7, displayName: "Camila Souza Lima", photo: null, isMe: true },
      { studentId: 201, displayName: "Bia Costa", photo: null, isMe: false },
    ],
  });
  return {
    group: { id: 1, name: "Grupo Semente", logoUrl: null },
    system: { id: 1, name: "Sistema Semente" },
    masters: [{ id: 1, displayName: "Mestre Bimba Filho", photo: null, level: level(BLUE) }],
    teachers: [
      { id: 2, displayName: "Prof Ana", photo: null, level: level(MIXED), isMyTeacher: true },
      { id: 3, displayName: "Prof Beto", photo: null, level: null, isMyTeacher: false },
    ],
    levels: [level(BLUE, { count: 9 }), mine, level(GREEN, { count: 7 })],
    me: { studentId: 7, displayName: "Camila Souza Lima", photo: null, level: MIXED, order: 2 },
    higherCount: 9,
    totalStudents: 20,
    ...over,
  };
}

describe("Rope", () => {
  it("SOLID: cor cheia e rótulo falado", () => {
    render(<Rope style="SOLID" colors={["#22c55e"]} />);
    const svg = q("svg.gx-rope")!;
    expect(svg.getAttribute("aria-label")).toBe("Corda verde");
    expect(svg.dataset["style"]).toBe("SOLID");
    expect(svg.querySelectorAll("[data-testid='rope-solid']")).toHaveLength(1);
  });

  it("SPLIT: faixas verticais iguais (2 e 3 cores)", () => {
    render(
      <>
        <Rope style="SPLIT" colors={["#22c55e", "#facc15"]} thickness={20} length={100} />
        <Rope style="SPLIT" colors={["#22c55e", "#facc15", "#3b82f6"]} thickness={30} length={100} />
      </>,
    );
    const [two, three] = [...container!.querySelectorAll("svg.gx-rope")];
    const bands2 = [...two!.querySelectorAll("[data-testid='rope-band']")];
    const bands3 = [...three!.querySelectorAll("[data-testid='rope-band']")];
    expect(bands2).toHaveLength(2);
    expect(bands3).toHaveLength(3);
    expect(bands3.map((b) => b.getAttribute("x"))).toEqual(["0", "10", "20"]);
    expect(two!.getAttribute("aria-label")).toBe("Corda dividida verde e amarela");
  });

  it("BRAIDED: listras diagonais (pattern rotacionado) com todas as cores e rótulo 'trançada'", () => {
    render(<Rope style="BRAIDED" colors={["#22c55e", "#facc15", "#3b82f6"]} />);
    const svg = q("svg.gx-rope")!;
    expect(svg.getAttribute("aria-label")).toBe("Corda trançada verde, amarela e azul");
    const pattern = svg.querySelector("pattern")!;
    expect(pattern.getAttribute("patternTransform")).toBe("rotate(-60)");
    expect(pattern.querySelectorAll("[data-testid='rope-stripe']")).toHaveLength(3);
    expect(svg.querySelector("[data-testid='rope-braided']")!.getAttribute("fill")).toBe(`url(#${pattern.id})`);
  });

  it("horizontal usa outro ângulo; ids únicos por instância", () => {
    render(
      <>
        <Rope style="BRAIDED" colors={["#22c55e", "#facc15"]} orientation="horizontal" />
        <Rope style="BRAIDED" colors={["#22c55e", "#facc15"]} />
      </>,
    );
    const patterns = [...container!.querySelectorAll("pattern")];
    expect(patterns[0]!.getAttribute("patternTransform")).toBe("rotate(30)");
    expect(patterns[0]!.id).not.toBe(patterns[1]!.id);
  });

  it("fallback: sem style/colors usa a cor única; sem nada, cinza neutro; 1 cor nunca vira SPLIT", () => {
    render(<Rope color="#3b82f6" />);
    expect(q("svg.gx-rope")!.dataset["colors"]).toBe("#3b82f6");
    expect(q("svg.gx-rope")!.dataset["style"]).toBe("SOLID");
    expect(normalizeRope({ style: "SPLIT", colors: ["#22c55e"] }).style).toBe("SOLID");
    expect(normalizeRope({ colors: ["nope"], color: null }).colors).toHaveLength(1);
    expect(normalizeRope({ style: "BRAIDED", colors: ["#fff", "#000", "#f00", "#0f0"] }).colors).toHaveLength(3);
  });

  it("decorativa some da árvore de acessibilidade; nomes de cor em pt-BR", () => {
    render(<Rope color="#22c55e" decorative />);
    expect(q("svg.gx-rope")!.getAttribute("aria-hidden")).toBe("true");
    expect(q("svg.gx-rope")!.getAttribute("role")).toBeNull();
    expect([colorName("#facc15"), colorName("#3b82f6"), colorName("#8b5cf6"), colorName("#ffffff"), colorName("#111111")]).toEqual(["amarela", "azul", "roxa", "crua", "preta"]);
    expect(ropeLabel({ style: "SPLIT", colors: ["#3b82f6", "#ffffff"] })).toBe("Corda dividida azul e crua");
  });
});

describe("Minha graduação e régua", () => {
  it("cartão: texto, subtítulo e corda do estilo real à direita", () => {
    render(<GraduationCard name="Corda verde" rope={MIXED} subtitle="Grupo Semente · Desde dezembro de 2025" />);
    expect(text()).toContain("Minha graduação");
    expect(text()).toContain("Corda verde");
    expect(text()).toContain("Grupo Semente · Desde dezembro de 2025");
    const rope = q(".grad-card svg.gx-rope")!;
    expect(rope.dataset["style"]).toBe("BRAIDED");
    expect(rope.dataset["orientation"]).toBe("vertical");
    expect(rope.getAttribute("height")).toBe("104");
  });

  it("cartão sem graduação não desenha corda", () => {
    render(<GraduationCard name={null} rope={null} subtitle="Nenhuma graduação registrada ainda." />);
    expect(text()).toContain("Sem graduação");
    expect(q("svg.gx-rope")).toBeNull();
  });

  it("régua: anteriores com check, atual destacada e próximas esmaecidas", () => {
    render(<RopeRuler levels={[BLUE, MIXED, GREEN]} currentOrder={2} />);
    const items = [...container!.querySelectorAll("li.rope-ruler-item")];
    expect(items.map((i) => i.getAttribute("data-state"))).toEqual(["done", "current", "next"]);
    // ordenada da menor para a maior: verde (done) -> mista (current) -> azul (next)
    const sorted = items;
    expect(sorted[0]!.textContent).toContain("Corda verde");
    expect(sorted[0]!.querySelector(".rope-ruler-check")).not.toBeNull();
    expect(sorted[1]!.getAttribute("aria-current")).toBe("step");
    expect(sorted[2]!.querySelector(".rope-ruler-check")).toBeNull();
  });
});

describe("lógica pura da hierarquia", () => {
  it("shortName, progresso e layout de cima para baixo", () => {
    expect(shortName("Camila de Souza Lima")).toBe("Camila L.");
    expect(shortName("Zé")).toBe("Zé");
    const h = sample();
    const p = progressOf(h);
    expect(p.mineIndex).toBe(1);
    expect(p.levelsAbove).toBe(1);
    expect(p.next?.name).toBe("Corda azul");
    expect(p.belowCount).toBe(7);
    const layout = buildLayout(h);
    const kinds = layout.nodes.map((n) => n.kind);
    expect(kinds).toEqual(["root", "master", "teacher", "teacher", "level", "mine", "below"]);
    const ys = layout.nodes.map((n) => n.y);
    expect([...ys].sort((a, b) => a - b)).toEqual(ys);
    expect(layout.mine).not.toBeNull();
    expect(layout.edges.length).toBeGreaterThan(0);
  });

  it("zoomAt mantém o ponto fixo, respeita limites; centerOn centra o retângulo", () => {
    const t = zoomAt({ x: 10, y: 20, scale: 1 }, 2, 100, 100);
    expect(t.scale).toBe(2);
    expect(t.x).toBe(100 - (100 - 10) * 2);
    expect(t.y).toBe(100 - (100 - 20) * 2);
    expect(zoomAt({ x: 0, y: 0, scale: 1 }, 100, 0, 0).scale).toBe(MAX_SCALE);
    expect(clampScale(0.001)).toBe(MIN_SCALE);
    expect(centerOn({ x: 100, y: 200, w: 100, h: 50 }, { w: 1000, h: 700 }, 1)).toEqual({ scale: 1, x: 350, y: 125 });
  });
});

describe("Hierarquia (canvas)", () => {
  it("renderiza mestre, professores (seu professor), níveis, 'você' em destaque e contagem acima", () => {
    state.hierarchy = { data: sample(), isLoading: false, error: null };
    render(<HierarchyCanvas viewToggle={<span>toggle</span>} />);
    expect(text()).toContain("Mestre Bimba Filho");
    expect(text()).toContain("Prof Ana");
    expect(q("[data-testid='my-teacher']")!.textContent).toContain("Seu professor");
    expect(text()).toContain("Corda azul");
    expect(q("[data-testid='hier-me']")!.textContent).toContain("Você está aqui");
    expect(q("[data-testid='hier-me']")!.textContent).toContain("Camila Souza Lima");
    expect(q("[data-testid='hier-below']")!.textContent).toContain("7 alunos abaixo de você");
    expect(q("[data-testid='hier-summary']")!.textContent).toContain("9 pessoas acima de você");
    expect(q("[data-testid='hier-summary']")!.textContent).toContain("Próximo nível: Corda azul");
    // nível mais alto antes do meu na ordem do DOM
    const names = [...container!.querySelectorAll(".hier-node .hier-name")].map((n) => n.textContent);
    expect(names.indexOf("Corda azul")).toBeLessThan(names.indexOf("Camila Souza Lima"));
    // miniaturas: máx. 6 + "+N"
    expect(q(".hier-level .hier-more")!.textContent).toBe("+3");
  });

  it("clicar em um nível abre o cartão com alunos (nome curto) e Esc fecha", () => {
    const h = sample();
    h.levels[0] = level(BLUE, { count: 15 }); // 12 alunos detalhados + 3 só na contagem
    state.hierarchy = { data: h, isLoading: false, error: null };
    render(<HierarchyCanvas viewToggle={null} />);
    click(q("button.hier-level"));
    const sheet = q("[data-testid='hier-sheet']")!;
    expect(sheet.textContent).toContain("Corda azul");
    expect(sheet.textContent).toContain("Aluno S.");
    expect(sheet.textContent).toContain("e mais 3 alunos");
    act(() => void q("button[aria-label='Fechar']")!.click());
    expect(q("[data-testid='hier-sheet']")).toBeNull();
  });

  it("inicia enquadrado em mim; zoom e centralizar mudam o transform esperado", () => {
    state.hierarchy = { data: sample(), isLoading: false, error: null };
    render(<HierarchyCanvas viewToggle={null} />);
    const world = () => q("[data-testid='hier-world']")!;
    const layout = buildLayout(sample());
    const off = layout.width / 2;
    const m = layout.mine!;
    const initial = centerOn({ ...m, x: m.x + off }, { w: 1000, h: 700 }, 0.92);
    expect(world().style.transform).toBe(`translate(${initial.x}px, ${initial.y}px) scale(0.92)`);

    click(button("Aproximar"));
    const zoomed = zoomAt(initial, 1.25, 500, 350); // 0.92 * 1.25 = 1.15
    expect(world().style.transform).toBe(`translate(${zoomed.x}px, ${zoomed.y}px) scale(${zoomed.scale})`);
    expect(world().dataset["scale"]).toBe("1.150");

    click(button("Afastar"));
    click(button("Afastar"));
    expect(Number(world().dataset["scale"])).toBeLessThan(0.92);

    click(button("Centralizar em mim"));
    expect(world().style.transform).toBe(`translate(${initial.x}px, ${initial.y}px) scale(0.92)`);
  });

  it("estados: vazio, carregando (skeleton) e erro", () => {
    state.hierarchy = { data: sample({ levels: [] }), isLoading: false, error: null };
    render(<HierarchyCanvas viewToggle={<span>toggle</span>} />);
    expect(q("[data-testid='hier-empty']")!.textContent).toContain("Seu grupo ainda não definiu as cordas");
    act(() => root!.unmount());
    container!.remove();

    state.hierarchy = { data: null, isLoading: true, error: null };
    render(<HierarchyCanvas viewToggle={null} />);
    expect(q("[data-testid='hier-skeleton']")).not.toBeNull();
    act(() => root!.unmount());
    container!.remove();

    state.hierarchy = { data: null, isLoading: false, error: new Error("Falhou") };
    render(<HierarchyCanvas viewToggle={null} />);
    expect(q("[role='alert']")!.textContent).toContain("Não foi possível carregar a hierarquia");
  });
});

describe("Jornada: Linha do tempo | Hierarquia", () => {
  const graduated: StudentGraduation[] = [
    { id: 2, graduatedAt: "2026-05-01T00:00:00Z", notes: null, graduationLevel: MIXED },
    { id: 1, graduatedAt: "2025-12-01T00:00:00Z", notes: null, graduationLevel: GREEN },
  ];

  it("linha do tempo mostra o cartão, a régua e a corda desenhada de cada graduação", () => {
    state.graduations = graduated;
    state.hierarchy = { data: sample(), isLoading: false, error: null };
    render(<JourneyPage />);
    expect(q(".grad-card")!.textContent).toContain("Corda verde, amarela e azul");
    expect(q(".grad-card svg.gx-rope")!.dataset["style"]).toBe("BRAIDED");
    expect(container!.querySelectorAll(".timeline-item svg.gx-rope")).toHaveLength(2);
    expect(container!.querySelectorAll(".rope-ruler-item")).toHaveLength(3);
    expect(q("[role='radio'][aria-checked='true']")!.textContent).toBe("Linha do tempo");
  });

  it("alterna para a Hierarquia, lembra a escolha e volta", () => {
    state.graduations = graduated;
    state.hierarchy = { data: sample(), isLoading: false, error: null };
    render(<JourneyPage />);
    click(q("[data-value='hierarchy']"));
    expect(q("[data-testid='hier-canvas']")).not.toBeNull();
    expect(q("[data-testid='hier-me']")).not.toBeNull();
    expect(localStorage.getItem("gingapp.journey.view")).toBe("hierarchy");
    expect(q("[role='radiogroup']")!.dataset["pos"]).toBe("1");

    // nova montagem lê a escolha guardada
    act(() => root!.unmount());
    container!.remove();
    render(<JourneyPage />);
    expect(q("[data-testid='hier-canvas']")).not.toBeNull();

    click(q("[data-value='timeline']"));
    expect(q("[data-testid='hier-canvas']")).toBeNull();
    expect(q(".grad-card")).not.toBeNull();
    expect(localStorage.getItem("gingapp.journey.view")).toBe("timeline");
  });

  it("sem os campos novos do backend cai para a cor única (sem régua)", () => {
    state.graduations = [{ id: 1, graduatedAt: "2025-12-01T00:00:00Z", notes: null, graduationLevel: GREEN }];
    state.hierarchy = { data: null, isLoading: false, error: null };
    render(<JourneyPage />);
    expect(q(".grad-card svg.gx-rope")!.dataset["style"]).toBe("SOLID");
    expect(q(".grad-card svg.gx-rope")!.dataset["colors"]).toBe("#22c55e");
    expect(q(".rope-ruler")).toBeNull();
  });
});
