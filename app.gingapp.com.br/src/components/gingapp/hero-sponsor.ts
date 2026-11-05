import type { HeroSlideSpec } from "./hero-carousel";
import { sponsorAssetUrl, type SponsorSlide } from "@/lib/sponsors";

/** Posição (0-based) do slide patrocinado: o 3º; com menos de 3 slides vai para o fim; nunca é o 1º. */
export const SPONSOR_SLIDE_INDEX = 2;
/** Chave estável do slide patrocinado (a campanha pode mudar sem o aluno "pular" de slide). */
export const SPONSOR_SLIDE_KEY = "patrocinado";

/**
 * Slide "Patrocinado" a partir do item do servidor. O botão aponta para o redirecionador do SERVIDOR (`clickPath`);
 * o app nunca monta a URL do patrocinador. Se o clique não resolver (fora do contrato) o slide simplesmente não existe.
 */
export function buildSponsorSlide(sponsor: SponsorSlide): HeroSlideSpec | null {
  const href = sponsorAssetUrl(sponsor.clickPath, "click");
  if (!href) return null;
  const image = sponsorAssetUrl(sponsor.imageUrl, "upload");
  return {
    key: SPONSOR_SLIDE_KEY,
    tone: "sponsor",
    ...(image ? { image } : {}),
    imageAlt: "",
    eyebrowIcon: null,
    eyebrow: "Patrocinado",
    title: sponsor.title,
    text: sponsor.text,
    cta: { to: href, label: sponsor.ctaLabel, external: true },
    sponsor: { id: sponsor.id, name: sponsor.sponsorName, logoSrc: sponsorAssetUrl(sponsor.logoUrl, "upload") },
  };
}

/** Insere o slide patrocinado na 3ª posição (no fim se houver menos de 3; nunca em 1º). Devolve a lista (mesma instância). */
export function insertSponsorSlide(list: HeroSlideSpec[], slide: HeroSlideSpec | null): HeroSlideSpec[] {
  if (slide) list.splice(Math.max(1, Math.min(SPONSOR_SLIDE_INDEX, list.length)), 0, slide);
  return list;
}
