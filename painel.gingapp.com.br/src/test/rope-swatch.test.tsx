import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { RopeSwatch } from "@/components/painel/rope-swatch";
import { colorName, ropeLabel, ropeOf } from "@/lib/rope";

afterEach(cleanup);

const stripes = (svg: Element) => [...svg.querySelectorAll("[data-stripe]")];
const GREEN = "#16a34a";
const YELLOW = "#facc15";
const BLUE = "#2563eb";

describe("RopeSwatch", () => {
  it("SOLID: uma cor cheia, aria-label descritivo", () => {
    render(<RopeSwatch style="SOLID" colors={[GREEN]} />);
    const svg = screen.getByRole("img", { name: "Corda sólida verde" });
    expect(svg).toHaveAttribute("data-style", "SOLID");
    expect(stripes(svg).map((s) => s.getAttribute("fill"))).toEqual([GREEN]);
  });

  it("SPLIT: faixas iguais (2 e 3 cores)", () => {
    const { unmount } = render(<RopeSwatch style="SPLIT" colors={[GREEN, YELLOW]} size="md" />);
    const two = screen.getByRole("img", { name: "Corda dividida verde e amarela" });
    expect(stripes(two).map((s) => s.getAttribute("fill"))).toEqual([GREEN, YELLOW]);
    const widths2 = stripes(two).map((s) => Number(s.getAttribute("width")));
    expect(widths2[0]).toBeCloseTo(widths2[1]!, 5);
    unmount();

    render(<RopeSwatch style="SPLIT" colors={[GREEN, YELLOW, BLUE]} />);
    const three = screen.getByRole("img", { name: "Corda dividida verde, amarela e azul" });
    expect(stripes(three).map((s) => s.getAttribute("fill"))).toEqual([GREEN, YELLOW, BLUE]);
    const xs = stripes(three).map((s) => Number(s.getAttribute("x")));
    expect(xs[0]).toBe(0);
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!, 5); // faixas igualmente espaçadas
  });

  it("BRAIDED: pattern com listras diagonais (rotate -60) alternando as 2 ou 3 cores", () => {
    render(<RopeSwatch style="BRAIDED" colors={[GREEN, YELLOW, BLUE]} />);
    const svg = screen.getByRole("img", { name: "Corda trançada verde, amarela e azul" });
    const pattern = svg.querySelector("pattern")!;
    expect(pattern.getAttribute("patternTransform")).toBe("rotate(-60)");
    expect([...pattern.querySelectorAll("rect")].map((r) => r.getAttribute("fill"))).toEqual([GREEN, YELLOW, BLUE]);
    // o corpo da corda usa o pattern
    expect(svg.querySelector("[data-braid]")!.getAttribute("fill")).toBe(`url(#${pattern.id})`);
  });

  it("ids de pattern/clipPath/gradient são únicos entre instâncias (useId)", () => {
    render(
      <>
        <RopeSwatch style="BRAIDED" colors={[GREEN, YELLOW]} />
        <RopeSwatch style="BRAIDED" colors={[BLUE, YELLOW]} />
      </>,
    );
    const ids = [...document.querySelectorAll("svg [id]")].map((e) => e.id);
    expect(ids.length).toBe(6);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => /^[\w-]+$/.test(id))).toBe(true);
  });

  it("orientação e tamanho: vertical é mais alta que larga; horizontal o inverso; lg > sm", () => {
    const { container } = render(
      <>
        <RopeSwatch style="SOLID" colors={[GREEN]} orientation="vertical" size="sm" />
        <RopeSwatch style="SOLID" colors={[GREEN]} orientation="horizontal" size="sm" />
        <RopeSwatch style="SOLID" colors={[GREEN]} orientation="vertical" size="lg" />
      </>,
    );
    const [v, h, big] = [...container.querySelectorAll("svg")].map((s) => [Number(s.getAttribute("width")), Number(s.getAttribute("height"))]);
    expect(v![1]).toBeGreaterThan(v![0]!);
    expect(h![0]).toBeGreaterThan(h![1]!);
    expect(h).toEqual([v![1], v![0]]);
    expect(big![1]).toBeGreaterThan(v![1]!);
  });

  it("decorative esconde do leitor de tela; cor inválida/ausente não quebra", () => {
    const { container } = render(
      <>
        <RopeSwatch style="SOLID" colors={[GREEN]} decorative />
        <RopeSwatch style="SPLIT" colors={["xx", GREEN]} />
        <RopeSwatch style="SOLID" colors={[]} />
      </>,
    );
    const [deco, invalid, empty] = [...container.querySelectorAll("svg")];
    expect(deco).toHaveAttribute("aria-hidden", "true");
    expect(deco).not.toHaveAttribute("aria-label");
    expect(stripes(invalid!)[0]!.getAttribute("fill")).toMatch(/^#[0-9a-f]{6}$/i); // fallback cinza
    expect(empty).toHaveAttribute("aria-label", "Corda sem cor definida");
  });
});

describe("helpers de corda", () => {
  it("colorName usa a cor da paleta mais próxima", () => {
    expect(colorName("#f5f5dc")).toBe("branca");
    expect(colorName("#ffff00")).toBe("amarela");
    expect(colorName("#0000ff")).toBe("azul");
    expect(colorName("nada")).toBe("sem cor");
  });
  it("ropeLabel e ropeOf (legado `color` vira SOLID com 1 cor)", () => {
    expect(ropeLabel({ style: "BRAIDED", colors: [GREEN, YELLOW, BLUE] })).toBe("Corda trançada verde, amarela e azul");
    expect(ropeOf({ color: "#112233" })).toEqual({ style: "SOLID", colors: ["#112233"] });
    expect(ropeOf({ style: "SPLIT", colors: [GREEN, BLUE], color: GREEN })).toEqual({ style: "SPLIT", colors: [GREEN, BLUE] });
    expect(ropeOf({ color: null })).toEqual({ style: "SOLID", colors: [] });
  });
});
