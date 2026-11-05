import { useState, type CSSProperties, type ReactNode } from "react";
import { Check, CircleCheck, Crown, Flame, Hand, Loader2, Target, TrendingUp, Trophy, History, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError, errorMessage } from "@/lib/api";
import { fmt } from "@/lib/format";
import { plural } from "@/lib/plural";
import { cn } from "@/lib/utils";
import { ALL_TIME, formatPoints, leagueColor, seasonLabel } from "@/lib/ranking";
import {
  chartBars,
  civilDay,
  evolutionLongLabel,
  goalView,
  statementDateLabel,
  statementFullDate,
  statementSeasonOptions,
  useDailyCheckinMutation,
  useDailyCheckinStatus,
  useRankingEvolution,
  useRankingGoal,
  useRankingStatement,
  type Granularity,
} from "@/lib/ranking-student";
import { useStudentScope } from "@/lib/queries";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { CountUp } from "./count-up";
import { pointIconFor } from "./ranking-icons";
import { ShowcaseHighlight } from "./ranking-achievements";
import { LeagueSeal } from "./ranking-parts";

/* ---------- Peças comuns ---------- */

function Card({
  id,
  title,
  icon: Icon,
  className,
  testId,
  children,
}: {
  id: string;
  title: string;
  icon: LucideIcon;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn("rk-card rkp-card", className)} aria-labelledby={id} data-testid={testId}>
      <h3 id={id} className="rkp-title">
        <Icon aria-hidden="true" /> {title}
      </h3>
      {children}
    </section>
  );
}

function CardSkeleton({ label = "Carregando", height = 90 }: { label?: string; height?: number }) {
  return (
    <div aria-busy="true" aria-label={label} role="status" className="rkp-skel-wrap" data-testid="rkp-skeleton">
      <span className="rk-skel rk-skel-line" style={{ width: "55%" }} />
      <span className="rk-skel rk-skel-step" style={{ height, borderRadius: 12 }} />
    </div>
  );
}

function CardError({ error, fallback, onRetry }: { error: unknown; fallback: string; onRetry: () => void }) {
  return (
    <div className="rkp-error" role="alert">
      <p>{errorMessage(error, fallback)}</p>
      <Button type="button" variant="outline" className="min-h-11" onClick={onRetry}>
        Tentar de novo
      </Button>
    </div>
  );
}

const cssVars = (vars: Record<string, string | number>) => vars as CSSProperties;

/* ---------- Check-in de hoje ---------- */

function dailyMessage(result: { alreadyCheckedIn: boolean; pointsToday: number } | undefined): string {
  if (!result) return "Hoje já valeu!";
  if (result.alreadyCheckedIn) return "Você já tinha feito o check-in de hoje.";
  if (result.pointsToday > 0) return `+${result.pointsToday} ${result.pointsToday === 1 ? "ponto" : "pontos"}`;
  return "Hoje já valeu! Este check-in não somou ponto novo, mas conta para a sua semana.";
}

function checkinFailure(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) return "Calma! Muitos toques seguidos. Espere um minutinho e tente de novo.";
  return errorMessage(error, "Não foi possível fazer o check-in agora. Confira a conexão e tente de novo.");
}

