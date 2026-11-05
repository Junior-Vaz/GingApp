import type { HeroSlideSpec } from "./hero-carousel";
import { sponsorAssetUrl, type SponsorSlide } from "@/lib/sponsors";

/** Posição (0-based) do slide patrocinado do GRUPO: o 3º; com menos de 3 slides vai para o fim; nunca é o 1º. */
export const SPONSOR_GROUP_SLIDE_INDEX = 2;
/** Posição (0-based) do slide patrocinado da PLATAFORMA: o 5º; com poucos slides vai para o fim; nunca é o 1º. */
export const SPONSOR_PLATFORM_SLIDE_INDEX = 4;
/** Chave estável do slide patrocinado da PLATAFORMA (a campanha pode mudar sem o aluno "pular" de slide). */
export const SPONSOR_SLIDE_KEY = "patrocinado";
/** Chave estável do slide patrocinado do GRUPO. */
export const SPONSOR_GROUP_SLIDE_KEY = "patrocinado-grupo";

/** Texto da faixa do slide do GRUPO ("Parceiro do grupo <nome>"; sem nome vindo do servidor, "Parceiro do seu grupo"). */
export function partnerLabelOf(groupName: string | null): string {
  return groupName ? `Parceiro do grupo ${groupName}` : "Parceiro do seu grupo";
}

/**
 * Slide "Patrocinado" a partir do item do servidor. O botão aponta para o redirecionador do SERVIDOR (`clickPath`);
 * o app nunca monta a URL do patrocinador. Se o clique não resolver (fora do contrato) o slide simplesmente não existe.
 * A chave é FIXA por escopo (e não por campanha).
 */
export function buildSponsorSlide(sponsor: SponsorSlide): HeroSlideSpec | null {
  const href = sponsorAssetUrl(sponsor.clickPath, "click");
  if (!href) return null;
  const image = sponsorAssetUrl(sponsor.imageUrl, "upload");
  const group = sponsor.scope === "GROUP";
  return {
    key: group ? SPONSOR_GROUP_SLIDE_KEY : SPONSOR_SLIDE_KEY,
    tone: "sponsor",
    ...(image ? { image } : {}),
    imageAlt: "",
    eyebrowIcon: null,
    eyebrow: "Patrocinado",
    title: sponsor.title,
    text: sponsor.text,
    cta: { to: href, label: sponsor.ctaLabel, external: true },
    sponsor: {
      id: sponsor.id,
      name: sponsor.sponsorName,
      logoSrc: sponsorAssetUrl(sponsor.logoUrl, "upload"),
      scope: sponsor.scope,
      partnerLabel: group ? partnerLabelOf(sponsor.groupName) : null,
    },
  };
}

const isSponsored = (slide: HeroSlideSpec | undefined): boolean => slide?.sponsor !== undefined;

/** Índice de inserção mais próximo de `want` (e dentro de 1..length) que não deixa o novo slide colado em outro patrocinado. */
function freeIndexNear(list: HeroSlideSpec[], want: number): number {
  const wanted = Math.max(1, Math.min(want, list.length));
  const isFree = (at: number) => !isSponsored(list[at - 1]) && !isSponsored(list[at]);
  for (let delta = 0; delta <= list.length; delta++) {
    for (const at of [wanted - delta, wanted + delta]) {
      if (at >= 1 && at <= list.length && isFree(at)) return at;
    }
  }
  return wanted; // não há como evitar (ex.: só 1 slide comum): fica onde o contrato manda
}

/**
 * Insere os slides patrocinados (contrato de grupo, seção 6): GRUPO na 3ª posição, PLATAFORMA na 5ª (ou no fim, havendo poucos
 * slides); nunca em 1º; dois patrocinados só ficam colados quando não há como evitar. Devolve a lista (mesma instância).
 */
export function insertSponsorSlides(
  list: HeroSlideSpec[],
  { group, platform }: { group?: HeroSlideSpec | null | undefined; platform?: HeroSlideSpec | null | undefined },
): HeroSlideSpec[] {
  if (group) list.splice(Math.max(1, Math.min(SPONSOR_GROUP_SLIDE_INDEX, list.length)), 0, group);
  if (platform) list.splice(freeIndexNear(list, SPONSOR_PLATFORM_SLIDE_INDEX), 0, platform);
  return list;
}
