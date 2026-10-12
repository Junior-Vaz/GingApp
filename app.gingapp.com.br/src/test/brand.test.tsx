import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Brand } from "@/components/gingapp/app-shell";

// A logo (1550x312) NÃO pode ser forçada num quadrado: o tamanho vem do CSS (.brand img) só pela altura.
// Sem @testing-library/dom (peer ausente no lockfile): renderização estática basta.
describe("Brand (logo)", () => {
  it("renderiza /logo.png com a proporção real e sem classes de tamanho fixo", () => {
    const html = renderToStaticMarkup(<Brand />);
    expect(html).toContain('src="/logo.png"');
    expect(html).toContain('width="1550"');
    expect(html).toContain('height="312"');
    expect(html).not.toMatch(/<img[^>]*class=/);
  });

  it("variantes mobile e large aplicam só a classe do wrapper", () => {
    expect(renderToStaticMarkup(<Brand mobile />)).toContain("mobile-brand");
    expect(renderToStaticMarkup(<Brand large />)).toContain("brand-lg");
  });
});