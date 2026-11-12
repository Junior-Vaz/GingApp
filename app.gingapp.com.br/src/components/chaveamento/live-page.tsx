import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AthleteHit } from "@/lib/chaveamento/athlete-search";
import { announcementFor, type SnapshotDiff } from "@/lib/chaveamento/snapshot-diff";
import type { ConnectionStatus } from "@/lib/chaveamento/connection";
import { formatLabel } from "@/lib/chaveamento/describe";
import { CURSOR_IDLE_MS, useFullscreen, useIdle, useTvRotation, useWakeLock } from "@/lib/chaveamento/hooks";
import { usePageChrome } from "@/lib/chaveamento/page-chrome";
import { useOnline, usePageVisible } from "@/lib/chaveamento/page-state";
import { withCategoryParam } from "@/lib/chaveamento/url-state";
import { categoryHasMatches, competitorsById, currentStageLabel, nextQueueRanks, pickInitialCategoryId, qualifiedIds, selectPodium } from "@/lib/chaveamento/selectors";
import type { PublicCategory, PublicSnapshot } from "@/lib/chaveamento/types";
import { CHAMPION_MS, useCelebration, useIntroQueue } from "@/lib/chaveamento/use-broadcast-events";
import { useLiveTournament } from "@/lib/chaveamento/use-live-tournament";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "./chaveamento.css";
import { AthleteSearch, type FocusedAthlete } from "./athlete-search";
import { BracketView, type BracketScrollRequest } from "./bracket-view";
import { CategoryTabs } from "./category-tabs";
import { ChampionBanner, ChampionOverlay } from "./champion";
import { ConfettiCanvas } from "./confetti-canvas";
import { BracketIcon, LogoMark, TrophyIcon, WifiOffIcon } from "./icons";
import { LiveHeader } from "./live-header";
import { NowPlaying } from "./now-playing";
import { Podium } from "./podium";
import { MatchList, StandingsTable } from "./standings-table";
import { VsIntro } from "./vs-intro";

/* ------------------------------------------------ telas de estado ------------------------------------------------ */

function Shell({ tv, idle = false, children, busy = false, chips = false }: { tv: boolean; idle?: boolean; children: ReactNode; busy?: boolean; chips?: boolean }) {
  // Aba oculta: as animações infinitas (pulso AO VIVO, brilho, varredura) pausam por CSS; ao voltar, seguem.
  const visible = usePageVisible();
  return (
    <div className="cv-root" data-tv={tv ? "1" : undefined} data-idle={idle ? "1" : undefined} data-hidden={visible ? undefined : "1"} data-chips={chips ? "1" : undefined} aria-busy={busy || undefined}>
      {children}
    </div>
  );
}

/** Marca discreta do GingApp nas telas de estado (mesma linguagem do cabeçalho). */
function BrandSign() {
  return (
    <p className="cv-sign" aria-hidden="true">
      <LogoMark size={22} /> GingApp
    </p>
  );
}

/** Esqueleto enquanto o primeiro snapshot não chega; depois de 10 s sem resposta avisa que continua tentando. */
export function LoadingScreen({ tv, offline = false }: { tv: boolean; offline?: boolean }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 10_000);
    return () => clearTimeout(timer);
  }, []);
  return (
    <Shell tv={tv} busy>
      <div className="cv-skeleton" role="status" aria-label="Carregando o chaveamento" data-testid="cv-loading">
        <div className="cv-skel-head">
          <LogoMark className="cv-skel-logo" size={tv ? 56 : 42} />
          <div className="cv-skel-lines">
            <div className="cv-skel cv-skel-kicker" />
            <div className="cv-skel cv-skel-title" />
          </div>
        </div>
        <div className="cv-skel-row">
          <div className="cv-skel cv-skel-tab" />
          <div className="cv-skel cv-skel-tab" />
          <div className="cv-skel cv-skel-tab" />
        </div>
        <div className="cv-skel-cols">
          {[0, 1, 2].map((column) => (
            <div key={column} className="cv-skel-col">
              {Array.from({ length: 4 - column }, (_, i) => (
                <div key={i} className="cv-skel cv-skel-card" />
              ))}
            </div>
          ))}
        </div>
        <p className="cv-skel-note" data-slow={slow || offline ? "1" : undefined}>
          {offline ? (
            <>
              <WifiOffIcon aria-hidden="true" /> Sem conexão. Assim que a internet voltar, o placar aparece.
            </>
          ) : slow ? (
            <>
              <WifiOffIcon aria-hidden="true" /> A conexão está demorando. Continuamos tentando, confira a internet do local.
            </>
          ) : (
            "Conectando ao campeonato…"
          )}
        </p>
      </div>
    </Shell>
  );
}

