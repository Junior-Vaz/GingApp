import { selectPodium } from "@/lib/chaveamento/selectors";
import type { PublicCategory, PublicCompetitor } from "@/lib/chaveamento/types";
import { Avatar } from "./avatar";
import { CrownIcon, TrophyIcon } from "./icons";

function sub(competitor: PublicCompetitor): string {
  return [competitor.group, competitor.graduation].filter(Boolean).join(" · ");
}

/** O campeão em destaque: holofote dourado, coroa, foto grande com anel dourado, nome gigante, grupo e graduação. */
export function ChampionHero({ champion, categoryName, big }: { champion: PublicCompetitor; categoryName: string; big: boolean }) {
  return (
    <div className="cv-champ" data-big={big ? "1" : undefined} data-testid="cv-champion">
      <p className="cv-champ-kicker">
        <TrophyIcon /> CAMPEÃO
      </p>
      <div className="cv-champ-photo">
        <CrownIcon className="cv-champ-crown" />
        <Avatar id={champion.id} name={champion.name} photoUrl={champion.photoUrl} group={champion.group} gold size={big ? 220 : 92} />
      </div>
      <p className="cv-champ-name">{champion.name}</p>
      {sub(champion) !== "" && <p className="cv-champ-sub">{sub(champion)}</p>}
      <p className="cv-champ-cat">{categoryName}</p>
    </div>
  );
}

/** Faixa de destaque no alto da categoria encerrada (fora do modo telão). */
export function ChampionBanner({ category }: { category: PublicCategory }) {
  const { champion } = selectPodium(category);
  if (!champion) return null;
  return (
    <section className="cv-champ-banner" aria-label="Campeão" data-testid="cv-champion-banner">
      <ChampionHero champion={champion} categoryName={category.name} big={false} />
    </section>
  );
}

/**
 * Tela de campeão do telão (~12 s, só na transição para FINISHED): cobre tudo, com holofote dourado, a revelação em camadas
 * e o 2º e 3º lugares embaixo. Depois some e o pódio permanente aparece por baixo. O confete é desenhado pelo canvas.
 */
export function ChampionOverlay({ category }: { category: PublicCategory }) {
  const { champion, second, thirds } = selectPodium(category);
  if (!champion) return null;
  const others: Array<{ place: 2 | 3; competitor: PublicCompetitor }> = [
    ...(second ? [{ place: 2 as const, competitor: second }] : []),
    ...thirds.map((competitor) => ({ place: 3 as const, competitor })),
  ];
  return (
    <div className="cv-overlay cv-overlay-champion" role="status" aria-label={`Campeão: ${champion.name}`} data-testid="cv-champion-overlay">
      <div className="cv-spot" aria-hidden="true" />
      <ChampionHero champion={champion} categoryName={category.name} big />
      {others.length > 0 && (
        <ul className="cv-champ-others">
          {others.map(({ place, competitor }) => (
            <li key={`${place}-${competitor.id}`} className="cv-champ-other" data-place={place}>
              <Avatar id={competitor.id} name={competitor.name} photoUrl={competitor.photoUrl} group={competitor.group} size={56} />
              <span>
                <b>{place}º lugar</b>
                <span>{competitor.name}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
