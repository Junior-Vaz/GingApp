import { plural } from "@/lib/plural";
import { Award, CalendarCheck, CalendarDays, Layers, Percent, Users, Wallet } from "lucide-react";
import { PageHeader } from "@/components/painel/page-header";
import { StatCard } from "@/components/painel/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { useDashboard } from "@/lib/dashboard";
import { dayOnly, fmt, formatCurrency } from "@/lib/format";

export function DashboardPage() {
  const { data, isLoading, error, refetch } = useDashboard();
  const finance = data?.finance;

  return (
    <div>
      <PageHeader title="Dashboard" description="Como está o seu grupo agora." />

      {error ? (
        <Card className="items-center gap-3 p-8 text-center" role="alert">
          <p className="text-sm text-destructive">
            {errorMessage(error, "Não foi possível carregar o dashboard.")}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </Card>
      ) : isLoading || !data ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4" data-testid="dashboard-loading">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-28 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="space-y-4" data-testid="dashboard-content">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={Users}
              label="Alunos ativos"
              value={data.students.active}
              hint={`+${data.students.new30d} nos últimos 30 dias`}
            />
            <StatCard icon={Layers} label="Turmas ativas" value={data.classes.active} />
            <StatCard icon={CalendarDays} label="Aulas hoje" value={data.lessonsToday} />
            <StatCard
              icon={Percent}
              label="Frequência (30d)"
              value={
                data.attendance.last30dPercent !== null ? `${data.attendance.last30dPercent}%` : "—"
              }
            />
          </div>

          {/* Cards financeiros só se o backend enviou `finance` (MESTRE); PROFESSOR não recebe. */}
          <div className={finance ? "grid gap-4 md:grid-cols-3" : "grid gap-4 sm:grid-cols-2 xl:grid-cols-4"}>
            {finance && (
              <>
                <StatCard
                  icon={Wallet}
                  label="Mensalidades previstas"
                  value={formatCurrency(finance.pendingCents)}
                  hint={plural(finance.pendingCount, "lançamento pendente", "lançamentos pendentes")}
                />
                <StatCard
                  icon={Wallet}
                  tone="danger"
                  label="Mensalidades atrasadas"
                  value={formatCurrency(finance.overdueCents)}
                  hint={plural(finance.overdueCount, "lançamento atrasado", "lançamentos atrasados")}
                />
              </>
            )}
            <StatCard icon={Award} label="Graduações (30d)" value={data.graduations.last30d} />
          </div>

          <Card className="gap-3 p-5">
            <div className="flex items-center gap-2">
              <CalendarCheck className="size-4 text-primary" />
              <h2 className="text-sm font-bold">Próximos eventos</h2>
            </div>
            {data.upcomingEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhum evento futuro cadastrado.</p>
            ) : (
              <ul className="divide-y">
                {data.upcomingEvents.map((event) => (
                  <li key={event.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                    <span className="font-semibold">{event.title}</span>
                    <span className="text-muted-foreground">
                      {fmt(dayOnly(event.date), "dd/MM")}
                      {event.location ? ` · ${event.location}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <p className="text-xs text-muted-foreground">
            Alunos inativos: {data.students.inactive}
          </p>
        </div>
      )}
    </div>
  );
}
