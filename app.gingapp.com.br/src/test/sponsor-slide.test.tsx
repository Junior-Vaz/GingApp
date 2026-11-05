import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeroCarousel, HeroCarouselView, HERO_INTERVAL_MS, type HeroSlideSpec } from "@/components/gingapp/hero-carousel";
import { SPONSOR_SLIDE_KEY, buildSponsorSlide, insertSponsorSlide } from "@/components/gingapp/hero-sponsor";
import {
  SPONSOR_IMPRESSION_DELAY_MS,
  isViewerMinor,
  parseSponsorSlide,
  pickSponsorSlide,
  reportImpressionOnce,
  resetSponsorImpressionMemory,
  sponsorAssetUrl,
  useActiveSponsor,
  type SponsorSlide,
} from "@/lib/sponsors";
import { saveSession } from "@/lib/session";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

/** Slide "Patrocinado" do banner (docs/CONTRATO_PATROCINADORES.md, secoes 2, 4.1 e 6). */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const render = (node: ReactNode) => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(node));
};
const $ = <T extends Element = HTMLElement>(selector: string) => document.body.querySelector<T>(selector);
const $$ = <T extends Element = HTMLElement>(selector: string) => [...document.body.querySelectorAll<T>(selector)];
const activeKey = () => $('.hero-slide[data-active]')?.getAttribute("data-testid")?.replace("hero-slide-", "");
const keys = () => $$(".hero-slide").map((s) => s.getAttribute("data-testid")?.replace("hero-slide-", ""));
const dots = () => $$<HTMLButtonElement>(".hero-dot");
const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
const advanceAsync = (ms: number) => act(async () => void (await vi.advanceTimersByTimeAsync(ms)));

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}
function setVisibility(state: "hidden" | "visible") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  act(() => void document.dispatchEvent(new Event("visibilitychange")));
}

/** Item do contrato 4.1. */
const ITEM: SponsorSlide = {
  id: 12,
  sponsorName: "Loja do Berimbau",
  logoUrl: "/api/uploads/logo-12.webp",
  imageUrl: "/api/uploads/banner-12.webp",
  title: "Berimbaus artesanais",
  text: "Do mestre artesão direto para a sua roda.",
  ctaLabel: "Conhecer",
  clickPath: "/api/sponsors/12/click?s=GO",
  state: "GO",
};

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
  setVisibility("visible");
  sessionStorage.clear();
  resetSponsorImpressionMemory();
});

