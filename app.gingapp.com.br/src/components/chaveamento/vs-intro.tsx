import type { IntroEvent } from "@/lib/chaveamento/snapshot-diff";
import type { PublicCompetitor } from "@/lib/chaveamento/types";
import { ringColorForGroup } from "@/lib/chaveamento/colors";
import { Avatar } from "./avatar";
import { MatIcon } from "./icons";

function Fighter({ competitor, side }: { competitor: PublicCompetitor | null; side: "a" | "b" }) {
  if (!competitor) return <div className="cv-vs-fighter" data-side={side} />;
  const sub = [competitor.group, competitor.graduation].filter(Boolean).join(" · ");
  return (
    <div className="cv-vs-fighter" data-side={side} style={{ ["--cv-fighter" as string]: ringColorForGroup(competitor.group) }}>
      <Avatar id={competitor.id} name={competitor.name} photoUrl={competitor.photoUrl} group={competitor.group} size={200} />
      <p className="cv-vs-name">{competitor.name}</p>
      {sub !== "" && <p className="cv-vs-sub">{sub}</p>}
    </div>
  );
}

/**
 * Abertura de luta "VS" (só no telão, ~3,5 s): os dois atletas entram deslizando dos lados com foto grande, nome, grupo e
 * graduação; faixa com tatame e rodada; varredura de luz ao fundo. Tudo CSS (transform/opacity), reiniciado pela `key` da luta.
 */
export function VsIntro({ intro }: { intro: IntroEvent }) {
  return (
    <div
      className="cv-overlay cv-overlay-vs"
      role="status"
      aria-label={`Luta começando: ${intro.a?.name ?? "atleta a definir"} contra ${intro.b?.name ?? "atleta a definir"}`}
      data-testid="cv-vs-intro"
      data-match-id={intro.matchId}
    >
      <div className="cv-vs-sweep" aria-hidden="true" />
      <div className="cv-vs-banner">
        <p className="cv-vs-kicker">
          <span className="cv-live-badge">
            <span className="cv-dot" aria-hidden="true" />
            AO VIVO
          </span>
          {intro.mat && (
            <span className="cv-vs-mat">
              <MatIcon aria-hidden="true" /> Tatame {intro.mat}
            </span>
          )}
          <span>{intro.stageLabel}</span>
          <span className="cv-vs-cat">{intro.categoryName}</span>
        </p>
        <div className="cv-vs-stage">
          <Fighter competitor={intro.a} side="a" />
          <div className="cv-vs-emblem" aria-hidden="true">
            VS
          </div>
          <Fighter competitor={intro.b} side="b" />
        </div>
      </div>
    </div>
  );
}
