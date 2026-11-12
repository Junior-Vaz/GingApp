import type { CSSProperties } from "react";
import type { PublicCompetitor, PublicMatch, Slot } from "@/lib/chaveamento/types";
import { describeMatch } from "@/lib/chaveamento/describe";
import { Avatar } from "./avatar";
import { CheckIcon, ClockIcon, MatIcon } from "./icons";

export type CardHighlight = "advanced" | null;

const RESULT_TAG: Record<string, string> = { WALKOVER: "W.O.", DISQUALIFICATION: "Desclassificação", DRAW: "Empate" };

interface RowProps {
  match: PublicMatch;
  side: Slot;
  competitor: PublicCompetitor | null;
  /** O vencedor da luta anterior acabou de "encaixar" neste lado. */
  arrived: boolean;
  /** A luta acabou de terminar: o placar dá um "pop". */
  pop: boolean;
  /** Este é o atleta em destaque (busca ou toque): o caminho dele na chave fica aceso. */
  focused: boolean;
}

function Row({ match, side, competitor, arrived, pop, focused }: RowProps) {
  const score = side === "A" ? match.scoreA : match.scoreB;
  const finished = match.status === "FINISHED";
  const won = finished && competitor !== null && match.winnerId === competitor.id;
  const lost = finished && competitor !== null && match.winnerId !== null && match.winnerId !== competitor.id;
  const empty = competitor === null;
  const label = empty ? (match.isBye && side === "B" ? "Folga" : "A definir") : competitor.name;
  const sub = competitor ? [competitor.group, competitor.graduation].filter(Boolean).join(" · ") : "";
  return (
    <div
      className="cv-row"
      data-side={side}
      data-win={won ? "1" : undefined}
      data-lost={lost ? "1" : undefined}
      data-empty={empty ? "1" : undefined}
      data-arrive={arrived ? "1" : undefined}
      data-focus={focused ? "1" : undefined}
    >
      {competitor ? <Avatar id={competitor.id} name={competitor.name} photoUrl={competitor.photoUrl} group={competitor.group} size={32} /> : <span className="cv-avatar-ghost" />}
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
      {won && <CheckIcon className="cv-check" />}
      <span className="cv-score" data-pop={pop && score !== null ? "1" : undefined}>
        {score !== null ? score : ""}
      </span>
    </div>
  );
}

export interface MatchCardProps {
  match: PublicMatch;
  byId: ReadonlyMap<number, PublicCompetitor>;
  highlight?: CardHighlight;
  /** Lado da luta (A/B) que acabou de receber o vencedor da luta anterior. */
  arrivedSlot?: Slot | null;
  /** A luta acabou de terminar neste snapshot: flash de vitória e "pop" no placar. */
  justFinished?: boolean;
  /** Posição na fila de chamada (1 = PRÓXIMA); null = fora da fila. */
  queueRank?: number | null;
  /** Atleta em destaque (caminho aceso na chave). */
  focusId?: number | null;
  /** Há um atleta em destaque: esta luta está no caminho dele ("on") ou fora dele ("off", esmaecida); null = sem destaque. */
  path?: "on" | "off" | null;
  /** Toque num atleta do cartão (liga/desliga o destaque do caminho). Ausente (telão) = cartão não interativo. */
  onPickAthlete?: ((competitorId: number) => void) | undefined;
  style?: CSSProperties;
  className?: string;
}

/**
 * Cartão de uma luta (cartão de atleta de transmissão): avatar com anel do grupo, nome em caixa alta condensada, grupo e
 * graduação, placar. AO VIVO: borda luminosa pulsante + selo vermelho + tatame; PRÓXIMA: selo com relógio; o vencedor é
 * realçado (verde + marca de vitória) e o perdedor esmaece. O estado nunca depende só da cor: sempre há texto/ícone.
 */
export function MatchCard({ match, byId, highlight = null, arrivedSlot = null, justFinished = false, queueRank = null, focusId = null, path = null, onPickAthlete, style, className }: MatchCardProps) {
  const a = match.slotAId === null ? null : (byId.get(match.slotAId) ?? null);
  const b = match.slotBId === null ? null : (byId.get(match.slotBId) ?? null);
  const live = match.status === "LIVE";
  const tag = live ? "AO VIVO" : match.status === "FINISHED" && match.resultType ? (RESULT_TAG[match.resultType] ?? null) : null;
  const upcoming = !tag && queueRank !== null && match.status === "READY";
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
      data-flash={justFinished ? "1" : undefined}
      data-next={upcoming ? queueRank : undefined}
      data-path={path ?? undefined}
    >
      <div className="cv-card-body" aria-hidden="true">
        <Row match={match} side="A" competitor={a} arrived={arrivedSlot === "A"} pop={justFinished} focused={a !== null && a.id === focusId} />
        <Row match={match} side="B" competitor={b} arrived={arrivedSlot === "B"} pop={justFinished} focused={b !== null && b.id === focusId} />
      </div>
      {onPickAthlete && (
        <div className="cv-card-hits">
          {[a, b].map((competitor, index) =>
            competitor ? (
              <button
                key={index}
                type="button"
                className="cv-row-hit"
                aria-pressed={competitor.id === focusId}
                aria-label={`Destacar o caminho de ${competitor.name}`}
                data-testid="cv-athlete-hit"
                data-competitor-id={competitor.id}
                onClick={() => onPickAthlete(competitor.id)}
              />
            ) : (
              <span key={index} className="cv-row-hit-empty" />
            ),
          )}
        </div>
      )}
      {tag && (
        <span className="cv-tag" data-live={live ? "1" : undefined} aria-hidden="true">
          {live && <span className="cv-dot" />}
          {tag}
          {live && match.mat ? (
            <>
              <MatIcon className="cv-tag-icon" /> {match.mat}
            </>
          ) : null}
        </span>
      )}
      {upcoming && (
        <span className="cv-tag" data-next={queueRank} aria-hidden="true">
          <ClockIcon className="cv-tag-icon" />
          {queueRank === 1 ? "PRÓXIMA" : "NA FILA"}
          {match.mat ? ` · Tat. ${match.mat}` : ""}
        </span>
      )}
      {!tag && !upcoming && match.mat && (match.status === "READY" || match.status === "PENDING") && (
        <span className="cv-tag" aria-hidden="true">
          <MatIcon className="cv-tag-icon" /> Tat. {match.mat}
        </span>
      )}
    </div>
  );
}
