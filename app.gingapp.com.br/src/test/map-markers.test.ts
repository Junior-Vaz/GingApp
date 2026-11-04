import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MapPlace } from "@/lib/map";
import {
  PIN_ICON,
  PIN_SELECTED_SCALE,
  classicClusterIcon,
  createClusterElement,
  createPinElement,
  markerLabel,
  markerPhotoUrl,
  photoPinIcon,
  resetMarkerCaches,
} from "@/lib/map-markers";

/**
 * Marcador em formato de "pin de foto": quadrado de cantos arredondados com borda, foto/logo dentro e cauda triangular
 * cuja PONTA é a âncora. Cobre o pin HTML (AdvancedMarkerElement) e o ícone SVG do marcador clássico, com e sem foto,
 * selecionado e "Meu grupo". Estrutura/estilo apenas — os pixels do Google não são testados.
 */

const org = { id: 1, name: "Grupo Cordão de Ouro", slug: "cordao", logoUrl: null, description: null };
const LOGO = "https://cdn.test/logo.png";
const place = (type: MapPlace["type"], extra: Partial<MapPlace> = {}): MapPlace => ({
  id: `${type}:1`,
  type,
  title: "Local de teste",
  description: null,
  latitude: -23.55,
  longitude: -46.63,
  address: null,
  city: null,
  state: null,
  organization: org,
  isMine: false,
  startsAt: type === "EVENT" ? "2026-11-21T13:00:00.000Z" : null,
  ...extra,
});
const withLogo = { organization: { ...org, logoUrl: LOGO } };

