import { describe, expect, it } from "vitest";
import { parseSponsorSlide, pickSponsorSlide } from "@/lib/sponsors";

/** Conformidade com o backend REAL: resposta capturada de GET /sponsors/active (e2e de sponsors) passa no parser do app sem adaptação. */
const REAL_ACTIVE = {
  items: [
    {
      id: 27,
      sponsorName: "Loja do Berimbau",
      logoUrl: "/api/uploads/57436b55-4078-4e03-aaf8-aeeaac0c0dc7.webp",
      imageUrl: "/api/uploads/03e54af1-6355-4f2e-84c0-1c27bfb9ddc3.webp",
      title: "Campanha Nacional",
      text: "Berimbaus artesanais com 10% de desconto para capoeiristas.",
      ctaLabel: "Conhecer",
      clickPath: "/api/sponsors/27/click?s=GO",
      state: "GO",
    },
  ],
};

describe("patrocinador: resposta real do backend", () => {
  it("o item real é aceito com todos os campos", () => {
    const slide = pickSponsorSlide(REAL_ACTIVE);
    expect(slide).not.toBeNull();
    expect(slide?.id).toBe(27);
    expect(slide?.clickPath).toBe("/api/sponsors/27/click?s=GO");
    expect(slide?.logoUrl).toMatch(/^\/api\/uploads\//);
  });

  it("sem região (UF desconhecida) o clickPath do servidor vem sem ?s= e continua aceito", () => {
    const slide = parseSponsorSlide({ ...REAL_ACTIVE.items[0], clickPath: "/api/sponsors/27/click", state: "" });
    expect(slide).not.toBeNull();
  });

  it("lista vazia (menor, sem campanha ou SPONSORS_ENABLED=false) = nenhum slide", () => {
    expect(pickSponsorSlide({ items: [] })).toBeNull();
  });

  it("clique apontando para fora de /api/sponsors/<id>/click é descartado (nunca monta URL de terceiro)", () => {
    expect(parseSponsorSlide({ ...REAL_ACTIVE.items[0], clickPath: "https://evil.example/x" })).toBeNull();
  });
});
