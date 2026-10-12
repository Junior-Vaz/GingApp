import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Brand } from "@/components/painel/brand";

// A logo (1550x312) NÃO pode ser forçada num quadrado: o tamanho vem do CSS (.brand img) só pela altura.
describe("Brand (logo)", () => {
  it("renderiza /logo.png com a proporção real e sem classes de tamanho fixo", () => {
    const { container } = render(<Brand />);
    const img = container.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/logo.png");
    expect(img.getAttribute("alt")).toBe("GingApp");
    expect(img.getAttribute("width")).toBe("1550");
    expect(img.getAttribute("height")).toBe("312");
  });

  it("variante large aplica só a classe do wrapper", () => {
    const large = render(<Brand large />).container.firstElementChild;
    expect(large?.className).toContain("brand-lg");
  });
});