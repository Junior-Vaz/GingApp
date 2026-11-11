import { useEffect, useMemo, useState } from "react";
import { LazyMotion, domAnimation, m } from "motion/react";
import type { BracketCard } from "@/lib/chaveamento/bracket-layout";
import { focusPageIndices, planBracketPages } from "@/lib/chaveamento/bracket-pages";
import type { FinishedMatchEvent } from "@/lib/chaveamento/snapshot-diff";
import type { PublicCompetitor, PublicMatch, Slot } from "@/lib/chaveamento/types";
import { Avatar } from "./avatar";
import { BracketIcon } from "./icons";
import { MatchCard } from "./match-card";
import { useElementSize } from "./use-element-size";

/** A corrida do vencedor pela linha dura menos de 1 s por evento. */
export const ADVANCE_MS = 900;
/** Com movimento reduzido, o destaque (cor/borda) fica mais tempo, já que não há movimento para chamar a atenção. */
export const ADVANCE_REDUCED_MS = 4_000;
/** Chave grande no telão: tempo de cada página quando há mais de uma em foco. */
export const PAGE_ROTATE_MS = 9_000;
/** Escala mínima legível no telão: abaixo disso a chave é dividida em páginas em vez de encolher. */
/** Depois de um resultado, a página da luta fica na tela por este tempo (a corrida do vencedor + um respiro). */
export const HOLD_PAGE_MS = 3_200;
export const TV_MIN_SCALE = 0.95;
const TV_MAX_SCALE = 2.2;
const CHIP = 34;

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
  /** Fila de chamada desta categoria: id da luta -> posição (1 = PRÓXIMA). */
  queueRanks?: ReadonlyMap<number, number>;
}

interface ActiveAdvance {
  key: number;
  items: readonly FinishedMatchEvent[];
}

/**
 * Chave em colunas por rodada: conectores em SVG e cartões HTML sobre o mesmo palco, que se ajusta à tela (modo telão) ou
 * rola na horizontal (celular). No telão, uma chave grande demais para ficar legível é dividida em PÁGINAS (metades,
 * quadrantes + fase final) e o telão fica na que tem luta ao vivo. Quando uma luta termina, o vencedor "corre" pela linha até o
 * cartão da próxima luta (traço com rastro luminoso + avatar que percorre o cotovelo + encaixe no cartão seguinte).
 * `reducedMotion`: nenhum movimento, só cor/borda.
 */