describe("lib/sponsors: formatos do contrato e regra de menor", () => {
  it("pickSponsorSlide: lê { items: [1 item] }; vazio, sem items ou lixo = null", () => {
    expect(pickSponsorSlide({ items: [ITEM] })).toEqual(ITEM);
    expect(pickSponsorSlide({ items: [] })).toBeNull();
    expect(pickSponsorSlide({})).toBeNull();
    expect(pickSponsorSlide(null)).toBeNull();
    expect(pickSponsorSlide(undefined)).toBeNull();
    expect(pickSponsorSlide({ items: "x" })).toBeNull();
    expect(pickSponsorSlide({ items: [null, 5, { id: "x" }] })).toBeNull();
  });

  it("parseSponsorSlide: logo/imagem nulos viram null; clique sem UF é válido; state ausente = ''", () => {
    const item = parseSponsorSlide({ ...ITEM, logoUrl: null, imageUrl: null, clickPath: "/api/sponsors/12/click", state: undefined });
    expect(item).toMatchObject({ logoUrl: null, imageUrl: null, clickPath: "/api/sponsors/12/click", state: "" });
  });

  it("só aceita o que o contrato promete: clique do redirecionador e imagens em /api/uploads (nada de terceiro)", () => {
    // clique que não é o redirecionador do servidor (URL do patrocinador direto / outro host) = item descartado
    expect(parseSponsorSlide({ ...ITEM, clickPath: "https://loja.example.com/promo" })).toBeNull();
    expect(parseSponsorSlide({ ...ITEM, clickPath: "//evil.example.com/api/sponsors/12/click" })).toBeNull();
    expect(parseSponsorSlide({ ...ITEM, clickPath: "javascript:alert(1)" })).toBeNull();
    expect(parseSponsorSlide({ ...ITEM, clickPath: "/api/sponsors/12/click?s=GO&url=https://x.com" })).toBeNull();
    // imagem de terceiro = sem imagem (o item segue valido, com o degradê)
    expect(parseSponsorSlide({ ...ITEM, imageUrl: "https://cdn.example.com/x.jpg", logoUrl: "http://x.com/l.png" })).toMatchObject({
      imageUrl: null,
      logoUrl: null,
    });
    // textos vazios / id inválido
    expect(parseSponsorSlide({ ...ITEM, title: "  " })).toBeNull();
    expect(parseSponsorSlide({ ...ITEM, id: 0 })).toBeNull();
    expect(parseSponsorSlide({ ...ITEM, id: 1.5 })).toBeNull();
  });

  it("sponsorAssetUrl: prefixa a origem da API (dev) e rejeita o que não é /api/...", () => {
    const click = sponsorAssetUrl("/api/sponsors/12/click?s=GO", "click")!;
    expect(click.endsWith("/api/sponsors/12/click?s=GO")).toBe(true);
    expect(sponsorAssetUrl("/api/uploads/a.webp", "upload")!.endsWith("/api/uploads/a.webp")).toBe(true);
    expect(sponsorAssetUrl("/api/uploads/a.webp", "click")).toBeNull();
    expect(sponsorAssetUrl("https://x.com/a.webp", "upload")).toBeNull();
    expect(sponsorAssetUrl(null, "upload")).toBeNull();
  });

  it("isViewerMinor: menor pelo passaporte ou pela data; sem informação = o app não impede (o servidor decide)", () => {
    const now = new Date(2026, 9, 21);
    expect(isViewerMinor({ passportIsMinor: true })).toBe(true);
    expect(isViewerMinor({ passportIsMinor: false })).toBe(false);
    expect(isViewerMinor({ birthDate: "2012-01-01T00:00:00.000Z", now })).toBe(true);
    expect(isViewerMinor({ birthDate: "2008-10-22T00:00:00.000Z", now })).toBe(true); // faz 18 amanhã
    expect(isViewerMinor({ birthDate: "2008-10-21T00:00:00.000Z", now })).toBe(false); // faz 18 hoje
    expect(isViewerMinor({ birthDate: "1990-05-10T00:00:00.000Z", now })).toBe(false);
    expect(isViewerMinor({ passportIsMinor: true, birthDate: "1990-05-10T00:00:00.000Z", now })).toBe(true);
    expect(isViewerMinor({})).toBe(false);
    expect(isViewerMinor({ passportIsMinor: null, birthDate: null })).toBe(false);
  });
});

describe("reportImpressionOnce (uma vez por campanha por sessão)", () => {
  const json = (status: number) => new Response(null, { status });
  let calls: { url: string; init: RequestInit | undefined }[] = [];
  beforeEach(() => {
    calls = [];
    sessionStorage.clear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return json(204);
      }),
    );
  });

  it("POST /sponsors/:id/impression sem corpo; a 2ª chamada da mesma campanha não envia; outra campanha envia", async () => {
    reportImpressionOnce(12);
    reportImpressionOnce(12);
    reportImpressionOnce(13);
    await act(async () => void (await Promise.resolve()));
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(["/api/sponsors/12/impression", "/api/sponsors/13/impression"]);
    for (const c of calls) {
      expect(c.init?.method).toBe("POST");
      expect(c.init?.body).toBeUndefined();
    }
  });

  it("só o id da campanha fica na sessão (nada no localStorage)", () => {
    localStorage.clear();
    reportImpressionOnce(12);
    expect(sessionStorage.length).toBe(1);
    expect(sessionStorage.key(0)).toContain("12");
    expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe("1");
    expect(JSON.stringify({ ...localStorage })).not.toMatch(/sponsor|12/i);
  });

  it("falha silenciosa: 500 e erro de rede não explodem nem tentam de novo", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(500)));
    expect(() => reportImpressionOnce(20)).not.toThrow();
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("rede"))));
    expect(() => reportImpressionOnce(21)).not.toThrow();
    await act(async () => void (await new Promise((r) => setTimeout(r, 10))));
    const fetchSpy = vi.fn(async () => json(204));
    vi.stubGlobal("fetch", fetchSpy);
    reportImpressionOnce(20); // já marcada: não repete mesmo tendo falhado
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("sessionStorage bloqueado: segue funcionando com o plano B em memória (1x)", async () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("bloqueado");
      },
      setItem: () => {
        throw new Error("bloqueado");
      },
    });
    reportImpressionOnce(30);
    reportImpressionOnce(30);
    await act(async () => void (await Promise.resolve()));
    expect(calls).toHaveLength(1);
  });

  it("id inválido não envia nada", () => {
    reportImpressionOnce(0);
    reportImpressionOnce(-3);
    reportImpressionOnce(1.5);
    reportImpressionOnce(Number.NaN);
    expect(calls).toHaveLength(0);
  });
});

