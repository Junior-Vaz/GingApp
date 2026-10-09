import { Printer } from "lucide-react";
import { PageHeader } from "@/components/painel/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/api";
import { useDashboard } from "@/lib/dashboard";
import { buildSections } from "./sections";

export function RelatoriosPage() {
  const { data, isLoading, error, refetch } = useDashboard();

  return (
    <div>
      <PageHeader
        title="Relatórios"
        description="Resumo do grupo com os indicadores disponíveis na API."
        actions={
          <Button variant="outline" onClick={() => window.print()} disabled={!data}>
            <Printer /> Imprimir
          </Button>
        }
      />
      {error ? (
        <Card className="items-center gap-3 p-8 text-center" role="alert">
          <p className="text-sm text-destructive">
            {errorMessage(error, "Não foi possível carregar o relatório.")}
          </p>
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            Tentar novamente
          </Button>
        </Card>
      ) : isLoading || !data ? (
        <div className="grid gap-4 md:grid-cols-2" data-testid="relatorio-loading">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-36 rounded-lg" />
          ))}
        </div>
      ) : (
        <div className="space-y-4" data-testid="relatorio-content">
          <div className="grid gap-4 md:grid-cols-2">
            {buildSections(data).map((section) => (
              <Card key={section.title} className="gap-3 p-5">
                <h2 className="text-sm font-bold">{section.title}</h2>
                <dl className="divide-y">
                  {section.rows.map((row) => (
                    <div key={row.label} className="flex justify-between py-2 text-sm">
                      <dt className="text-muted-foreground">{row.label}</dt>
                      <dd className="font-semibold">{row.value}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Relatórios detalhados (por período, turma ou aluno) dependem de endpoints que ainda não
            existem na API.
          </p>
        </div>
      )}
    </div>
  );
}
