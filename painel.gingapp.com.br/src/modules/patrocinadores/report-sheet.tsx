import { useId, useMemo, useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { downloadCampaignCsv, sponsorsErrorMessage, useCampaignReport } from "./api";
import { BarChart } from "./bar-chart";
import {
  defaultReportRange,
  fillDays,
  formatInt,
  formatInstant,
  formatPercent,
  longDay,
  shortDay,
  stateReportLabel,
  type GroupCampaign,
} from "./sponsor-utils";

function Total({ label, value, testId }: { label: string; value: string; testId: string }) {
  return (
    <Card className="gap-1 p-4">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-2xl font-extrabold tabular-nums" data-testid={testId}>
        {value}
      </p>
    </Card>
  );
}

function ReportBody({ campaign }: { campaign: GroupCampaign }) {
  const fromId = useId();
  const toId = useId();
  const [range, setRange] = useState(() => defaultReportRange(campaign.startsAt, campaign.endsAt));
  const [exporting, setExporting] = useState(false);
  const invalidRange = range.from === "" || range.to === "" || range.from > range.to;
  const query = useCampaignReport(campaign.id, range);
  const report = query.data;

  const days = useMemo(
    () => (report && !invalidRange ? fillDays(report.byDay, range.from, range.to) : []),
    [report, invalidRange, range.from, range.to],
  );

  async function exportCsv() {
    setExporting(true);
    try {
      await downloadCampaignCsv(campaign.id, range);
      toast.success("Arquivo CSV gerado.");
    } catch (error) {
      toast.error(sponsorsErrorMessage(error, "Não foi possível exportar o CSV."));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="grid gap-5 pb-6 sm:px-4" data-testid="report">
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor={fromId}>De</Label>
          <Input id={fromId} type="date" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor={toId}>Até</Label>
          <Input id={toId} type="date" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </div>
        <Button type="button" variant="outline" disabled={invalidRange || exporting} onClick={() => void exportCsv()}>
          <Download /> {exporting ? "Gerando…" : "Exportar CSV"}
        </Button>
      </div>
      <p className="-mt-3 text-xs text-muted-foreground">
        Padrão: últimos 30 dias dentro da vigência ({formatInstant(campaign.startsAt)} até {formatInstant(campaign.endsAt)}).
      </p>

      {invalidRange && (
        <p role="alert" className="text-sm font-medium text-destructive" data-testid="report-range-error">
          Informe um período válido: a data inicial não pode ser depois da final.
        </p>
      )}

      {!invalidRange && query.isLoading && (
        <div className="grid gap-3" data-testid="report-loading" aria-busy="true">
          <Skeleton className="h-20 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      )}

      {!invalidRange && query.error && (
        <Card className="items-center gap-3 p-6 text-center" role="alert" data-testid="report-error">
          <p className="text-sm text-destructive">{sponsorsErrorMessage(query.error, "Não foi possível carregar o relatório.")}</p>
          <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
            Tentar novamente
          </Button>
        </Card>
      )}

      {!invalidRange && report && (
        <>
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-3">
            <Total label="Impressões" value={formatInt(report.totals.impressions)} testId="total-impressions" />
            <Total label="Cliques" value={formatInt(report.totals.clicks)} testId="total-clicks" />
            <Total label="CTR (cliques ÷ impressões)" value={formatPercent(report.totals.ctr)} testId="total-ctr" />
          </div>

          {report.totals.impressions === 0 && report.totals.clicks === 0 ? (
            <p className="rounded-lg border p-6 text-center text-sm text-muted-foreground" data-testid="report-empty">
              Ainda não há impressões nem cliques neste período.
            </p>
          ) : (
            <>
              <div className="grid gap-4 lg:grid-cols-2">
                <BarChart title="Impressões por dia" colorClass="text-sky-700" testId="chart-impressions" points={days.map((d) => ({ label: shortDay(d.day), value: d.impressions }))} />
                <BarChart title="Cliques por dia" colorClass="text-emerald-700" testId="chart-clicks" points={days.map((d) => ({ label: shortDay(d.day), value: d.clicks }))} />
              </div>

              <div>
                <h3 className="mb-2 text-sm font-semibold">Por estado (UF)</h3>
                {report.byState.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Sem dados por estado no período.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm" data-testid="table-states">
                      <caption className="sr-only">Impressões e cliques por estado</caption>
                      <thead className="bg-muted/50 text-left">
                        <tr>
                          <th scope="col" className="px-3 py-2 font-medium">
                            Estado
                          </th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">
                            Impressões
                          </th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">
                            Cliques
                          </th>
                          <th scope="col" className="px-3 py-2 text-right font-medium">
                            CTR
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.byState.map((s) => (
                          <tr key={s.state || "?"} className="border-t">
                            <th scope="row" className="px-3 py-2 text-left font-medium">
                              {stateReportLabel(s.state)}
                            </th>
                            <td className="px-3 py-2 text-right tabular-nums">{formatInt(s.impressions)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatInt(s.clicks)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatPercent(s.impressions > 0 ? Math.round((s.clicks / s.impressions) * 10000) / 100 : 0)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <details className="rounded-lg border p-3 text-sm">
                <summary className="cursor-pointer font-medium">Ver os números dia a dia</summary>
                <div className="mt-2 max-h-72 overflow-auto">
                  <table className="w-full" data-testid="table-days">
                    <caption className="sr-only">Impressões e cliques por dia</caption>
                    <thead className="text-left">
                      <tr>
                        <th scope="col" className="py-1 pr-3 font-medium">
                          Dia
                        </th>
                        <th scope="col" className="py-1 pr-3 text-right font-medium">
                          Impressões
                        </th>
                        <th scope="col" className="py-1 text-right font-medium">
                          Cliques
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((d) => (
                        <tr key={d.day} className="border-t">
                          <th scope="row" className="py-1 pr-3 text-left font-normal">
                            {longDay(d.day)}
                          </th>
                          <td className="py-1 pr-3 text-right tabular-nums">{formatInt(d.impressions)}</td>
                          <td className="py-1 text-right tabular-nums">{formatInt(d.clicks)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </>
      )}

      <p className="text-xs text-muted-foreground" data-testid="report-privacy">
        Os números são agregados e não identificam pessoas.
      </p>
    </div>
  );
}

/** Relatório da campanha (totais, CTR, série por dia, tabela por UF, CSV), numa folha lateral que ocupa a tela toda no celular. */
export function ReportSheet({ campaign, sponsorName, onClose }: { campaign: GroupCampaign | null; sponsorName: string; onClose: () => void }) {
  return (
    <Sheet open={campaign !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="overflow-y-auto max-sm:w-full max-sm:p-4 sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Relatório da campanha</SheetTitle>
          <SheetDescription>
            {campaign ? `${campaign.title} · ${sponsorName}` : ""}
          </SheetDescription>
        </SheetHeader>
        {campaign && <ReportBody key={campaign.id} campaign={campaign} />}
      </SheetContent>
    </Sheet>
  );
}
