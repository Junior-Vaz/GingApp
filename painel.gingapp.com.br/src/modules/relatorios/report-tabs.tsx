import { plural } from "@/lib/plural";
import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Award, CheckCircle2, ClipboardCheck, Clock, AlertTriangle, UserCheck, UserPlus, Users, Wallet } from "lucide-react";
import { ExportCsvButton, ExportRowsButton } from "@/components/painel/export-csv-button";
import { RopeSwatch } from "@/components/painel/rope-swatch";
import { ropeOf } from "@/lib/rope";
import { StatCard } from "@/components/painel/stat-card";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "@/lib/api";
import { decimalBr, reais } from "@/lib/csv";
import { formatCurrency } from "@/lib/format";
import { BarList, ColumnChart, StackedColumnChart, type StackPart } from "./charts";
import {
  monthLabel,
  percentLabel,
  periodLabel,
  useReport,
  type AttendanceReport,
  type FinanceReport,
  type GraduationsReport,
  type ReportFilters,
  type ReportPeriod,
  type StudentsReport,
} from "./relatorios-api";

/** Carregando / erro com nova tentativa / conteúdo. */
function ReportBody<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.error) {
    return (
      <Card className="items-center gap-3 p-8 text-center" role="alert">
        <p className="text-sm text-destructive">{errorMessage(query.error, "Não foi possível carregar o relatório.")}</p>
        <Button variant="outline" size="sm" onClick={() => void query.refetch()}>
          Tentar novamente
        </Button>
      </Card>
    );
  }
  if (query.isLoading || !query.data) {
    return (
      <div className="grid gap-4 md:grid-cols-2" data-testid="report-loading">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-32 rounded-lg" />
        ))}
      </div>
    );
  }
  return <>{children(query.data)}</>;
}

function Section({ title, children, hint }: { title: string; children: ReactNode; hint?: string }) {
  return (
    <Card className="gap-3 p-5">
      <div>
        <h2 className="text-sm font-bold">{title}</h2>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </Card>
  );
}

function Toolbar({ period, children }: { period: ReportPeriod; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-muted-foreground" data-testid="report-period">
        Período: {periodLabel(period)}
      </p>
      <div className="no-print flex gap-2">{children}</div>
    </div>
  );
}

const num = "text-right tabular-nums";

// -----------------------------------------------------------------------------------------------
// Frequência
// -----------------------------------------------------------------------------------------------

const STUDENT_ROWS_SHOWN = 50;