const css = () => readFileSync(resolve(__dirname, "../styles.css"), "utf8");
/** Corpo da PRIMEIRA regra com exatamente este seletor. */
const ruleBody = (selector: string) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|[}\\s])${escaped}\\s*\\{([^}]*)\\}`).exec(css());
  expect(match, `regra CSS ${selector}`).toBeTruthy();
  return match![1]!;
};
const svgOf = (icon: { url: string }) =>
  decodeURIComponent(icon.url.replace(/^data:image\/svg\+xml;charset=UTF-8,/, ""));

beforeEach(() => resetMarkerCaches());

describe("pin de foto HTML (createPinElement)", () => {
  it("com foto (logo do grupo): quadrado com <img> + cauda como ÚLTIMO filho; acessível e focável", () => {
    const pin = createPinElement(place("UNIT", withLogo));
    expect(pin.className).toContain("gm-pin");
    expect(pin.classList.contains("gm-pin-unit")).toBe(true);
    expect(pin.classList.contains("has-photo")).toBe(true);
    expect(pin.getAttribute("role")).toBe("button");
    expect(pin.tabIndex).toBe(0);
    expect(pin.getAttribute("aria-label")).toBe("Grupo: Local de teste");
    const badge = pin.querySelector(":scope > .gm-pin-badge")!;
    expect(badge.classList.contains("is-fallback")).toBe(false);
    const img = badge.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(LOGO);
    expect(img.alt).toBe("");
    // Grupo = pin "puro": sem selo do tipo. A cauda é o último filho (base do elemento = âncora do marcador).
    expect(pin.querySelector(".gm-pin-seal")).toBeNull();
    expect(pin.lastElementChild?.classList.contains("gm-pin-tail")).toBe(true);
    expect(pin.children).toHaveLength(2);
    expect(pin.style.getPropertyValue("--pin")).toBe("#1b5e43");
    // Sem nome embaixo (o nome é do cartão).
    expect(pin.querySelector(".gm-pin-name")).toBeNull();
    expect(pin.textContent).toBe("");
  });

  it("evento/roda/treino com foto ganham o selo do tipo entre o quadrado e a cauda", () => {
    for (const type of ["EVENT", "RODA", "CLASS"] as const) {
      const pin = createPinElement(place(type, withLogo));
      expect(pin.querySelector(":scope > .gm-pin-seal svg"), type).toBeTruthy();
      const names = [...pin.children].map((c) => c.className.split(" ")[0]);
      expect(names, type).toEqual(["gm-pin-badge", "gm-pin-seal", "gm-pin-tail"]);
    }
  });

  it("a capa do evento (imageUrl) tem prioridade sobre o logo do grupo — a mesma regra do cartão", () => {
    const ev = place("EVENT", { ...withLogo, imageUrl: "https://cdn.test/capa.png" });
    expect(markerPhotoUrl(ev)).toBe("https://cdn.test/capa.png");
    expect(createPinElement(ev).querySelector("img")?.getAttribute("src")).toBe("https://cdn.test/capa.png");
    expect(markerPhotoUrl(place("UNIT", withLogo))).toBe(LOGO);
    expect(markerPhotoUrl(place("UNIT"))).toBeNull();
  });

  it("sem foto: o mesmo formato sobre a cor do tipo — iniciais (grupo), dia/mês (evento), ícone (treino/roda)", () => {
    const unit = createPinElement(place("UNIT"));
    expect(unit.classList.contains("has-photo")).toBe(false);
    expect(unit.querySelector("img")).toBeNull();
    expect(unit.querySelector(".gm-pin-badge.is-fallback .gm-pin-initials")?.textContent).toBe("GO");
    expect(unit.querySelector(".gm-pin-seal")).toBeNull();
    expect(unit.lastElementChild?.classList.contains("gm-pin-tail")).toBe(true);

    const event = createPinElement(place("EVENT"));
    expect(event.querySelector(".gm-pin-month")?.textContent).toBe("NOV");
    expect(event.querySelector(".gm-pin-day")?.textContent).toBe("21");
    expect(event.style.getPropertyValue("--pin")).toBe("#a65e0a");

    for (const type of ["CLASS", "RODA"] as const) {
      const pin = createPinElement(place(type));
      expect(pin.querySelector(".gm-pin-badge.is-fallback .gm-pin-glyph svg"), type).toBeTruthy();
      expect(pin.querySelector(".gm-pin-seal"), type).toBeNull(); // o próprio miolo já é o ícone do tipo
    }
  });

  it("se a foto falhar ao carregar, vira o fallback (sem imagem quebrada) e o selo some", () => {
    const pin = createPinElement(place("RODA", withLogo));
    expect(pin.classList.contains("has-photo")).toBe(true);
    pin.querySelector("img")!.dispatchEvent(new Event("error"));
    expect(pin.classList.contains("has-photo")).toBe(false);
    expect(pin.querySelector("img")).toBeNull();
    expect(pin.querySelector(".gm-pin-seal")).toBeNull();
    expect(pin.querySelector(".gm-pin-badge.is-fallback .gm-pin-glyph svg")).toBeTruthy();
    expect(pin.lastElementChild?.classList.contains("gm-pin-tail")).toBe(true);
  });

  it("meu grupo ganha .is-mine (a menos que highlightMine=false); o selecionado é uma classe aplicada depois", () => {
    expect(createPinElement(place("CLASS", { isMine: true })).classList.contains("is-mine")).toBe(true);
    expect(createPinElement(place("CLASS", { isMine: true }), { highlightMine: false }).classList.contains("is-mine")).toBe(false);
    expect(createPinElement(place("CLASS")).classList.contains("is-selected")).toBe(false);
  });

  it("texto de usuário nunca vira HTML (nome do grupo com tags vira só texto)", () => {
    const evil = { organization: { ...org, name: "<img src=x onerror=alert(1)> Grupo" } };
    const pin = createPinElement(place("UNIT", evil));
    expect(pin.querySelectorAll("img")).toHaveLength(0);
    expect(pin.querySelector(".gm-pin-initials")).toBeTruthy();
    expect(markerLabel(place("EVENT", evil))).toContain("<img"); // o rótulo é texto puro (title/aria-label), não markup
  });

  it("clusters mantêm o estilo atual (círculo verde com contador)", () => {
    const cluster = createClusterElement(12, true);
    expect(cluster.className).toBe("gm-cluster is-large");
    expect(cluster.textContent).toBe("12");
    expect(cluster.getAttribute("aria-label")).toBe("12 locais agrupados");
    const icon = classicClusterIcon(12);
    expect(icon.anchorX).toBe(icon.width / 2);
    expect(icon.anchorY).toBe(icon.height / 2);
  });
});

describe("pin de foto: CSS (formato, tamanho e âncora)", () => {
  it("quadrado de 44-52 px com cantos arredondados e borda; cauda triangular; escala parte da base (ponta)", () => {
    const badge = ruleBody(".gm-pin-badge");
    const size = Number(/width:(\d+)px/.exec(badge)![1]);
    expect(size).toBeGreaterThanOrEqual(44);
    expect(size).toBeLessThanOrEqual(52);
    expect(/height:(\d+)px/.exec(badge)![1]).toBe(String(size));
    expect(badge).toMatch(/border-radius:(\d+)px/);
    expect(badge).toMatch(/border:3px solid var\(--ring\)/);
    expect(ruleBody(".gm-pin")).toMatch(/transform-origin:50% 100%/); // a ponta da cauda não sai do lugar ao escalar
    expect(ruleBody(".gm-pin")).toMatch(/drop-shadow/);
    expect(ruleBody(".gm-pin-tail")).toMatch(/border-top:\d+px solid var\(--ring\)/);
    expect(ruleBody(".gm-pin-tail")).toMatch(/border-left:\d+px solid transparent/);
    // Selecionado: maior (escala) e anel na cor do tipo; "Meu grupo": anel dourado.
    expect(ruleBody(".gm-pin.is-selected")).toMatch(/scale\(1\.15\)/);
    expect(ruleBody(".gm-pin.is-selected:not(.is-mine)")).toMatch(/--ring:var\(--pin\)/);
    expect(ruleBody(".gm-pin.is-mine")).toMatch(/--ring:#e8b923/);
  });

  it("o selecionado do HTML e o do SVG usam a mesma escala", () => {
    expect(PIN_SELECTED_SCALE).toBe(1.15);
  });
});

describe("pin de foto SVG (marcador clássico, photoPinIcon)", () => {
  it("geometria: quadrado de 44-52 px, anchor = ponta da cauda (centro horizontal), tamanho fixo", () => {
    expect(PIN_ICON.badge).toBeGreaterThanOrEqual(44);
    expect(PIN_ICON.badge).toBeLessThanOrEqual(52);
    const icon = photoPinIcon(place("UNIT"));
    expect(icon.url.startsWith("data:image/svg+xml;charset=UTF-8,")).toBe(true);
    expect([icon.width, icon.height]).toEqual([PIN_ICON.width, PIN_ICON.height]);
    expect([icon.anchorX, icon.anchorY]).toEqual([PIN_ICON.tipX, PIN_ICON.tipY]);
    expect(icon.anchorX).toBe(icon.width / 2);
    expect(icon.anchorY).toBeLessThan(icon.height); // sobra margem p/ a sombra abaixo da ponta
    // A ponta da cauda desenhada no SVG está exatamente na âncora.
    const svg = svgOf(icon);
    expect(svg).toContain(`L${PIN_ICON.tipX} ${PIN_ICON.tipY}`);
    expect(svg).toMatch(/<svg [^>]*width="56" height="68" viewBox="0 0 56 68"/);
    expect(svg).toContain("feDropShadow"); // sombra
  });

  it("borda: branca por padrão, dourada em 'Meu grupo' e na cor do tipo quando selecionado", () => {
    const ringOf = (p: MapPlace, selected = false) =>
      /<path d="[^"]+" fill="(#[0-9a-f]{6})"/i.exec(svgOf(photoPinIcon(p, { selected })))![1];
    expect(ringOf(place("CLASS"))).toBe("#ffffff");
    expect(ringOf(place("CLASS", { isMine: true }))).toBe("#e8b923");
    expect(ringOf(place("CLASS"), true)).toBe("#2a6f97");
    expect(ringOf(place("EVENT"), true)).toBe("#a65e0a");
    expect(ringOf(place("CLASS", { isMine: true }), true)).toBe("#e8b923");
  });

  it("selecionado: 15% maior e a âncora continua na ponta da cauda (escalada)", () => {
    const normal = photoPinIcon(place("UNIT"));
    const sel = photoPinIcon(place("UNIT"), { selected: true });
    expect(sel.width).toBe(Math.round(PIN_ICON.width * PIN_SELECTED_SCALE));
    expect(sel.height).toBe(Math.round(PIN_ICON.height * PIN_SELECTED_SCALE));
    expect(sel.anchorX).toBe(Math.round(PIN_ICON.tipX * PIN_SELECTED_SCALE));
    expect(sel.anchorY).toBe(Math.round(PIN_ICON.tipY * PIN_SELECTED_SCALE));
    expect(sel.width).toBeGreaterThan(normal.width);
    // Proporção ponta/altura preservada (a ponta é a mesma, só ampliada).
    expect(sel.anchorY / sel.height).toBeCloseTo(normal.anchorY / normal.height, 1);
  });

  it("com foto: <image> recortada em quadrado arredondado (clipPath); treino/roda/evento levam o selo, grupo não", () => {
    const data = "data:image/png;base64,AAAA";
    const unit = svgOf(photoPinIcon(place("UNIT", withLogo), { logo: data }));
    expect(unit).toContain(`<image href="${data}"`);
    expect(unit).toMatch(/<clipPath id="c"><rect [^>]*rx="11"/);
    expect(unit).toContain('clip-path="url(#c)"');
    expect(unit).not.toContain('r="8.5"'); // sem selo
    for (const type of ["CLASS", "RODA", "EVENT"] as const) {
      const svg = svgOf(photoPinIcon(place(type, withLogo), { logo: data }));
      expect(svg, type).toContain(`<image href="${data}"`);
      expect(svg, type).toContain('r="8.5"'); // selo do tipo no canto
    }
  });

  it("sem foto: miolo na cor do tipo com iniciais (grupo), dia/mês (evento) ou ícone (treino/roda); nunca <image>", () => {
    const unit = svgOf(photoPinIcon(place("UNIT")));
    expect(unit).not.toContain("<image");
    expect(unit).toContain('fill="#1b5e43"');
    expect(unit).toContain(">GO<");
    const event = svgOf(photoPinIcon(place("EVENT")));
    expect(event).toContain('fill="#a65e0a"');
    expect(event).toContain(">NOV<");
    expect(event).toContain(">21<");
    for (const [type, color] of [
      ["CLASS", "#2a6f97"],
      ["RODA", "#b4472f"],
    ] as const) {
      const svg = svgOf(photoPinIcon(place(type)));
      expect(svg, type).toContain(`fill="${color}"`);
      expect(svg, type).toContain("<g transform="); // glifo do tipo
      expect(svg, type).not.toContain("<text");
    }
  });

  it("escapa XML do texto do usuário e cacheia o ícone (mesmo objeto para os mesmos parâmetros)", () => {
    const evil = place("UNIT", { organization: { ...org, name: "<&> Grupo" } });
    const svg = svgOf(photoPinIcon(evil));
    expect(svg).not.toContain("<&>");
    expect(photoPinIcon(place("UNIT"))).toBe(photoPinIcon(place("UNIT")));
    expect(photoPinIcon(place("UNIT"), { selected: true })).not.toBe(photoPinIcon(place("UNIT")));
  });

  it("não depende de canvas: sem getContext o ícone sai igual", () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    expect(photoPinIcon(place("UNIT")).anchorY).toBe(PIN_ICON.tipY);
  });
});
