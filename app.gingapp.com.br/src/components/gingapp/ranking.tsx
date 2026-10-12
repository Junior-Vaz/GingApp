import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Medal, Settings2, Sparkles, Trophy, User, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import {
  ALL_TIME,
  BANDS,
  CATEGORIES,
  SCOPES,
  currentSeasonLocal,
  formatPoints,
  leveledUp,
  prefersReducedMotion,
  readSeenLeague,
  seasonLabel,
  storeSeenLeague,
  useRankingGroups,
  useRankingMe,
  useRankingSeasons,
  useRankingStudents,
  type GroupScope,
  type RankBand,
  type RankCategory,
  type RankLevel,
  type RankScope,
} from "@/lib/ranking";
import {
  Confetti,
  GroupRow,
  ProgressCard,
  ProgressSkeleton,
  RankSkeleton,
  SettingsSheet,
  StudentRow,
  GroupsPodium,
  StudentsPodium,
} from "./ranking-parts";

type Tab = "students" | "groups";

const TABS: { value: Tab; label: string; icon: typeof User }[] = [
  { value: "students", label: "Alunos", icon: User },
  { value: "groups", label: "Grupos", icon: Users },
];

/** Alternador animado "Alunos | Grupos" (mesmo componente visual do Lista | Mapa; setas do teclado). */
function TabToggle({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return (
    <div
      className="view-toggle rk-tabs"
      role="radiogroup"
      aria-label="Tipo de ranking"
      data-view={tab === "groups" ? "map" : "list"}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
        event.preventDefault();
        const next = tab === "students" ? "groups" : "students";
        onChange(next);
        event.currentTarget.querySelector<HTMLElement>(`[data-value="${next}"]`)?.focus();
      }}
    >
      <span className="view-toggle-pill" aria-hidden="true" />
      {TABS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          data-value={value}
          aria-checked={tab === value}
          tabIndex={tab === value ? 0 : -1}
          onClick={() => onChange(value)}
        >
          <Icon aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

function Chip<T extends string>({
  value,
  current,
  onSelect,
  children,
  small = false,
}: {
  value: T;
  current: T;
  onSelect: (value: T) => void;
  children: string;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      className={`map-chip rk-chip ${small ? "is-small" : ""}`}
      aria-pressed={current === value}
      onClick={() => onSelect(value)}
    >
      {children}
    </button>
  );
}

function EmptyRanking({ onConfigure, groups }: { onConfigure?: () => void; groups?: boolean }) {
  return (
    <div className="rk-empty" role="status" data-testid="rk-empty">
      <span className="rk-empty-icon" aria-hidden="true">
        <Trophy />
      </span>
      <strong>Ainda sem pontos nesta temporada — bora treinar!</strong>
      <p>
        {groups
          ? "Quando os alunos dos grupos pontuarem em aulas, rodas e eventos, o ranking aparece aqui."
          : "Cada aula, roda e evento rende pontos. Quem aparece primeiro leva a coroa."}
      </p>
      {onConfigure && (
        <Button variant="outline" size="sm" onClick={onConfigure}>
          <Settings2 /> Configurar ranking
        </Button>
      )}
    </div>
  );
}

export function RankingPage() {
  const [tab, setTab] = useState<Tab>("students");
  const [scope, setScope] = useState<RankScope>("GROUP");
  const [category, setCategory] = useState<RankCategory>("GENERAL");
  const [band, setBand] = useState<RankBand | "">("");
  const [pickedSeason, setPickedSeason] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [celebrate, setCelebrate] = useState<RankLevel | null>(null);
  const [confetti, setConfetti] = useState(false);

  const seasons = useRankingSeasons();
  // A temporada so e conhecida depois de /ranking/seasons (ou de ele falhar): evita consultar o mes errado.
  const seasonsSettled = !seasons.isPending;
  const current = seasons.data?.current ?? currentSeasonLocal();
  const season = pickedSeason ?? current;
  const seasonOptions = useMemo(() => {
    const past = (seasons.data?.items ?? []).map((item) => item.season).filter((s) => s !== current && s !== ALL_TIME);
    return [current, ...[...new Set(past)].sort().reverse(), ALL_TIME];
  }, [seasons.data, current]);
  const champions = seasons.data?.items.find((item) => item.season === season)?.champions;

  const groupsTab = tab === "groups";
  const groupScope: GroupScope = scope === "GROUP" ? "CITY" : scope;
  const students = useRankingStudents({ scope, season, category, band }, seasonsSettled && !groupsTab);
  const groups = useRankingGroups({ scope: groupScope, season }, seasonsSettled && groupsTab);
  const me = useRankingMe();

  function changeTab(next: Tab) {
    setTab(next);
    if (next === "groups" && scope === "GROUP") setScope("CITY");
  }

  // Subiu de liga desde a ultima visita? (compara com a ultima liga vista, guardada no navegador)
  const meId = me.data?.student.id;
  const meLevel = me.data?.level;
  useEffect(() => {
    if (meId === undefined || !meLevel) return;
    if (leveledUp(readSeenLeague(meId), meLevel.code)) {
      setCelebrate(meLevel);
      setConfetti(!prefersReducedMotion());
    }
    storeSeenLeague(meId, meLevel.code);
  }, [meId, meLevel]);
  useEffect(() => {
    if (!confetti) return;
    const timer = window.setTimeout(() => setConfetti(false), 4600);
    return () => window.clearTimeout(timer);
  }, [confetti]);

  const list = groupsTab ? groups : students;
  const items = groupsTab ? groups.items : students.items;
  const rest = items.slice(3);
  const myRank = !groupsTab ? students.me : null;
  const showMeBar = !groupsTab && myRank !== null && !myRank.inList && myRank.rank !== null;
  const empty = !list.isLoading && !list.isError && list.total === 0;
  const scopes = groupsTab ? SCOPES.filter((s) => s.value !== "GROUP") : SCOPES;
  const effectiveScope = groupsTab ? groupScope : scope;
  const metaFor = groupsTab ? `${groups.total} grupos` : `${students.total} alunos`;
  const settings = me.data?.settings;
  const playKey = `${tab}-${effectiveScope}-${season}-${category}-${band}`;

  return (
    <>
      <div className="page-heading rk-heading">
        <div>
          <h1>
            <Trophy className="rk-title-icon" aria-hidden="true" /> Ginga Rank
          </h1>
          <p>Treine, jogue roda, vá aos eventos — e suba de liga. A capoeira também é uma boa disputa.</p>
        </div>
        <Button variant="outline" size="sm" aria-label="Configurar ranking" onClick={() => setSettingsOpen(true)}>
          <Settings2 /> <span className="rk-cfg-label">Configurar ranking</span>
        </Button>
      </div>

      {celebrate && (
        <div className="rk-levelup" role="status" data-testid="rk-levelup" style={{ "--lg": celebrate.color } as CSSProperties}>
          <Sparkles aria-hidden="true" />
          <div>
            <strong>Você subiu de liga!</strong>
            <span>Agora você está na liga {celebrate.name}. Parabéns, capoeirista!</span>
          </div>
          <button type="button" aria-label="Fechar aviso" onClick={() => setCelebrate(null)}>
            <X />
          </button>
        </div>
      )}
      {confetti && <Confetti />}

      <section className="rk-filters" aria-label="Filtros do ranking">
        <div className="rk-filter-top">
          <TabToggle tab={tab} onChange={changeTab} />
          <div className="rk-chips rk-scope" role="group" aria-label="Escopo">
            {scopes.map((item) => (
              <Chip key={item.value} value={item.value} current={effectiveScope} onSelect={setScope}>
                {item.label}
              </Chip>
            ))}
          </div>
          <label className="rk-season">
            <span className="sr-only">Temporada</span>
            <Medal aria-hidden="true" />
            <select
              aria-label="Temporada"
              className="select-field"
              value={season}
              onChange={(event) => setPickedSeason(event.target.value)}
            >
              {seasonOptions.map((value) => (
                <option key={value} value={value}>
                  {seasonLabel(value)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {!groupsTab && (
          <div className="rk-filter-sub">
            <div className="rk-chips" role="group" aria-label="Categoria">
              {CATEGORIES.map((item) => (
                <Chip key={item.value} value={item.value} current={category} onSelect={setCategory} small>
                  {item.label}
                </Chip>
              ))}
            </div>
            <span className="rk-sep" aria-hidden="true" />
            <div className="rk-chips" role="group" aria-label="Faixa etária">
              {BANDS.map((item) => (
                <Chip key={item.value} value={item.value} current={band} onSelect={setBand} small>
                  {item.label}
                </Chip>
              ))}
            </div>
          </div>
        )}
      </section>

      {champions && season !== current && (champions.country || champions.group) && (
        <p className="rk-champs" data-testid="rk-champions">
          <Trophy aria-hidden="true" />
          <span>
            {champions.country && (
              <>
                Campeão do Brasil em {seasonLabel(season)}: <strong>{champions.country.displayName}</strong> ({formatPoints(champions.country.points)} pts)
              </>
            )}
            {champions.country && champions.group && " · "}
            {champions.group && (
              <>
                do grupo: <strong>{champions.group.displayName}</strong> ({formatPoints(champions.group.points)} pts)
              </>
            )}
          </span>
        </p>
      )}

      <div className="rk-layout">
        <div className="rk-podium-area" aria-busy={list.isPlaceholderData}>
          {list.isLoading ? (
            <RankSkeleton />
          ) : list.isError ? (
            <div className="rk-empty is-error" role="alert">
              <strong>{errorMessage(list.error, "Não foi possível carregar o ranking.")}</strong>
              <Button size="sm" variant="outline" onClick={() => void list.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : empty ? (
            <EmptyRanking groups={groupsTab} {...(settings && !settings.optInPublic ? { onConfigure: () => setSettingsOpen(true) } : {})} />
          ) : (
            <div className={list.isPlaceholderData ? "rk-dim" : undefined} key={playKey}>
              {groupsTab ? <GroupsPodium items={groups.items} /> : <StudentsPodium items={students.items} />}
            </div>
          )}
        </div>

        <aside className="rk-aside" aria-label="Seu progresso">
          {me.isLoading ? (
            <ProgressSkeleton />
          ) : me.data ? (
            <ProgressCard me={me.data} onConfigure={() => setSettingsOpen(true)} />
          ) : me.isError ? (
            <section className="rk-card" role="alert">
              <strong>Não foi possível carregar seu progresso.</strong>
              <p className="rk-muted">{errorMessage(me.error, "Tente novamente em instantes.")}</p>
              <Button size="sm" variant="outline" onClick={() => void me.refetch()}>
                Tentar novamente
              </Button>
            </section>
          ) : null}
        </aside>

        <div className="rk-list-area">
          {!list.isLoading && !list.isError && !empty && (
            <>
              {rest.length > 0 && (
                <div className="rk-list-head">
                  <h2>Classificação</h2>
                  <span>{metaFor}</span>
                </div>
              )}
              <ul className={`rk-list ${list.isPlaceholderData ? "rk-dim" : ""}`} data-testid="rk-list">
                {groupsTab
                  ? groups.items.slice(3).map((item, i) => <GroupRow key={item.groupId} item={item} index={i} />)
                  : students.items.slice(3).map((item, i) => <StudentRow key={item.studentId} item={item} index={i} />)}
              </ul>
              {list.hasNextPage && (
                <div className="rk-more">
                  <p role="status">
                    Mostrando {items.length} de {list.total}
                  </p>
                  <Button variant="outline" size="sm" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                    {list.isFetchingNextPage ? "Carregando…" : "Ver mais"}
                  </Button>
                </div>
              )}
              {showMeBar && myRank && (
                <div className="rk-me-bar" data-testid="rk-me-bar" role="status">
                  <strong>Você: #{myRank.rank}</strong>
                  <span>{formatPoints(myRank.points)} pts</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} settings={settings} />
    </>
  );
}