describe("useActiveSponsor", () => {
  let paths: string[] = [];
  let reply: () => Response = () => new Response(JSON.stringify({ items: [ITEM] }), { status: 200 });
  let seen: { data: SponsorSlide | null | undefined; isError: boolean } = { data: undefined, isError: false };

  function Probe({ studentId, enabled }: { studentId: number | undefined; enabled: boolean }) {
    const q = useActiveSponsor(studentId, enabled);
    seen = { data: q.data, isError: q.isError };
    return null;
  }
  const settle = () => act(async () => void (await new Promise((r) => setTimeout(r, 30))));
  async function mount(studentId: number | undefined, enabled: boolean) {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <Probe studentId={studentId} enabled={enabled} />
      </QueryClientProvider>,
    );
    await settle();
    await settle();
  }

  beforeEach(() => {
    paths = [];
    seen = { data: undefined, isError: false };
    saveSession("t", { id: 1, name: "Camila", email: "c@x.com", userType: "MEMBER", isSuperAdmin: false, organizationId: 1, organizationSlug: "g", role: "ALUNO" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        paths.push(url.pathname + url.search);
        return reply();
      }),
    );
  });

  it("GET /sponsors/active?studentId=11 e devolve o item do contrato", async () => {
    reply = () => new Response(JSON.stringify({ items: [ITEM] }), { status: 200 });
    await mount(11, true);
    expect(paths).toEqual(["/api/sponsors/active?studentId=11"]);
    expect(seen.data).toEqual(ITEM);
  });

  it("sem aluno a rota vai sem studentId; resposta vazia = null (sem erro)", async () => {
    reply = () => new Response(JSON.stringify({ items: [] }), { status: 200 });
    await mount(undefined, true);
    expect(paths).toEqual(["/api/sponsors/active"]);
    expect(seen.data).toBeNull();
    expect(seen.isError).toBe(false);
  });

  it("enabled=false (menor, sem sessão...) = NENHUMA requisição", async () => {
    await mount(11, false);
    expect(paths).toEqual([]);
    expect(seen.data).toBeUndefined();
  });

  it("erro do servidor: sem dado, sem nova tentativa (1 chamada)", async () => {
    reply = () => new Response(JSON.stringify({ message: "erro" }), { status: 500 });
    await mount(11, true);
    expect(paths).toHaveLength(1);
    expect(seen.data).toBeUndefined();
    expect(seen.isError).toBe(true);
  });
});

