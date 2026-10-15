import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeroCarousel, HeroCarouselView, HERO_INTERVAL_MS, type HeroSlideSpec } from "@/components/gingapp/hero-carousel";
import { saveSession } from "@/lib/session";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

/** Banner da Home em carrossel: autoplay 5,5 s, pausas, indicadores, reduced-motion, slides sem dado e CTAs. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const slide = (key: string, to: string): HeroSlideSpec => ({
  key,
  tone: "community",
  eyebrowIcon: null,
  eyebrow: `Eyebrow ${key}`,
  title: `Título ${key}`,
  text: `Texto ${key}`,
  cta: { to, label: `CTA ${key}` },
});
const SLIDES = [slide("a", "/comunidade"), slide("b", "/ranking"), slide("c", "/jornada")];

const render = (node: ReactNode) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
};
const activeKey = () => document.body.querySelector<HTMLElement>('.hero-slide[data-active]')?.getAttribute("data-testid")?.replace("hero-slide-", "");
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const dots = () => [...document.body.querySelectorAll<HTMLButtonElement>(".hero-dot")];
const carousel = () => document.body.querySelector<HTMLElement>('[data-testid="hero-carousel"]')!;
const fire = (el: Element, type: string, props: Record<string, unknown> = {}) =>
  act(() => void el.dispatchEvent(Object.assign(new Event(type, { bubbles: true }), props)));

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("HeroCarouselView", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubReducedMotion(false);
  });

  it("começa no slide 1, com região/slides acessíveis e CTA do slide ativo", () => {
    render(<HeroCarouselView slides={SLIDES} />);
    expect(carousel().getAttribute("role")).toBe("region");
    expect(carousel().getAttribute("aria-roledescription")).toBe("carrossel");
    expect(activeKey()).toBe("a");
    const labels = [...document.body.querySelectorAll(".hero-slide")].map((s) => s.getAttribute("aria-label"));
    expect(labels).toEqual(["1 de 3", "2 de 3", "3 de 3"]);
    expect(document.body.querySelector(".hero-track")!.getAttribute("aria-live")).toBe("off");
    expect(dots()).toHaveLength(3);
    expect(dots()[0]!.getAttribute("aria-current")).toBe("true");
  });

  it("avança sozinho após 5,5 s (e não antes) e volta ao primeiro no fim", () => {
    render(<HeroCarouselView slides={SLIDES} />);
    advance(HERO_INTERVAL_MS - 100);
    expect(activeKey()).toBe("a");
    advance(100);
    expect(activeKey()).toBe("b");
    advance(HERO_INTERVAL_MS);
    expect(activeKey()).toBe("c");
    advance(HERO_INTERVAL_MS);
    expect(activeKey()).toBe("a");
  });

  it("pausa com o mouse em cima e retoma ao sair", () => {
    render(<HeroCarouselView slides={SLIDES} />);
    fire(carousel(), "pointerover");
    advance(30_000);
    expect(activeKey()).toBe("a");
    fire(carousel(), "pointerout");
    advance(HERO_INTERVAL_MS);
    expect(activeKey()).toBe("b");
  });

  it("pausa durante o toque e o swipe horizontal troca o slide", () => {
    render(<HeroCarouselView slides={SLIDES} />);
    const touch = { pointerType: "touch", pointerId: 1, clientY: 10 };
    fire(carousel(), "pointerdown", { ...touch, clientX: 300 });
    advance(30_000);
    expect(activeKey()).toBe("a");
    fire(carousel(), "pointerup", { ...touch, clientX: 200 }); // arrastou 100px para a esquerda = próximo
    expect(activeKey()).toBe("b");
    fire(carousel(), "pointerdown", { ...touch, clientX: 100 });
    fire(carousel(), "pointerup", { ...touch, clientX: 220 }); // para a direita = anterior
    expect(activeKey()).toBe("a");
  });

  it("pausa com a aba oculta e retoma ao voltar", () => {
    render(<HeroCarouselView slides={SLIDES} />);
    const setVisibility = (state: "hidden" | "visible") => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
      act(() => void document.dispatchEvent(new Event("visibilitychange")));
    };
    setVisibility("hidden");
    advance(30_000);
    expect(activeKey()).toBe("a");
    setVisibility("visible");
    advance(HERO_INTERVAL_MS);
    expect(activeKey()).toBe("b");
  });

  it("prefers-reduced-motion: não avança sozinho, mas a navegação manual funciona", () => {
    stubReducedMotion(true);
    render(<HeroCarouselView slides={SLIDES} />);
    advance(60_000);
    expect(activeKey()).toBe("a");
    act(() => dots()[2]!.click());
    expect(activeKey()).toBe("c");
  });

  it("indicadores trocam o slide, marcam o ativo e ligam o aria-live só no modo manual", () => {
    render(<HeroCarouselView slides={SLIDES} />);
    act(() => dots()[1]!.click());
    expect(activeKey()).toBe("b");
    expect(dots()[1]!.getAttribute("aria-current")).toBe("true");
    expect(dots()[0]!.hasAttribute("aria-current")).toBe(false);
    expect(document.body.querySelector(".hero-track")!.getAttribute("aria-live")).toBe("polite");
    act(() => document.body.querySelector<HTMLButtonElement>('[aria-label="Próximo slide"]')!.click());
    expect(activeKey()).toBe("c");
    act(() => document.body.querySelector<HTMLButtonElement>('[aria-label="Slide anterior"]')!.click());
    expect(activeKey()).toBe("b");
  });

  it("um slide que sai da lista não faz o ativo pular; com 1 slide não há controles", () => {
    render(<HeroCarouselView slides={SLIDES} />);
    act(() => dots()[1]!.click());
    act(() => root!.render(<HeroCarouselView slides={[SLIDES[0]!, SLIDES[1]!]} />));
    expect(activeKey()).toBe("b");
    act(() => root!.render(<HeroCarouselView slides={[SLIDES[0]!]} />));
    expect(dots()).toHaveLength(0);
    advance(30_000);
    expect(activeKey()).toBe("a");
  });

  it("cada slide tem o CTA com o link certo", () => {
    render(<HeroCarouselView slides={SLIDES} />);
    const hrefs = [...document.body.querySelectorAll<HTMLAnchorElement>(".hero-slide a")].map((a) => [a.textContent, a.getAttribute("href")]);
    expect(hrefs).toEqual([
      ["CTA a", "/comunidade"],
      ["CTA b", "/ranking"],
      ["CTA c", "/jornada"],
    ]);
  });
});

describe("HeroCarousel (dados do aluno ativo)", () => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
  const LEVEL = { id: 2, name: "Corda Verde", order: 2, color: "#22C55E" };
  const ME = {
    student: { id: 11, displayName: "Camila", avatarUrl: null },
    points: { season: 1180, allTime: 6420 },
    level: { code: "AZUL", name: "Roda", color: "#3B82F6" },
    nextLevel: { code: "ROXA", name: "Axé", color: "#8B5CF6", minPoints: 1400 },
    pointsToNext: 220,
    progressPct: 69,
  };
  let paths: string[] = [];

  function mockApi(opts: { ranking?: "ok" | "fail"; graduations?: "ok" | "empty" | "fail" } = {}) {
    paths = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input).replace(/^.*\/api/, "http://x"));
        paths.push(url.pathname + url.search);
        switch (url.pathname) {
          case "/students/me":
            return json(200, [{ id: 11, userId: 1, unitId: 1, name: "Camila", photo: null, coverPhoto: null, socialLinks: null, joinedAt: null }]);
          case "/ranking/me":
            return opts.ranking === "fail" ? json(500, { message: "erro" }) : json(200, ME);
          case "/graduations/students/11":
            if (opts.graduations === "fail") return json(500, { message: "erro" });
            return json(200, opts.graduations === "empty" ? [] : [{ id: 1, graduatedAt: "2026-01-01", notes: null, graduationLevel: LEVEL }]);
          case "/graduations/hierarchy":
            return json(200, {
              group: { id: 1, name: "G", logoUrl: null },
              system: null,
              levels: [1, 2, 3].map((n) => ({ id: n, name: `Corda ${n}`, order: n, color: "#22C55E", count: 1, isMine: n === 2, students: [] })).map((l) => (l.id === 2 ? { ...l, name: "Corda Verde" } : l)),
              me: null,
              higherCount: 0,
              totalStudents: 3,
            });
          default:
            return json(404, { message: `sem rota ${url.pathname}` });
        }
      }),
    );
  }

  const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 40))));
  async function mount() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <HeroCarousel />
      </QueryClientProvider>,
    );
    await settle();
    await settle();
    await settle();
  }
  const keys = () => [...document.body.querySelectorAll<HTMLElement>(".hero-slide")].map((s) => s.getAttribute("data-testid")?.replace("hero-slide-", ""));

  beforeEach(() => {
    localStorage.clear();
    stubReducedMotion(true); // sem autoplay: o teste só olha a composição dos slides
    saveSession("t", { id: 1, name: "Camila Souza", email: "c@x.com", userType: "MEMBER", isSuperAdmin: false, organizationId: 1, organizationSlug: "g", role: "ALUNO" });
  });

  it("com dados: comunidade, ranking (liga e pontos), jornada (corda e progresso) e check-in, com os links certos", async () => {
    mockApi();
    await mount();
    expect(keys()).toEqual(["comunidade", "ranking", "jornada", "checkin"]);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Liga Roda");
    expect(text).toContain("1.180 pts");
    expect(text).toContain("Faltam 220 para a liga Axé");
    expect(text).toContain("Corda atual: Corda Verde. Próxima: Corda 3.");
    expect(document.body.querySelector('[data-testid="hero-journey-progress"]')!.getAttribute("aria-label")).toBe("Corda 2 de 3");
    expect(document.body.querySelector("[data-testid='hero-slide-jornada'] svg")).toBeTruthy(); // corda desenhada
    const hrefs = [...document.body.querySelectorAll<HTMLAnchorElement>(".hero-slide a")].map((a) => a.getAttribute("href"));
    expect(hrefs).toEqual(["/comunidade", "/ranking", "/jornada", "/checkin"]);
    // segue o aluno ativo
    expect(paths.some((p) => p.startsWith("/ranking/me") && p.includes("studentId=11"))).toBe(true);
    expect(paths).toContain("/graduations/students/11");
  });

  it("slide cujo dado falha é omitido (sem erro na tela)", async () => {
    mockApi({ ranking: "fail", graduations: "fail" });
    await mount();
    expect(keys()).toEqual(["comunidade", "checkin"]);
    expect(document.body.textContent).not.toMatch(/erro|falha|não foi possível/i);
  });

  it("aluno sem graduação: sem o slide da jornada", async () => {
    mockApi({ graduations: "empty" });
    await mount();
    expect(keys()).toEqual(["comunidade", "ranking", "checkin"]);
  });
});
