import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { LazyMotion, domAnimation, m } from "motion/react";
import { computeBracketLayout, fitScale, type BracketCard } from "@/lib/chaveamento/bracket-layout";
import type { FinishedMatchEvent } from "@/lib/chaveamento/snapshot-diff";
import type { PublicCompetitor, PublicMatch } from "@/lib/chaveamento/types";
import { Avatar } from "./avatar";
import { MatchCard } from "./match-card";

/** A corrida do vencedor pela linha dura menos de 1 s por evento. */
export const ADVANCE_MS = 900;
/** Com movimento reduzido, o destaque (cor/borda) fica mais tempo, já que não há movimento para chamar a atenção. */
export const ADVANCE_REDUCED_MS = 4_000;
const CHIP = 30;

export interface BracketViewProps {
  /** Lutas MAIN e THIRD_PLACE da categoria. */
  matches: readonly PublicMatch[];
  byId: ReadonlyMap<number, PublicCompetitor>;
  /** Lutas que acabaram de terminar neste snapshot (com luta seguinte): disparam a corrida do vencedor. */
  advances: readonly FinishedMatchEvent[];
  /** Muda a cada snapshot aceito. */
  advanceKey: number;
  tv: boolean;
  reducedMotion: boolean;
}

interface ActiveAdvance {
  key: number;
  items: readonly FinishedMatchEvent[];
}

function useElementSize(): [RefObject<HTMLDivElement | null>, { width: number; height: number }] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = (): void => setSize({ width: el.clientWidth, height: el.clientHeight });
    read();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", read);
      return () => window.removeEventListener("resize", read);
    }
    const observer = new ResizeObserver(read);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

/**
 * Chave em colunas por rodada: conectores em SVG e cartões HTML sobre o mesmo palco, que se ajusta à tela (modo telão) ou
 * rola na horizontal (celular). Quando uma luta termina, o vencedor "corre" pela linha até o cartão da próxima luta
 * (traço animado por `pathLength` = stroke-dashoffset + avatar que percorre o cotovelo + o cartão seguinte dá um pulinho).
 * `reducedMotion`: nenhum movimento, só cor/borda.
 */