describe("HeroCarouselView com slide patrocinado", () => {
  const plain = (key: string, to: string): HeroSlideSpec => ({
    key,
    tone: "community",
    eyebrowIcon: null,
    eyebrow: `Eyebrow ${key}`,
    title: `Título ${key}`,
    text: `Texto ${key}`,
    cta: { to, label: `CTA ${key}` },
  });
  const sponsorSpec = (): HeroSlideSpec => buildSponsorSlide(ITEM)!;
  const SLIDES = (): HeroSlideSpec[] => [plain("a", "/comunidade"), plain("b", "/ranking"), sponsorSpec(), plain("c", "/checkin")];
  const seenSpy = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    stubReducedMotion(false);
    seenSpy.mockReset();
  });

  it("selo 'Patrocinado' em texto visível, logo, nome, título e texto; tone sponsor", () => {
    render(<HeroCarouselView slides={SLIDES()} onSponsorSeen={seenSpy} />);
    const slide = $(`[data-testid="hero-slide-${SPONSOR_SLIDE_KEY}"]`)!;
    expect(slide.className).toContain("hero-sponsor");
    const badge = slide.querySelector('[data-testid="hero-sponsor-badge"]')!;
    expect(badge.textContent).toBe("Patrocinado");
    expect(slide.querySelector(".hero-sponsor-name")!.textContent).toBe("Loja do Berimbau");
    expect(slide.querySelector('[data-testid="hero-sponsor-logo"] img')!.getAttribute("src")).toContain("/api/uploads/logo-12.webp");
    expect(slide.querySelector("h2")!.textContent).toBe("Berimbaus artesanais");
    expect(slide.querySelector("p")!.textContent).toBe("Do mestre artesão direto para a sua roda.");
    expect(slide.querySelector(":scope > img")!.getAttribute("src")).toContain("/api/uploads/banner-12.webp"); // imagem de fundo
  });

  it("sem imagem nem logo: degradê neutro (sem <img>) e o selo continua lá", () => {
    const spec = buildSponsorSlide({ ...ITEM, imageUrl: null, logoUrl: null })!;
    render(<HeroCarouselView slides={[plain("a", "/x"), plain("b", "/y"), spec]} onSponsorSeen={seenSpy} />);
    const slide = $(`[data-testid="hero-slide-${SPONSOR_SLIDE_KEY}"]`)!;
    expect(slide.querySelector("img")).toBeNull();
    expect(slide.querySelector('[data-testid="hero-sponsor-badge"]')!.textContent).toBe("Patrocinado");
  });

  it("botão do anúncio: <a> para o clickPath do servidor, nova aba, rel sponsored noopener noreferrer", () => {
    render(<HeroCarouselView slides={SLIDES()} onSponsorSeen={seenSpy} />);
    const link = $(`[data-testid="hero-slide-${SPONSOR_SLIDE_KEY}"] a`)!;
    expect(link.tagName).toBe("A");
    expect(link.textContent).toContain("Conhecer");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")!.split(" ").sort()).toEqual(["noopener", "noreferrer", "sponsored"]);
    const href = link.getAttribute("href")!;
    expect(href.endsWith("/api/sponsors/12/click?s=GO")).toBe(true);
    expect(href).not.toContain("loja"); // o app nunca monta a URL do patrocinador
    // os demais slides continuam com o Link do app (sem target/rel)
    const other = $('[data-testid="hero-slide-a"] a')!;
    expect(other.getAttribute("target")).toBeNull();
    expect(other.getAttribute("rel")).toBeNull();
  });

  it("indicador do slide patrocinado: 'Patrocinado: <título>'; os demais seguem 'Ir para o slide N de M'", () => {
    render(<HeroCarouselView slides={SLIDES()} onSponsorSeen={seenSpy} />);
    expect(dots().map((d) => d.getAttribute("aria-label"))).toEqual([
      "Ir para o slide 1 de 4",
      "Ir para o slide 2 de 4",
      "Patrocinado: Berimbaus artesanais",
      "Ir para o slide 4 de 4",
    ]);
    act(() => dots()[2]!.click());
    expect(activeKey()).toBe(SPONSOR_SLIDE_KEY);
    expect(dots()[2]!.getAttribute("aria-current")).toBe("true");
  });

  it("'Por que vejo isso?' abre a folha com o texto de transparência, move o foco, pausa o autoplay e fecha com Esc", () => {
    render(<HeroCarouselView slides={SLIDES()} onSponsorSeen={seenSpy} />);
    act(() => dots()[2]!.click());
    const why = $<HTMLButtonElement>(".hero-sponsor-why")!;
    expect(why.textContent).toBe("Por que vejo isso?");
    expect($('[role="dialog"]')).toBeNull();
    act(() => why.click());
    const dialog = $('[role="dialog"]')!;
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain("Por que vejo isso?");
    expect(dialog.textContent).toContain("O GingApp é gratuito e se mantém com o apoio de parceiros. Este anúncio é de Loja do Berimbau e não usa seus dados pessoais.");
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(dialog.getAttribute("aria-describedby")).toBeTruthy();
    expect(dialog.contains(document.activeElement)).toBe(true); // foco dentro da folha
    expect($('[data-testid="hero-carousel"]')!.getAttribute("data-paused")).toBe("true");
    advance(HERO_INTERVAL_MS * 3);
    expect(activeKey()).toBe(SPONSOR_SLIDE_KEY); // aberta = não avança sozinho
    act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    advance(500);
    expect($('[role="dialog"]')).toBeNull();
    expect($('[data-testid="hero-carousel"]')!.getAttribute("data-paused")).toBeNull();
  });

  it("a folha também fecha no botão 'Fechar'", () => {
    render(<HeroCarouselView slides={SLIDES()} onSponsorSeen={seenSpy} />);
    act(() => dots()[2]!.click());
    act(() => $<HTMLButtonElement>(".hero-sponsor-why")!.click());
    const close = [...$('[role="dialog"]')!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.includes("Fechar"))!;
    act(() => close.click());
    advance(500);
    expect($('[role="dialog"]')).toBeNull();
  });

  it("impressão: só depois de 1 s com o slide ativo; antes disso nada; depois, exatamente 1 chamada", () => {
    render(<HeroCarouselView slides={SLIDES()} onSponsorSeen={seenSpy} />);
    advance(HERO_INTERVAL_MS); // a -> b (autoplay; o timer é rearmado a cada troca)
    advance(HERO_INTERVAL_MS); // b -> patrocinado
    expect(activeKey()).toBe(SPONSOR_SLIDE_KEY);
    expect(seenSpy).not.toHaveBeenCalled();
    advance(SPONSOR_IMPRESSION_DELAY_MS - 1);
    expect(seenSpy).not.toHaveBeenCalled();
    advance(1);
    expect(seenSpy).toHaveBeenCalledTimes(1);
    expect(seenSpy).toHaveBeenCalledWith(12);
    advance(1000); // ainda no mesmo slide: não repete
    expect(seenSpy).toHaveBeenCalledTimes(1);
  });

  it("trocar de slide antes de 1 s cancela a impressão; voltar e ficar 1 s conta", () => {
    render(<HeroCarouselView slides={SLIDES()} onSponsorSeen={seenSpy} />);
    act(() => dots()[2]!.click());
    advance(900);
    act(() => dots()[3]!.click()); // saiu antes de 1 s
    advance(5000);
    expect(seenSpy).not.toHaveBeenCalled();
    act(() => dots()[2]!.click());
    advance(1000);
    expect(seenSpy).toHaveBeenCalledTimes(1);
  });

  it("aba oculta não conta: esconder cancela e voltar a mostrar recomeça o 1 s", () => {
    render(<HeroCarouselView slides={SLIDES()} onSponsorSeen={seenSpy} />);
    act(() => dots()[2]!.click());
    advance(600);
    setVisibility("hidden");
    advance(10_000);
    expect(seenSpy).not.toHaveBeenCalled();
    setVisibility("visible");
    advance(999);
    expect(seenSpy).not.toHaveBeenCalled();
    advance(1);
    expect(seenSpy).toHaveBeenCalledTimes(1);
  });

  it("slides sem patrocinador nunca disparam impressão", () => {
    render(<HeroCarouselView slides={[plain("a", "/x"), plain("b", "/y")]} onSponsorSeen={seenSpy} />);
    advance(HERO_INTERVAL_MS * 4);
    expect(seenSpy).not.toHaveBeenCalled();
  });

  it("prefers-reduced-motion: sem autoplay, o patrocinado é alcançável pelo indicador e a impressão conta em 1 s", () => {
    stubReducedMotion(true);
    render(<HeroCarouselView slides={SLIDES()} onSponsorSeen={seenSpy} />);
    advance(60_000);
    expect(activeKey()).toBe("a");
    expect(seenSpy).not.toHaveBeenCalled();
    act(() => dots()[2]!.click());
    expect(activeKey()).toBe(SPONSOR_SLIDE_KEY);
    advance(1000);
    expect(seenSpy).toHaveBeenCalledTimes(1);
    advance(60_000);
    expect(activeKey()).toBe(SPONSOR_SLIDE_KEY); // continua parado
  });

  it("botões do slide patrocinado só entram na ordem do Tab quando ele está ativo", () => {
    render(<HeroCarouselView slides={SLIDES()} onSponsorSeen={seenSpy} />);
    const link = () => $(`[data-testid="hero-slide-${SPONSOR_SLIDE_KEY}"] a`)!;
    const why = () => $(".hero-sponsor-why")!;
    expect(link().getAttribute("tabindex")).toBe("-1");
    expect(why().getAttribute("tabindex")).toBe("-1");
    act(() => dots()[2]!.click());
    expect(link().getAttribute("tabindex")).toBe("0");
    expect(why().getAttribute("tabindex")).toBe("0");
  });
});

