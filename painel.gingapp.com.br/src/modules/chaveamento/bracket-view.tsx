import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Check, Medal, Route, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CARD_H, CARD_W, FOOT_H, ROW_H, layoutBracket, type PositionedMatch } from "./bracket-layout";
import { CompetitorPhoto } from "./competitor-photo";
import {
  BYE_LABEL,
  EMPTY_SLOT,
  isSwappableMatch,
  lastMainRound,
  matLabel,
  matchTitle,
  pathMatchIds,
  sideName,
  stageLabel,
  statusText,
  type CompetitorMap,
} from "./helpers";
import { useQuickUndo } from "./quick-undo-context";
import { RESULT_TYPE_LABEL, type OperatorMatch, type Slot } from "./types";
import "./chaveamento.css";

export interface SwapState {
  /** Modo "trocar atletas" ligado: tocar num atleta e depois noutro. */
  active: boolean;
  picked: { matchId: number; slot: Slot } | null;
  firstRound: number;
  onPick: (matchId: number, slot: Slot) => void;
}

interface BracketViewProps {
  matches: readonly OperatorMatch[];
  competitors: CompetitorMap;
  onSelectMatch: (match: OperatorMatch) => void;
  swap?: SwapState | undefined;
  /** Atleta cujo caminho está realçado (controlado pela categoria); sem isso a chave guarda o seu próprio. */
  pathId?: number | null | undefined;
  onPathChange?: ((id: number | null) => void) | undefined;
}

const ZOOMS = [0.6, 0.8, 1] as const;

/** Moldura e rodapé por status: cor + TEXTO (o status nunca depende só da cor). */
const FRAME: Record<OperatorMatch["status"], string> = {
  LIVE: "border-red-600 bg-red-50 dark:bg-red-950/40",
  READY: "border-emerald-600 bg-card",
  FINISHED: "border-border bg-muted/50",
  PENDING: "border-dashed border-border bg-card",
};
const FOOT: Record<OperatorMatch["status"], string> = {
  LIVE: "bg-red-600 text-white",
  READY: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  FINISHED: "bg-muted text-muted-foreground",
  PENDING: "bg-muted/60 text-muted-foreground",
};

function footText(m: OperatorMatch): string {
  const mat = matLabel(m.mat);
  if (m.isBye) return "Folga";
  if (m.status === "LIVE") return `AO VIVO${mat ? ` · ${mat}` : ""}`;
  if (m.status === "FINISHED") {
    return m.resultType && m.resultType !== "NORMAL" ? `Encerrada · ${RESULT_TYPE_LABEL[m.resultType]}` : "Encerrada";
  }
  return `${statusText(m)}${mat ? ` · ${mat}` : ""}`;
}

/** Linha de um atleta no cartão: avatar com anel do grupo, nome, grupo e placar. */
function Row({ match, slot, competitors }: { match: OperatorMatch; slot: Slot; competitors: CompetitorMap }) {
  const id = slot === "A" ? match.slotAId : match.slotBId;
  const score = slot === "A" ? match.scoreA : match.scoreB;
  const competitor = id === null ? null : (competitors.get(id) ?? null);
  const name = sideName(competitors, id);
  const winner = match.status === "FINISHED" && id !== null && match.winnerId === id;
  const loser = match.status === "FINISHED" && id !== null && match.winnerId !== null && match.winnerId !== id;
  const label = name ?? (match.isBye ? BYE_LABEL : EMPTY_SLOT);
  return (
    <span className={cn("flex h-11 items-center gap-2 px-2", winner && "bg-emerald-500/10", loser && "opacity-60")}>
      {name === null ? (
        <span className="grid size-8 shrink-0 place-items-center rounded-full border-2 border-dashed border-muted-foreground/40" aria-hidden />
      ) : (
        <CompetitorPhoto name={name} photoUrl={competitor?.photoUrl ?? null} group={competitor?.groupName} id={competitor?.id} size="sm" />
      )}
      <span className="min-w-0 flex-1 leading-tight">
        <span className={cn("block truncate text-[13px]", name === null ? "italic text-muted-foreground" : winner ? "font-extrabold" : "font-semibold")}>{label}</span>
        {competitor?.groupName && <span className="block truncate text-[11px] text-muted-foreground">{competitor.groupName}</span>}
      </span>
      {winner && <Check className="size-4 shrink-0 text-emerald-700" aria-hidden />}
      {score !== null && <span className={cn("w-7 shrink-0 text-right text-lg tabular-nums", winner ? "font-black" : "font-bold")}>{score}</span>}
    </span>
  );
}

