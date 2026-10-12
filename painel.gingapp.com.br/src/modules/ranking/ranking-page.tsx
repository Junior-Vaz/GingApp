import { useEffect, useState } from "react";
import { Printer, Sigma, TrendingUp, UserX, Users } from "lucide-react";
import { DataTable, type Column } from "@/components/painel/data-table";
import { ExportRowsButton } from "@/components/painel/export-csv-button";
import { PageHeader } from "@/components/painel/page-header";
import { StatCard } from "@/components/painel/stat-card";
import { StudentAvatar } from "@/components/painel/student-avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage } from "@/lib/api";
import { NativeSelect } from "@/modules/alunos/native-select";
import {
  BAND_LABEL,
  CATEGORY_LABEL,
  RANKING_CSV_HEADERS,
  SCOPE_LABEL,
  formatPoints,
  rankingCsvRows,
  seasonLabel,
  useGroupOverview,
  useGroupsRanking,
  useRankingSeasons,
  useStudentsRanking,
  type GroupsScope,
  type RankingBand,
  type RankingCategory,
  type RankingGroup,
  type RankingStudent,
} from "./ranking-api";
import { DeltaCell, LeagueBadge, Podium, RankAvatar, SeasonChampions } from "./ranking-parts";

const PAGE_SIZE = 20;
/** Máximo aceito pelo backend por página: usado para achar a posição do meu grupo. */
const POSITION_LIMIT = 200;
const HIGHLIGHT = "bg-primary/10 hover:bg-primary/15";

type TabId = "alunos" | "brasil";

/* ---------- Cabeçalho: indicadores do grupo ---------- */

function OverviewCards() {
  const { data, isLoading, error, refetch } = useGroupOverview();
  if (error) {
    return (
      <Card className="mb-4 items-center gap-3 p-6 text-center" role="alert">
        <p className="text-sm text-destructive">{errorMessage(error, "Não foi possível carregar os indicadores do ranking.")}</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Tentar novamente
        </Button>
      </Card>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="ranking-overview-loading">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    );
  }
  return (
    <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4" data-testid="ranking-overview">
      <StatCard icon={Users} label="Alunos ativos" value={data.activeStudents} />
      <StatCard icon={Sigma} label="Pontos totais" value={formatPoints(data.totalPoints)} />
      <StatCard icon={TrendingUp} label="Média por aluno" value={formatPoints(data.avgPoints)} />
      <StatCard
        icon={UserX}
        label="Sem pontos na temporada"
        value={data.inactiveCount}
        hint="Alunos inativos no ranking"
        tone={data.inactiveCount > 0 ? "danger" : "default"}
      />
    </div>
  );
}

/* ---------- Aba: Alunos do grupo ---------- */

const studentColumns: Column<RankingStudent>[] = [
  { id: "rank", header: "Posição", className: "w-20", cell: (s) => <span className="font-bold">#{s.rank}</span> },
  {
    id: "name",
    header: "Aluno",
    cell: (s) => (
      <span className="flex items-center gap-3">
        <RankAvatar student={s} />
        <span className="font-semibold">{s.displayName}</span>
        {s.isMe && <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">Você</span>}
      </span>
    ),
  },
  { id: "league", header: "Liga", cell: (s) => <LeagueBadge level={s.level} /> },
  { id: "points", header: "Pontos", className: "text-right", cell: (s) => <span className="font-semibold">{formatPoints(s.points)}</span> },
  { id: "delta", header: "Variação", cell: (s) => <DeltaCell delta={s.rankDelta} /> },
];

function StudentsTab({ season }: { season: string }) {
  const [category, setCategory] = useState<RankingCategory>("GENERAL");
  const [band, setBand] = useState<RankingBand | "">("");
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [season]);

  const query = useStudentsRanking({ season, category, band, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
  const items = query.data?.items ?? [];

  return (
    <div className="space-y-4">
      {page === 0 && !query.error && items.length > 0 && <Podium students={items} />}
      <DataTable
        columns={studentColumns}
        data={query.data?.items}
        getRowId={(s) => s.studentId}
        isLoading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
        emptyMessage="Nenhum aluno com pontos neste filtro."
        rowClassName={(s) => (s.isMe ? HIGHLIGHT : undefined)}
        server={{
          total: query.data?.total ?? 0,
          page,
          pageSize: PAGE_SIZE,
          onPageChange: setPage,
          isFetching: query.isFetching,
        }}
        toolbar={
          <div className="no-print flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label="Filtrar por categoria"
              className="w-40"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value as RankingCategory);
                setPage(0);
              }}
            >
              {(Object.keys(CATEGORY_LABEL) as RankingCategory[]).map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABEL[c]}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Filtrar por faixa etária"
              className="w-44"
              value={band}
              onChange={(e) => {
                setBand(e.target.value as RankingBand | "");
                setPage(0);
              }}
            >
              <option value="">Todas as faixas etárias</option>
              {(Object.keys(BAND_LABEL) as RankingBand[]).map((b) => (
                <option key={b} value={b}>
                  {BAND_LABEL[b]}
                </option>
              ))}
            </NativeSelect>
            <ExportRowsButton
              filename="ranking-alunos"
              disabled={items.length === 0}
              build={() => ({ headers: RANKING_CSV_HEADERS, rows: rankingCsvRows(items) })}
            />
          </div>
        }
      />
    </div>
  );
}

/* ---------- Aba: Meu grupo no Brasil ---------- */

const SCOPE_PLACE: Record<GroupsScope, string> = { COUNTRY: "no Brasil", STATE: "no estado", CITY: "na cidade" };