describe("HeroCarousel (dados reais do aluno ativo + patrocinador)", () => {
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
  const passport = (isMinor: boolean) => ({
    student: { id: 11, name: "Camila" },
    organization: { name: "G" },
    unit: null,
    currentGraduation: null,
    stats: { aulas: 0, rodas: 0, eventos: 0, graduacoes: 0, certificados: 0 },
    publicProfile: null,
    viewer: { isGuardian: false, isMinor, hasConsent: null, canPublish: !isMinor, canConsent: false },
  });

  let paths: string[] = [];
  let posts: string[] = [];
  let sponsorsReply: () => Response = () => json(200, { items: [ITEM] });

  function mockApi(opts: { ranking?: "ok" | "fail"; graduations?: "ok" | "fail"; minor?: boolean; passport?: "ok" | "fail" } = {}) {
    paths = [];
    posts = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(String(input).replace(/^.*\/api/, "http://x"));
        paths.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
        if (init?.method === "POST") posts.push(url.pathname);
        switch (url.pathname) {
          case "/students/me":
            return json(200, [{ id: 11, userId: 1, unitId: 1, name: "Camila", photo: null, coverPhoto: null, socialLinks: null, joinedAt: null }]);
          case "/ranking/me":
            return opts.ranking === "fail" ? json(500, { message: "erro" }) : json(200, ME);
          case "/graduations/students/11":
            return opts.graduations === "fail" ? json(500, { message: "erro" }) : json(200, [{ id: 1, graduatedAt: "2026-01-01", notes: null, graduationLevel: LEVEL }]);
          case "/graduations/hierarchy":
            return json(200, {
              group: { id: 1, name: "G", logoUrl: null },
              system: null,
              levels: [1, 2, 3].map((n) => ({ id: n, name: n === 2 ? "Corda Verde" : `Corda ${n}`, order: n, color: "#22C55E", count: 1, isMine: n === 2, students: [] })),
              me: null,
              higherCount: 0,
              totalStudents: 3,
            });
          case "/passport/me":
            return opts.passport === "fail" ? json(500, { message: "erro" }) : json(200, passport(opts.minor === true));
          case "/sponsors/active":
            return sponsorsReply();
          case "/sponsors/12/impression":
            return new Response(null, { status: 204 });
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
    for (let i = 0; i < 4; i++) await settle();
  }
  const sponsorCalls = () => paths.filter((p) => p.includes("/sponsors/active"));

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    stubReducedMotion(true); // sem autoplay: só a composição e a navegação manual
    sponsorsReply = () => json(200, { items: [ITEM] });
    saveSession("t", { id: 1, name: "Camila Souza", email: "c@x.com", userType: "MEMBER", isSuperAdmin: false, organizationId: 1, organizationSlug: "g", role: "ALUNO" });
  });

  it("com patrocinador: entra na 3ª posição (comunidade, ranking, PATROCINADO, jornada, check-in) e pede /sponsors/active?studentId=11", async () => {
    mockApi();
    await mount();
    expect(keys()).toEqual(["comunidade", "ranking", SPONSOR_SLIDE_KEY, "jornada", "checkin"]);
    expect(sponsorCalls()).toEqual(["GET /sponsors/active?studentId=11"]);
    // os demais slides e links intactos
    const hrefs = $$<HTMLAnchorElement>(".hero-slide a").map((a) => a.getAttribute("href"));
    expect(hrefs[0]).toBe("/comunidade");
    expect(hrefs[1]).toBe("/ranking");
    expect(hrefs[2]!.endsWith("/api/sponsors/12/click?s=GO")).toBe(true);
    expect(hrefs.slice(3)).toEqual(["/jornada", "/checkin"]);
    expect($(`[data-testid="hero-slide-${SPONSOR_SLIDE_KEY}"] [data-testid="hero-sponsor-badge"]`)!.textContent).toBe("Patrocinado");
  });

  it("com menos de 3 slides (ranking e jornada falham): vai para o FIM, nunca em 1º", async () => {
    mockApi({ ranking: "fail", graduations: "fail" });
    await mount();
    expect(keys()).toEqual(["comunidade", "checkin", SPONSOR_SLIDE_KEY]);
    expect(keys()[0]).not.toBe(SPONSOR_SLIDE_KEY);
  });

  it("nunca em 1º mesmo que o patrocinador chegue antes dos outros dados", async () => {
    mockApi();
    await mount();
    expect(keys()[0]).toBe("comunidade");
    expect(activeKey()).toBe("comunidade");
  });

  it("sem patrocinador (resposta vazia): carrossel IDÊNTICO ao de hoje e nenhuma mensagem", async () => {
    sponsorsReply = () => json(200, { items: [] });
    mockApi();
    await mount();
    expect(keys()).toEqual(["comunidade", "ranking", "jornada", "checkin"]);
    expect(dots()).toHaveLength(4);
    expect($(".hero-sponsor")).toBeNull();
    expect(document.body.textContent).not.toMatch(/patrocin|erro|falha|não foi possível/i);
  });

  it.each([
    ["erro 500", () => json(500, { message: "erro" })],
    ["404 (backend antigo)", () => json(404, { message: "sem rota" })],
    ["corpo torto", () => json(200, { items: [{ id: "x" }] })],
    ["clique fora do contrato", () => json(200, { items: [{ ...ITEM, clickPath: "https://loja.example.com" }] })],
    ["sem items", () => json(200, {})],
  ])("%s: carrossel idêntico ao atual e sem mensagem", async (_name, reply) => {
    sponsorsReply = reply;
    mockApi();
    await mount();
    expect(keys()).toEqual(["comunidade", "ranking", "jornada", "checkin"]);
    expect(sponsorCalls()).toHaveLength(1); // sem retry
    expect(document.body.textContent).not.toMatch(/patrocin|erro|falha|não foi possível/i);
  });

  it("perfil MENOR (passaporte do aluno ativo): nenhuma chamada a /sponsors/active e nenhum slide", async () => {
    mockApi({ minor: true });
    await mount();
    expect(sponsorCalls()).toEqual([]);
    expect(keys()).toEqual(["comunidade", "ranking", "jornada", "checkin"]);
  });

  it("sem sessão: não há requisição a /sponsors/active", async () => {
    localStorage.clear(); // sem usuário guardado
    mockApi();
    await mount();
    expect(sponsorCalls()).toEqual([]);
    expect(keys()).not.toContain(SPONSOR_SLIDE_KEY);
  });

  it("passaporte indisponível (erro): o app não sabe -> pergunta ao servidor, que decide (menor = vazio)", async () => {
    mockApi({ passport: "fail" });
    await mount();
    expect(sponsorCalls()).toHaveLength(1);
    expect(keys()).toContain(SPONSOR_SLIDE_KEY);
  });

  it("impressão pelo componente real: 1 s no slide -> 1 POST; sair e voltar não repete; remontar na mesma sessão não repete", async () => {
    mockApi();
    await mount();
    vi.useFakeTimers();
    act(() => dots()[2]!.click());
    await advanceAsync(SPONSOR_IMPRESSION_DELAY_MS - 1);
    expect(posts).toEqual([]);
    await advanceAsync(1);
    expect(posts).toEqual(["/sponsors/12/impression"]);
    act(() => dots()[3]!.click());
    act(() => dots()[2]!.click());
    await advanceAsync(5000);
    expect(posts).toEqual(["/sponsors/12/impression"]); // 1x por campanha por sessão
    expect(sessionStorage.length).toBe(1);

    // "recarregar" o banner na mesma sessão do navegador (sessionStorage mantido)
    vi.useRealTimers();
    act(() => root?.unmount());
    container?.remove();
    await mount();
    vi.useFakeTimers();
    act(() => dots()[2]!.click());
    await advanceAsync(3000);
    expect(posts).toEqual(["/sponsors/12/impression"]);
  });

  it("trocar de slide antes de 1 s: nenhum POST", async () => {
    mockApi();
    await mount();
    vi.useFakeTimers();
    act(() => dots()[2]!.click());
    await advanceAsync(800);
    act(() => dots()[0]!.click());
    await advanceAsync(10_000);
    expect(posts).toEqual([]);
    expect(sessionStorage.length).toBe(0);
  });

  it("o botão do banner aponta para o redirecionador do servidor (o app não conhece a URL do patrocinador)", async () => {
    mockApi();
    await mount();
    const link = $<HTMLAnchorElement>(`[data-testid="hero-slide-${SPONSOR_SLIDE_KEY}"] a`)!;
    const url = new URL(link.href);
    expect(url.pathname + url.search).toBe("/api/sponsors/12/click?s=GO");
    expect(link.target).toBe("_blank");
    expect(link.rel).toBe("sponsored noopener noreferrer");
    expect(JSON.stringify(paths)).not.toMatch(/loja\.example/);
  });
});

