import type { KeyboardEvent } from "react";
import { useMemo } from "react";
import { CARD_H, CARD_W, FOOT_H, HEADER_H, ROW_H, layoutBracket, type PositionedMatch } from "./bracket-layout";
import {
  BYE_LABEL,
  EMPTY_SLOT,
  matLabel,
  matchTitle,
  isSwappableMatch,
  sideName,
  stageLabel,
  statusText,
  truncate,
  type CompetitorMap,
  lastMainRound,
} from "./helpers";
import type { OperatorMatch, Slot } from "./types";

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
}

const NAME_MAX = 24;

const FRAME_BY_STATUS: Record<OperatorMatch["status"], string> = {
  LIVE: "fill-red-50 stroke-red-600 dark:fill-red-950/40",
  READY: "fill-card stroke-emerald-600",
  FINISHED: "fill-muted/40 stroke-slate-400",
  PENDING: "fill-card stroke-slate-300 [stroke-dasharray:4_3]",
};

const FOOT_BY_STATUS: Record<OperatorMatch["status"], string> = {
  LIVE: "fill-red-700 dark:fill-red-400",
  READY: "fill-emerald-700 dark:fill-emerald-400",
  FINISHED: "fill-muted-foreground",
  PENDING: "fill-muted-foreground",
};

const onActivate = (action: () => void) => (event: KeyboardEvent) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    action();
  }
};

function Row({
  match,
  slot,
  competitors,
  y,
}: {
  match: OperatorMatch;
  slot: Slot;
  competitors: CompetitorMap;
  y: number;
}) {
  const id = slot === "A" ? match.slotAId : match.slotBId;
  const score = slot === "A" ? match.scoreA : match.scoreB;
  const name = sideName(competitors, id);
  const winner = match.status === "FINISHED" && id !== null && match.winnerId === id;
  const loser = match.status === "FINISHED" && id !== null && match.winnerId !== null && match.winnerId !== id;
  const label = name ?? (match.isBye ? BYE_LABEL : EMPTY_SLOT);
  return (
    <g transform={`translate(0 ${String(y)})`}>
      <text
        x={8}
        y={ROW_H / 2}
        dominantBaseline="central"
        className={
          name === null
            ? "fill-muted-foreground text-[11px] italic"
            : winner
              ? "fill-foreground text-[12px] font-bold"
              : loser
                ? "fill-muted-foreground text-[12px]"
                : "fill-foreground text-[12px]"
        }
      >
        {winner ? "✓ " : ""}
        {truncate(label, NAME_MAX)}
      </text>
      {score !== null && (
        <text x={CARD_W - 8} y={ROW_H / 2} dominantBaseline="central" textAnchor="end" className="fill-foreground text-[12px] font-bold">
          {score}
        </text>
      )}
    </g>
  );
}

