import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LazyMotion, domAnimation, m } from "motion/react";
import { athletePathMatchIds } from "@/lib/chaveamento/athlete-search";
import type { BracketCard } from "@/lib/chaveamento/bracket-layout";
import { focusPageIndices, planBracketPages } from "@/lib/chaveamento/bracket-pages";
import {
  VIRTUALIZE_MIN_CARDS,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  cardsInWindow,
  clampZoom,
  fitWidthScale,
  isOutsideWindow,
  quantizeWindow,
  scrollLeftToCenter,
  type ViewWindow,
} from "@/lib/chaveamento/bracket-window";
import type { FinishedMatchEvent } from "@/lib/chaveamento/snapshot-diff";
import type { PublicCompetitor, PublicMatch, Slot } from "@/lib/chaveamento/types";
import { Avatar } from "./avatar";
import { BracketIcon, FitIcon, MinusIcon, PlusIcon, TargetIcon } from "./icons";
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
/** Fora do telão a faixa de rodadas é a própria legenda: só sobra o respiro para a etiqueta que sai acima do cartão. */
const PAGE_LAYOUT = { headerH: 6 } as const;
/** Janela do primeiro desenho de uma chave grande (antes de medir a tela): só o canto de cima à esquerda. */
const FIRST_WINDOW: ViewWindow = { x0: 0, x1: 1_200, y0: 0, y1: 1_600 };

export interface BracketScrollRequest {
  matchId: number;
  /** Muda a cada pedido (o mesmo cartão pode ser pedido de novo). */
  nonce: number;
}

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
  /** Atleta em destaque (busca ou toque): o caminho dele fica aceso e o resto esmaece. */
  focusId?: number | null;
  /** Toque num atleta de um cartão (fora do telão). */
  onPickAthlete?: (competitorId: number) => void;
  /** Rola a chave até uma luta (resultado da busca). */
  scrollRequest?: BracketScrollRequest | null;
}

interface ActiveAdvance {
  key: number;
  items: readonly FinishedMatchEvent[];
}

/**
 * Chave em colunas por rodada: conectores em SVG e cartões HTML sobre o mesmo palco, que se ajusta à tela (modo telão) ou
 * rola na horizontal (celular, com encaixe por rodada, legenda de rodadas fixa e botões de zoom). No telão, uma chave grande
 * demais para ficar legível é dividida em PÁGINAS (metades, quadrantes + fase final) e o telão fica na que tem luta ao vivo.
 * Quando uma luta termina, o vencedor "corre" pela linha até o cartão da próxima luta (traço com rastro luminoso + avatar que
 * percorre o cotovelo + encaixe no cartão seguinte). Chaves grandes (128 atletas) só desenham os cartões perto da tela.
 * `reducedMotion`: nenhum movimento, só cor/borda.
 */