export function AttendanceTab({ filters }: { filters: ReportFilters }) {
  const query = useReport<AttendanceReport>("attendance", filters);
  return (
    <ReportBody query={query}>
      {(d) => (
        <div className="space-y-4" data-testid="report-attendance">
          <Toolbar period={d.period}>
            <ExportCsvButton
              path="/reports/attendance/export.csv"
              filename="frequencia"
              params={{ from: filters.from, to: filters.to, unitId: filters.unitId, classId: filters.classId }}
            />
          </Toolbar>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              label="Frequência média"
              value={percentLabel(d.totals.percent)}
              icon={ClipboardCheck}
              hint={`${plural(d.totals.records, "registro")} de chamada`}
            />
            <StatCard label="Presenças" value={d.totals.present} icon={UserCheck} />
            <StatCard label="Faltas" value={d.totals.absent} icon={Users} tone={d.totals.absent > 0 ? "danger" : "default"} />
            <StatCard
              label="Aulas no período"
              value={d.totals.lessons}
              hint={`${d.totals.lessonsWithRecords} com chamada registrada`}
            />
          </div>
          <Section title="Frequência por mês" hint="Percentual de presenças sobre os registros de chamada do mês.">
            <ColumnChart
              ariaLabel="Frequência por mês"
              data={d.byMonth.map((m) => ({ label: monthLabel(m.month), value: m.percent ?? 0 }))}
              format={(v) => `${String(v).replace(".", ",")}%`}
            />
          </Section>
          <Section title="Por turma">
            {d.byClass.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma aula no período.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Turma</TableHead>
                    <TableHead className={num}>Aulas</TableHead>
                    <TableHead className={num}>Presenças</TableHead>
                    <TableHead className={num}>Faltas</TableHead>
                    <TableHead className={num}>Frequência</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.byClass.map((c) => (
                    <TableRow key={c.classId}>
                      <TableCell className="font-medium">{c.name}</TableCell>
                      <TableCell className={num}>{c.lessons}</TableCell>
                      <TableCell className={num}>{c.present}</TableCell>
                      <TableCell className={num}>{c.absent}</TableCell>
                      <TableCell className={num}>{percentLabel(c.percent)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
          <Section
            title="Por aluno"
            hint={
              d.byStudentTotal > STUDENT_ROWS_SHOWN
                ? `Mostrando os ${STUDENT_ROWS_SHOWN} com menor frequência de ${d.byStudentTotal}. O CSV traz todos.`
                : "Do menor para o maior percentual de presença."
            }
          >
            {d.byStudent.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma chamada registrada no período.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Aluno</TableHead>
                    <TableHead className={num}>Presenças</TableHead>
                    <TableHead className={num}>Faltas</TableHead>
                    <TableHead className={num}>Frequência</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {d.byStudent.slice(0, STUDENT_ROWS_SHOWN).map((s) => (
                    <TableRow key={s.studentId}>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className={num}>{s.present}</TableCell>
                      <TableCell className={num}>{s.absent}</TableCell>
                      <TableCell className={num}>{percentLabel(s.percent)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
        </div>
      )}
    </ReportBody>
  );
}

// -----------------------------------------------------------------------------------------------
// Financeiro
// -----------------------------------------------------------------------------------------------

const FINANCE_PARTS: StackPart[] = [
  { key: "receivedCents", label: "Recebido", color: "var(--primary)" },
  { key: "pendingCents", label: "A receber", color: "var(--warning)" },
  { key: "overdueCents", label: "Em atraso", color: "var(--destructive)" },
];

export function FinanceTab({ filters }: { filters: ReportFilters }) {
  const query = useReport<FinanceReport>("finance", filters);
  return (
    <ReportBody query={query}>
      {(d) => (
        <div className="space-y-4" data-testid="report-finance">
          <Toolbar period={d.period}>
            <ExportRowsButton
              filename="relatorio-financeiro"
              build={() => ({
                headers: ["Mês de vencimento", "Previsto (R$)", "Recebido (R$)", "A receber (R$)", "Em atraso (R$)", "Inadimplência (%)"],
                rows: d.byMonth.map((m) => [
                  monthLabel(m.month),
                  reais(m.expectedCents),
                  reais(m.receivedCents),
                  reais(m.pendingCents),
                  reais(m.overdueCents),
                  decimalBr(m.overdueRatePercent),
                ]),
              })}
            />
          </Toolbar>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Previsto" value={formatCurrency(d.totals.expectedCents)} icon={Wallet} hint={plural(d.totals.count, "lançamento")} />
            <StatCard
              label="Recebido"
              value={formatCurrency(d.totals.receivedCents)}
              icon={CheckCircle2}
              hint={`${formatCurrency(d.totals.receivedInPeriodCents)} pagos no período`}
            />
            <StatCard label="A receber" value={formatCurrency(d.totals.pendingCents)} icon={Clock} />
            <StatCard
              label="Em atraso"
              value={formatCurrency(d.totals.overdueCents)}
              icon={AlertTriangle}
              tone="danger"
              hint={`Inadimplência ${percentLabel(d.totals.overdueRatePercent)} · ${plural(d.totals.overdueCount, "lançamento")}`}
            />
          </div>
          <Section title="Por mês de vencimento" hint={d.basis}>
            <StackedColumnChart
              ariaLabel="Recebido, a receber e em atraso por mês"
              parts={FINANCE_PARTS}
              format={(v) => formatCurrency(v)}
              data={d.byMonth.map((m) => ({
                label: monthLabel(m.month),
                values: { receivedCents: m.receivedCents, pendingCents: m.pendingCents, overdueCents: m.overdueCents },
              }))}
            />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead className={num}>Previsto</TableHead>
                  <TableHead className={num}>Recebido</TableHead>
                  <TableHead className={num}>A receber</TableHead>
                  <TableHead className={num}>Em atraso</TableHead>
                  <TableHead className={num}>Inadimplência</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.byMonth.map((m) => (
                  <TableRow key={m.month}>
                    <TableCell className="font-medium">{monthLabel(m.month)}</TableCell>
                    <TableCell className={num}>{formatCurrency(m.expectedCents)}</TableCell>
                    <TableCell className={num}>{formatCurrency(m.receivedCents)}</TableCell>
                    <TableCell className={num}>{formatCurrency(m.pendingCents)}</TableCell>
                    <TableCell className={num}>{formatCurrency(m.overdueCents)}</TableCell>
                    <TableCell className={num}>{percentLabel(m.overdueRatePercent)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>
        </div>
      )}
    </ReportBody>
  );
}

// -----------------------------------------------------------------------------------------------
// Alunos
// -----------------------------------------------------------------------------------------------

export function StudentsTab({ filters }: { filters: ReportFilters }) {
  const query = useReport<StudentsReport>("students", filters);
  return (
    <ReportBody query={query}>
      {(d) => (
        <div className="space-y-4" data-testid="report-students">
          <Toolbar period={d.period}>
            <ExportRowsButton
              filename="relatorio-alunos"
              build={() => ({
                headers: ["Seção", "Item", "Valor"],
                rows: [
                  ["Situação", "Ativos", d.totals.active],
                  ["Situação", "Inativos", d.totals.inactive],
                  ["Situação", "Suspensos", d.totals.suspended],
                  ["Situação", "Ex-alunos", d.totals.former],
                  ["Situação", "Total", d.totals.total],
                  ["Situação", "Novos no período", d.totals.newInPeriod],
                  ...d.byMonth.map((m) => ["Novos por mês", monthLabel(m.month), m.newStudents] as const),
                  ...d.byUnit.flatMap((u) => [
                    ["Por unidade (ativos)", u.unitName, u.active] as const,
                    ["Por unidade (não ativos)", u.unitName, u.inactive] as const,
                  ]),
                  ...d.byAgeGroup.map((g) => ["Faixa etária (ativos)", g.label, g.count] as const),
                ],
              })}
            />
          </Toolbar>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Alunos ativos" value={d.totals.active} icon={UserCheck} />
            <StatCard
              label="Não ativos"
              value={d.totals.total - d.totals.active}
              icon={Users}
              hint={`${plural(d.totals.inactive, "inativo")} · ${plural(d.totals.suspended, "suspenso")} · ${plural(d.totals.former, "ex-aluno")}`}
            />
            <StatCard label="Novos no período" value={d.totals.newInPeriod} icon={UserPlus} />
            <StatCard label="Total cadastrado" value={d.totals.total} icon={Users} />
          </div>
          <Section title="Novos alunos por mês">
            <ColumnChart ariaLabel="Novos alunos por mês" data={d.byMonth.map((m) => ({ label: monthLabel(m.month), value: m.newStudents }))} />
          </Section>
          <div className="grid gap-4 md:grid-cols-2">
            <Section title="Alunos ativos por unidade">
              <BarList
                ariaLabel="Alunos ativos por unidade"
                items={d.byUnit.map((u) => ({ key: u.unitId ?? "none", label: u.unitName, value: u.active }))}
              />
            </Section>
            <Section title="Faixa etária (alunos ativos)">
              <BarList
                ariaLabel="Alunos ativos por faixa etária"
                items={d.byAgeGroup.map((g) => ({ key: g.key, label: g.label, value: g.count }))}
              />
            </Section>
          </div>
          <Section title="Por unidade">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Unidade</TableHead>
                  <TableHead className={num}>Ativos</TableHead>
                  <TableHead className={num}>Não ativos</TableHead>
                  <TableHead className={num}>Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {d.byUnit.map((u) => (
                  <TableRow key={u.unitId ?? "none"}>
                    <TableCell className="font-medium">{u.unitName}</TableCell>
                    <TableCell className={num}>{u.active}</TableCell>
                    <TableCell className={num}>{u.inactive}</TableCell>
                    <TableCell className={num}>{u.total}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>
        </div>
      )}
    </ReportBody>
  );
}

// -----------------------------------------------------------------------------------------------
// Graduações
// -----------------------------------------------------------------------------------------------

export function GraduationsTab({ filters }: { filters: ReportFilters }) {
  const query = useReport<GraduationsReport>("graduations", filters);
  return (
    <ReportBody query={query}>
      {(d) => (
        <div className="space-y-4" data-testid="report-graduations">
          <Toolbar period={d.period}>
            <ExportRowsButton
              filename="relatorio-graduacoes"
              build={() => ({
                headers: ["Seção", "Item", "Valor"],
                rows: [
                  ["Resumo", "Graduações", d.totals.graduations],
                  ["Resumo", "Alunos graduados", d.totals.students],
                  ...d.byMonth.map((m) => ["Por mês", monthLabel(m.month), m.count] as const),
                  ...d.byLevel.map((l) => ["Por nível (corda)", `${l.systemName} — ${l.levelName}`, l.count] as const),
                ],
              })}
            />
          </Toolbar>
          <div className="grid gap-3 sm:grid-cols-2">
            <StatCard label="Graduações no período" value={d.totals.graduations} icon={Award} />
            <StatCard label="Alunos graduados" value={d.totals.students} icon={UserCheck} />
          </div>
          <Section title="Graduações por mês">
            <ColumnChart ariaLabel="Graduações por mês" data={d.byMonth.map((m) => ({ label: monthLabel(m.month), value: m.count }))} />
          </Section>
          <Section title="Por nível (corda)">
            <BarList
              ariaLabel="Graduações por nível"
              empty="Nenhuma graduação no período."
              items={d.byLevel.map((l) => ({
                key: l.levelId,
                label: (
                  <span className="inline-flex items-center gap-2">
                    <RopeSwatch {...ropeOf(l)} size="sm" orientation="horizontal" />
                    {`${l.systemName} — ${l.levelName}`}
                  </span>
                ),
                value: l.count,
                ...(l.color ? { color: l.color } : {}),
              }))}
            />
          </Section>
        </div>
      )}
    </ReportBody>
  );
}