/** Texto genérico: nunca diz POR QUE (link trocado, desligado, expirado ou inexistente são indistinguíveis de propósito). */
export function UnavailableScreen({ tv }: { tv: boolean }) {
  return (
    <Shell tv={tv}>
      <main className="cv-unavailable" data-testid="cv-unavailable">
        <span className="cv-state-icon" aria-hidden="true">
          <BracketIcon />
        </span>
        <h1>Este campeonato não está disponível</h1>
        <p>Confira o link com a organização do evento.</p>
        <BrandSign />
      </main>
    </Shell>
  );
}

/* ------------------------------------------------ uma categoria ------------------------------------------------ */

function CategoryHeading({ category, stageLabel = null }: { category: PublicCategory; stageLabel?: string | null }) {
  const count = category.competitors.length;
  const finished = category.status === "FINISHED";
  const running = category.status === "RUNNING";
  return (
    <div className="cv-cat-head" data-testid="cv-cat-head">
      <h2 className="cv-cat-title">{category.name}</h2>
      <span className="cv-cat-meta">
        {formatLabel(category.format)}
        {count > 0 ? ` · ${count} ${count === 1 ? "atleta" : "atletas"}` : ""}
      </span>
      <span className="cv-cat-state" data-state={category.status}>
        {finished ? (
          <>
            <TrophyIcon aria-hidden="true" /> ENCERRADA
          </>
        ) : running ? (
          "EM ANDAMENTO"
        ) : (
          "AGUARDANDO SORTEIO"
        )}
      </span>
      {running && stageLabel && (
        <span className="cv-cat-stage" aria-hidden="true" data-testid="cv-cat-stage">
          {stageLabel}
        </span>
      )}
    </div>
  );
}

interface CategoryViewProps {
  category: PublicCategory;
  diff: SnapshotDiff | null;
  seq: number;
  tv: boolean;
  reducedMotion: boolean;
  queueRanks: ReadonlyMap<number, number>;
  stageLabel: string | null;
  /** Atleta em destaque nesta categoria (busca ou toque). */
  focusId: number | null;
  onPickAthlete: (competitorId: number) => void;
  scrollRequest: BracketScrollRequest | null;
}