function MatchCard({
  node,
  competitors,
  lastRound,
  onSelect,
  swap,
}: {
  node: PositionedMatch;
  competitors: CompetitorMap;
  lastRound: number;
  onSelect: (match: OperatorMatch) => void;
  swap: SwapState | undefined;
}) {
  const m = node.match;
  const swapping = swap?.active === true && isSwappableMatch(m, swap.firstRound);
  const mat = matLabel(m.mat);
  const foot =
    m.status === "LIVE" ? `AO VIVO${mat ? ` · ${mat}` : ""}` : `${statusText(m)}${mat && m.status !== "FINISHED" ? ` · ${mat}` : ""}`;
  const title = `${stageLabel(m, lastRound)}: ${matchTitle(m, competitors)}. ${statusText(m)}.`;
  const frame = `${FRAME_BY_STATUS[m.status]} ${m.isBye ? "opacity-60 [stroke-dasharray:2_3]" : ""}`;

  const body = (
    <>
      <title>{title}</title>
      <rect width={CARD_W} height={CARD_H} rx={6} strokeWidth={m.status === "LIVE" ? 2.5 : 1.5} className={frame} />
      <line x1={0} x2={CARD_W} y1={ROW_H} y2={ROW_H} className="stroke-border" />
      <line x1={0} x2={CARD_W} y1={ROW_H * 2} y2={ROW_H * 2} className="stroke-border" />
    </>
  );

  const footer = (
    <text x={8} y={ROW_H * 2 + FOOT_H / 2} dominantBaseline="central" className={`${FOOT_BY_STATUS[m.status]} text-[10px] font-semibold uppercase tracking-wide`}>
      {foot}
    </text>
  );

  if (swapping && swap) {
    const slots: Slot[] = ["A", "B"];
    return (
      <g transform={`translate(${String(node.x)} ${String(node.y)})`} data-testid={`match-${String(m.id)}`} data-status={m.status}>
        {body}
        {slots.map((slot, i) => {
          const id = slot === "A" ? m.slotAId : m.slotBId;
          const selected = swap.picked?.matchId === m.id && swap.picked.slot === slot;
          const name = sideName(competitors, id) ?? EMPTY_SLOT;
          const pick = () => swap.onPick(m.id, slot);
          return (
            <g
              key={slot}
              role="button"
              tabIndex={0}
              aria-pressed={selected}
              aria-label={`Trocar ${name}${selected ? " (selecionado)" : ""}`}
              data-testid={`swap-${String(m.id)}-${slot}`}
              className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
              onClick={pick}
              onKeyDown={onActivate(pick)}
            >
              <rect
                x={1}
                y={i * ROW_H + 1}
                width={CARD_W - 2}
                height={ROW_H - 2}
                rx={4}
                className={selected ? "fill-amber-200 stroke-amber-600 dark:fill-amber-900" : "fill-transparent stroke-transparent hover:fill-amber-50"}
                strokeWidth={2}
              />
              <Row match={m} slot={slot} competitors={competitors} y={i * ROW_H} />
            </g>
          );
        })}
        {footer}
      </g>
    );
  }

  const select = () => onSelect(m);
  return (
    <g
      transform={`translate(${String(node.x)} ${String(node.y)})`}
      role="button"
      tabIndex={0}
      aria-label={`${title} Toque para abrir.`}
      data-testid={`match-${String(m.id)}`}
      data-status={m.status}
      data-bye={m.isBye ? "true" : undefined}
      className="cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      onClick={select}
      onKeyDown={onActivate(select)}
    >
      {body}
      <Row match={m} slot="A" competitors={competitors} y={0} />
      <Row match={m} slot="B" competitors={competitors} y={ROW_H} />
      {footer}
    </g>
  );
}

/** Chave eliminatória em SVG: uma coluna por rodada, conectores entre as lutas, 3º lugar separado embaixo. */
export function BracketView({ matches, competitors, onSelectMatch, swap }: BracketViewProps) {
  const layout = useMemo(() => layoutBracket(matches), [matches]);
  const lastRound = lastMainRound(matches);
  if (layout.nodes.length === 0 && layout.third === null) return null;
  return (
    <div
      className="overflow-x-auto rounded-md border bg-card p-1"
      role="region"
      aria-label="Chave do campeonato (role para os lados para ver todas as rodadas)"
      tabIndex={0}
      data-testid="bracket"
    >
      <svg width={layout.width} height={layout.height} viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`} className="max-w-none" role="group" aria-label="Chave">
        {layout.columns.map((c) => (
          <text key={c.round} x={c.x} y={HEADER_H - 10} className="fill-muted-foreground text-[11px] font-semibold uppercase tracking-wide">
            {c.label}
          </text>
        ))}
        {layout.edges.map((e) => (
          <path
            key={`${String(e.fromId)}-${String(e.toId)}`}
            d={e.d}
            fill="none"
            strokeWidth={1.5}
            className="stroke-slate-400"
            data-testid={`edge-${String(e.fromId)}-${String(e.toId)}`}
          />
        ))}
        {layout.nodes.map((n) => (
          <MatchCard key={n.match.id} node={n} competitors={competitors} lastRound={lastRound} onSelect={onSelectMatch} swap={swap} />
        ))}
        {layout.third && layout.thirdLabelY !== null && (
          <>
            <text x={layout.third.x} y={layout.thirdLabelY} className="fill-muted-foreground text-[11px] font-semibold uppercase tracking-wide">
              Disputa de 3º lugar
            </text>
            <MatchCard node={layout.third} competitors={competitors} lastRound={lastRound} onSelect={onSelectMatch} swap={undefined} />
          </>
        )}
      </svg>
    </div>
  );
}
