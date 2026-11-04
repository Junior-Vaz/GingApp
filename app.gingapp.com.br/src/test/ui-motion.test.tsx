import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CountUp } from "@/components/gingapp/count-up";
import { resetCountUpMemory } from "@/lib/use-count-up";

/**
 * Fundo branco, margem lateral única (--page-gutter) e movimento (animações só de transform/opacity, desligadas por
 * prefers-reduced-motion). Os testes de CSS leem o styles.css de verdade.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = resolve(__dirname, "..");
const css = readFileSync(resolve(SRC, "styles.css"), "utf8");
const MOTION_MARKER = "/* ---------- Movimento e fluidez";
const motion = css.slice(css.indexOf(MOTION_MARKER));
const KEYFRAMES = /@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g;
const COMMENTS = /\/\*[\s\S]*?\*\//g;
const motionOutsideKeyframes = motion.replace(KEYFRAMES, "").replace(COMMENTS, "");

function bodiesOf(selector: string): string[] {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...css.matchAll(new RegExp(`(?:^|[}\\s;])${escaped}\\s*\\{([^}]*)\\}`, "g"))].map((match) => match[1]!);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === "test" ? [] : sourceFiles(full);
    return /\.(tsx?|css)$/.test(name) ? [full] : [];
  });
}

describe("fundo branco", () => {
  it("o :root define --background como branco puro (e o cartão segue branco)", () => {
    expect(css).toMatch(/:root\s*\{[^}]*--background:\s*oklch\(1 0 0\)/);
    expect(css).toMatch(/:root\s*\{[^}]*--card:\s*oklch\(1 0 0\)/);
    expect(css).not.toContain("oklch(.976 .003 150)");
  });

  it("PWA: theme-color, theme_color e background_color brancos (barra de status)", () => {
    const html = readFileSync(resolve(SRC, "../index.html"), "utf8");
    expect(html).toContain('<meta name="theme-color" content="#ffffff" />');
    const vite = readFileSync(resolve(SRC, "../vite.config.ts"), "utf8");
    expect(vite).toContain('theme_color: "#ffffff"');
    expect(vite).toContain('background_color: "#ffffff"');
  });

  it("não há modo escuro a quebrar: nenhum prefers-color-scheme no CSS", () => {
    expect(css).not.toContain("prefers-color-scheme");
  });
});

describe("margem lateral única (--page-gutter)", () => {
  it("12px no celular e 24px de 768px para cima", () => {
    expect(css).toMatch(/:root\s*\{[^}]*--page-gutter:\s*12px/);
    expect(css).toMatch(/@media\(min-width:768px\)\s*\{\s*:root\s*\{\s*--page-gutter:\s*24px/);
  });

  it("tudo acoplado ao padding lateral usa a variável e não sobrou 18/19/25/38px", () => {
    const coupled = [".main-content", ".topbar", ".student-bar", ".welcome-banner", ".grad-attached", ".pf-highlights"];
    const legacy = /(?:padding|margin|scroll-padding)[a-z-]*\s*:[^;}]*-?\b(?:18|19|25|38)px/;
    for (const selector of coupled) {
      const bodies = bodiesOf(selector);
      expect(bodies.length, selector).toBeGreaterThan(0);
      expect(bodies.some((body) => body.includes("var(--page-gutter)")), `${selector} usa --page-gutter`).toBe(true);
      for (const body of bodies) expect(body, `${selector}: ${body}`).not.toMatch(legacy);
    }
  });

  it("nenhuma margem/padding negativo de 18px no styles.css (sangrias usam a variável)", () => {
    expect(css).not.toMatch(/(?:margin|padding)[a-z-]*\s*:[^;}]*-18px/);
    expect(css).not.toMatch(/scroll-padding-inline\s*:\s*18px/);
  });

  it("nenhum componente sangra com valor fixo (-mx-[18px], px-[18px], ml-[-18px]...)", () => {
    const offenders = sourceFiles(SRC).filter((file) => /-m[xlr]-\[(?:18|19|25|38)px\]|\bpx-\[(?:18|38)px\]|\bm[xlr]-\[-(?:18|38)px\]/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("a faixa de stories, o feed e a prévia da Home sangram com a variável", () => {
    for (const file of ["components/gingapp/stories/stories-row.tsx", "components/gingapp/feed/feed-page.tsx", "components/gingapp/feed/home-feed-preview.tsx"]) {
      expect(readFileSync(resolve(SRC, file), "utf8"), file).toContain("max-md:-mx-[var(--page-gutter)]");
    }
  });
});

describe("movimento: só transform/opacity e desligado por prefers-reduced-motion", () => {
  it("easing da marca no :root e usado nas animações novas", () => {
    expect(css).toMatch(/:root\s*\{[^}]*--ease-out:\s*cubic-bezier\(\.22,1,\.36,1\)/);
    expect(motionOutsideKeyframes).toContain("var(--ease-out)");
  });

  it("os @keyframes novos mexem só em opacity e transform", () => {
    for (const name of ["page-rise", "stagger-rise", "bar-grow", "shimmer-slide"]) {
      const block = motion.match(new RegExp(`@keyframes ${name}\\s*\\{(?:[^{}]*\\{[^{}]*\\})*[^{}]*\\}`));
      expect(block, name).not.toBeNull();
      const props = [...block![0].matchAll(/([a-z-]+)\s*:/g)].map((match) => match[1]);
      expect(props.length, name).toBeGreaterThan(0);
      for (const prop of props) expect(["opacity", "transform"], `${name}: ${prop}`).toContain(prop);
    }
  });

  it("nada fica escondido fora dos keyframes (sem opacity:0, visibility:hidden, filtro, blur ou will-change)", () => {
    expect(motionOutsideKeyframes).not.toMatch(/opacity\s*:\s*0(?![.\d])/);
    expect(motionOutsideKeyframes).not.toMatch(/visibility\s*:\s*hidden/);
    expect(motionOutsideKeyframes).not.toMatch(/\bfilter\s*:|blur\(|will-change/);
  });

  it("entradas de página e de lista duram até 320 ms e a única animação infinita nova é o brilho do esqueleto", () => {
    const duration = (name: string) => Number(motionOutsideKeyframes.match(new RegExp(`animation:${name}\\s+([\\d.]+)s`))![1]);
    expect(duration("page-rise")).toBeLessThanOrEqual(0.32);
    expect(duration("stagger-rise")).toBeLessThanOrEqual(0.32);
    const infinite = [...motionOutsideKeyframes.matchAll(/([^{}]+)\{[^}]*\binfinite\b[^}]*\}/g)].map((match) => match[1]!.trim());
    expect(infinite).toEqual([".skeleton-shimmer::after"]);
  });

  it("a regra global desliga animation/transition e o bloco da seção repete as classes novas", () => {
    expect(css).toMatch(/@media\(prefers-reduced-motion:reduce\)\s*\{\s*\*,\*:before,\*:after\s*\{\s*animation:none!important;\s*transition:none!important;\s*scroll-behavior:auto!important;/);
    const start = motion.indexOf("@media(prefers-reduced-motion:reduce)");
    expect(start).toBeGreaterThan(-1);
    const block = motion.slice(start);
    for (const token of [".page-enter > *", ".stagger > *", ".progress-fill", ".skeleton-shimmer::after", ".bottom-nav a::before", '[class*="active:scale-"]:active']) {
      expect(block, token).toContain(token);
    }
    expect(block).toMatch(/animation:none!important/);
    expect(block).toMatch(/transition:none!important/);
    expect(block).toMatch(/scale:none!important/);
  });

  it("stagger: no máximo 8 itens com atraso (o 9º em diante entra sem atraso)", () => {
    const delays = [...motion.matchAll(/\.stagger > :nth-child\((\d+)\)\s*\{\s*animation-delay:/g)].map((match) => Number(match[1]));
    expect(delays).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(motion).not.toMatch(/\.stagger > :nth-child\(n\+9\)/);
  });

  it("scroll suave só para âncoras (não atrasa a rolagem das rotas) e overscroll contido nos carrosséis", () => {
    expect(motion).toContain("html:has(:target) { scroll-behavior:smooth; }");
    expect(css).not.toMatch(/(?:^|\n)html\s*\{[^}]*scroll-behavior:\s*smooth/);
    expect(motion).toMatch(/\.pf-highlights[^{]*\{\s*overscroll-behavior-x:contain/);
  });
});

describe("useCountUp / CountUp", () => {
  let container: HTMLDivElement;
  let root: Root;
  const realMatchMedia = window.matchMedia;
  const realIO = (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver;
  let observers: Array<{ fire: () => void }> = [];

  class FakeIntersectionObserver {
    private callback: (entries: Array<{ isIntersecting: boolean }>) => void;
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
      this.callback = callback;
      observers.push({ fire: () => this.callback([{ isIntersecting: true }]) });
    }
    observe() {}
    disconnect() {}
    unobserve() {}
  }

  const mount = (node: React.ReactNode) => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root.render(node));
  };
  const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
  const text = () => container.textContent ?? "";

  beforeEach(() => {
    resetCountUpMemory();
    observers = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    vi.useRealTimers();
    window.matchMedia = realMatchMedia;
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = realIO;
  });

  it("sem IntersectionObserver (jsdom) mostra o valor final direto, num único texto", () => {
    mount(<CountUp value={75} suffix="%" />);
    expect(text()).toBe("75%");
    expect(container.querySelector("[aria-hidden]")).toBeNull();
    expect(container.querySelector(".sr-only")).toBeNull();
  });

  it("com IntersectionObserver conta de 0 ao valor final ao aparecer na tela; leitor de tela lê só o final", () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIntersectionObserver;
    mount(<CountUp value={75} suffix="%" />);
    expect(container.querySelector(".sr-only")!.textContent).toBe("75%");
    expect(container.querySelector("[aria-hidden]")!.textContent).toBe("0%");
    advance(1000); // fora da tela: não começa
    expect(container.querySelector("[aria-hidden]")!.textContent).toBe("0%");
    act(() => observers[0]!.fire());
    advance(350);
    const middle = Number(container.querySelector("[aria-hidden]")!.textContent!.replace("%", ""));
    expect(middle).toBeGreaterThan(0);
    expect(middle).toBeLessThan(75);
    advance(600);
    expect(text()).toBe("75%");
    expect(container.querySelector("[aria-hidden]")).toBeNull();
    expect(container.querySelector(".sr-only")).toBeNull();
  });

  it("prefers-reduced-motion: valor final direto, sem animar", () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIntersectionObserver;
    window.matchMedia = ((query: string) => ({ matches: query.includes("reduce"), media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    mount(<CountUp value={42} />);
    expect(text()).toBe("42");
    expect(container.querySelector("[aria-hidden]")).toBeNull();
  });

  it("só na 1ª exibição: com o mesmo id, voltar à tela mostra o valor final direto", () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIntersectionObserver;
    mount(<CountUp id="stat-teste" value={10} />);
    act(() => observers[0]!.fire());
    advance(1000);
    expect(text()).toBe("10");
    act(() => root.unmount());
    container.remove();
    mount(<CountUp id="stat-teste" value={10} />);
    expect(text()).toBe("10");
    expect(container.querySelector("[aria-hidden]")).toBeNull();
  });

  it("valor 0 ou mudança depois da contagem: sem animação (pula direto)", () => {
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver = FakeIntersectionObserver;
    mount(<CountUp value={0} />);
    expect(text()).toBe("0");
    act(() => root.render(<CountUp value={8} />));
    expect(text()).toBe("8");
  });
});
