import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HeroCarousel, HeroCarouselView, HERO_INTERVAL_MS, type HeroSlideSpec } from "@/components/gingapp/hero-carousel";
import { SPONSOR_GROUP_SLIDE_KEY, SPONSOR_SLIDE_KEY, buildSponsorSlide, insertSponsorSlides } from "@/components/gingapp/hero-sponsor";
import {
  SPONSOR_IMPRESSION_DELAY_MS,
  isViewerMinor,
  parseSponsorSlide,
  pickSponsorSlides,
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
  scope: "PLATFORM",
  groupName: null,
};
/** Item do GRUPO (contrato de grupo, secao 2). */
const GROUP_ITEM: SponsorSlide = {
  id: 31,
  sponsorName: "Padaria do Mestre",
  logoUrl: "/api/uploads/logo-31.webp",
  imageUrl: "/api/uploads/banner-31.webp",
  title: "Pão de queijo da roda",
  text: "Desconto para quem treina no grupo.",
  ctaLabel: "Ver cardápio",
  clickPath: "/api/sponsors/31/click?s=GO",
  state: "GO",
  scope: "GROUP",
  groupName: "Capoeira Axé",
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
  it("pickSponsorSlides: lê { items: [1 item] }; vazio, sem items ou lixo = []", () => {
    expect(pickSponsorSlides({ items: [ITEM] })).toEqual([ITEM]);
    expect(pickSponsorSlides({ items: [] })).toEqual([]);
    expect(pickSponsorSlides({})).toEqual([]);
    expect(pickSponsorSlides(null)).toEqual([]);
    expect(pickSponsorSlides(undefined)).toEqual([]);
    expect(pickSponsorSlides({ items: "x" })).toEqual([]);
    expect(pickSponsorSlides({ items: [null, 5, { id: "x" }] })).toEqual([]);
  });

  it("pickSponsorSlides: 2 itens (grupo + plataforma) saem com o do GRUPO primeiro, mesmo vindo na ordem inversa", () => {
    expect(pickSponsorSlides({ items: [GROUP_ITEM, ITEM] })).toEqual([GROUP_ITEM, ITEM]);
    expect(pickSponsorSlides({ items: [ITEM, GROUP_ITEM] })).toEqual([GROUP_ITEM, ITEM]);
  });

  it("pickSponsorSlides: no máximo 1 por escopo (duplicados descartados; vale o primeiro válido)", () => {
    const outroGrupo: SponsorSlide = { ...GROUP_ITEM, id: 32, title: "Outro do grupo" };
    const outraPlataforma: SponsorSlide = { ...ITEM, id: 13, title: "Outro da plataforma" };
    expect(pickSponsorSlides({ items: [ITEM, outraPlataforma, GROUP_ITEM, outroGrupo] })).toEqual([GROUP_ITEM, ITEM]);
    // o inválido não "consome" a vaga do escopo
    expect(pickSponsorSlides({ items: [{ ...GROUP_ITEM, clickPath: "https://x.com" }, outroGrupo] })).toEqual([outroGrupo]);
  });

  it("pickSponsorSlides: resposta antiga (sem scope/groupName) = PLATAFORMA com groupName null", () => {
    const old: Record<string, unknown> = { ...ITEM };
    delete old["scope"];
    delete old["groupName"];
    const [only] = pickSponsorSlides({ items: [old] });
    expect(only).toEqual({ ...old, scope: "PLATFORM", groupName: null });
  });

  it("pickSponsorSlides: item inválido é descartado em silêncio e o outro escopo segue valendo", () => {
    expect(pickSponsorSlides({ items: [{ ...GROUP_ITEM, id: "x" }, ITEM] })).toEqual([ITEM]);
    expect(pickSponsorSlides({ items: [GROUP_ITEM, { ...ITEM, clickPath: "//evil.example.com/api/sponsors/12/click" }] })).toEqual([GROUP_ITEM]);
    expect(pickSponsorSlides({ items: [GROUP_ITEM, { ...ITEM, scope: "OUTRO" }] })).toEqual([GROUP_ITEM]); // escopo desconhecido = fora do contrato
  });

  it("parseSponsorSlide: groupName só vale no escopo GRUPO (trim; vazio/ausente = null); na PLATAFORMA é sempre null", () => {
    expect(parseSponsorSlide({ ...GROUP_ITEM, groupName: "  Capoeira Axé  " })!.groupName).toBe("Capoeira Axé");
    expect(parseSponsorSlide({ ...GROUP_ITEM, groupName: "  " })!.groupName).toBeNull();
    expect(parseSponsorSlide({ ...GROUP_ITEM, groupName: undefined })!.groupName).toBeNull();
    expect(parseSponsorSlide({ ...ITEM, groupName: "Capoeira Axé" })!.groupName).toBeNull();
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
  let seen: { data: SponsorSlide[] | undefined; isError: boolean } = { data: undefined, isError: false };

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
    expect(seen.data).toEqual([ITEM]);
  });

  it("devolve a lista com grupo + plataforma (grupo primeiro)", async () => {
    reply = () => new Response(JSON.stringify({ items: [GROUP_ITEM, ITEM] }), { status: 200 });
    await mount(11, true);
    expect(seen.data).toEqual([GROUP_ITEM, ITEM]);
  });

  it("sem aluno a rota vai sem studentId; resposta vazia = [] (sem erro)", async () => {
    reply = () => new Response(JSON.stringify({ items: [] }), { status: 200 });
    await mount(undefined, true);
    expect(paths).toEqual(["/api/sponsors/active"]);
    expect(seen.data).toEqual([]);
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

  it("slide da PLATAFORMA não tem faixa de parceiro; o selo é 'Patrocinado' e a folha usa o texto da plataforma", () => {
    render(<HeroCarouselView slides={SLIDES()} onSponsorSeen={seenSpy} />);
    expect($(`[data-testid="hero-slide-${SPONSOR_SLIDE_KEY}"] [data-testid="hero-sponsor-partner"]`)).toBeNull();
    expect($('[data-testid="hero-sponsor-partner"]')).toBeNull();
  });

  describe("com os dois (grupo + plataforma)", () => {
    const BOTH = (): HeroSlideSpec[] => [
      plain("a", "/comunidade"),
      plain("b", "/ranking"),
      buildSponsorSlide(GROUP_ITEM)!,
      plain("c", "/jornada"),
      buildSponsorSlide(ITEM)!,
      plain("d", "/checkin"),
    ];
    const slideOf = (key: string) => $(`[data-testid="hero-slide-${key}"]`)!;
    const dotOf = (key: string) => dots()[keys().indexOf(key)]!;

    it("chaves fixas por escopo; o selo é o mesmo 'Patrocinado' nos dois", () => {
      render(<HeroCarouselView slides={BOTH()} onSponsorSeen={seenSpy} />);
      expect(keys()).toEqual(["a", "b", SPONSOR_GROUP_SLIDE_KEY, "c", SPONSOR_SLIDE_KEY, "d"]);
      expect(SPONSOR_GROUP_SLIDE_KEY).toBe("patrocinado-grupo");
      expect(SPONSOR_SLIDE_KEY).toBe("patrocinado");
      for (const key of [SPONSOR_GROUP_SLIDE_KEY, SPONSOR_SLIDE_KEY]) {
        expect(slideOf(key).querySelector('[data-testid="hero-sponsor-badge"]')!.textContent).toBe("Patrocinado");
        expect(slideOf(key).className).toContain("hero-sponsor");
      }
      expect(slideOf(SPONSOR_GROUP_SLIDE_KEY).querySelector(".hero-sponsor-name")!.textContent).toBe("Padaria do Mestre");
      expect(slideOf(SPONSOR_SLIDE_KEY).querySelector(".hero-sponsor-name")!.textContent).toBe("Loja do Berimbau");
    });

    it("faixa 'Parceiro do grupo <nome>' SÓ no slide do grupo; sem nome = 'Parceiro do seu grupo'", () => {
      render(<HeroCarouselView slides={BOTH()} onSponsorSeen={seenSpy} />);
      expect(slideOf(SPONSOR_GROUP_SLIDE_KEY).querySelector('[data-testid="hero-sponsor-partner"]')!.textContent).toBe("Parceiro do grupo Capoeira Axé");
      expect(slideOf(SPONSOR_SLIDE_KEY).querySelector('[data-testid="hero-sponsor-partner"]')).toBeNull();
      expect($$('[data-testid="hero-sponsor-partner"]')).toHaveLength(1);
      act(() => root?.unmount());
      container?.remove();
      render(<HeroCarouselView slides={[plain("a", "/a"), plain("b", "/b"), buildSponsorSlide({ ...GROUP_ITEM, groupName: null })!]} onSponsorSeen={seenSpy} />);
      expect($('[data-testid="hero-sponsor-partner"]')!.textContent).toBe("Parceiro do seu grupo");
    });

    it("indicadores acessíveis 'Patrocinado: <título>' para cada um", () => {
      render(<HeroCarouselView slides={BOTH()} onSponsorSeen={seenSpy} />);
      expect(dots().map((d) => d.getAttribute("aria-label"))).toEqual([
        "Ir para o slide 1 de 6",
        "Ir para o slide 2 de 6",
        "Patrocinado: Pão de queijo da roda",
        "Ir para o slide 4 de 6",
        "Patrocinado: Berimbaus artesanais",
        "Ir para o slide 6 de 6",
      ]);
    });

    it("folha 'Por que vejo isso?' do GRUPO tem o texto do grupo (sem a frase da plataforma)", () => {
      render(<HeroCarouselView slides={BOTH()} onSponsorSeen={seenSpy} />);
      act(() => dotOf(SPONSOR_GROUP_SLIDE_KEY).click());
      act(() => slideOf(SPONSOR_GROUP_SLIDE_KEY).querySelector<HTMLButtonElement>(".hero-sponsor-why")!.click());
      const text = $('[role="dialog"]')!.textContent!;
      expect(text).toContain("Este anúncio é de Padaria do Mestre, parceiro do seu grupo, e não usa seus dados pessoais.");
      expect(text).not.toContain("O GingApp é gratuito");
    });

    it("folha 'Por que vejo isso?' da PLATAFORMA mantém o texto atual (depois de fechar a do grupo)", () => {
      render(<HeroCarouselView slides={BOTH()} onSponsorSeen={seenSpy} />);
      act(() => dotOf(SPONSOR_GROUP_SLIDE_KEY).click());
      act(() => slideOf(SPONSOR_GROUP_SLIDE_KEY).querySelector<HTMLButtonElement>(".hero-sponsor-why")!.click());
      act(() => void document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      advance(500);
      expect($('[role="dialog"]')).toBeNull();
      act(() => dotOf(SPONSOR_SLIDE_KEY).click());
      act(() => slideOf(SPONSOR_SLIDE_KEY).querySelector<HTMLButtonElement>(".hero-sponsor-why")!.click());
      const text = $('[role="dialog"]')!.textContent!;
      expect(text).toContain("O GingApp é gratuito e se mantém com o apoio de parceiros. Este anúncio é de Loja do Berimbau e não usa seus dados pessoais.");
      expect(text).not.toContain("parceiro do seu grupo");
    });

    it("impressão: cada slide conta a sua (grupo 31, plataforma 12), 1 vez cada, após 1 s visível", () => {
      render(<HeroCarouselView slides={BOTH()} onSponsorSeen={seenSpy} />);
      act(() => dotOf(SPONSOR_GROUP_SLIDE_KEY).click());
      advance(SPONSOR_IMPRESSION_DELAY_MS - 1);
      expect(seenSpy).not.toHaveBeenCalled();
      advance(1);
      expect(seenSpy.mock.calls).toEqual([[31]]);
      act(() => dotOf(SPONSOR_SLIDE_KEY).click());
      advance(SPONSOR_IMPRESSION_DELAY_MS - 1);
      expect(seenSpy.mock.calls).toEqual([[31]]);
      advance(1);
      expect(seenSpy.mock.calls).toEqual([[31], [12]]);
      advance(2000); // ficar no mesmo slide não repete
      expect(seenSpy).toHaveBeenCalledTimes(2);
    });

    it("sair do slide patrocinado antes de 1 s cancela só a impressão dele (também entre os dois patrocinados colados)", () => {
      render(<HeroCarouselView slides={[plain("a", "/a"), plain("b", "/b"), buildSponsorSlide(GROUP_ITEM)!, buildSponsorSlide(ITEM)!]} onSponsorSeen={seenSpy} />);
      act(() => dotOf(SPONSOR_GROUP_SLIDE_KEY).click());
      advance(900);
      act(() => dotOf(SPONSOR_SLIDE_KEY).click()); // colado: sair do grupo cancela o do grupo
      advance(900);
      act(() => dotOf("a").click()); // e sair da plataforma antes de 1 s cancela a dela
      advance(10_000);
      expect(seenSpy).not.toHaveBeenCalled();
    });

    it("autoplay passa pelos dois patrocinados e volta ao primeiro", () => {
      render(<HeroCarouselView slides={BOTH()} onSponsorSeen={seenSpy} />);
      const order: (string | undefined)[] = [activeKey()];
      for (let i = 0; i < 6; i++) {
        advance(HERO_INTERVAL_MS);
        order.push(activeKey());
      }
      expect(order).toEqual(["a", "b", SPONSOR_GROUP_SLIDE_KEY, "c", SPONSOR_SLIDE_KEY, "d", "a"]);
    });
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
          case "/sponsors/31/impression":
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

  it("só plataforma: entra na 5ª posição (no fim com 4 slides comuns) e pede /sponsors/active?studentId=11", async () => {
    mockApi();
    await mount();
    expect(keys()).toEqual(["comunidade", "ranking", "jornada", "checkin", SPONSOR_SLIDE_KEY]);
    expect(sponsorCalls()).toEqual(["GET /sponsors/active?studentId=11"]);
    // os demais slides e links intactos
    const hrefs = $$<HTMLAnchorElement>(".hero-slide a").map((a) => a.getAttribute("href"));
    expect(hrefs.slice(0, 4)).toEqual(["/comunidade", "/ranking", "/jornada", "/checkin"]);
    expect(hrefs[4]!.endsWith("/api/sponsors/12/click?s=GO")).toBe(true);
    expect($(`[data-testid="hero-slide-${SPONSOR_SLIDE_KEY}"] [data-testid="hero-sponsor-badge"]`)!.textContent).toBe("Patrocinado");
    expect($('[data-testid="hero-sponsor-partner"]')).toBeNull();
  }, 30000);

  it("só grupo: 3ª posição (comunidade, ranking, GRUPO, jornada, check-in) com a faixa 'Parceiro do grupo Capoeira Axé'", async () => {
    sponsorsReply = () => json(200, { items: [GROUP_ITEM] });
    mockApi();
    await mount();
    expect(keys()).toEqual(["comunidade", "ranking", SPONSOR_GROUP_SLIDE_KEY, "jornada", "checkin"]);
    const hrefs = $$<HTMLAnchorElement>(".hero-slide a").map((a) => a.getAttribute("href"));
    expect(hrefs[2]!.endsWith("/api/sponsors/31/click?s=GO")).toBe(true);
    expect($(`[data-testid="hero-slide-${SPONSOR_GROUP_SLIDE_KEY}"] [data-testid="hero-sponsor-partner"]`)!.textContent).toBe("Parceiro do grupo Capoeira Axé");
    expect($(`[data-testid="hero-slide-${SPONSOR_GROUP_SLIDE_KEY}"] [data-testid="hero-sponsor-badge"]`)!.textContent).toBe("Patrocinado");
  }, 30000);

  it("os dois (grupo + plataforma): grupo na 3ª e plataforma na 5ª posição, sem ficarem colados, nunca em 1º", async () => {
    sponsorsReply = () => json(200, { items: [GROUP_ITEM, ITEM] });
    mockApi();
    await mount();
    expect(keys()).toEqual(["comunidade", "ranking", SPONSOR_GROUP_SLIDE_KEY, "jornada", SPONSOR_SLIDE_KEY, "checkin"]);
    expect(sponsorCalls()).toEqual(["GET /sponsors/active?studentId=11"]); // 1 só chamada para os dois
    expect(dots()).toHaveLength(6);
    expect($$('[data-testid="hero-sponsor-badge"]')).toHaveLength(2);
    expect($$('[data-testid="hero-sponsor-partner"]')).toHaveLength(1);
  }, 30000);

  it("os dois vindo em ordem inversa do servidor: o grupo continua na 3ª e a plataforma na 5ª", async () => {
    sponsorsReply = () => json(200, { items: [ITEM, GROUP_ITEM] });
    mockApi();
    await mount();
    expect(keys()).toEqual(["comunidade", "ranking", SPONSOR_GROUP_SLIDE_KEY, "jornada", SPONSOR_SLIDE_KEY, "checkin"]);
  }, 30000);

  it("resposta antiga do backend (sem scope/groupName) vira slide da PLATAFORMA, sem faixa de parceiro", async () => {
    const old: Record<string, unknown> = { ...ITEM };
    delete old["scope"];
    delete old["groupName"];
    sponsorsReply = () => json(200, { items: [old] });
    mockApi();
    await mount();
    expect(keys()).toEqual(["comunidade", "ranking", "jornada", "checkin", SPONSOR_SLIDE_KEY]);
    expect($('[data-testid="hero-sponsor-partner"]')).toBeNull();
  }, 30000);

  it("item inválido (clique fora do contrato) é descartado e o outro escopo aparece normalmente", async () => {
    sponsorsReply = () => json(200, { items: [{ ...GROUP_ITEM, clickPath: "https://loja.example.com" }, ITEM] });
    mockApi();
    await mount();
    expect(keys()).toEqual(["comunidade", "ranking", "jornada", "checkin", SPONSOR_SLIDE_KEY]);
  }, 30000);

  it("o outro caso de item inválido: plataforma com id torto é descartada e o grupo aparece", async () => {
    sponsorsReply = () => json(200, { items: [GROUP_ITEM, { ...ITEM, id: "x" }] });
    mockApi();
    await mount();
    expect(keys()).toEqual(["comunidade", "ranking", SPONSOR_GROUP_SLIDE_KEY, "jornada", "checkin"]);
  }, 30000);

  it("com poucos slides (ranking e jornada falham): grupo vai ao fim, nunca em 1º", async () => {
    sponsorsReply = () => json(200, { items: [GROUP_ITEM] });
    mockApi({ ranking: "fail", graduations: "fail" });
    await mount();
    expect(keys()).toEqual(["comunidade", "checkin", SPONSOR_GROUP_SLIDE_KEY]);
  }, 30000);

  it("com poucos slides (ranking e jornada falham) e os dois patrocinados: nunca em 1º e sem colar quando há como", async () => {
    sponsorsReply = () => json(200, { items: [GROUP_ITEM, ITEM] });
    mockApi({ ranking: "fail", graduations: "fail" });
    await mount();
    // base [comunidade, checkin] -> grupo no fim; a plataforma vai para entre os comuns para não colar no grupo
    expect(keys()).toEqual(["comunidade", SPONSOR_SLIDE_KEY, "checkin", SPONSOR_GROUP_SLIDE_KEY]);
    expect(keys()[0]).toBe("comunidade");
  }, 30000);

  it("com menos de 5 slides (ranking e jornada falham): plataforma vai para o FIM, nunca em 1º", async () => {
    mockApi({ ranking: "fail", graduations: "fail" });
    await mount();
    expect(keys()).toEqual(["comunidade", "checkin", SPONSOR_SLIDE_KEY]);
    expect(keys()[0]).not.toBe(SPONSOR_SLIDE_KEY);
  }, 30000);

  it("chave estável: o slide do grupo não 'pula' quando a campanha do grupo muda (id/título novos, mesma chave)", async () => {
    sponsorsReply = () => json(200, { items: [GROUP_ITEM, ITEM] });
    mockApi();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <HeroCarousel />
      </QueryClientProvider>,
    );
    for (let i = 0; i < 4; i++) await settle();
    act(() => dots()[keys().indexOf(SPONSOR_GROUP_SLIDE_KEY)]!.click());
    expect(activeKey()).toBe(SPONSOR_GROUP_SLIDE_KEY);
    expect($(`[data-testid="hero-slide-${SPONSOR_GROUP_SLIDE_KEY}"] h2`)!.textContent).toBe("Pão de queijo da roda");
    // a campanha do grupo troca (o servidor sorteou outra) e o cache é atualizado
    sponsorsReply = () => json(200, { items: [{ ...GROUP_ITEM, id: 32, title: "Café da roda", clickPath: "/api/sponsors/32/click?s=GO" }, ITEM] });
    await act(async () => void (await queryClient.invalidateQueries({ queryKey: ["sponsors", "active"] })));
    await settle();
    expect(keys()).toEqual(["comunidade", "ranking", SPONSOR_GROUP_SLIDE_KEY, "jornada", SPONSOR_SLIDE_KEY, "checkin"]);
    expect($(`[data-testid="hero-slide-${SPONSOR_GROUP_SLIDE_KEY}"] h2`)!.textContent).toBe("Café da roda");
    expect(activeKey()).toBe(SPONSOR_GROUP_SLIDE_KEY); // o aluno continua no mesmo slide
  }, 30000);

  it("grupo + plataforma: cada slide conta a PRÓPRIA impressão, 1x por campanha por sessão", async () => {
    sponsorsReply = () => json(200, { items: [GROUP_ITEM, ITEM] });
    mockApi();
    await mount();
    vi.useFakeTimers();
    const dotOf = (key: string) => dots()[keys().indexOf(key)]!;
    act(() => dotOf(SPONSOR_GROUP_SLIDE_KEY).click());
    await advanceAsync(SPONSOR_IMPRESSION_DELAY_MS - 1);
    expect(posts).toEqual([]);
    await advanceAsync(1);
    expect(posts).toEqual(["/sponsors/31/impression"]);
    act(() => dotOf(SPONSOR_SLIDE_KEY).click());
    await advanceAsync(SPONSOR_IMPRESSION_DELAY_MS);
    expect(posts).toEqual(["/sponsors/31/impression", "/sponsors/12/impression"]);
    // sair e voltar nos dois: nada repete
    act(() => dotOf(SPONSOR_GROUP_SLIDE_KEY).click());
    await advanceAsync(3000);
    act(() => dotOf(SPONSOR_SLIDE_KEY).click());
    await advanceAsync(3000);
    expect(posts).toEqual(["/sponsors/31/impression", "/sponsors/12/impression"]);
    expect(sessionStorage.length).toBe(2);
  }, 30000);

  it("grupo + plataforma: sair de um deles antes de 1 s não gera POST", async () => {
    sponsorsReply = () => json(200, { items: [GROUP_ITEM, ITEM] });
    mockApi();
    await mount();
    vi.useFakeTimers();
    const dotOf = (key: string) => dots()[keys().indexOf(key)]!;
    act(() => dotOf(SPONSOR_GROUP_SLIDE_KEY).click());
    await advanceAsync(800);
    act(() => dotOf(SPONSOR_SLIDE_KEY).click());
    await advanceAsync(800);
    act(() => dotOf("comunidade").click());
    await advanceAsync(10_000);
    expect(posts).toEqual([]);
    expect(sessionStorage.length).toBe(0);
  }, 30000);

  it("perfil MENOR com grupo + plataforma no servidor: nenhuma chamada a /sponsors/active e nenhum slide patrocinado", async () => {
    sponsorsReply = () => json(200, { items: [GROUP_ITEM, ITEM] });
    mockApi({ minor: true });
    await mount();
    expect(sponsorCalls()).toEqual([]);
    expect(keys()).toEqual(["comunidade", "ranking", "jornada", "checkin"]);
  }, 30000);

  it("erro do servidor com grupo+plataforma esperados: carrossel idêntico ao atual", async () => {
    sponsorsReply = () => json(500, { message: "erro" });
    mockApi();
    await mount();
    expect(keys()).toEqual(["comunidade", "ranking", "jornada", "checkin"]);
    expect($(".hero-sponsor")).toBeNull();
  }, 30000);

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
    act(() => dots()[4]!.click()); // plataforma sozinha = 5ª posição
    await advanceAsync(SPONSOR_IMPRESSION_DELAY_MS - 1);
    expect(posts).toEqual([]);
    await advanceAsync(1);
    expect(posts).toEqual(["/sponsors/12/impression"]);
    act(() => dots()[3]!.click());
    act(() => dots()[4]!.click());
    await advanceAsync(5000);
    expect(posts).toEqual(["/sponsors/12/impression"]); // 1x por campanha por sessão
    expect(sessionStorage.length).toBe(1);

    // "recarregar" o banner na mesma sessão do navegador (sessionStorage mantido)
    vi.useRealTimers();
    act(() => root?.unmount());
    container?.remove();
    await mount();
    vi.useFakeTimers();
    act(() => dots()[4]!.click());
    await advanceAsync(3000);
    expect(posts).toEqual(["/sponsors/12/impression"]);
  }, 30000);

  it("trocar de slide antes de 1 s: nenhum POST", async () => {
    mockApi();
    await mount();
    vi.useFakeTimers();
    act(() => dots()[4]!.click());
    await advanceAsync(800);
    act(() => dots()[0]!.click());
    await advanceAsync(10_000);
    expect(posts).toEqual([]);
    expect(sessionStorage.length).toBe(0);
  }, 30000);

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

describe("insertSponsorSlides (posição)", () => {
  const p = (key: string): HeroSlideSpec => ({ key, tone: "community", eyebrowIcon: null, eyebrow: key, title: key, text: key, cta: { to: `/${key}`, label: key } });
  const base = (n: number) => Array.from({ length: n }, (_, i) => p(`s${i}`));
  const G = SPONSOR_GROUP_SLIDE_KEY;
  const P = SPONSOR_SLIDE_KEY;
  const only = (n: number, which: "group" | "platform") =>
    insertSponsorSlides(base(n), which === "group" ? { group: buildSponsorSlide(GROUP_ITEM) } : { platform: buildSponsorSlide(ITEM) }).map((s) => s.key);
  const both = (n: number) => insertSponsorSlides(base(n), { group: buildSponsorSlide(GROUP_ITEM), platform: buildSponsorSlide(ITEM) }).map((s) => s.key);

  it("só GRUPO: 3ª posição; no fim com menos de 3 slides; nunca em 1º", () => {
    expect(only(4, "group")).toEqual(["s0", "s1", G, "s2", "s3"]);
    expect(only(3, "group")).toEqual(["s0", "s1", G, "s2"]);
    expect(only(2, "group")).toEqual(["s0", "s1", G]);
    expect(only(1, "group")).toEqual(["s0", G]);
  });

  it("só PLATAFORMA: 5ª posição; no fim com menos de 5 slides; nunca em 1º", () => {
    expect(only(6, "platform")).toEqual(["s0", "s1", "s2", "s3", P, "s4", "s5"]);
    expect(only(5, "platform")).toEqual(["s0", "s1", "s2", "s3", P, "s4"]);
    expect(only(4, "platform")).toEqual(["s0", "s1", "s2", "s3", P]);
    expect(only(2, "platform")).toEqual(["s0", "s1", P]);
    expect(only(1, "platform")).toEqual(["s0", P]);
  });

  it("os DOIS: grupo na 3ª e plataforma na 5ª (contando o do grupo), sem colar", () => {
    expect(both(4)).toEqual(["s0", "s1", G, "s2", P, "s3"]); // o caso real do app (comunidade, ranking, jornada, check-in)
    expect(both(5)).toEqual(["s0", "s1", G, "s2", P, "s3", "s4"]);
    expect(both(3)).toEqual(["s0", "s1", G, "s2", P]);
  });

  it("poucos slides: nunca em 1º; evita dois patrocinados colados quando há como; senão fica colado", () => {
    expect(both(2)).toEqual(["s0", P, "s1", G]); // evitou colar
    expect(both(1)).toEqual(["s0", G, P]); // sem como evitar
    for (let n = 1; n <= 8; n++) {
      const order = both(n);
      expect(order[0]).toBe("s0"); // nunca um patrocinado em 1º
      expect(order).toHaveLength(n + 2);
      expect(order).toContain(G);
      expect(order).toContain(P);
    }
  });

  it("sem slide patrocinado (null/ausente) a lista não muda", () => {
    expect(insertSponsorSlides([p("a"), p("b"), p("c")], { group: null, platform: null }).map((s) => s.key)).toEqual(["a", "b", "c"]);
    expect(insertSponsorSlides([p("a"), p("b"), p("c")], {}).map((s) => s.key)).toEqual(["a", "b", "c"]);
  });

  it("buildSponsorSlide: chave fixa por escopo (não muda com a campanha) e faixa só no grupo", () => {
    expect(buildSponsorSlide(GROUP_ITEM)!.key).toBe("patrocinado-grupo");
    expect(buildSponsorSlide({ ...GROUP_ITEM, id: 99, title: "Outra" })!.key).toBe("patrocinado-grupo");
    expect(buildSponsorSlide(ITEM)!.key).toBe("patrocinado");
    expect(buildSponsorSlide({ ...ITEM, id: 98 })!.key).toBe("patrocinado");
    expect(buildSponsorSlide(GROUP_ITEM)!.sponsor).toMatchObject({ scope: "GROUP", partnerLabel: "Parceiro do grupo Capoeira Axé" });
    expect(buildSponsorSlide({ ...GROUP_ITEM, groupName: null })!.sponsor!.partnerLabel).toBe("Parceiro do seu grupo");
    expect(buildSponsorSlide(ITEM)!.sponsor).toMatchObject({ scope: "PLATFORM", partnerLabel: null });
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