function Footer({ match }: { match: OperatorMatch }) {
  return (
    <span className={cn("flex items-center gap-1.5 px-2 text-[10px] font-extrabold uppercase tracking-wider", FOOT[match.status])} style={{ height: FOOT_H }}>
      {match.status === "LIVE" && <span className="chv-dot size-1.5 rounded-full bg-white" aria-hidden />}
      {footText(match)}
    </span>
  );
}

function MatchCard({
  node,
  competitors,
  lastRound,
  onSelect,
  swap,
  dim,
  flash,
  onPathPick,
}: {
  node: PositionedMatch;
  competitors: CompetitorMap;
  lastRound: number;
  onSelect: (match: OperatorMatch) => void;
  swap: SwapState | undefined;
  dim: boolean;
  flash: number | null;
  onPathPick: (competitorId: number) => void;
}) {
  const m = node.match;
  const swapping = swap?.active === true && isSwappableMatch(m, swap.firstRound);
  const title = `${stageLabel(m, lastRound)}: ${matchTitle(m, competitors)}. ${statusText(m)}.`;
  const frame = cn("overflow-hidden rounded-xl border-2 text-left shadow-sm", FRAME[m.status], m.isBye && "opacity-70");
  const style = { left: node.x, top: node.y, width: CARD_W, height: CARD_H } as const;
  const live = m.status === "LIVE";
  const halo = live ? <span className="chv-halo pointer-events-none absolute -inset-1 rounded-[14px] ring-2 ring-red-500" aria-hidden /> : null;
  const pulse = flash !== null ? <span key={flash} className="chv-flash pointer-events-none absolute inset-0 rounded-xl bg-emerald-500/40" aria-hidden /> : null;
  const wrapper = cn("absolute transition-opacity duration-200", dim && "opacity-35");

  if (swapping && swap) {
    const slots: Slot[] = ["A", "B"];
    return (
      <div className={wrapper} style={style} data-testid={`match-${String(m.id)}`} data-status={m.status}>
        <div className={cn(frame, "grid h-full")} style={{ gridTemplateRows: `${String(ROW_H)}px ${String(ROW_H)}px ${String(FOOT_H)}px` }}>
          <Row match={m} slot="A" competitors={competitors} />
          <Row match={m} slot="B" competitors={competitors} />
          <Footer match={m} />
        </div>
        {slots.map((slot, i) => {
          const id = slot === "A" ? m.slotAId : m.slotBId;
          const selected = swap.picked?.matchId === m.id && swap.picked.slot === slot;
          const name = sideName(competitors, id) ?? EMPTY_SLOT;
          return (
            <button
              key={slot}
              type="button"
              aria-pressed={selected}
              aria-label={`Trocar ${name}${selected ? " (selecionado)" : ""}`}
              data-testid={`swap-${String(m.id)}-${slot}`}
              onClick={() => swap.onPick(m.id, slot)}
              style={{ top: i * ROW_H, height: ROW_H }}
              className={cn(
                "absolute inset-x-0 rounded-lg border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected ? "border-amber-600 bg-amber-300/40" : "border-transparent hover:bg-amber-200/30",
              )}
            />
          );
        })}
      </div>
    );
  }

  return (
    <div className={cn(wrapper, "chv-pop")} style={{ ...style, "--i": Math.min(node.column * 2 + Math.round(node.y / (CARD_H + 14)), 12) } as CSSProperties}>
      <button
        type="button"
        onClick={() => onSelect(m)}
        aria-label={`${title} Toque para abrir.`}
        data-testid={`match-${String(m.id)}`}
        data-status={m.status}
        data-bye={m.isBye ? "true" : undefined}
        className={cn(frame, "absolute inset-0 grid w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-[0.99]")}
        style={{ gridTemplateRows: `${String(ROW_H)}px ${String(ROW_H)}px ${String(FOOT_H)}px` }}
      >
        <Row match={m} slot="A" competitors={competitors} />
        <Row match={m} slot="B" competitors={competitors} />
        <Footer match={m} />
      </button>
      {halo}
      {pulse}
      {/* Toque no avatar = destacar o caminho do atleta (alvo de 44 px; fora do botão da luta para não aninhar botões). */}
      {([m.slotAId, m.slotBId] as const).map((id, i) =>
        id === null || (m.isBye && i === 1) ? null : (
          <button
            key={i}
            type="button"
            tabIndex={-1}
            aria-label={`Destacar o caminho de ${sideName(competitors, id) ?? "atleta"}`}
            onClick={() => onPathPick(id)}
            className="absolute left-0 grid w-12 place-items-center rounded-full hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            style={{ top: i * ROW_H, height: ROW_H }}
          />
        ),
      )}
    </div>
  );
}