export function BracketView({ matches, byId, advances, advanceKey, tv, reducedMotion, queueRanks }: BracketViewProps) {
  const matchById = useMemo(() => new Map(matches.map((match) => [match.id, match])), [matches]);
  const [wrapRef, area] = useElementSize<HTMLDivElement>();

  const plan = useMemo(
    () => planBracketPages(matches, tv ? area : { width: 0, height: 0 }, { minScale: TV_MIN_SCALE, maxScale: TV_MAX_SCALE }),
    [matches, tv, area],
  );
  const liveIds = useMemo(() => new Set(matches.filter((match) => match.status === "LIVE").map((match) => match.id)), [matches]);
  const focus = useMemo(() => focusPageIndices(plan.pages, liveIds), [plan.pages, liveIds]);

  // Rodízio entre as páginas em foco (só no telão e só quando há mais de uma).
  const [cursor, setCursor] = useState(0);
  const rotates = tv && plan.paged && focus.length > 1;
  useEffect(() => {
    if (!rotates) return;
    const timer = setInterval(() => setCursor((value) => value + 1), PAGE_ROTATE_MS);
    return () => clearInterval(timer);
  }, [rotates]);
  // Uma luta acabou de terminar: a página dela fica na tela até o vencedor chegar ao destino (senão a animação passaria fora de vista).
  const [hold, setHold] = useState<number | null>(null);
  const heldIndex = hold === null ? -1 : plan.pages.findIndex((p) => p.matchIds.includes(hold));
  const pageIndex = heldIndex >= 0 ? heldIndex : focus.length === 0 ? 0 : focus[cursor % focus.length]!;
  const page = plan.pages[pageIndex] ?? plan.pages[0]!;
  const layout = page.layout;

  const [active, setActive] = useState<ActiveAdvance | null>(null);
  useEffect(() => {
    if (advances.length > 0) {
      setActive({ key: advanceKey, items: advances });
      setHold(advances[advances.length - 1]!.matchId);
    }
    // Só um snapshot novo (advanceKey) dispara; um snapshot sem resultado novo NÃO interrompe a animação em curso.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advanceKey]);
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setActive(null), reducedMotion ? ADVANCE_REDUCED_MS : ADVANCE_MS + 150);
    return () => clearTimeout(timer);
  }, [active, reducedMotion]);
  useEffect(() => {
    if (hold === null) return;
    const timer = setTimeout(() => setHold(null), reducedMotion ? ADVANCE_REDUCED_MS : HOLD_PAGE_MS);
    return () => clearTimeout(timer);
  }, [hold, reducedMotion]);

  const rawScale = tv ? (plan.scales[page.index] ?? 1) : area.width > 0 ? Math.min(1.15, Math.max(1, area.width / layout.width)) : 1;
  const scale = Math.max(0.15, rawScale);
  const activeItems = active?.items ?? [];
  const bumpedIds = new Set(activeItems.map((item) => item.nextMatchId).filter((id): id is number => id !== null));
  const finishedIds = new Set(activeItems.map((item) => item.matchId));
  const arrivals = new Map<number, Slot>();
  for (const item of activeItems) if (item.nextMatchId !== null && item.nextSlot !== null) arrivals.set(item.nextMatchId, item.nextSlot);
  const connectorById = new Map(layout.connectors.map((c) => [c.fromMatchId, c]));
  const visibleAdvances = activeItems.filter((item) => connectorById.has(item.matchId));

  const cardStyle = (card: BracketCard) => ({ left: card.x, top: card.y, width: card.w, height: card.h });

  const renderCard = (card: BracketCard, index: number) => {
    const match = matchById.get(card.matchId);
    if (!match) return null;
    const bumped = bumpedIds.has(card.matchId);
    const inner = (
      <MatchCard
        match={match}
        byId={byId}
        highlight={bumped ? "advanced" : null}
        arrivedSlot={arrivals.get(card.matchId) ?? null}
        justFinished={finishedIds.has(card.matchId)}
        queueRank={queueRanks?.get(card.matchId) ?? null}
        style={{ width: "100%", height: "100%" }}
      />
    );
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
        initial={{ opacity: 0, y: 12 }}
        animate={bumped ? { opacity: 1, y: 0, scale: [1, 1.05, 1] } : { opacity: 1, y: 0, scale: 1 }}
        transition={bumped ? { delay: 0.5, duration: 0.45 } : { delay: Math.min(index * 0.02, 0.4), duration: 0.32 }}
      >
        {inner}
      </m.div>
    );
  };

  const pagerLabel = plan.paged ? (plan.pages.length <= 9 ? `${page.label} · ${page.index + 1}/${page.count}` : page.label) : null;

  return (
    <LazyMotion features={domAnimation} strict>
      <section className="cv-bracket" ref={wrapRef} data-tv={tv ? "1" : undefined} data-paged={plan.paged ? "1" : undefined} aria-label="Chave de lutas">
        {tv && pagerLabel && (
          <div className="cv-pager" data-testid="cv-pager">
            <BracketIcon className="cv-pager-icon" />
            <span>{pagerLabel}</span>
            {plan.pages.length <= 9 && (
            <span className="cv-pager-dots" aria-hidden="true">
              {plan.pages.map((p) => (
                <i key={p.id} data-on={p.index === page.index ? "1" : undefined} data-focus={focus.includes(p.index) ? "1" : undefined} />
              ))}
            </span>
            )}
          </div>
        )}
        <div className="cv-bracket-scroll">
          <div className="cv-stage" key={page.id} style={{ width: layout.width * scale, height: layout.height * scale }}>
            <div className="cv-stage-inner" data-page={page.id} style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>
              {layout.columns.map((column) => (
                <div key={column.round} className="cv-col-label" data-final={column.label === "Final" ? "1" : undefined} style={{ left: column.x, width: layout.cards[0]?.w ?? 0 }}>
                  {column.label}
                </div>
              ))}
              {layout.third && (
                <div className="cv-col-label" style={{ left: layout.third.x, top: layout.third.y - 30, width: layout.third.w }}>
                  Disputa de 3º lugar
                </div>
              )}
              <svg className="cv-links" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true" focusable="false">
                {layout.connectors.map((connector) => {
                  const from = matchById.get(connector.fromMatchId);
                  const done = from?.status === "FINISHED" && from.winnerId !== null;
                  return <path key={`${connector.fromMatchId}-${connector.toMatchId}`} d={connector.d} className="cv-link" data-done={done ? "1" : undefined} fill="none" />;
                })}
                {visibleAdvances.map((item) => {
                  const connector = connectorById.get(item.matchId)!;
                  return reducedMotion ? (
                    <path key={`run-${item.matchId}`} d={connector.d} className="cv-link-run" data-motion="off" fill="none" />
                  ) : (
                    <g key={`run-${item.matchId}-${active?.key ?? 0}`}>
                      <m.path
                        d={connector.d}
                        className="cv-link-trail"
                        fill="none"
                        initial={{ pathLength: 0, opacity: 0.7 }}
                        animate={{ pathLength: 1, opacity: [0.7, 0.7, 0] }}
                        transition={{ duration: ADVANCE_MS / 1000 + 0.05, ease: "easeInOut" }}
                      />
                      <m.path
                        d={connector.d}
                        className="cv-link-run"
                        data-motion="on"
                        fill="none"
                        initial={{ pathLength: 0 }}
                        animate={{ pathLength: 1 }}
                        transition={{ duration: ADVANCE_MS / 1000 - 0.1, ease: "easeInOut" }}
                      />
                    </g>
                  );
                })}
              </svg>
              {layout.cards.map(renderCard)}
              {!reducedMotion &&
                visibleAdvances.map((item) => {
                  const connector = connectorById.get(item.matchId)!;
                  const winner = item.advancedCompetitorId === null ? undefined : byId.get(item.advancedCompetitorId);
                  if (!winner) return null;
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
                        scale: [1, 1.2, 1.2, 0.8],
                      }}
                      transition={{ duration: ADVANCE_MS / 1000, times: [0, 0.4, 0.75, 1], ease: "easeInOut" }}
                    >
                      <Avatar id={winner.id} name={winner.name} photoUrl={winner.photoUrl} group={winner.group} size={CHIP} />
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