describe("insertSponsorSlide (posição)", () => {
  const p = (key: string): HeroSlideSpec => ({ key, tone: "community", eyebrowIcon: null, eyebrow: key, title: key, text: key, cta: { to: `/${key}`, label: key } });
  const order = (n: number) => insertSponsorSlide(Array.from({ length: n }, (_, i) => p(`s${i}`)), buildSponsorSlide(ITEM)).map((s) => s.key);

  it("3ª posição; no fim com menos de 3; nunca em 1º (com ao menos 1 slide)", () => {
    expect(order(4)).toEqual(["s0", "s1", SPONSOR_SLIDE_KEY, "s2", "s3"]);
    expect(order(3)).toEqual(["s0", "s1", SPONSOR_SLIDE_KEY, "s2"]);
    expect(order(2)).toEqual(["s0", "s1", SPONSOR_SLIDE_KEY]);
    expect(order(1)).toEqual(["s0", SPONSOR_SLIDE_KEY]);
  });

  it("sem slide patrocinado a lista não muda", () => {
    const list = [p("a"), p("b"), p("c")];
    expect(insertSponsorSlide(list, null).map((s) => s.key)).toEqual(["a", "b", "c"]);
  });
});

describe("autoplay continua o mesmo com o slide patrocinado", () => {
  it("avança a cada 5,5 s passando pelo patrocinado e volta ao primeiro", () => {
    vi.useFakeTimers();
    stubReducedMotion(false);
    const p = (key: string): HeroSlideSpec => ({ key, tone: "community", eyebrowIcon: null, eyebrow: key, title: key, text: key, cta: { to: `/${key}`, label: key } });
    render(<HeroCarouselView slides={[p("a"), p("b"), buildSponsorSlide(ITEM)!, p("c")]} />);
    const order: (string | undefined)[] = [activeKey()];
    for (let i = 0; i < 4; i++) {
      advance(HERO_INTERVAL_MS);
      order.push(activeKey());
    }
    expect(order).toEqual(["a", "b", SPONSOR_SLIDE_KEY, "c", "a"]);
  });
});
