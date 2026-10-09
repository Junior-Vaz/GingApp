import type { DashboardSummary } from "@/lib/dashboard";
import { formatCurrency } from "@/lib/format";

export interface ReportSection {
  title: string;
  rows: Array<{ label: string; value: string }>;
}

/** Monta as seções do relatório somente com agregados reais de GET /dashboard. */
export function buildSections(data: DashboardSummary): ReportSection[] {
  const attendance = data.attendance.last30dPercent;
  return [
    {
      title: "Alunos",
      rows: [
        { label: "Alunos ativos", value: String(data.students.active) },
        { label: "Novos alunos (30 dias)", value: String(data.students.new30d) },
        { label: "Alunos inativos", value: String(data.students.inactive) },
        { label: "Turmas ativas", value: String(data.classes.active) },
      ],
    },
    {
      title: "Frequência",
      rows: [
        { label: "Aulas hoje", value: String(data.lessonsToday) },
        { label: "Frequência média (30 dias)", value: attendance !== null ? `${attendance}%` : "-" },
      ],
    },
    // Seção Financeiro só existe se o backend enviou `finance` (MESTRE); PROFESSOR não recebe.
    ...(data.finance
      ? [
          {
            title: "Financeiro",
            rows: [
              { label: "Lançamentos pendentes", value: String(data.finance.pendingCount) },
              { label: "Valor previsto", value: formatCurrency(data.finance.pendingCents) },
              { label: "Lançamentos atrasados", value: String(data.finance.overdueCount) },
              { label: "Valor em atraso", value: formatCurrency(data.finance.overdueCents) },
            ],
          },
        ]
      : []),
    {
      title: "Graduações",
      rows: [{ label: "Graduações (30 dias)", value: String(data.graduations.last30d) }],
    },
  ];
}
