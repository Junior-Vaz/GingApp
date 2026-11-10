import type { PublicCompetitor, PublicMatch, StandingsGroup } from "@/lib/chaveamento/types";
import { describeMatch, groupLabel } from "@/lib/chaveamento/describe";
import { Avatar } from "./avatar";


export interface StandingsTableProps {
  groups: readonly StandingsGroup[];
  byId: ReadonlyMap<number, PublicCompetitor>;
  /** Todo contra todos: um único quadro, sem o nome do grupo. */
  single: boolean;
}

/** Classificação (pontos, vitórias, saldo) de cada grupo ou do todos contra todos. */
export function StandingsTable({ groups, byId, single }: StandingsTableProps) {
  const filled = groups.filter((g) => g.rows.length > 0);
  if (filled.length === 0) return null;
  return (
    <div className="cv-standings-grid" data-testid="cv-standings">
      {filled.map((group) => {
        const title = single ? "Classificação" : groupLabel(group.groupIndex);
        return (
          <table key={group.groupIndex} className="cv-table">
            <caption className="cv-table-caption">{title}</caption>
            <thead>
              <tr>
                <th scope="col" className="cv-th-rank">
                  <span className="sr-only">Posição</span>
                  <span aria-hidden="true">#</span>
                </th>
                <th scope="col">Atleta</th>
                <th scope="col" title="Lutas">
                  <abbr title="Lutas">L</abbr>
                </th>
                <th scope="col">
                  <abbr title="Vitórias">V</abbr>
                </th>
                <th scope="col">
                  <abbr title="Empates">E</abbr>
                </th>
                <th scope="col">
                  <abbr title="Derrotas">D</abbr>
                </th>
                <th scope="col">
                  <abbr title="Saldo de pontos">Saldo</abbr>
                </th>
                <th scope="col">
                  <abbr title="Pontos">Pts</abbr>
                </th>
              </tr>
            </thead>
            <tbody>
              {group.rows.map((row) => {
                const competitor = byId.get(row.competitorId);
                const balance = row.pointsFor - row.pointsAgainst;
                return (
                  <tr key={row.competitorId} data-rank={row.rank}>
                    <td className="cv-td-rank">{row.rank}</td>
                    <td className="cv-td-athlete">
                      {competitor && <Avatar id={competitor.id} name={competitor.name} photoUrl={competitor.photoUrl} size={28} />}
                      <span className="cv-td-name">{competitor?.name ?? "Atleta"}</span>
                    </td>
                    <td>{row.played}</td>
                    <td>{row.wins}</td>
                    <td>{row.draws}</td>
                    <td>{row.losses}</td>
                    <td>{balance > 0 ? `+${balance}` : balance}</td>
                    <td className="cv-td-points">{row.points}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        );
      })}
    </div>
  );
}

/** Lista compacta das lutas de grupo/todos contra todos, por rodada (quem enfrenta quem e o placar). */
export function MatchList({ matches, byId, groupIndex }: { matches: readonly PublicMatch[]; byId: ReadonlyMap<number, PublicCompetitor>; groupIndex?: number | null }) {
  const shown = matches.filter((m) => m.stage === "GROUP" && (groupIndex === undefined || groupIndex === null || m.groupIndex === groupIndex));
  if (shown.length === 0) return null;
  const rounds = [...new Set(shown.map((m) => m.round))].sort((a, b) => a - b);
  const name = (id: number | null): string => (id === null ? "A definir" : (byId.get(id)?.name ?? "Atleta"));
  return (
    <div className="cv-rounds">
      {rounds.map((round) => (
        <section key={round} className="cv-round" aria-label={`Rodada ${round}`}>
          <h3 className="cv-round-title">Rodada {round}</h3>
          <ul className="cv-round-list">
            {shown
              .filter((m) => m.round === round)
              .sort((a, b) => a.position - b.position || a.id - b.id)
              .map((m) => {
                const finished = m.status === "FINISHED";
                return (
                  <li key={m.id} className="cv-round-item" data-status={m.status} aria-label={describeMatch(m, byId)} data-testid="cv-list-match">
                    <span className="cv-round-names" aria-hidden="true">
                      <span data-win={finished && m.winnerId === m.slotAId ? "1" : undefined}>{name(m.slotAId)}</span>
                      <span className="cv-round-score">{m.scoreA !== null && m.scoreB !== null ? `${m.scoreA} x ${m.scoreB}` : "×"}</span>
                      <span data-win={finished && m.winnerId === m.slotBId ? "1" : undefined}>{name(m.slotBId)}</span>
                    </span>
                    {m.status === "LIVE" && (
                      <span className="cv-tag" data-live="1" aria-hidden="true">
                        <span className="cv-dot" />
                        AO VIVO{m.mat ? ` · Tat. ${m.mat}` : ""}
                      </span>
                    )}
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
