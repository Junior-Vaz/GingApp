import type { CSSProperties } from "react";
import type { PodiumEntry, PublicCompetitor } from "@/lib/chaveamento/types";
import { Avatar } from "./avatar";
import { MedalIcon, TrophyIcon } from "./icons";

const PLACE_LABEL: Record<number, string> = { 1: "1º lugar", 2: "2º lugar", 3: "3º lugar" };
/** Atraso (s) da subida de cada lugar: 2º, 3º e por último o 1º (a revelação do campeão). */
const RISE_DELAY: Record<number, number> = { 2: 0.15, 3: 0.55, 1: 1.0 };

export interface PodiumProps {
  podium: readonly PodiumEntry[];
  byId: ReadonlyMap<number, PublicCompetitor>;
  reducedMotion: boolean;
  tv: boolean;
}

/**
 * Pódio 2º-1º-3º: blocos que "sobem" em sequência (2º, 3º, depois o 1º), medalha em SVG, foto/iniciais com anel e grupo.
 * Sem disputa de 3º lugar aparecem DOIS terceiros. Com movimento reduzido: pódio estático com destaque dourado.
 */
export function Podium({ podium, byId, reducedMotion, tv }: PodiumProps) {
  const entries = podium
    .map((entry) => ({ entry, competitor: byId.get(entry.competitorId) }))
    .filter((item): item is { entry: PodiumEntry; competitor: PublicCompetitor } => item.competitor !== undefined);
  if (entries.length === 0) return null;
  const order = [2, 1, 3].flatMap((place) => entries.filter((item) => item.entry.place === place));

  return (
    <section className="cv-podium" aria-label="Pódio" data-testid="cv-podium" data-tv={tv ? "1" : undefined} data-motion={reducedMotion ? "off" : "on"}>
      <h2 className="cv-podium-title">
        <TrophyIcon /> Pódio
      </h2>
      <ol className="cv-podium-steps">
        {order.map(({ entry, competitor }) => {
          const sub = [competitor.group, competitor.graduation].filter(Boolean).join(" · ");
          const style = { "--cv-rise-delay": `${RISE_DELAY[entry.place] ?? 0}s` } as CSSProperties;
          return (
            <li key={`${entry.place}-${competitor.id}`} className="cv-step" data-place={entry.place} style={style}>
              <MedalIcon place={entry.place} className="cv-step-medal" />
              <Avatar id={competitor.id} name={competitor.name} photoUrl={competitor.photoUrl} group={competitor.group} gold={entry.place === 1} size={tv ? (entry.place === 1 ? 112 : 88) : entry.place === 1 ? 84 : 64} />
              <span className="cv-step-name">{competitor.name}</span>
              {sub !== "" && <span className="cv-step-group">{sub}</span>}
              <span className="cv-step-block">
                <span className="cv-step-place" aria-hidden="true">
                  {entry.place}º
                </span>
                <span className="sr-only">{PLACE_LABEL[entry.place]}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