/** "Salve!" uma vez por dia: vale pouco de propósito, sem culpa nem corrente para quebrar (a meta é da semana). */
export function DailyCheckinCard() {
  const status = useDailyCheckinStatus();
  const checkin = useDailyCheckinMutation();
  const reduced = useReducedMotion();
  const data = status.data;

  return (
    <Card id="rkp-daily-title" title="Check-in de hoje" icon={Hand} className="rkp-daily" testId="rk-daily">
      {status.isLoading ? (
        <CardSkeleton label="Carregando o check-in de hoje" />
      ) : status.isError || !data ? (
        <CardError error={status.error} fallback="Não foi possível carregar o check-in de hoje." onRetry={() => void status.refetch()} />
      ) : (
        <>
          <ol className="rkp-dots" aria-label="Seus últimos 7 dias">
            {data.last7.map((item, index) => {
              const date = civilDay(item.day);
              const today = index === data.last7.length - 1;
              return (
                <li
                  key={item.day}
                  data-testid="rkp-dot"
                  data-done={item.done ? "true" : "false"}
                  aria-current={today ? "date" : undefined}
                  aria-label={`${fmt(date, "EEEE, dd/MM")}: ${item.done ? "check-in feito" : "sem check-in"}${today ? " (hoje)" : ""}`}
                >
                  <span className={cn("rkp-dot", item.done && "is-done", today && "is-today")} aria-hidden="true">
                    {item.done && <Check />}
                  </span>
                  <small aria-hidden="true">{fmt(date, "EEE").replace(/\.$/, "")}</small>
                </li>
              );
            })}
          </ol>

          <p className="rkp-week" data-testid="rkp-week">
            <strong>
              {data.weekDays} de {data.weekTarget}
            </strong>{" "}
            dias nesta semana
          </p>

          {data.checkedInToday ? (
            <div className={cn("rkp-done", checkin.isSuccess && !reduced && "is-pop")} role="status" data-testid="rkp-daily-done">
              <span className="rkp-done-icon" aria-hidden="true">
                <CircleCheck />
              </span>
              <div>
                <strong>Check-in de hoje feito!</strong>
                <span data-testid="rkp-daily-result">{dailyMessage(checkin.data)}</span>
              </div>
            </div>
          ) : (
            <Button
              type="button"
              className="rkp-daily-btn"
              disabled={checkin.isPending}
              aria-busy={checkin.isPending}
              onClick={() => checkin.mutate()}
            >
              {checkin.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Hand aria-hidden="true" />}
              {checkin.isPending ? "Registrando…" : "Salve! Check-in de hoje"}
            </Button>
          )}

          {checkin.isError && (
            <p className="rk-problem" role="alert" data-testid="rkp-daily-error">
              {checkinFailure(checkin.error)}
            </p>
          )}

          {data.weekDone && (
            <p className="rkp-hint" data-testid="rkp-week-done">
              Meta da semana batida! O bônus entra quando a semana fecha.
            </p>
          )}
          {data.monthDays >= data.monthCapDays && (
            <p className="rkp-hint">Neste mês o check-in já rendeu o máximo de pontos. Ele segue contando para a sua semana.</p>
          )}
          <p className="rkp-hint">Um toque por dia, sem pressão: faltar um dia não tira nada.</p>
        </>
      )}
    </Card>
  );
}

/* ---------- Meta do mês ---------- */

const RING_R = 54;
const RING_C = 2 * Math.PI * RING_R;

/** Anel SVG da meta do mês: aulas presentes ÷ aulas planejadas, com uma marca onde o bônus passa a valer. */
export function GoalCard() {
  const query = useRankingGoal();
  const goal = query.data;

  return (
    <Card id="rkp-goal-title" title="Meta do mês" icon={Target} className="rkp-goal" testId="rk-goal">
      {query.isLoading ? (
        <CardSkeleton label="Carregando a meta do mês" height={120} />
      ) : query.isError || !goal ? (
        <CardError error={query.error} fallback="Não foi possível carregar a meta do mês." onRetry={() => void query.refetch()} />
      ) : (
        <GoalBody goal={goal} />
      )}
    </Card>
  );
}

