import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { announcementFor, type SnapshotDiff } from "@/lib/chaveamento/snapshot-diff";
import type { ConnectionStatus } from "@/lib/chaveamento/connection";
import { formatLabel } from "@/lib/chaveamento/describe";
import { CURSOR_IDLE_MS, useFullscreen, useIdle, useTvRotation, useWakeLock } from "@/lib/chaveamento/hooks";
import { categoryHasMatches, competitorsById, currentStageLabel, nextQueueRanks, pickInitialCategoryId, qualifiedIds, selectPodium } from "@/lib/chaveamento/selectors";
import type { PublicCategory, PublicSnapshot } from "@/lib/chaveamento/types";
import { CHAMPION_MS, useCelebration, useIntroQueue } from "@/lib/chaveamento/use-broadcast-events";
import { useLiveTournament } from "@/lib/chaveamento/use-live-tournament";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import "@fontsource/barlow-condensed/latin-700.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "./chaveamento.css";
import { BracketView } from "./bracket-view";
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

function Shell({ tv, idle = false, children, busy = false }: { tv: boolean; idle?: boolean; children: ReactNode; busy?: boolean }) {
  return (
    <div className="cv-root" data-tv={tv ? "1" : undefined} data-idle={idle ? "1" : undefined} aria-busy={busy || undefined}>
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
export function LoadingScreen({ tv }: { tv: boolean }) {
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
        <p className="cv-skel-note" data-slow={slow ? "1" : undefined}>
          {slow ? (
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

function CategoryHeading({ category }: { category: PublicCategory }) {
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
}

function CategoryView({ category, diff, seq, tv, reducedMotion, queueRanks }: CategoryViewProps) {
  const byId = useMemo(() => competitorsById(category), [category]);
  const bracketMatches = useMemo(() => category.matches.filter((m) => m.stage === "MAIN" || m.stage === "THIRD_PLACE"), [category.matches]);
  const advances = useMemo(
    () => (diff && !diff.initial && !diff.stale ? diff.finished.filter((e) => e.categoryId === category.id && e.nextMatchId !== null) : []),
    [diff, category.id],
  );
  const qualified = useMemo(() => qualifiedIds(category), [category]);

  if (!categoryHasMatches(category)) {
    return (
      <div className="cv-category" data-testid="cv-category" data-empty="1">
        <CategoryHeading category={category} />
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
      <CategoryHeading category={category} />
      {!tv && hasChampion && <ChampionBanner category={category} />}
      <div className="cv-category-body">
        {podium}
        {showStandings && (
          <div className="cv-panel cv-panel-standings">
            <StandingsTable groups={category.standings} byId={byId} single={category.format === "ROUND_ROBIN"} qualified={qualified} tv={tv} />
            {!tv && showMatchList && <MatchList matches={category.matches} byId={byId} />}
          </div>
        )}
        {tv && showMatchList && (
          <div className="cv-panel cv-panel-matches">
            <MatchList matches={category.matches} byId={byId} tv />
          </div>
        )}
        {hasBracket && (
          <div className="cv-panel cv-panel-bracket">
            <BracketView matches={bracketMatches} byId={byId} advances={advances} advanceKey={seq} tv={tv} reducedMotion={reducedMotion} queueRanks={queueRanks} />
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
  tv: boolean;
  token: string;
}

function Board({ snapshot, diff, seq, status, tv, token }: BoardProps) {
  const reducedMotion = useReducedMotion();
  const fullscreen = useFullscreen();
  const idle = useIdle(CURSOR_IDLE_MS, tv);
  useWakeLock(tv);

  const [selected, setSelected] = useState<number | null>(() => pickInitialCategoryId(snapshot));
  const [paused, setPaused] = useState(false);
  const currentId = snapshot.categories.some((c) => c.id === selected) ? selected : pickInitialCategoryId(snapshot);
  const category = snapshot.categories.find((c) => c.id === currentId) ?? null;

  const onRotate = useCallback((id: number) => setSelected(id), []);
  const onPick = useCallback(
    (id: number) => {
      setSelected(id);
      if (tv) setPaused(true);
    },
    [tv],
  );
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
  const announcement = announcementFor(diff);
  const queueRanks = useMemo(() => (category ? nextQueueRanks(snapshot, category.id) : new Map<number, number>()), [snapshot, category]);

  return (
    <Shell tv={tv} idle={idle}>
      <LiveHeader
        organizationName={snapshot.organizationName}
        eventTitle={snapshot.event.title}
        eventDate={snapshot.event.date}
        location={snapshot.event.location}
        status={status}
        tv={tv}
        fullscreen={fullscreen}
        shareUrl={shareUrl}
        rotationPaused={paused}
        onResumeRotation={() => setPaused(false)}
        stageLabel={category ? currentStageLabel(category) : null}
      />
      {status === "reconnecting" && (
        <p className="cv-banner" data-testid="cv-offline-banner">
          <WifiOffIcon aria-hidden="true" /> Sem conexão com o servidor. Mostrando o último placar recebido; tentando reconectar.
        </p>
      )}
      {/* Anuncia só MUDANÇAS (luta terminou); o primeiro snapshot gera texto vazio. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="cv-announcer">
        {announcement}
      </div>
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
        {category && <CategoryView key={category.id} category={category} diff={diff} seq={seq} tv={tv} reducedMotion={reducedMotion} queueRanks={queueRanks} />}
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
}

/** Telão público ao vivo: só mostra o snapshot público; nada além dele é lido, guardado ou enviado. */
export function LivePage({ token, tv }: LivePageProps) {
  const state = useLiveTournament(token);
  if (state.status === "unavailable") return <UnavailableScreen tv={tv} />;
  if (!state.snapshot) return <LoadingScreen tv={tv} />;
  return <Board snapshot={state.snapshot} diff={state.diff} seq={state.seq} status={state.status} tv={tv} token={token} />;
}
