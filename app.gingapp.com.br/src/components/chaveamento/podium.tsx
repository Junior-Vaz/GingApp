import { useEffect, useState, type CSSProperties } from "react";
import { Trophy } from "lucide-react";
import type { PodiumEntry, PublicCompetitor } from "@/lib/chaveamento/types";
import { Avatar } from "./avatar";

/** Duração do confete (CSS puro, sem biblioteca): leve e curto. */
export const CONFETTI_MS = 3_600;
const CONFETTI_COLORS = ["#f59e0b", "#22c55e", "#3b82f6", "#ec4899", "#eab308", "#14b8a6", "#f97316"];
const PIECES = 36;

/** Peças deterministas (sem Math.random no render): posição, atraso, duração, cor e giro derivados do índice. */
function pieceStyle(index: number): CSSProperties {
  const left = (index * 97) % 100;
  const delay = ((index * 37) % 10) / 20;
  const duration = 1.9 + ((index * 53) % 10) / 10;
  const spin = 240 + ((index * 71) % 480);
  return {
    left: `${left}%`,
    animationDelay: `${delay}s`,
    animationDuration: `${duration}s`,
    background: CONFETTI_COLORS[index % CONFETTI_COLORS.length]!,
    ["--cv-spin" as string]: `${spin}deg`,
    ["--cv-drift" as string]: `${((index * 29) % 60) - 30}px`,
  };
}

export function Confetti() {
  return (
    <div className="cv-confetti" data-testid="cv-confetti" aria-hidden="true">
      {Array.from({ length: PIECES }, (_, index) => (
        <span key={index} className="cv-confetti-piece" style={pieceStyle(index)} />
      ))}
    </div>
  );
}

const PLACE_LABEL: Record<number, string> = { 1: "1º lugar", 2: "2º lugar", 3: "3º lugar" };

export interface PodiumProps {
  podium: readonly PodiumEntry[];
  byId: ReadonlyMap<number, PublicCompetitor>;
  /** A categoria acabou de terminar neste snapshot: solta o confete (uma vez). */
  celebrate: boolean;
  reducedMotion: boolean;
  tv: boolean;
}

/** Pódio 2º-1º-3º com avatares; ao terminar a categoria (ao vivo) solta confete leve (nunca com movimento reduzido). */
export function Podium({ podium, byId, celebrate, reducedMotion, tv }: PodiumProps) {
  const [burst, setBurst] = useState(celebrate && !reducedMotion);
  useEffect(() => {
    if (!burst) return;
    const timer = setTimeout(() => setBurst(false), CONFETTI_MS);
    return () => clearTimeout(timer);
  }, [burst]);

  const entries = podium
    .map((entry) => ({ entry, competitor: byId.get(entry.competitorId) }))
    .filter((item): item is { entry: PodiumEntry; competitor: PublicCompetitor } => item.competitor !== undefined);
  if (entries.length === 0) return null;
  const order = [2, 1, 3].map((place) => entries.filter((item) => item.entry.place === place)).flat();

  return (
    <section className="cv-podium" aria-label="Pódio" data-testid="cv-podium">
      {burst && <Confetti />}
      <h2 className="cv-podium-title">
        <Trophy aria-hidden="true" /> Pódio
      </h2>
      <ol className="cv-podium-steps">
        {order.map(({ entry, competitor }) => (
          <li key={`${entry.place}-${competitor.id}`} className="cv-step" data-place={entry.place}>
            <Avatar id={competitor.id} name={competitor.name} photoUrl={competitor.photoUrl} size={tv ? 96 : entry.place === 1 ? 76 : 60} />
            <span className="cv-step-name">{competitor.name}</span>
            {competitor.group && <span className="cv-step-group">{competitor.group}</span>}
            <span className="cv-step-block">
              <span className="cv-step-place">{entry.place}º</span>
              <span className="sr-only">{PLACE_LABEL[entry.place]}</span>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
