import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { groupLabel, matLabel, scoreText, sideName, statusText, type CompetitorMap, EMPTY_SLOT } from "./helpers";
import type { OperatorCategory, OperatorMatch, PodiumEntry, StandingsGroup } from "./types";

const BORDER_BY_STATUS: Record<OperatorMatch["status"], string> = {
  LIVE: "border-l-red-600 bg-red-50 dark:bg-red-950/30",
  READY: "border-l-emerald-600",
  FINISHED: "border-l-slate-400 bg-muted/40",
  PENDING: "border-l-slate-300 border-dashed",
};

/** Luta de grupo/todos-contra-todos como botão grande (celular): atletas, placar e status em texto + cor. */
export function MatchRowButton({
  match,
  competitors,
  onSelect,
}: {
  match: OperatorMatch;
  competitors: CompetitorMap;
  onSelect: (match: OperatorMatch) => void;
}) {
  const a = sideName(competitors, match.slotAId) ?? EMPTY_SLOT;
  const b = sideName(competitors, match.slotBId) ?? EMPTY_SLOT;
  const score = scoreText(match);
  const mat = matLabel(match.mat);
  const winnerA = match.status === "FINISHED" && match.winnerId !== null && match.winnerId === match.slotAId;
  const winnerB = match.status === "FINISHED" && match.winnerId !== null && match.winnerId === match.slotBId;
  return (
    <button
      type="button"
      onClick={() => onSelect(match)}
      data-testid={`match-${String(match.id)}`}
      data-status={match.status}
      aria-label={`${a} contra ${b}. ${statusText(match)}. Toque para abrir.`}
      className={cn(
        "flex min-h-14 w-full items-center justify-between gap-3 rounded-md border border-l-4 px-3 py-2 text-left text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        BORDER_BY_STATUS[match.status],
      )}
    >
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate", winnerA && "font-bold")}>{winnerA ? "✓ " : ""}{a}</span>
        <span className={cn("block truncate", winnerB && "font-bold")}>{winnerB ? "✓ " : ""}{b}</span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1 text-xs">
        {score && <span className="text-base font-bold tabular-nums">{score}</span>}
        <Badge variant={match.status === "LIVE" ? "destructive" : match.status === "READY" ? "default" : "outline"}>
          {match.status === "LIVE" ? "AO VIVO" : statusText(match)}
        </Badge>
        {mat && <span className="text-muted-foreground">{mat}</span>}
      </span>
    </button>
  );
}

/** Tabela de classificação de um grupo (ou de todos contra todos). */
export function StandingsTable({
  group,
  competitors,
  advance,
  caption,
}: {
  group: StandingsGroup;
  competitors: CompetitorMap;
  /** Quantos primeiros colocados avançam ao mata-mata (grupos); 0/undefined = ninguém é marcado. */
  advance?: number | null;
  caption: string;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm" data-testid="standings-table">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="px-2 py-2 text-left">#</th>
            <th scope="col" className="px-2 py-2 text-left">Atleta</th>
            <th scope="col" className="px-2 py-2 text-right" title="Pontos">Pts</th>
            <th scope="col" className="px-2 py-2 text-right" title="Jogos">J</th>
            <th scope="col" className="px-2 py-2 text-right" title="Vitórias">V</th>
            <th scope="col" className="px-2 py-2 text-right" title="Empates">E</th>
            <th scope="col" className="px-2 py-2 text-right" title="Derrotas">D</th>
            <th scope="col" className="px-2 py-2 text-right" title="Pontos a favor / contra">Placar</th>
          </tr>
        </thead>
        <tbody>
          {group.rows.map((row) => {
            const advances = advance != null && advance > 0 && row.rank <= advance;
            return (
              <tr key={row.competitorId} className={cn("border-t", advances && "bg-emerald-50 dark:bg-emerald-950/30")}>
                <td className="px-2 py-2 tabular-nums">{row.rank}º</td>
                <td className="px-2 py-2">
                  <span className="font-medium">{sideName(competitors, row.competitorId)}</span>
                  {advances && <span className="ml-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">Classificado</span>}
                </td>
                <td className="px-2 py-2 text-right font-bold tabular-nums">{row.points}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.played}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.wins}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.draws}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.losses}</td>
                <td className="px-2 py-2 text-right tabular-nums">{row.pointsFor}:{row.pointsAgainst}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Fase de grupos (ou todos contra todos): classificação ao vivo + lutas por rodada, uma seção por grupo. */
export function GroupStageView({
  category,
  competitors,
  onSelectMatch,
}: {
  category: OperatorCategory;
  competitors: CompetitorMap;
  onSelectMatch: (match: OperatorMatch) => void;
}) {
  const groupMatches = category.matches.filter((m) => m.stage === "GROUP");
  const indexes = [...new Set(groupMatches.map((m) => m.groupIndex ?? 0))].sort((a, b) => a - b);
  const isRoundRobin = category.format === "ROUND_ROBIN";
  if (indexes.length === 0) return null;
  return (
    <div className="grid gap-6" data-testid="group-stage">
      {indexes.map((index) => {
        const title = isRoundRobin ? "Todos contra todos" : groupLabel(index);
        const standings = category.standings.find((g) => g.groupIndex === index);
        const matches = groupMatches.filter((m) => (m.groupIndex ?? 0) === index);
        const rounds = [...new Set(matches.map((m) => m.round))].sort((a, b) => a - b);
        return (
          <section key={index} aria-label={title} className="grid gap-3" data-testid={`group-${String(index)}`}>
            <h3 className="text-base font-bold">{title}</h3>
            {standings && (
              <StandingsTable
                group={standings}
                competitors={competitors}
                advance={isRoundRobin ? null : category.advancePerGroup}
                caption={`Classificação: ${title}`}
              />
            )}
            <div className="grid gap-4 md:grid-cols-2">
              {rounds.map((round) => (
                <div key={round} className="grid content-start gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Rodada {round}</h4>
                  {matches
                    .filter((m) => m.round === round)
                    .sort((a, b) => a.position - b.position)
                    .map((m) => (
                      <MatchRowButton key={m.id} match={m} competitors={competitors} onSelect={onSelectMatch} />
                    ))}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

const PODIUM_LABEL: Record<PodiumEntry["place"], string> = { 1: "1º lugar", 2: "2º lugar", 3: "3º lugar" };

/** Pódio (aparece quando o servidor devolve `podium`). 3º lugar pode vir empatado (duas entradas). */
export function PodiumView({ podium, competitors }: { podium: readonly PodiumEntry[]; competitors: CompetitorMap }) {
  if (podium.length === 0) return null;
  return (
    <section aria-label="Pódio" className="rounded-md border bg-card p-4" data-testid="podium">
      <h3 className="mb-2 text-base font-bold">Pódio</h3>
      <ol className="grid gap-1 text-sm">
        {podium.map((entry) => (
          <li key={`${String(entry.place)}-${String(entry.competitorId)}`} className="flex items-center gap-3">
            <span className="w-20 font-bold">{PODIUM_LABEL[entry.place]}</span>
            <span>{sideName(competitors, entry.competitorId)}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
