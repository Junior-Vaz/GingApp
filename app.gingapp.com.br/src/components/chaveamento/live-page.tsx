import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { announcementFor, type SnapshotDiff } from "@/lib/chaveamento/snapshot-diff";
import type { ConnectionStatus } from "@/lib/chaveamento/connection";
import { CURSOR_IDLE_MS, useFullscreen, useIdle, useTvRotation, useWakeLock } from "@/lib/chaveamento/hooks";
import { categoryHasMatches, competitorsById, pickInitialCategoryId } from "@/lib/chaveamento/selectors";
import type { PublicCategory, PublicSnapshot } from "@/lib/chaveamento/types";
import { useLiveTournament } from "@/lib/chaveamento/use-live-tournament";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import "./chaveamento.css";
import { BracketView } from "./bracket-view";
import { CategoryTabs } from "./category-tabs";
import { LiveHeader } from "./live-header";
import { NowPlaying } from "./now-playing";
import { Podium } from "./podium";
import { MatchList, StandingsTable } from "./standings-table";

/* ------------------------------------------------ telas de estado ------------------------------------------------ */

function Shell({ tv, idle = false, children, busy = false }: { tv: boolean; idle?: boolean; children: ReactNode; busy?: boolean }) {
  return (
    <div className="cv-root" data-tv={tv ? "1" : undefined} data-idle={idle ? "1" : undefined} aria-busy={busy || undefined}>
      {children}
    </div>
  );
}

/** Esqueleto enquanto o primeiro snapshot não chega. */
export function LoadingScreen({ tv }: { tv: boolean }) {
  return (
    <Shell tv={tv} busy>
      <div className="cv-skeleton" role="status" aria-label="Carregando o chaveamento" data-testid="cv-loading">
        <div className="cv-skel cv-skel-title" />
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
      </div>
    </Shell>
  );
}

/** Texto genérico: nunca diz POR QUE (link trocado, desligado, expirado ou inexistente são indistinguíveis de propósito). */
export function UnavailableScreen({ tv }: { tv: boolean }) {
  return (
    <Shell tv={tv}>
      <main className="cv-unavailable" data-testid="cv-unavailable">
        <h1>Este campeonato não está disponível</h1>
        <p>Confira o link com a organização do evento.</p>
      </main>
    </Shell>
  );
}

/* ------------------------------------------------ uma categoria ------------------------------------------------ */

interface CategoryViewProps {
  category: PublicCategory;
  diff: SnapshotDiff | null;
  seq: number;
  tv: boolean;
  reducedMotion: boolean;
}

function CategoryView({ category, diff, seq, tv, reducedMotion }: CategoryViewProps) {
  const byId = useMemo(() => competitorsById(category), [category]);
  const bracketMatches = useMemo(() => category.matches.filter((m) => m.stage === "MAIN" || m.stage === "THIRD_PLACE"), [category.matches]);
  const advances = useMemo(
    () => (diff && !diff.initial && !diff.stale ? diff.finished.filter((e) => e.categoryId === category.id && e.nextMatchId !== null) : []),
    [diff, category.id],
  );

  if (!categoryHasMatches(category)) {
    return (
      <div className="cv-empty" data-testid="cv-empty">
        <p>Chave ainda não sorteada</p>
        <span>Assim que a organização sortear, ela aparece aqui.</span>
      </div>
    );
  }

  const celebrate = diff !== null && diff.categoriesFinished.includes(category.id);
  const podium = category.status === "FINISHED" ? <Podium podium={category.podium} byId={byId} celebrate={celebrate} reducedMotion={reducedMotion} tv={tv} /> : null;
  const hasBracket = bracketMatches.length > 0;
  const hasGroupMatches = category.matches.some((m) => m.stage === "GROUP");
  const showStandings = category.format !== "SINGLE_ELIMINATION";

  return (
    <div className="cv-category" data-format={category.format} data-testid="cv-category">
      {podium}
      {showStandings && (
        <div className="cv-panel">
          <StandingsTable groups={category.standings} byId={byId} single={category.format === "ROUND_ROBIN"} />
          {hasGroupMatches && !(category.format === "GROUPS_KNOCKOUT" && hasBracket && tv) && <MatchList matches={category.matches} byId={byId} />}
        </div>
      )}
      {hasBracket && (
        <div className="cv-panel cv-panel-bracket">
          <BracketView matches={bracketMatches} byId={byId} advances={advances} advanceKey={seq} tv={tv} reducedMotion={reducedMotion} />
        </div>
      )}
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

  useEffect(() => {
    const previous = document.title;
    document.title = `${snapshot.event.title} — Ao vivo`;
    return () => {
      document.title = previous;
    };
  }, [snapshot.event.title]);

  const shareUrl = `${window.location.origin}/ao-vivo/${encodeURIComponent(token)}`;
  const announcement = announcementFor(diff);

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
      />
      {/* Anuncia só MUDANÇAS (luta terminou); o primeiro snapshot gera texto vazio. */}
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="cv-announcer">
        {announcement}
      </div>
      <NowPlaying snapshot={snapshot} tv={tv} />
      <CategoryTabs categories={snapshot.categories} selectedId={currentId} onSelect={onPick} />
      <main className="cv-main">
        {snapshot.categories.length === 0 && (
          <div className="cv-empty" data-testid="cv-empty">
            <p>Ainda não há categorias neste campeonato</p>
          </div>
        )}
        {category && <CategoryView key={category.id} category={category} diff={diff} seq={seq} tv={tv} reducedMotion={reducedMotion} />}
      </main>
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