const groupColumns: Column<RankingGroup>[] = [
  { id: "rank", header: "Posição", className: "w-20", cell: (g) => <span className="font-bold">#{g.rank}</span> },
  {
    id: "name",
    header: "Grupo",
    cell: (g) => (
      <span className="flex items-center gap-3">
        <StudentAvatar name={g.name} photo={g.logoUrl} />
        <span className="font-semibold">{g.name}</span>
        {g.isMine && <span className="rounded bg-primary px-1.5 py-0.5 text-[10px] font-bold text-primary-foreground">Seu grupo</span>}
      </span>
    ),
  },
  { id: "place", header: "Cidade", cell: (g) => [g.city, g.state].filter(Boolean).join(" / ") || "-" },
  { id: "students", header: "Alunos", className: "text-right", cell: (g) => g.studentsCount },
  { id: "total", header: "Pontos", className: "text-right", cell: (g) => <span className="font-semibold">{formatPoints(g.totalPoints)}</span> },
  { id: "avg", header: "Média", className: "text-right", cell: (g) => formatPoints(g.avgPoints) },
];

function GroupsTab({ season }: { season: string }) {
  const [scope, setScope] = useState<GroupsScope>("COUNTRY");
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [season]);

  const list = useGroupsRanking({ scope, season, limit: PAGE_SIZE, offset: page * PAGE_SIZE });
  // Posição do meu grupo: busca à parte (até 200 primeiros) para não depender da página que está aberta.
  const position = useGroupsRanking({ scope, season, limit: POSITION_LIMIT, offset: 0 });
  const mine = position.data?.items.find((g) => g.isMine);
  const total = position.data?.total ?? list.data?.total ?? 0;

  return (
    <div className="space-y-4">
      {mine ? (
        <Card className="gap-1 border-primary p-4" data-testid="my-group-position">
          <p className="text-lg font-extrabold">
            Você está em #{mine.rank} de {total}
          </p>
          <p className="text-sm text-muted-foreground">
            {mine.name} {SCOPE_PLACE[scope]} · {formatPoints(mine.totalPoints)} pontos · média {formatPoints(mine.avgPoints)} por aluno
          </p>
        </Card>
      ) : (
        position.data &&
        total > 0 && (
          <Card className="p-4 text-sm text-muted-foreground" data-testid="my-group-position">
            Seu grupo não está entre os {POSITION_LIMIT} primeiros de {total} {SCOPE_PLACE[scope]}.
          </Card>
        )
      )}
      <DataTable
        columns={groupColumns}
        data={list.data?.items}
        getRowId={(g) => g.groupId}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        emptyMessage="Nenhum grupo com pontos neste recorte."
        rowClassName={(g) => (g.isMine ? HIGHLIGHT : undefined)}
        server={{
          total: list.data?.total ?? 0,
          page,
          pageSize: PAGE_SIZE,
          onPageChange: setPage,
          isFetching: list.isFetching,
        }}
        toolbar={
          <div className="no-print flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label="Comparar com"
              className="w-44"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as GroupsScope);
                setPage(0);
              }}
            >
              {(Object.keys(SCOPE_LABEL) as GroupsScope[]).map((s) => (
                <option key={s} value={s}>
                  {SCOPE_LABEL[s]}
                </option>
              ))}
            </NativeSelect>
          </div>
        }
      />
    </div>
  );
}

/* ---------- Página ---------- */

export function RankingPage() {
  const [tab, setTab] = useState<TabId>("alunos");
  const [season, setSeason] = useState("");
  const seasons = useRankingSeasons();
  const past = (seasons.data?.items ?? []).filter((s) => s.season !== seasons.data?.current);
  const currentLabel = seasons.data?.current ? ` (${seasonLabel(seasons.data.current)})` : "";

  return (
    <div>
      <PageHeader
        title="Ranking"
        description="Pontuação e ligas dos alunos do grupo e a posição do seu grupo no Brasil."
        actions={
          <Button variant="outline" className="no-print" onClick={() => window.print()}>
            <Printer /> Imprimir
          </Button>
        }
      />

      <div className="report-printable space-y-4">
        <OverviewCards />

        <div className="no-print flex flex-wrap items-center gap-2">
          <label htmlFor="ranking-season" className="text-sm font-medium">
            Temporada
          </label>
          <NativeSelect id="ranking-season" className="w-64" value={season} onChange={(e) => setSeason(e.target.value)}>
            <option value="">Temporada atual{currentLabel}</option>
            <option value="ALL">Geral (todas as temporadas)</option>
            {past.map((s) => (
              <option key={s.season} value={s.season}>
                {seasonLabel(s.season)}
              </option>
            ))}
          </NativeSelect>
        </div>

        <Tabs value={tab} onValueChange={(value) => setTab(value as TabId)}>
          <TabsList className="no-print">
            <TabsTrigger value="alunos">Alunos do grupo</TabsTrigger>
            <TabsTrigger value="brasil">Meu grupo no Brasil</TabsTrigger>
          </TabsList>
          <TabsContent value="alunos" className="mt-4">
            <StudentsTab season={season} />
          </TabsContent>
          <TabsContent value="brasil" className="mt-4">
            <GroupsTab season={season} />
          </TabsContent>
        </Tabs>

        <Card className="gap-3 p-5">
          <h2 className="text-sm font-bold">Campeões das temporadas</h2>
          {seasons.error ? (
            <div role="alert" className="flex items-center gap-3 text-sm text-destructive">
              {errorMessage(seasons.error, "Não foi possível carregar as temporadas.")}
              <Button variant="outline" size="sm" onClick={() => void seasons.refetch()}>
                Tentar novamente
              </Button>
            </div>
          ) : seasons.isLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <SeasonChampions seasons={past} />
          )}
        </Card>
      </div>
    </div>
  );
}
