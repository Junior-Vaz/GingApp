import { useState } from "react";
import { Printer } from "lucide-react";
import { PageHeader } from "@/components/painel/page-header";
import { UnitPicker } from "@/components/painel/unit-picker";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { errorMessage } from "@/lib/api";
import { useDashboard } from "@/lib/dashboard";
import { useCan } from "@/lib/session";
import { NativeSelect } from "@/modules/aulas/native-select";
import { useClassSelector } from "@/modules/frequencia/frequencia-api";
import { emptyReportFilters, type ReportFilters } from "./relatorios-api";
import { AttendanceTab, FinanceTab, GraduationsTab, StudentsTab } from "./report-tabs";
import { buildSections } from "./sections";

type TabId = "resumo" | "alunos" | "frequencia" | "financeiro" | "graduacoes";

const TAB_TITLE: Record<TabId, string> = {
  resumo: "Resumo do grupo",
  alunos: "Relatório de alunos",
  frequencia: "Relatório de frequência",
  financeiro: "Relatório financeiro",
  graduacoes: "Relatório de graduações",
};

/** Resumo (indicadores do dashboard, sem filtros): o que a página já mostrava antes dos relatórios detalhados. */
function ResumoTab() {
  const { data, isLoading, error, refetch } = useDashboard();
  if (error) {
    return (
      <Card className="items-center gap-3 p-8 text-center" role="alert">
        <p className="text-sm text-destructive">{errorMessage(error, "Não foi possível carregar o relatório.")}</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Tentar novamente
        </Button>
      </Card>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="grid gap-4 md:grid-cols-2" data-testid="relatorio-loading">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-36 rounded-lg" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="relatorio-content">
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
  );
}

export function RelatoriosPage() {
  const [tab, setTab] = useState<TabId>("resumo");
  const [filters, setFilters] = useState<ReportFilters>(emptyReportFilters);
  const canFinance = useCan("finance", "view");
  const classes = useClassSelector();
  const set = <K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const hasFilter = !!(filters.from || filters.to || filters.unitId || filters.classId);

  return (
    <div>
      <PageHeader
        title="Relatórios"
        description="Indicadores do grupo por período e unidade. Exporte em CSV ou imprima."
        actions={
          <Button variant="outline" onClick={() => window.print()}>
            <Printer /> Imprimir
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={(value) => setTab(value as TabId)}>
        <TabsList className="no-print h-auto flex-wrap">
          <TabsTrigger value="resumo">Resumo</TabsTrigger>
          <TabsTrigger value="alunos">Alunos</TabsTrigger>
          <TabsTrigger value="frequencia">Frequência</TabsTrigger>
          {canFinance && <TabsTrigger value="financeiro">Financeiro</TabsTrigger>}
          <TabsTrigger value="graduacoes">Graduações</TabsTrigger>
        </TabsList>

        {tab !== "resumo" && (
          <div className="no-print mt-4 grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5" data-testid="report-filters">
            <div className="space-y-1.5">
              <label htmlFor="rel-de" className="text-sm font-medium">
                De
              </label>
              <Input id="rel-de" type="date" value={filters.from} max={filters.to || undefined} onChange={(e) => set("from", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="rel-ate" className="text-sm font-medium">
                Até
              </label>
              <Input id="rel-ate" type="date" value={filters.to} min={filters.from || undefined} onChange={(e) => set("to", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Unidade</span>
              <UnitPicker mode="filter" value={filters.unitId ? Number(filters.unitId) : null} onChange={(u) => set("unitId", u ? String(u.id) : "")} />
            </div>
            {tab === "frequencia" && (
              <div className="space-y-1.5">
                <label htmlFor="rel-turma" className="text-sm font-medium">
                  Turma
                </label>
                <NativeSelect id="rel-turma" value={filters.classId} onChange={(e) => set("classId", e.target.value)}>
                  <option value="">Todas as turmas</option>
                  {classes.data?.items.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
            <div className="flex items-end">
              {hasFilter && (
                <Button variant="ghost" size="sm" onClick={() => setFilters(emptyReportFilters())}>
                  Limpar filtros
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-5">
              Sem datas: últimos 30 dias na frequência, 6 meses no financeiro e 12 meses em alunos e graduações.
            </p>
          </div>
        )}

        <div className="report-printable mt-4">
          <h2 className="mb-3 hidden text-lg font-bold print:block">{TAB_TITLE[tab]}</h2>
          <TabsContent value="resumo">
            <ResumoTab />
          </TabsContent>
          <TabsContent value="alunos">
            <StudentsTab filters={filters} />
          </TabsContent>
          <TabsContent value="frequencia">
            <AttendanceTab filters={filters} />
          </TabsContent>
          {canFinance && (
            <TabsContent value="financeiro">
              <FinanceTab filters={filters} />
            </TabsContent>
          )}
          <TabsContent value="graduacoes">
            <GraduationsTab filters={filters} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
