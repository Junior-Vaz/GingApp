import { Check } from "lucide-react";
import type { CSSProperties } from "react";
import type { PublicCompetitor, PublicMatch } from "@/lib/chaveamento/types";
import { describeMatch } from "@/lib/chaveamento/describe";
import { Avatar } from "./avatar";

export type CardHighlight = "advanced" | null;

const RESULT_TAG: Record<string, string> = { WALKOVER: "W.O.", DISQUALIFICATION: "Desclassificação", DRAW: "Empate" };

interface RowProps {
  match: PublicMatch;
  side: "A" | "B";
  competitor: PublicCompetitor | null;
}

function Row({ match, side, competitor }: RowProps) {
  const score = side === "A" ? match.scoreA : match.scoreB;
  const finished = match.status === "FINISHED";
  const won = finished && competitor !== null && match.winnerId === competitor.id;
  const lost = finished && competitor !== null && match.winnerId !== null && match.winnerId !== competitor.id;
  const empty = competitor === null;
  const label = empty ? (match.isBye && side === "B" ? "Folga" : "A definir") : competitor.name;
  const sub = competitor ? [competitor.group, competitor.graduation].filter(Boolean).join(" · ") : "";
  return (
    <div className="cv-row" data-win={won ? "1" : undefined} data-lost={lost ? "1" : undefined} data-empty={empty ? "1" : undefined}>
      {competitor ? <Avatar id={competitor.id} name={competitor.name} photoUrl={competitor.photoUrl} size={30} /> : <span className="cv-avatar-ghost" />}
      <span className="cv-row-text">
        <span className="cv-name" title={label}>
          {label}
        </span>
        {sub !== "" && (
          <span className="cv-sub" title={sub}>
            {sub}
          </span>
        )}
      </span>
      {won && <Check className="cv-check" aria-hidden="true" strokeWidth={3.2} />}
      <span className="cv-score">{score !== null ? score : ""}</span>
    </div>
  );
}

export interface MatchCardProps {
  match: PublicMatch;
  byId: ReadonlyMap<number, PublicCompetitor>;
  highlight?: CardHighlight;
  style?: CSSProperties;
  className?: string;
}

/** Cartão de uma luta: avatar, nome, grupo/graduação e placar dos dois lados; AO VIVO pulsa; o vencedor é realçado (cor + marca). */
export function MatchCard({ match, byId, highlight = null, style, className }: MatchCardProps) {
  const a = match.slotAId === null ? null : (byId.get(match.slotAId) ?? null);
  const b = match.slotBId === null ? null : (byId.get(match.slotBId) ?? null);
  const tag = match.status === "LIVE" ? "AO VIVO" : match.status === "FINISHED" && match.resultType ? (RESULT_TAG[match.resultType] ?? null) : null;
  return (
    <div
      className={`cv-card ${className ?? ""}`.trim()}
      style={style}
      role="group"
      aria-label={describeMatch(match, byId)}
      data-testid="cv-match"
      data-match-id={match.id}
      data-status={match.status}
      data-bye={match.isBye ? "1" : undefined}
      data-highlight={highlight ?? undefined}
    >
      <div className="cv-card-body" aria-hidden="true">
        <Row match={match} side="A" competitor={a} />
        <Row match={match} side="B" competitor={b} />
        {tag && (
          <span className="cv-tag" data-live={match.status === "LIVE" ? "1" : undefined}>
            {match.status === "LIVE" && <span className="cv-dot" />}
            {tag}
            {match.status === "LIVE" && match.mat ? ` · Tat. ${match.mat}` : ""}
          </span>
        )}
        {!tag && match.mat && (match.status === "READY" || match.status === "PENDING") && <span className="cv-tag">Tat. {match.mat}</span>}
      </div>
    </div>
  );
}
