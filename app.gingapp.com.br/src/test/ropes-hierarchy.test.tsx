import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Ficha, Hierarchy, HierarchyLevel, StudentGraduation } from "@/lib/queries";

/**
 * Cordas desenhadas (Rope), cartão "Minha graduação", régua do sistema e Hierarquia do grupo na Jornada.
 * Os hooks de dados são mockados; o foco é o que a tela desenha e como pan/zoom mexem no transform.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const state: {
  hierarchy: { data: Hierarchy | null; isLoading: boolean; error: Error | null };
  graduations: StudentGraduation[];
  ficha: Ficha | undefined;
} = { hierarchy: { data: null, isLoading: false, error: null }, graduations: [], ficha: undefined };

vi.mock("@/lib/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/queries")>();
  const idle = { data: undefined, isLoading: false, error: null };
  return {
    ...actual,
    useHierarchy: () => ({ ...state.hierarchy, refetch: vi.fn() }),
    useGraduations: () => ({ data: state.graduations, isLoading: false, error: null }),
    useFicha: () => ({ data: state.ficha, isLoading: false, error: null }),
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
import { buildLayout, centerOn, clampScale, MAX_SCALE, MIN_SCALE, progressOf, shortName, staffTiers, zoomAt } from "@/lib/hierarchy";
import { normalizeStaff } from "@/lib/queries";
import type { Badge } from "@/lib/roles";
import { buildTimeline } from "@/lib/derive";
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
  state.ficha = undefined;
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
    // sem `staff` (backend antigo): selos do papel de acesso, Mestre antes de Professor
    const roleNames = [...container!.querySelectorAll(".hier-person .badge")].map((n) => n.textContent);
    expect(roleNames).toEqual(["Mestre", "Professor", "Professor"]);
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

  it("com `staff`: um bloco por cargo do grupo na ordem do rank, com selo colorido; 'seu professor' continua destacado", () => {
    const badge = (id: number, name: string, rank: number, color: string | null, icon: string | null, accessRole: Badge["accessRole"]): Badge => ({
      id, name, slug: name.toLowerCase(), color, icon, accessRole, rank,
    });
    const contramestre = badge(1, "Contramestre", 90, "#dc2626", "crown", "PROFESSOR");
    const formado = badge(2, "Formado", 50, "#facc15", "graduation-cap", "INSTRUTOR");
    const monitor = badge(3, "Monitor", 10, null, null, "MONITOR");
    const person = (id: number, displayName: string, isMyTeacher = false) => ({ id, displayName, photo: null, level: null, isMyTeacher });
    state.hierarchy = {
      data: sample({
        // propositalmente fora de ordem: o app ordena por rank desc
        staff: [
          { groupRole: monitor, people: [person(30, "Zeca Monitor")] },
          { groupRole: contramestre, people: [person(10, "Mestre Joao"), person(11, "Mestra Lia")] },
          { groupRole: formado, people: [person(20, "Prof Ana", true)] },
        ],
        masters: [],
        teachers: [],
      }),
      isLoading: false,
      error: null,
    };
    render(<HierarchyCanvas viewToggle={null} />);

    const cards = [...container!.querySelectorAll(".hier-person")].map((c) => ({
      name: c.querySelector(".hier-name")!.textContent,
      role: c.querySelector(".badge")!.textContent,
    }));
    expect(cards).toEqual([
      { name: "Mestre Joao", role: "Contramestre" },
      { name: "Mestra Lia", role: "Contramestre" },
      { name: "Prof Ana", role: "Formado" },
      { name: "Zeca Monitor", role: "Monitor" },
    ]);
    const chip = q("[data-testid='role-badge-contramestre']")!;
    expect(chip.style.backgroundColor).toBe("rgb(220, 38, 38)");
    expect(chip.querySelector("svg")).not.toBeNull();
    expect(q("[data-testid='role-badge-monitor']")!.style.backgroundColor).toBe("");
    // meu professor (cargo Formado) destacado e na legenda
    expect(q("[data-testid='my-teacher']")!.textContent).toContain("Prof Ana");
    expect(q("[data-testid='my-teacher']")!.textContent).toContain("Formado");
    expect(q(".hier-legend")!.textContent).toContain("Seu professor");
    // as pessoas ficam ANTES das cordas na árvore
    const names = [...container!.querySelectorAll(".hier-node .hier-name")].map((n) => n.textContent);
    expect(names.indexOf("Zeca Monitor")).toBeLessThan(names.indexOf("Corda azul"));
  });

  it("staffTiers: ordena por rank, ignora cargos sem pessoas e cai em masters/teachers quando `staff` falta ou vem vazio", () => {
    const b = (name: string, rank: number): Badge => ({ id: rank, name, slug: name.toLowerCase(), color: null, icon: null, accessRole: "MONITOR", rank });
    const p = { id: 1, displayName: "X", photo: null, level: null, isMyTeacher: false };
    const tiers = staffTiers(sample({ staff: [{ groupRole: b("Baixo", 1), people: [p] }, { groupRole: b("Vazio", 50), people: [] }, { groupRole: b("Alto", 99), people: [p] }] }));
    expect(tiers.map((t) => t.badge.name)).toEqual(["Alto", "Baixo"]);
    expect(tiers.every((t) => t.kind === "staff")).toBe(true);

    for (const over of [{}, { staff: [] }]) {
      const legacy = staffTiers(sample(over));
      expect(legacy.map((t) => `${t.kind}:${t.badge.name}:${t.people.length}`)).toEqual(["master:Mestre:1", "teacher:Professor:2"]);
    }
    // o layout usa os mesmos nós: sem staff = 1 master + 2 teachers (comportamento antigo)
    expect(buildLayout(sample()).nodes.filter((n) => n.kind === "master" || n.kind === "teacher")).toHaveLength(3);
  });

  it("normalizeStaff (select de useHierarchy): resposta fora do contrato vira [] e o rank manda na ordem", () => {
    expect(normalizeStaff(undefined)).toEqual([]);
    expect(normalizeStaff("x")).toEqual([]);
    const out = normalizeStaff([
      { groupRole: { id: 3, name: "Monitor", slug: "monitor", color: null, icon: null, accessRole: "MONITOR", rank: 10 }, people: [] },
      { groupRole: { id: 1, name: "Contramestre", slug: "contramestre", color: "#dc2626", icon: "crown", accessRole: "PROFESSOR", rank: 90 }, people: [] },
      { groupRole: null, people: [] },
      { groupRole: { name: "Sem lista" } },
    ]);
    expect(out.map((g) => g.groupRole.name)).toEqual(["Contramestre", "Monitor"]);
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

  it("marca \"Corda de origem\" nas graduações de outro grupo e \"Reconhecida pelo grupo\" nas reconhecidas", () => {
    state.graduations = graduated;
    state.hierarchy = { data: sample(), isLoading: false, error: null };
    state.ficha = {
      person: { id: 1, gingappCode: "GA-1", name: "Camila", nickname: null, birthDate: null, photo: null, documentMasked: null, documentKind: null },
      enrollments: [
        { studentId: 7, organization: { id: 20, name: "Grupo Semente", logoUrl: null }, unit: null, status: "ACTIVE", since: null, until: null, isCurrent: true },
        { studentId: 3, organization: { id: 10, name: "Grupo Antigo", logoUrl: null }, unit: null, status: "TRANSFERRED", since: null, until: null, isCurrent: false },
      ],
      graduations: [
        { id: 2, studentId: 7, organization: { id: 20, name: "Grupo Semente" }, graduatedAt: "2026-05-01T00:00:00Z", level: MIXED, recognizedFromLevelId: 9 },
        { id: 1, studentId: 3, organization: { id: 10, name: "Grupo Antigo" }, graduatedAt: "2025-12-01T00:00:00Z", level: GREEN, recognizedFromLevelId: null },
      ],
      attendanceByGroup: [],
      certificates: [],
      sharedFromOtherGroups: [],
      scope: "SELF",
    };
    render(<JourneyPage />);
    const items = container!.querySelectorAll(".timeline-item");
    expect(items).toHaveLength(2);
    expect(items[0]!.textContent).toContain("Reconhecida pelo grupo");
    expect(items[0]!.textContent).not.toContain("Corda de origem");
    expect(items[1]!.textContent).toContain("Corda de origem — Grupo Antigo");
    expect(items[1]!.textContent).not.toContain("Reconhecida pelo grupo");
  });

  it("buildTimeline sem ficha devolve a lista sem marcas e inclui cordas que só a ficha conhece", () => {
    expect(buildTimeline(graduated, undefined).every((g) => g.originGroup === null && !g.recognized)).toBe(true);
    const ficha = {
      enrollments: [{ organization: { id: 20, name: "Grupo Semente" }, isCurrent: true }],
      graduations: [{ id: 99, studentId: 3, organization: { id: 10, name: "Grupo Antigo" }, graduatedAt: "2020-01-01T00:00:00Z", level: GREEN, recognizedFromLevelId: null }],
    } as unknown as Ficha;
    const merged = buildTimeline(graduated, ficha);
    expect(merged.map((g) => g.id)).toEqual([2, 1, 99]); // mais recente primeiro
    expect(merged[2]!.originGroup).toBe("Grupo Antigo");
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

describe("Corda com pontas", () => {
  const GRAY = "#9ca3af";
  const YELLOW = "#facc15";
  const BLUE_TIP = "#3b82f6";
  const TIPPED = { id: 9, name: "Corda cinza com pontas", order: 4, color: GRAY, style: "SOLID" as const, colors: [GRAY], tipStart: YELLOW, tipEnd: BLUE_TIP };

  it("vertical: duas pontas nas extremidades (~20% cada), com as cores e linha separadora", () => {
    render(<Rope style="SOLID" colors={[GRAY]} tipStart={YELLOW} tipEnd={BLUE_TIP} length={100} thickness={20} />);
    const svg = q("svg.gx-rope")!;
    expect(svg.getAttribute("aria-label")).toBe("Corda cinza com ponta amarela e ponta azul");
    const start = q("[data-testid='rope-tip-start']")!;
    const end = q("[data-testid='rope-tip-end']")!;
    expect(start.getAttribute("fill")).toBe(YELLOW);
    expect(start.getAttribute("y")).toBe("0");
    expect(start.getAttribute("height")).toBe("20");
    expect(start.getAttribute("width")).toBe("20");
    expect(end.getAttribute("fill")).toBe(BLUE_TIP);
    expect(end.getAttribute("y")).toBe("80");
    expect(end.getAttribute("height")).toBe("20");
    expect(container!.querySelectorAll("[data-testid='rope-tip-line']")).toHaveLength(2);
    expect(svg.dataset["tipStart"]).toBe(YELLOW);
    expect(svg.dataset["tipEnd"]).toBe(BLUE_TIP);
    // o corpo continua desenhado (recortado ao trecho do meio)
    expect(container!.querySelectorAll("[data-testid='rope-solid']")).toHaveLength(1);
  });

  it("horizontal: pontas à esquerda e à direita", () => {
    render(<Rope style="SOLID" colors={["#e5e5e5"]} tipStart="#22c55e" tipEnd={YELLOW} orientation="horizontal" length={100} thickness={12} />);
    const start = q("[data-testid='rope-tip-start']")!;
    const end = q("[data-testid='rope-tip-end']")!;
    expect(start.getAttribute("x")).toBe("0");
    expect(start.getAttribute("width")).toBe("20");
    expect(start.getAttribute("height")).toBe("12");
    expect(end.getAttribute("x")).toBe("80");
    expect(q("svg.gx-rope")!.getAttribute("aria-label")).toBe("Corda branca com ponta verde e ponta amarela");
  });

  it("só uma ponta: desenha apenas ela e o rótulo cita só ela", () => {
    render(<Rope style="SOLID" colors={[GRAY]} tipEnd={BLUE_TIP} length={100} thickness={20} />);
    expect(q("[data-testid='rope-tip-start']")).toBeNull();
    expect(q("[data-testid='rope-tip-end']")).not.toBeNull();
    expect(container!.querySelectorAll("[data-testid='rope-tip-line']")).toHaveLength(1);
    expect(q("svg.gx-rope")!.getAttribute("aria-label")).toBe("Corda cinza com ponta azul");
  });

  it("corpo trançado e dividido continuam com seu padrão e ganham as pontas", () => {
    render(<Rope style="BRAIDED" colors={["#22c55e", "#facc15"]} tipStart="#000000" tipEnd="#ffffff" />);
    expect(q("[data-testid='rope-braided']")).not.toBeNull();
    expect(container!.querySelectorAll("[data-testid='rope-stripe']")).toHaveLength(2);
    expect(q("[data-testid='rope-tip-start']")).not.toBeNull();
    expect(q("svg.gx-rope")!.getAttribute("aria-label")).toBe("Corda trançada verde e amarela com ponta preta e ponta crua");
    act(() => root!.render(<Rope style="SPLIT" colors={["#22c55e", "#3b82f6"]} tipStart={YELLOW} />));
    expect(container!.querySelectorAll("[data-testid='rope-band']")).toHaveLength(2);
    expect(q("[data-testid='rope-tip-start']")!.getAttribute("fill")).toBe(YELLOW);
    expect(q("[data-testid='rope-tip-end']")).toBeNull();
  });

  it("sem pontas (ou com valor inválido) a corda fica como antes", () => {
    render(<Rope style="SOLID" colors={[GRAY]} tipStart={null} tipEnd="não-é-cor" />);
    expect(q("[data-testid='rope-tip-start']")).toBeNull();
    expect(q("[data-testid='rope-tip-end']")).toBeNull();
    expect(q("[data-testid='rope-tip-line']")).toBeNull();
    expect(q("svg.gx-rope")!.getAttribute("aria-label")).toBe("Corda cinza");
    expect(q("svg.gx-rope")!.hasAttribute("data-tip-start")).toBe(false);
    expect(normalizeRope({ colors: [GRAY] })).toMatchObject({ tipStart: null, tipEnd: null });
    expect(ropeLabel({ colors: [GRAY], tipStart: YELLOW, tipEnd: BLUE_TIP })).toBe("Corda cinza com ponta amarela e ponta azul");
  });

  it("pontos de uso: cartão e régua repassam tipStart/tipEnd", () => {
    render(<GraduationCard name="Corda cinza" rope={TIPPED} subtitle="x" />);
    expect(q(".grad-card svg.gx-rope")!.dataset["tipStart"]).toBe(YELLOW);
    expect(q(".grad-card svg.gx-rope")!.getAttribute("aria-label")).toBe("Corda cinza com ponta amarela e ponta azul");
    act(() => root!.render(<RopeRuler levels={[GREEN, TIPPED]} currentOrder={4} />));
    expect(container!.querySelectorAll("svg.gx-rope[data-tip-start]")).toHaveLength(1);
  });

  it("Jornada e Hierarquia desenham as pontas do nível", () => {
    state.graduations = [{ id: 5, graduatedAt: "2026-05-01T00:00:00Z", notes: null, graduationLevel: TIPPED }];
    state.hierarchy = { data: sample({ levels: [level(TIPPED, { isMine: true })], me: { studentId: 7, displayName: "Camila", photo: null, level: TIPPED, order: 4 } }), isLoading: false, error: null };
    render(<JourneyPage />);
    expect(q(".grad-card svg.gx-rope")!.dataset["tipEnd"]).toBe(BLUE_TIP);
    expect(container!.querySelectorAll(".timeline-item svg.gx-rope[data-tip-start]")).toHaveLength(1);
    expect(container!.querySelectorAll(".rope-ruler-item svg.gx-rope[data-tip-start]").length).toBeGreaterThan(0);
  });

  it("Hierarquia: nós de nível e 'você' desenham as pontas", () => {
    state.hierarchy = { data: sample({ levels: [level(TIPPED, { isMine: true })], me: { studentId: 7, displayName: "Camila", photo: null, level: TIPPED, order: 4 } }), isLoading: false, error: null };
    render(<HierarchyCanvas viewToggle={<span>t</span>} />);
    expect(container!.querySelectorAll(".hier-node svg.gx-rope[data-tip-start][data-tip-end]").length).toBeGreaterThan(0);
  });
});