/**
 * Chave eliminatória: uma coluna por rodada (cabeçalho fixo com o nome em português), cartões de atleta no padrão do
 * telão, conectores atrás, 3º lugar separado embaixo. Tocar no avatar realça o caminho do atleta; tocar na luta abre a
 * ação rápida. Os cartões são HTML (alvos de toque grandes); só os conectores são SVG.
 */
export function BracketView({ matches, competitors, onSelectMatch, swap, pathId: pathProp, onPathChange }: BracketViewProps) {
  const layout = useMemo(() => layoutBracket(matches), [matches]);
  const lastRound = lastMainRound(matches);
  const quick = useQuickUndo();
  const [zoomIndex, setZoomIndex] = useState<number>(ZOOMS.length - 1);
  const [ownPath, setOwnPath] = useState<number | null>(null);
  const controlled = pathProp !== undefined;
  const pathId = controlled ? pathProp : ownPath;
  const setPath = (id: number | null) => (controlled ? onPathChange?.(id) : setOwnPath(id));
  const zoom = ZOOMS[zoomIndex] ?? 1;

  const pathIds = useMemo(() => pathMatchIds(matches, pathId), [matches, pathId]);
  const pathName = pathId === null ? null : (competitors.get(pathId)?.displayName ?? null);
  const progress = useMemo(() => {
    const map = new Map<number, { done: number; total: number }>();
    for (const m of matches) {
      if (m.stage !== "MAIN" || m.isBye) continue;
      const cur = map.get(m.round) ?? { done: 0, total: 0 };
      cur.total += 1;
      if (m.status === "FINISHED") cur.done += 1;
      map.set(m.round, cur);
    }
    return map;
  }, [matches]);

  // Esc limpa o realce do caminho.
  useEffect(() => {
    if (pathId === null) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPath(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathId]);

  if (layout.nodes.length === 0 && layout.third === null) return null;
  const dimming = pathIds.size > 0;
  const flashFor = (id: number): number | null => (quick.current?.matchId === id ? quick.current.id : null);
  const pick = (id: number) => setPath(pathId === id ? null : id);
  const wide = layout.columns.length >= 2;

  return (
    <div className="grid grid-cols-1 gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <p>Toque no avatar para destacar o caminho do atleta. Toque na luta para abrir.</p>
        {wide && (
          <div className="flex items-center gap-1" role="group" aria-label="Zoom da chave">
            <Button type="button" variant="outline" size="icon" aria-label="Reduzir a chave" disabled={zoomIndex === 0} onClick={() => setZoomIndex((z) => Math.max(z - 1, 0))}>
              <ZoomOut />
            </Button>
            <span className="w-10 text-center font-bold tabular-nums" aria-live="polite">{Math.round(zoom * 100)}%</span>
            <Button type="button" variant="outline" size="icon" aria-label="Ampliar a chave" disabled={zoomIndex === ZOOMS.length - 1} onClick={() => setZoomIndex((z) => Math.min(z + 1, ZOOMS.length - 1))}>
              <ZoomIn />
            </Button>
          </div>
        )}
      </div>

      <div aria-live="polite" className="min-h-0">
        {pathName && (
          <div className="chv-pop flex items-center justify-between gap-2 rounded-lg border border-primary/40 bg-secondary px-3 py-2 text-sm" data-testid="path-chip">
            <span className="flex min-w-0 items-center gap-2 font-semibold text-primary">
              <Route className="size-4 shrink-0" aria-hidden />
              <span className="truncate">Caminho de {pathName}</span>
              <span className="shrink-0 font-normal text-muted-foreground">· {pathIds.size} {pathIds.size === 1 ? "luta" : "lutas"}</span>
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setPath(null)} aria-label="Limpar o destaque do caminho">
              <X /> Limpar
            </Button>
          </div>
        )}
      </div>

      <div
        className="chv-scroller relative max-h-[78dvh] overflow-auto rounded-xl border bg-card"
        role="region"
        aria-label="Chave do campeonato (role para os lados para ver todas as rodadas)"
        tabIndex={0}
        data-testid="bracket"
      >
        {/* Cabeçalho das rodadas: fica fixo no topo ao rolar a chave para baixo e acompanha a rolagem para os lados. */}
        <div className="sticky top-0 z-20 h-10 border-b bg-card" style={{ width: layout.width * zoom }} data-testid="bracket-header">
          {layout.columns.map((c) => {
            const p = progress.get(c.round);
            return (
              <div
                key={c.round}
                className="chv-snap absolute top-0 flex h-10 items-center justify-between gap-2 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground"
                style={{ left: c.x * zoom, width: CARD_W * zoom }}
              >
                <span className="truncate text-foreground">{c.label}</span>
                {p && <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 tabular-nums">{p.done}/{p.total}</span>}
              </div>
            );
          })}
        </div>

        <div className="relative" style={{ width: layout.width * zoom, height: layout.height * zoom }}>
          <div className="absolute left-0 top-0" style={{ width: layout.width, height: layout.height, transform: `scale(${String(zoom)})`, transformOrigin: "0 0" }}>
            <svg width={layout.width} height={layout.height} viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`} className="pointer-events-none absolute inset-0 max-w-none" aria-hidden>
              {layout.edges.map((e) => {
                const onPath = dimming && pathIds.has(e.fromId) && pathIds.has(e.toId);
                return (
                  <path
                    key={`${String(e.fromId)}-${String(e.toId)}`}
                    d={e.d}
                    fill="none"
                    strokeWidth={onPath ? 3 : 1.75}
                    strokeLinejoin="round"
                    className={cn("transition-opacity", onPath ? "stroke-primary" : "stroke-slate-400", dimming && !onPath && "opacity-30")}
                    data-testid={`edge-${String(e.fromId)}-${String(e.toId)}`}
                  />
                );
              })}
            </svg>
            {layout.nodes.map((n) => (
              <MatchCard
                key={n.match.id}
                node={n}
                competitors={competitors}
                lastRound={lastRound}
                onSelect={onSelectMatch}
                swap={swap}
                dim={dimming && !pathIds.has(n.match.id)}
                flash={flashFor(n.match.id)}
                onPathPick={pick}
              />
            ))}
            {layout.third && layout.thirdLabelY !== null && (
              <>
                <p className="absolute flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground" style={{ left: layout.third.x, top: layout.thirdLabelY - 6 }}>
                  <Medal className="size-4" aria-hidden /> Disputa de 3º lugar
                </p>
                <MatchCard
                  node={layout.third}
                  competitors={competitors}
                  lastRound={lastRound}
                  onSelect={onSelectMatch}
                  swap={undefined}
                  dim={dimming && !pathIds.has(layout.third.match.id)}
                  flash={flashFor(layout.third.match.id)}
                  onPathPick={pick}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