function CategoryView({ category, diff, seq, tv, reducedMotion, queueRanks, stageLabel, focusId, onPickAthlete, scrollRequest }: CategoryViewProps) {
  const byId = useMemo(() => competitorsById(category), [category]);
  const bracketMatches = useMemo(() => category.matches.filter((m) => m.stage === "MAIN" || m.stage === "THIRD_PLACE"), [category.matches]);
  const advances = useMemo(
    () => (diff && !diff.initial && !diff.stale ? diff.finished.filter((e) => e.categoryId === category.id && e.nextMatchId !== null) : []),
    [diff, category.id],
  );
  const qualified = useMemo(() => qualifiedIds(category), [category]);

  // Busca de atleta cuja luta é de grupo (tabela): rola a página até a luta dele (a chave se rola sozinha).
  useEffect(() => {
    if (tv || !scrollRequest) return;
    const target = category.matches.find((m) => m.id === scrollRequest.matchId);
    if (!target || target.stage !== "GROUP") return;
    const timer = setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-match-id="${target.id}"]`);
      try {
        el?.scrollIntoView?.({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
      } catch {
        /* sem rolagem suave */
      }
    }, 120);
    return () => clearTimeout(timer);
    // Só um pedido novo (nonce) rola.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest?.nonce]);

  if (!categoryHasMatches(category)) {
    return (
      <div className="cv-category" data-testid="cv-category" data-empty="1">
        <CategoryHeading category={category} stageLabel={stageLabel} />
        <div className="cv-empty" data-testid="cv-empty">
          <span className="cv-state-icon cv-breathe" aria-hidden="true">
            <BracketIcon />
          </span>
          <p>Chave ainda não sorteada</p>
          <span>Assim que a organização sortear, ela aparece aqui.</span>
        </div>
      </div>
    );
  }

  const finished = category.status === "FINISHED";
  const hasChampion = finished && selectPodium(category).champion !== null;
  const hasBracket = bracketMatches.length > 0;
  const hasGroupMatches = category.matches.some((m) => m.stage === "GROUP");
  const showStandings = category.format !== "SINGLE_ELIMINATION";
  const podium = finished ? <Podium podium={category.podium} byId={byId} reducedMotion={reducedMotion} tv={tv} /> : null;
  const showMatchList = hasGroupMatches && !(category.format === "GROUPS_KNOCKOUT" && hasBracket && tv);

  return (
    <div className="cv-category" data-format={category.format} data-finished={finished ? "1" : undefined} data-testid="cv-category">
      <CategoryHeading category={category} stageLabel={stageLabel} />
      {!tv && hasChampion && <ChampionBanner category={category} />}
      <div className="cv-category-body">
        {podium}
        {showStandings && (
          <div className="cv-panel cv-panel-standings">
            <StandingsTable groups={category.standings} byId={byId} single={category.format === "ROUND_ROBIN"} qualified={qualified} focusId={focusId} tv={tv} />
            {!tv && showMatchList && <MatchList matches={category.matches} byId={byId} focusId={focusId} />}
          </div>
        )}
        {tv && showMatchList && (
          <div className="cv-panel cv-panel-matches">
            <MatchList matches={category.matches} byId={byId} tv />
          </div>
        )}
        {hasBracket && (
          <div className="cv-panel cv-panel-bracket">
            <BracketView
              matches={bracketMatches}
              byId={byId}
              advances={advances}
              advanceKey={seq}
              tv={tv}
              reducedMotion={reducedMotion}
              queueRanks={queueRanks}
              focusId={focusId}
              onPickAthlete={onPickAthlete}
              scrollRequest={scrollRequest}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------ quadro ------------------------------------------------ */

interface BoardProps {
  snapshot: PublicSnapshot;
  diff: SnapshotDiff | null;
  seq: number;
  status: ConnectionStatus;
  offline: boolean;
  tv: boolean;
  token: string;
  /** Categoria pedida pelo link (`?categoria=`): só vale se existir neste campeonato. */
  categoryId: number | null;
  /** Texto de pré-busca do link (`?q=`), já limpo. */
  initialQuery: string;
}

/** Aviso de reconexão só depois de uns segundos (uma queda curta não pisca a tela); sem rede avisa na hora. */
const RECONNECT_NOTICE_MS = 3_000;

/** Troca a categoria na URL sem recarregar e sem empilhar histórico (preserva `tv` e o resto). */
function syncCategoryUrl(categoryId: number): void {
  try {
    window.history.replaceState(window.history.state, "", withCategoryParam(window.location.href, categoryId));
  } catch {
    /* sem History API: a URL só não acompanha */
  }
}

function Board({ snapshot, diff, seq, status, offline, tv, token, categoryId, initialQuery }: BoardProps) {
  const reducedMotion = useReducedMotion();
  const fullscreen = useFullscreen();
  const idle = useIdle(CURSOR_IDLE_MS, tv);
  useWakeLock(tv);

  const [selected, setSelected] = useState<number | null>(() =>
    categoryId !== null && snapshot.categories.some((c) => c.id === categoryId) ? categoryId : pickInitialCategoryId(snapshot),
  );
  const [paused, setPaused] = useState(false);
  const [focus, setFocus] = useState<FocusedAthlete | null>(null);
  const [scrollReq, setScrollReq] = useState<(BracketScrollRequest & { categoryId: number }) | null>(null);
  const nonce = useRef(0);
  const currentId = snapshot.categories.some((c) => c.id === selected) ? selected : pickInitialCategoryId(snapshot);
  const category = snapshot.categories.find((c) => c.id === currentId) ?? null;
  // Trocar de categoria no celular: o chip acende na hora (urgente) e a chave nova é desenhada logo em seguida, sem travar o
  // toque (INP). No telão o desenho é imediato (o rodízio e a abertura VS dependem disso).
  const deferredId = useDeferredValue(currentId);
  const shownCategory = tv ? category : (snapshot.categories.find((c) => c.id === deferredId) ?? category);

  const onRotate = useCallback((id: number) => setSelected(id), []);
  const onPick = useCallback(
    (id: number) => {
      setSelected(id);
      setScrollReq(null);
      syncCategoryUrl(id);
      if (tv) setPaused(true);
    },
    [tv],
  );
  // Busca ("Acompanhar meu atleta"): vai para a categoria do atleta, destaca o caminho e rola até a luta dele.
  const onFocusAthlete = useCallback((hit: AthleteHit | null, scroll: boolean) => {
    if (hit === null) {
      setFocus(null);
      return;
    }
    setFocus({ categoryId: hit.categoryId, competitorId: hit.competitor.id });
    setSelected(hit.categoryId);
    syncCategoryUrl(hit.categoryId);
    if (scroll && hit.targetMatchId !== null) {
      nonce.current += 1;
      setScrollReq({ matchId: hit.targetMatchId, nonce: nonce.current, categoryId: hit.categoryId });
    }
  }, []);
  // Toque num atleta da chave: acende (ou apaga) o caminho dele.
  const onTapAthlete = useCallback((categoryOfCard: number, competitorId: number) => {
    setFocus((previous) => (previous && previous.categoryId === categoryOfCard && previous.competitorId === competitorId ? null : { categoryId: categoryOfCard, competitorId }));
  }, []);

  // Aviso "Reconectando": sem rede é imediato; queda curta com rede só avisa depois de alguns segundos.
  const [reconnectLate, setReconnectLate] = useState(false);
  useEffect(() => {
    if (status !== "reconnecting" || offline) {
      setReconnectLate(false);
      return;
    }
    const timer = setTimeout(() => setReconnectLate(true), RECONNECT_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [status, offline]);
  const startedCategoryIds = useMemo(() => (diff && !diff.initial && !diff.stale ? [...new Set(diff.started.map((s) => s.categoryId))] : []), [diff]);
  useTvRotation({ enabled: tv, paused, snapshot, currentId, seq, startedCategoryIds, onSelect: onRotate });

  // Abertura "VS" (só no telão e só com movimento) e tela de campeão: nascem de DIFERENÇAS entre snapshots, nunca da primeira carga.
  const intro = useIntroQueue({ diff, seq, enabled: tv && !reducedMotion });
  const celebration = useCelebration({ diff, seq });
  const celebrated = celebration ? (snapshot.categories.find((c) => c.id === celebration.categoryId) ?? null) : null;
  const showChampion = tv && !reducedMotion && celebrated !== null && selectPodium(celebrated).champion !== null;

  // No telão, a categoria que acabou de terminar vira a tela (o pódio permanente fica por baixo da tela de campeão).
  const celebrationSeq = celebration?.seq ?? 0;
  const celebrationCategory = celebration?.categoryId ?? null;
  useEffect(() => {
    if (tv && !paused && celebrationCategory !== null) setSelected(celebrationCategory);
    // Só reage a uma comemoração nova.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [celebrationSeq]);

  useEffect(() => {
    const previous = document.title;
    document.title = `${snapshot.event.title} — Ao vivo`;
    return () => {
      document.title = previous;
    };
  }, [snapshot.event.title]);

  const shareUrl = `${window.location.origin}/ao-vivo/${encodeURIComponent(token)}`;
  // O botão "Compartilhar" leva a categoria que está na tela; o QR do telão leva ao campeonato todo.
  const shareLinkUrl = currentId === null ? shareUrl : `${shareUrl}?categoria=${currentId}`;
  const announcement = announcementFor(diff);
  const queueRanks = useMemo(() => (shownCategory ? nextQueueRanks(snapshot, shownCategory.id) : new Map<number, number>()), [snapshot, shownCategory]);

  return (
    <Shell tv={tv} idle={idle} chips={snapshot.categories.length > 1}>
      <LiveHeader
        organizationName={snapshot.organizationName}
        eventTitle={snapshot.event.title}
        eventDate={snapshot.event.date}
        location={snapshot.event.location}
        status={status}
        offline={offline}
        tv={tv}
        fullscreen={fullscreen}
        shareUrl={shareUrl}
        shareLinkUrl={shareLinkUrl}
        rotationPaused={paused}
        onResumeRotation={() => setPaused(false)}
        stageLabel={category ? currentStageLabel(category) : null}
      />
      {offline ? (
        <p className="cv-banner" role="status" data-testid="cv-offline-banner" data-offline="1">
          <WifiOffIcon aria-hidden="true" /> Sem conexão — mostrando o último placar.
        </p>
      ) : (
        status === "reconnecting" &&
        reconnectLate && (
          <p className="cv-banner" role="status" data-testid="cv-offline-banner">
            <WifiOffIcon aria-hidden="true" /> Sem conexão com o servidor. Mostrando o último placar recebido; tentando reconectar.
          </p>
        )
      )}
      {/* Anuncia só MUDANÇAS (luta terminou); o primeiro snapshot gera texto vazio. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="cv-announcer">
        {announcement}
      </div>
      {!tv && <AthleteSearch snapshot={snapshot} initialQuery={initialQuery} focus={focus} onFocus={onFocusAthlete} />}
      <NowPlaying snapshot={snapshot} tv={tv} />
      <CategoryTabs categories={snapshot.categories} selectedId={currentId} onSelect={onPick} />
      <main className="cv-main">
        {snapshot.categories.length === 0 && (
          <div className="cv-empty" data-testid="cv-empty">
            <span className="cv-state-icon cv-breathe" aria-hidden="true">
              <BracketIcon />
            </span>
            <p>Ainda não há categorias neste campeonato</p>
          </div>
        )}
        {shownCategory && (
          <CategoryView
            key={shownCategory.id}
            category={shownCategory}
            diff={diff}
            seq={seq}
            tv={tv}
            reducedMotion={reducedMotion}
            queueRanks={queueRanks}
            stageLabel={currentStageLabel(shownCategory)}
            focusId={focus && focus.categoryId === shownCategory.id ? focus.competitorId : null}
            onPickAthlete={(competitorId) => onTapAthlete(shownCategory.id, competitorId)}
            scrollRequest={scrollReq && scrollReq.categoryId === shownCategory.id ? scrollReq : null}
          />
        )}
      </main>
      {intro && !showChampion && <VsIntro key={`vs-${intro.matchId}`} intro={intro} />}
      {showChampion && celebrated && <ChampionOverlay key={`champion-${celebrationSeq}`} category={celebrated} />}
      {celebration && !reducedMotion && <ConfettiCanvas key={`confetti-${celebrationSeq}`} durationMs={tv ? CHAMPION_MS - 2_000 : 5_000} />}
    </Shell>
  );
}

/* ------------------------------------------------ página ------------------------------------------------ */

export interface LivePageProps {
  token: string;
  /** `?tv=1`: fontes grandes, sem rolagem, contraste alto, rodízio automático e tela sempre acesa. */
  tv: boolean;
  /** `?categoria=<id>`: abre nessa categoria (id inexistente é ignorado em silêncio). */
  categoryId?: number | null;
  /** `?q=<texto>`: pré-busca de atleta ou grupo (só texto). */
  initialQuery?: string;
}

/** Telão público ao vivo: só mostra o snapshot público; nada além dele é lido, guardado ou enviado. */
export function LivePage({ token, tv, categoryId = null, initialQuery = "" }: LivePageProps) {
  const state = useLiveTournament(token);
  const online = useOnline();
  usePageChrome();
  if (state.status === "unavailable") return <UnavailableScreen tv={tv} />;
  if (!state.snapshot) return <LoadingScreen tv={tv} offline={state.offline || !online} />;
  return (
    <Board
      snapshot={state.snapshot}
      diff={state.diff}
      seq={state.seq}
      status={state.status}
      offline={state.offline || !online}
      tv={tv}
      token={token}
      categoryId={categoryId}
      initialQuery={initialQuery}
    />
  );
}
