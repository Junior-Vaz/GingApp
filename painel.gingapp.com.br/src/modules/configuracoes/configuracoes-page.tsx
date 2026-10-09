import { useQuery } from "@tanstack/react-query";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { api, errorMessage } from "@/lib/api";
import { useDashboard } from "@/lib/dashboard";
import { formatCurrency, fmt, toDate } from "@/lib/format";

import {
  SUBSCRIPTION_LABEL,
  usagePercent,
  type Organization,
  type Subscription,
} from "./plan";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="text-sm font-semibold">{value || "-"}</dd>
    </div>
  );
}

function ErrorCard({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Card className="items-center gap-3 p-6 text-center" role="alert">
      <p className="text-sm text-destructive">{errorMessage(error, "Não foi possível carregar.")}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        Tentar novamente
      </Button>
    </Card>
  );
}

function OrganizationCard() {
  const org = useQuery({
    queryKey: ["organizations", "own"],
    queryFn: async () => {
      const data = await api.get<Organization | Organization[] | null>("/organizations");
      return Array.isArray(data) ? (data[0] ?? null) : data;
    },
  });
  if (org.error) return <ErrorCard error={org.error} onRetry={() => void org.refetch()} />;
  return (
    <Card className="gap-4 p-5" data-testid="org-card">
      <h2 className="text-lg font-bold">Dados do grupo</h2>
      {org.isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : org.data ? (
        <dl className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" value={org.data.name} />
          <Field label="Identificador (slug)" value={org.data.slug} />
          <Field label="Documento (CNPJ/CPF)" value={org.data.document} />
          <Field label="E-mail" value={org.data.email} />
          <Field label="Telefone" value={org.data.phone} />
          <Field label="Situação" value={org.data.status === "ACTIVE" ? "Ativo" : org.data.status} />
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">Organização não encontrada.</p>
      )}
      <p className="text-xs text-muted-foreground">
        A edição dos dados do grupo ainda não esta disponível na API. Fale com a equipe GingApp.
      </p>
    </Card>
  );
}

function PlanCard() {
  const subscription = useQuery({
    queryKey: ["subscriptions", "me"],
    queryFn: () => api.get<Subscription | null>("/subscriptions/me"),
  });
  // Alunos ativos vem do agregado do dashboard (GET /students e limitado a 50 itens).
  const dashboard = useDashboard();

  if (subscription.error) {
    return <ErrorCard error={subscription.error} onRetry={() => void subscription.refetch()} />;
  }
  const sub = subscription.data;
  const active = dashboard.data?.students.active ?? 0;
  const percent = sub ? usagePercent(active, sub.plan.maxStudents) : null;

  return (
    <Card className="gap-4 p-5" data-testid="plan-card">
      <h2 className="text-lg font-bold">Meu plano</h2>
      {subscription.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : sub ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-semibold">{sub.plan.name}</span>
            {sub.status === "ACTIVE" ? (
              <Badge>{SUBSCRIPTION_LABEL[sub.status]}</Badge>
            ) : (
              <Badge variant="outline">{SUBSCRIPTION_LABEL[sub.status]}</Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {formatCurrency(sub.plan.priceCents)}/mês
            {sub.currentPeriodEnd
              ? ` - renova em ${fmt(new Date(toDate(sub.currentPeriodEnd).getTime()), "dd/MM/yyyy")}`
              : ""}
          </p>
          <div>
            <div className="flex justify-between text-sm">
              <span>Alunos ativos</span>
              <span data-testid="plan-usage">
                {dashboard.isLoading ? "..." : active} / {sub.plan.maxStudents ?? "ilimitado"}
              </span>
            </div>
            {percent !== null && <Progress value={percent} className="mt-1.5 h-2" />}
            {percent !== null && percent >= 100 && (
              <p className="mt-1.5 text-sm text-destructive" role="alert">
                Limite de alunos do plano atingido. Fale com a equipe GingApp para fazer upgrade.
              </p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          Nenhuma assinatura ativa no momento. Fale com a equipe GingApp para contratar um plano.
        </p>
      )}
    </Card>
  );
}

export function ConfiguracoesPage() {
  return (
    <div>
      <PageHeader title="Configurações" description="Dados do grupo, plano e uso." />
      <div className="grid gap-4 lg:grid-cols-2">
        <OrganizationCard />
        <PlanCard />
      </div>
    </div>
  );
}
