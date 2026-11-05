import { describe, expect, it } from "vitest";
import { parseSponsorSlide, pickSponsorSlides } from "@/lib/sponsors";

/**
 * Conformidade com o backend REAL: resposta capturada de GET /sponsors/active (e2e de sponsors) passa no parser do app sem adaptação.
 * REAL_ACTIVE = formato ANTIGO (Fase 1, sem scope/groupName), que o app continua aceitando como PLATAFORMA.
 */
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

/** Formato do CONTRATO de grupo (docs/CONTRATO_PATROCINADORES_GRUPO.md, secao 2): scope + groupName, grupo primeiro. */
const CONTRACT_ACTIVE = {
  items: [
    { ...REAL_ACTIVE.items[0], id: 41, sponsorName: "Padaria do Mestre", title: "Pão da roda", clickPath: "/api/sponsors/41/click?s=GO", scope: "GROUP", groupName: "Capoeira Axé" },
    { ...REAL_ACTIVE.items[0], scope: "PLATFORM", groupName: null },
  ],
};

/** Capturado do backend REAL (e2e sponsor-groups): GET /sponsors/active com 1 campanha do grupo + 1 da plataforma (sem imagens). */
const REAL_GROUP_AND_PLATFORM = {
  items: [
    { id: 173, sponsorName: "Parceiro A", logoUrl: null, imageUrl: null, title: "Grupo A", text: "Aulas de reforço muscular com 15% para o grupo.", ctaLabel: "Conhecer", clickPath: "/api/sponsors/173/click?s=GO", state: "GO", scope: "GROUP", groupName: "Capoeira Axé" },
    { id: 176, sponsorName: "Nacional", logoUrl: null, imageUrl: null, title: "Plataforma", text: "Aulas de reforço muscular com 15% para o grupo.", ctaLabel: "Conhecer", clickPath: "/api/sponsors/176/click?s=GO", state: "GO", scope: "PLATFORM", groupName: null },
  ],
};

describe("patrocinador: resposta real do backend (grupo + plataforma)", () => {
  it("2 itens reais: grupo primeiro, ambos aceitos com scope/groupName", () => {
    const slides = pickSponsorSlides(REAL_GROUP_AND_PLATFORM);
    expect(slides.map((s) => [s.id, s.scope, s.groupName])).toEqual([
      [173, "GROUP", "Capoeira Axé"],
      [176, "PLATFORM", null],
    ]);
    expect(slides[0]?.logoUrl).toBeNull();
  });

  it("o servidor mandando a plataforma antes do grupo: o app reordena (grupo primeiro)", () => {
    const reversed = { items: [...REAL_GROUP_AND_PLATFORM.items].reverse() };
    expect(pickSponsorSlides(reversed).map((s) => s.scope)).toEqual(["GROUP", "PLATFORM"]);
  });
});

describe("patrocinador: resposta real do backend", () => {
  it("o item real é aceito com todos os campos", () => {
    const [slide] = pickSponsorSlides(REAL_ACTIVE);
    expect(slide).toBeDefined();
    expect(slide?.id).toBe(27);
    expect(slide?.clickPath).toBe("/api/sponsors/27/click?s=GO");
    expect(slide?.logoUrl).toMatch(/^\/api\/uploads\//);
  });

  it("formato antigo (sem scope/groupName) = PLATAFORMA com groupName null", () => {
    const [slide] = pickSponsorSlides(REAL_ACTIVE);
    expect(slide).toMatchObject({ scope: "PLATFORM", groupName: null });
  });

  it("formato do contrato de grupo: 2 itens, grupo primeiro, com scope e groupName", () => {
    const slides = pickSponsorSlides(CONTRACT_ACTIVE);
    expect(slides.map((s) => [s.id, s.scope, s.groupName])).toEqual([
      [41, "GROUP", "Capoeira Axé"],
      [27, "PLATFORM", null],
    ]);
  });

  it("sem região (UF desconhecida) o clickPath do servidor vem sem ?s= e continua aceito", () => {
    const slide = parseSponsorSlide({ ...REAL_ACTIVE.items[0], clickPath: "/api/sponsors/27/click", state: "" });
    expect(slide).not.toBeNull();
  });

  it("lista vazia (menor, sem campanha ou SPONSORS_ENABLED=false) = nenhum slide", () => {
    expect(pickSponsorSlides({ items: [] })).toEqual([]);
  });

  it("clique apontando para fora de /api/sponsors/<id>/click é descartado (nunca monta URL de terceiro)", () => {
    expect(parseSponsorSlide({ ...REAL_ACTIVE.items[0], clickPath: "https://evil.example/x" })).toBeNull();
  });
});