export function BracketView({ matches, byId, advances, advanceKey, tv, reducedMotion }: BracketViewProps) {
  const layout = useMemo(() => computeBracketLayout(matches), [matches]);
  const matchById = useMemo(() => new Map(matches.map((match) => [match.id, match])), [matches]);
  const [wrapRef, area] = useElementSize();

  const [active, setActive] = useState<ActiveAdvance | null>(null);
  useEffect(() => {
    if (advances.length > 0) setActive({ key: advanceKey, items: advances });
    // Só um snapshot novo (advanceKey) dispara; um snapshot sem resultado novo NÃO interrompe a animação em curso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advanceKey]);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setActive(null), reducedMotion ? ADVANCE_REDUCED_MS : ADVANCE_MS + 150);
    return () => clearTimeout(timer);
  }, [active, reducedMotion]);

  const scale = tv ? fitScale(layout, area) : area.width > 0 ? Math.min(1.25, Math.max(1, area.width / layout.width)) : 1;
  const activeItems = active?.items ?? [];
  const bumpedIds = new Set(activeItems.map((item) => item.nextMatchId).filter((id): id is number => id !== null));
  const connectorById = new Map(layout.connectors.map((c) => [c.fromMatchId, c]));

  const cardStyle = (card: BracketCard) => ({ left: card.x, top: card.y, width: card.w, height: card.h });

  const renderCard = (card: BracketCard, index: number) => {
    const match = matchById.get(card.matchId);
    if (!match) return null;
    const bumped = bumpedIds.has(card.matchId);
    const inner = <MatchCard match={match} byId={byId} highlight={bumped ? "advanced" : null} style={{ width: "100%", height: "100%" }} />;
    if (reducedMotion) {
      return (
        <div key={card.matchId} className="cv-pos" style={cardStyle(card)} data-motion="off">
          {inner}
        </div>
      );
    }
    return (
      <m.div
        key={card.matchId}
        className="cv-pos"
        style={cardStyle(card)}
        data-motion="on"
        initial={{ opacity: 0, y: 10 }}
        animate={bumped ? { opacity: 1, y: 0, scale: [1, 1.06, 1] } : { opacity: 1, y: 0, scale: 1 }}
        transition={bumped ? { delay: 0.5, duration: 0.45 } : { delay: Math.min(index * 0.015, 0.35), duration: 0.3 }}
      >
        {inner}
      </m.div>
    );
  };

  return (
    <LazyMotion features={domAnimation} strict>
      <section className="cv-bracket" ref={wrapRef} data-tv={tv ? "1" : undefined} aria-label="Chave de lutas">
        <div className="cv-bracket-scroll">
          <div className="cv-stage" style={{ width: layout.width * scale, height: layout.height * scale }}>
            <div className="cv-stage-inner" style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>
              {layout.columns.map((column) => (
                <div key={column.round} className="cv-col-label" style={{ left: column.x, width: layout.cards[0]?.w ?? 0 }}>
                  {column.label}
                </div>
              ))}
              {layout.third && (
                <div className="cv-col-label" style={{ left: layout.third.x, top: layout.third.y - 26, width: layout.third.w }}>
                  Disputa de 3º lugar
                </div>
              )}
              <svg className="cv-links" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true" focusable="false">
                {layout.connectors.map((connector) => {
                  const from = matchById.get(connector.fromMatchId);
                  const done = from?.status === "FINISHED" && from.winnerId !== null;
                  return <path key={`${connector.fromMatchId}-${connector.toMatchId}`} d={connector.d} className="cv-link" data-done={done ? "1" : undefined} fill="none" />;
                })}
                {activeItems.map((item) => {
                  const connector = connectorById.get(item.matchId);
                  if (!connector) return null;
                  return reducedMotion ? (
                    <path key={`run-${item.matchId}`} d={connector.d} className="cv-link-run" data-motion="off" fill="none" />
                  ) : (
                    <m.path
                      key={`run-${item.matchId}-${active?.key ?? 0}`}
                      d={connector.d}
                      className="cv-link-run"
                      data-motion="on"
                      fill="none"
                      initial={{ pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: ADVANCE_MS / 1000 - 0.1, ease: "easeInOut" }}
                    />
                  );
                })}
              </svg>
              {layout.cards.map(renderCard)}
              {!reducedMotion &&
                activeItems.map((item) => {
                  const connector = connectorById.get(item.matchId);
                  const winner = item.advancedCompetitorId === null ? undefined : byId.get(item.advancedCompetitorId);
                  if (!connector || !winner) return null;
                  const xm = connector.x1 + (connector.x2 - connector.x1) / 2;
                  const half = CHIP / 2;
                  return (
                    <m.div
                      key={`chip-${item.matchId}-${active?.key ?? 0}`}
                      className="cv-chip"
                      data-testid="cv-winner-chip"
                      initial={{ x: connector.x1 - half, y: connector.y1 - half, opacity: 1, scale: 1 }}
                      animate={{
                        x: [connector.x1 - half, xm - half, xm - half, connector.x2 - half],
                        y: [connector.y1 - half, connector.y1 - half, connector.y2 - half, connector.y2 - half],
                        opacity: [1, 1, 1, 0],
                        scale: [1, 1.15, 1.15, 0.8],
                      }}
                      transition={{ duration: ADVANCE_MS / 1000, times: [0, 0.4, 0.75, 1], ease: "easeInOut" }}
                    >
                      <Avatar id={winner.id} name={winner.name} photoUrl={winner.photoUrl} size={CHIP} />
                    </m.div>
                  );
                })}
            </div>
          </div>
        </div>
      </section>
    </LazyMotion>
  );
}