function GoalBody({ goal }: { goal: NonNullable<ReturnType<typeof useRankingGoal>["data"]> }) {
  const view = goalView(goal);
  const missing = goal.remainingForBonus;
  const angle = view.markRatio * 2 * Math.PI - Math.PI / 2;
  const mark = {
    x1: 70 + (RING_R - 9) * Math.cos(angle),
    y1: 70 + (RING_R - 9) * Math.sin(angle),
    x2: 70 + (RING_R + 9) * Math.cos(angle),
    y2: 70 + (RING_R + 9) * Math.sin(angle),
  };
  const summary =
    view.state === "none"
      ? "Sem meta este mês"
      : `${goal.present} de ${plural(goal.lessonsPlanned, "aula")} no mês. ${
          view.state === "reached" ? "Bônus garantido." : `${missing === 1 ? "Falta 1 presença" : `Faltam ${missing} presenças`} para o bônus.`
        }`;

  return (
    <div className="rkp-goal-body" data-state={view.state} data-testid="rkp-goal-body">
      <div className="rkp-ring">
        <svg viewBox="0 0 140 140" role="img" aria-label={summary}>
          <circle className="rkp-ring-track" cx="70" cy="70" r={RING_R} />
          {view.state !== "none" && (
            <circle
              className={cn("rkp-ring-fill", view.state === "reached" && "is-reached")}
              cx="70"
              cy="70"
              r={RING_R}
              strokeDasharray={RING_C}
              strokeDashoffset={RING_C * (1 - view.ratio)}
              transform="rotate(-90 70 70)"
              style={cssVars({ "--ring-c": RING_C })}
            />
          )}
          {view.state !== "none" && goal.neededForBonus > 0 && <line className="rkp-ring-mark" {...mark} />}
        </svg>
        <div className="rkp-ring-center" aria-hidden="true">
          {view.state === "none" ? (
            <Target />
          ) : (
            <>
              <strong>
                <CountUp id="rk-goal-present" value={goal.present} />
              </strong>
              <span>de {goal.lessonsPlanned}</span>
            </>
          )}
        </div>
      </div>

      <div className="rkp-goal-text">
        <span className="rk-eyebrow">{seasonLabel(goal.season)}</span>
        {view.state === "none" ? (
          <>
            <strong data-testid="rkp-goal-headline">Sem meta este mês</strong>
            <p>Suas turmas não têm aulas planejadas neste mês. Quando houver, a meta aparece aqui.</p>
          </>
        ) : (
          <>
            <strong data-testid="rkp-goal-headline">
              {goal.present} de {plural(goal.lessonsPlanned, "aula")}
              {view.state === "reached" ? (
                <> · bônus de +{goal.bonusPoints} garantido</>
              ) : (
                <>
                  {" · "}
                  {missing === 1 ? "falta 1" : `faltam ${missing}`} para o bônus de +{goal.bonusPoints}
                </>
              )}
            </strong>
            {view.state === "unreachable" && (
              <p data-testid="rkp-goal-gentle">
                Neste mês o bônus já não fecha, e tudo bem: cada aula continua valendo pontos e o próximo mês começa com a meta nova. Bora treinar!
              </p>
            )}
            {view.state === "reached" && <p>Meta batida! Continue treinando: cada aula segue somando pontos.</p>}
            <p className="rkp-hint">
              {goal.lessonsDone} de {plural(goal.lessonsPlanned, "aula")} do mês já tiveram chamada. O bônus é concedido quando o mês fecha.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- Próxima liga ---------- */

export function LeagueCard() {
  const query = useRankingGoal();
  const goal = query.data;
  const league = goal?.league;
  const color = league ? leagueColor(league.current) : "#E5E5E5";
  const next = league?.next ?? null;
  const nextColor = next ? leagueColor(next) : color;
  const pct = league ? Math.max(0, Math.min(100, Math.round(league.progressPct))) : 0;
  const toNext = league?.pointsToNext ?? 0;

  return (
    <Card id="rkp-league-title" title="Próxima liga" icon={Trophy} className="rkp-league" testId="rk-league">
      {query.isLoading ? (
        <CardSkeleton label="Carregando sua liga" height={60} />
      ) : query.isError || !league ? (
        <CardError error={query.error} fallback="Não foi possível carregar sua liga." onRetry={() => void query.refetch()} />
      ) : (
        <div style={cssVars({ "--lg": color, "--next": nextColor })} className="rkp-league-body">
          <LeagueSeal level={league.current} />
          {next ? (
            <>
              <div className="rk-next-line">
                <span>
                  {`${toNext === 1 ? "falta" : "faltam"} ${formatPoints(toNext)} ${toNext === 1 ? "ponto" : "pontos"} para `}
                  <strong className="rk-next-name" style={cssVars({ "--lg": nextColor })}>
                    {next.name.toLocaleUpperCase("pt-BR")}
                  </strong>
                </span>
                <b>{pct}%</b>
              </div>
              <div className="rk-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progresso até a próxima liga">
                <div className="rk-bar-fill" style={cssVars({ "--pct": `${pct}%` })} />
              </div>
            </>
          ) : (
            <p className="rk-maxed">
              <Crown aria-hidden="true" /> Você chegou à liga máxima. Axé!
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

/* ---------- Sequência ---------- */

export function StreakCard() {
  const query = useRankingEvolution("WEEK");
  const data = query.data;
  return (
    <Card id="rkp-streak-title" title="Sequência" icon={Flame} className="rkp-streak" testId="rk-streak">
      {query.isLoading ? (
        <CardSkeleton label="Carregando sua sequência" height={60} />
      ) : query.isError || !data ? (
        <CardError error={query.error} fallback="Não foi possível carregar sua sequência." onRetry={() => void query.refetch()} />
      ) : (
        <div className="rkp-streak-tiles">
          <div data-testid="rkp-streak-current">
            <Flame className="is-flame" aria-hidden="true" />
            <strong>
              <CountUp id="rk-streak-current" value={data.currentStreakWeeks} />
            </strong>
            <span>{data.currentStreakWeeks === 1 ? "semana seguida agora" : "semanas seguidas agora"}</span>
          </div>
          <div data-testid="rkp-streak-best">
            <Trophy aria-hidden="true" />
            <strong>
              <CountUp id="rk-streak-best" value={data.bestStreakWeeks} />
            </strong>
            <span>{data.bestStreakWeeks === 1 ? "semana na melhor sequência" : "semanas na melhor sequência"}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

/* ---------- Gráfico de evolução ---------- */

const CHART = { width: 320, height: 110, top: 18, bottom: 22 };

const GRANULARITIES: { value: Granularity; label: string }[] = [
  { value: "WEEK", label: "Semanas" },
  { value: "MONTH", label: "Meses" },
];

/** Barras SVG simples (sem biblioteca): a última é o período atual. O leitor de tela lê uma tabela escondida, não o desenho. */
export function EvolutionCard() {
  const [granularity, setGranularity] = useState<Granularity>("WEEK");
  const query = useRankingEvolution(granularity);
  const data = query.data;
  const unit = granularity === "WEEK" ? "semana" : "mês";
  const bars = data ? chartBars(data.points, granularity, { width: CHART.width, height: CHART.height }) : [];
  const total = data ? data.points.reduce((sum, point) => sum + point.points, 0) : 0;
  const last = data?.points[data.points.length - 1];

  return (
    <Card id="rkp-evo-title" title="Sua evolução" icon={TrendingUp} className="rkp-evo" testId="rk-evolution">
      <div className="rkp-seg rkp-seg-sm" role="radiogroup" aria-label="Período do gráfico">
        {GRANULARITIES.map((item) => (
          <button
            key={item.value}
            type="button"
            role="radio"
            aria-checked={granularity === item.value}
            onClick={() => setGranularity(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <CardSkeleton label="Carregando a evolução" height={130} />
      ) : query.isError || !data ? (
        <CardError error={query.error} fallback="Não foi possível carregar a evolução." onRetry={() => void query.refetch()} />
      ) : total === 0 ? (
        <p className="rkp-empty" data-testid="rkp-evo-empty">
          Sem pontos neste período ainda. Cada aula, roda e evento entra no gráfico — bora treinar!
        </p>
      ) : (
        <div className={cn("rkp-chart-wrap", query.isPlaceholderData && "rk-dim")} data-testid="rkp-chart">
          <svg
            className="rkp-chart"
            viewBox={`0 0 ${CHART.width} ${CHART.top + CHART.height + CHART.bottom}`}
            preserveAspectRatio="xMidYMid meet"
            aria-hidden="true"
            focusable="false"
          >
            <line className="rkp-chart-base" x1="0" x2={CHART.width} y1={CHART.top + CHART.height} y2={CHART.top + CHART.height} />
            {bars.map((bar) => {
              const y = CHART.top + CHART.height - bar.height;
              return (
                <g key={bar.key} data-testid="rkp-bar" data-points={bar.points} data-last={bar.isLast ? "true" : "false"}>
                  <rect
                    className={cn("rkp-bar", bar.isLast && "is-last", bar.points === 0 && "is-zero")}
                    x={bar.x}
                    y={y}
                    width={bar.width}
                    height={bar.height}
                    rx={Math.min(4, bar.width / 2)}
                  />
                  {bar.isLast && bar.points > 0 && (
                    <text className="rkp-bar-value" x={bar.x + bar.width / 2} y={y - 5} textAnchor="middle">
                      {formatPoints(bar.points)}
                    </text>
                  )}
                  {bar.showLabel && (
                    <text className={cn("rkp-bar-label", bar.isLast && "is-last")} x={bar.x + bar.width / 2} y={CHART.top + CHART.height + 15} textAnchor="middle">
                      {bar.label}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <table className="sr-only">
            <caption>{`Pontos por ${unit} nos últimos ${data.points.length} períodos`}</caption>
            <thead>
              <tr>
                <th scope="col">Período</th>
                <th scope="col">Pontos</th>
                <th scope="col">Aulas</th>
              </tr>
            </thead>
            <tbody>
              {data.points.map((point) => (
                <tr key={point.key}>
                  <th scope="row">{evolutionLongLabel(point.key, granularity)}</th>
                  <td>{point.points}</td>
                  <td>{point.lessons}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="rkp-chart-sum" data-testid="rkp-chart-sum">
            {last && (
              <>
                {granularity === "WEEK" ? "Esta semana" : "Este mês"}: <strong>{formatPoints(last.points)} pts</strong> ·{" "}
              </>
            )}
            no gráfico: <strong>{formatPoints(total)} pts</strong>
            {data.bestWeek && (
              <>
                {" "}
                · melhor semana: <strong>{formatPoints(data.bestWeek.points)} pts</strong> ({evolutionLongLabel(data.bestWeek.key, "WEEK")})
              </>
            )}
          </p>
        </div>
      )}
    </Card>
  );
}

/* ---------- Extrato ---------- */

/** "Como ganhei meus pontos": lista paginada com filtro de temporada e o total da temporada escolhida. */
export function StatementCard() {
  const [season, setSeason] = useState<string>(ALL_TIME);
  const statement = useRankingStatement(season);
  const options = statementSeasonOptions(statement.seasonTotals);
  const seasonTotal = statement.seasonTotals.find((item) => item.season === season)?.points ?? 0;
  const empty = !statement.isLoading && !statement.isError && statement.total === 0;

  return (
    <Card id="rkp-stmt-title" title="Como ganhei meus pontos" icon={History} className="rkp-stmt" testId="rk-statement">
      <div className="rkp-stmt-top">
        <label className="rkp-stmt-filter">
          <span>Temporada</span>
          <select
            className="select-field"
            aria-label="Filtrar extrato por temporada"
            value={options.includes(season) ? season : ALL_TIME}
            onChange={(event) => setSeason(event.target.value)}
          >
            {options.map((value) => (
              <option key={value} value={value}>
                {seasonLabel(value)}
              </option>
            ))}
          </select>
        </label>
        {!statement.isLoading && !statement.isError && (
          <p className="rkp-stmt-total" data-testid="rkp-stmt-total">
            {season === ALL_TIME ? "Total de todos os tempos" : `Total em ${seasonLabel(season)}`}:{" "}
            <strong>{formatPoints(season === ALL_TIME ? statement.allTimePoints : seasonTotal)} pts</strong>
          </p>
        )}
      </div>

      {statement.isLoading ? (
        <CardSkeleton label="Carregando o extrato" height={150} />
      ) : statement.isError ? (
        <CardError error={statement.error} fallback="Não foi possível carregar o extrato." onRetry={() => void statement.refetch()} />
      ) : empty ? (
        <p className="rkp-empty" data-testid="rkp-stmt-empty">
          {season === ALL_TIME ? "Ainda sem pontos por aqui." : "Nenhum ponto nesta temporada ainda."} Quando você treinar, for a um evento ou fizer o
          check-in, eles aparecem nesta lista.
        </p>
      ) : (
        <>
          <ul className={cn("rkp-stmt-list", statement.isPlaceholderData && "rk-dim")} data-testid="rkp-stmt-list" aria-busy={statement.isPlaceholderData}>
            {statement.items.map((item) => {
              const Icon = pointIconFor(item.type);
              return (
                <li key={item.id} data-testid="rkp-stmt-item" data-type={item.type}>
                  <span className="rkp-stmt-icon" aria-hidden="true">
                    <Icon />
                  </span>
                  <span className="rkp-stmt-main">
                    <strong>{item.label}</strong>
                    <time dateTime={item.occurredAt} title={statementFullDate(item.occurredAt)}>
                      {statementDateLabel(item.occurredAt)}
                    </time>
                  </span>
                  <b className={cn("rkp-stmt-pts", item.points < 0 && "is-neg")}>
                    {item.points > 0 ? "+" : ""}
                    {formatPoints(item.points)}
                  </b>
                </li>
              );
            })}
          </ul>
          {statement.hasNextPage && (
            <div className="rk-more">
              <p role="status">
                Mostrando {statement.items.length} de {statement.total}
              </p>
              <Button type="button" variant="outline" className="min-h-11" disabled={statement.isFetchingNextPage} onClick={() => void statement.fetchNextPage()}>
                {statement.isFetchingNextPage ? "Carregando…" : "Ver mais"}
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}

/* ---------- Tela "Meu progresso" ---------- */

export function NoStudentNote() {
  return (
    <div className="rk-empty" role="status" data-testid="rkp-no-student">
      <span className="rk-empty-icon" aria-hidden="true">
        <Trophy />
      </span>
      <strong>Nenhum aluno vinculado a esta conta.</strong>
      <p>Quando houver um aluno ligado, o progresso dele aparece aqui.</p>
    </div>
  );
}

export function ProgressView() {
  const scope = useStudentScope();
  if (scope.ready && scope.studentId === undefined) return <NoStudentNote />;
  return (
    <div className="rkp-grid stagger" data-testid="rk-progress-view">
      <ShowcaseHighlight className="rkp-wide" />
      <DailyCheckinCard />
      <GoalCard />
      <LeagueCard />
      <StreakCard />
      <EvolutionCard />
      <StatementCard />
    </div>
  );
}