export function BracketView({ matches, byId, advances, advanceKey, tv, reducedMotion, queueRanks, focusId = null, onPickAthlete, scrollRequest = null }: BracketViewProps) {
  const matchById = useMemo(() => new Map(matches.map((match) => [match.id, match])), [matches]);
  const [wrapRef, area] = useElementSize<HTMLDivElement>();

  const plan = useMemo(
    () => planBracketPages(matches, tv ? area : { width: 0, height: 0 }, { minScale: TV_MIN_SCALE, maxScale: TV_MAX_SCALE, ...(tv ? {} : { layout: PAGE_LAYOUT }) }),
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

  /* ------------------------------------------------ escala, zoom e janela visível (fora do telão) ------------------------------------------------ */

  const [zoom, setZoom] = useState(1);
  const baseScale = area.width > 0 ? Math.min(1.15, Math.max(1, area.width / layout.width)) : 1;
  const rawScale = tv ? (plan.scales[page.index] ?? 1) : baseScale * zoom;
  const scale = Math.max(0.15, rawScale);

  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef(0);
  const virtualize = !tv && layout.cards.length >= VIRTUALIZE_MIN_CARDS;
  const [win, setWin] = useState<ViewWindow | null>(null);
  const [fabOn, setFabOn] = useState(false);

  /** Luta para o botão flutuante: a ao vivo (a de maior rodada); sem nenhuma, a final. */
  const fabTarget = useMemo(() => {
    const mainCards = layout.cards.filter((card) => card.stage === "MAIN");
    const live = layout.cards.filter((card) => liveIds.has(card.matchId)).sort((a, b) => b.round - a.round)[0];
    if (live) return { card: live, label: "Ir para a luta ao vivo" };
    const last = mainCards.reduce<BracketCard | null>((best, card) => (best === null || card.round > best.round ? card : best), null);
    return last ? { card: last, label: "Ir para a final" } : null;
  }, [layout.cards, liveIds]);

  const syncView = useCallback((): void => {
    const scroller = scrollerRef.current;
    const stage = stageRef.current;
    if (!scroller || !stage || tv) return;
    if (stripRef.current) stripRef.current.style.transform = `translate3d(${-scroller.scrollLeft}px,0,0)`;
    const top = stage.getBoundingClientRect().top;
    const height = window.innerHeight;
    const view: ViewWindow = { x0: scroller.scrollLeft / scale, x1: (scroller.scrollLeft + scroller.clientWidth) / scale, y0: -top / scale, y1: (height - top) / scale };
    if (virtualize) {
      // Uma tela de folga para cada lado: o que está prestes a aparecer já está desenhado.
      const padX = scroller.clientWidth / scale;
      const padY = height / scale;
      const next = quantizeWindow({ x0: view.x0 - padX, x1: view.x1 + padX, y0: view.y0 - padY, y1: view.y1 + padY });
      setWin((previous) => (previous && previous.x0 === next.x0 && previous.x1 === next.x1 && previous.y0 === next.y0 && previous.y1 === next.y1 ? previous : next));
    }
    const sectionRect = wrapRef.current?.getBoundingClientRect();
    const sectionOnScreen = !!sectionRect && sectionRect.bottom > 0 && sectionRect.top < height;
    setFabOn(sectionOnScreen && fabTarget !== null && isOutsideWindow(fabTarget.card, view));
  }, [tv, scale, virtualize, fabTarget, wrapRef]);

  const scheduleSync = useCallback((): void => {
    if (frameRef.current !== 0) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = 0;
      syncView();
    });
  }, [syncView]);

  useEffect(() => {
    if (tv) return;
    syncView();
    const scroller = scrollerRef.current;
    scroller?.addEventListener("scroll", scheduleSync, { passive: true });
    window.addEventListener("scroll", scheduleSync, { passive: true });
    window.addEventListener("resize", scheduleSync);
    return () => {
      scroller?.removeEventListener("scroll", scheduleSync);
      window.removeEventListener("scroll", scheduleSync);
      window.removeEventListener("resize", scheduleSync);
      if (frameRef.current !== 0) window.cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [tv, syncView, scheduleSync, area.width]);

  // Trocar o zoom mantém o centro da tela no mesmo ponto da chave.
  const previousScale = useRef(scale);
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller && !tv && previousScale.current !== scale) {
      const center = scroller.scrollLeft + scroller.clientWidth / 2;
      scroller.scrollLeft = (center * scale) / previousScale.current - scroller.clientWidth / 2;
    }
    previousScale.current = scale;
  }, [scale, tv]);

  const smooth = reducedMotion ? "auto" : "smooth";
  const scrollToMatch = useCallback(
    (matchId: number): void => {
      const scroller = scrollerRef.current;
      const stage = stageRef.current;
      const card = layout.cards.find((c) => c.matchId === matchId);
      if (!scroller || !stage || !card) return;
      const left = scrollLeftToCenter(card, scale, scroller.clientWidth, layout.width);
      try {
        scroller.scrollTo({ left, behavior: smooth });
      } catch {
        scroller.scrollLeft = left;
      }
      // Na vertical só rola a página se a luta estiver fora da tela (não pula à toa).
      const top = stage.getBoundingClientRect().top;
      const centerY = top + (card.y + card.h / 2) * scale;
      const height = window.innerHeight;
      if (centerY < height * 0.2 || centerY > height * 0.8) {
        try {
          window.scrollTo({ top: Math.max(0, window.scrollY + centerY - height / 2), behavior: smooth });
        } catch {
          /* sem rolagem suave: a página fica onde está */
        }
      }
    },
    [layout.cards, layout.width, scale, smooth],
  );

  // Pedido de rolagem (busca de atleta): atende uma vez por `nonce`, depois que o palco foi medido.
  const lastNonce = useRef<number | null>(null);
  useEffect(() => {
    if (tv || !scrollRequest || lastNonce.current === scrollRequest.nonce) return;
    lastNonce.current = scrollRequest.nonce;
    const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(() => scrollToMatch(scrollRequest.matchId)));
    return () => window.cancelAnimationFrame(frame);
  }, [tv, scrollRequest, scrollToMatch]);

  // Ao abrir a categoria, a rodada em andamento (a da luta ao vivo ou da próxima) já fica na tela; só na horizontal.
  const firstView = useRef(true);
  useEffect(() => {
    if (tv || !firstView.current || area.width <= 0) return;
    firstView.current = false;
    if (scrollRequest) return;
    const card = fabTarget && liveIds.size > 0 ? fabTarget.card : (layout.cards.find((c) => matchById.get(c.matchId)?.status === "READY") ?? null);
    const scroller = scrollerRef.current;
    if (!card || !scroller || layout.width * scale <= scroller.clientWidth) return;
    scroller.scrollLeft = scrollLeftToCenter(card, scale, scroller.clientWidth, layout.width);
    // Só na primeira medida da área.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tv, area.width]);

  const zoomBy = (factor: number): void => setZoom((value) => clampZoom(value * factor));
  const fitZoom = (): void => setZoom(clampZoom(fitWidthScale(layout.width, area.width) / baseScale));

  /* ------------------------------------------------ desenho ------------------------------------------------ */

  const activeItems = active?.items ?? [];
  const bumpedIds = new Set(activeItems.map((item) => item.nextMatchId).filter((id): id is number => id !== null));
  const finishedIds = new Set(activeItems.map((item) => item.matchId));
  const arrivals = new Map<number, Slot>();
  for (const item of activeItems) if (item.nextMatchId !== null && item.nextSlot !== null) arrivals.set(item.nextMatchId, item.nextSlot);
  const connectorById = new Map(layout.connectors.map((c) => [c.fromMatchId, c]));
  const visibleAdvances = activeItems.filter((item) => connectorById.has(item.matchId));

  const pathIds = useMemo(() => {
    if (tv || focusId === null) return null;
    const ids = athletePathMatchIds(matches, focusId);
    return ids.size > 0 ? ids : null;
  }, [tv, focusId, matches]);

  const cardStyle = (card: BracketCard) => ({ left: card.x, top: card.y, width: card.w, height: card.h });
  const drawn = virtualize ? cardsInWindow(layout.cards, win ?? FIRST_WINDOW) : layout.cards;
  const plain = reducedMotion || virtualize;

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
        focusId={pathIds ? focusId : null}
        path={pathIds ? (pathIds.has(card.matchId) ? "on" : "off") : null}
        onPickAthlete={tv ? undefined : onPickAthlete}
        style={{ width: "100%", height: "100%" }}
      />
    );
    if (plain) {
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
  const labelW = (layout.cards[0]?.w ?? 0) * scale;

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
        {!tv && (
          <div className="cv-bracket-bar" data-testid="cv-bracket-bar">
            <div className="cv-strip" aria-hidden="true">
              <div className="cv-strip-track" ref={stripRef} style={{ width: layout.width * scale }}>
                {layout.columns.map((column) => (
                  <span key={column.round} className="cv-strip-label" data-final={column.label === "Final" ? "1" : undefined} style={{ left: column.x * scale, width: labelW }}>
                    <span className="cv-strip-text">{column.label}</span>
                  </span>
                ))}
              </div>
            </div>
            <div className="cv-zoom" role="group" aria-label="Zoom da chave">
              <button type="button" className="cv-zoom-btn" onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={zoom <= ZOOM_MIN + 0.001} aria-label="Diminuir a chave" data-testid="cv-zoom-out">
                <MinusIcon aria-hidden="true" />
              </button>
              <button type="button" className="cv-zoom-btn" onClick={fitZoom} aria-label="Ajustar a chave à largura da tela" data-testid="cv-zoom-fit">
                <FitIcon aria-hidden="true" />
              </button>
              <button type="button" className="cv-zoom-btn" onClick={() => zoomBy(ZOOM_STEP)} disabled={zoom >= ZOOM_MAX - 0.001} aria-label="Ampliar a chave" data-testid="cv-zoom-in">
                <PlusIcon aria-hidden="true" />
              </button>
            </div>
          </div>
        )}
        <div className="cv-bracket-scroll" ref={scrollerRef} data-testid="cv-bracket-scroll" tabIndex={tv ? undefined : 0} role={tv ? undefined : "group"} aria-label={tv ? undefined : "Rolagem da chave de lutas"}>
          <div className="cv-stage" ref={stageRef} key={page.id} style={{ width: layout.width * scale, height: layout.height * scale }}>
            {!tv && layout.columns.map((column) => <span key={`snap-${column.round}`} className="cv-snap" style={{ left: column.x * scale }} aria-hidden="true" />)}
            <div className="cv-stage-inner" data-page={page.id} data-virtual={virtualize ? "1" : undefined} style={{ width: layout.width, height: layout.height, transform: `scale(${scale})` }}>
              {tv &&
                layout.columns.map((column) => (
                  <div key={column.round} className="cv-col-label" data-final={column.label === "Final" ? "1" : undefined} style={{ left: column.x, width: layout.cards[0]?.w ?? 0 }}>
                    {column.label}
                  </div>
                ))}
              {layout.third && (
                <div className="cv-col-label" data-third="1" style={{ left: layout.third.x, top: layout.third.y - 30, width: layout.third.w }}>
                  Disputa de 3º lugar
                </div>
              )}
              <svg className="cv-links" width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} aria-hidden="true" focusable="false">
                {layout.connectors.map((connector) => {
                  const from = matchById.get(connector.fromMatchId);
                  const done = from?.status === "FINISHED" && from.winnerId !== null;
                  const onPath = pathIds ? pathIds.has(connector.fromMatchId) && pathIds.has(connector.toMatchId) : null;
                  return (
                    <path
                      key={`${connector.fromMatchId}-${connector.toMatchId}`}
                      d={connector.d}
                      className="cv-link"
                      data-done={done ? "1" : undefined}
                      data-path={onPath === null ? undefined : onPath ? "on" : "off"}
                      fill="none"
                    />
                  );
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
              {drawn.map(renderCard)}
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
        {!tv && fabOn && fabTarget && (
          <button type="button" className="cv-fab" onClick={() => scrollToMatch(fabTarget.card.matchId)} data-testid="cv-fab">
            <TargetIcon aria-hidden="true" />
            <span>{fabTarget.label}</span>
          </button>
        )}
      </section>
    </LazyMotion>
  );
}
