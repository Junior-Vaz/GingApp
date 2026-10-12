import { useQuery } from "@tanstack/react-query";
import { api, buildQuery, type QueryParams } from "@/lib/api";

/** Filtros da página (strings vazias = padrão de cada relatório no servidor). */
export interface ReportFilters {
  from: string;
  to: string;
  unitId: string;
  classId: string;
}

export const emptyReportFilters = (): ReportFilters => ({ from: "", to: "", unitId: "", classId: "" });

export interface ReportPeriod {
  from: string;
  to: string;
}

export interface AttendanceCounts {
  records: number;
  present: number;
  absent: number;
  percent: number | null;
}

/** GET /reports/attendance */
export interface AttendanceReport {
  period: ReportPeriod;
  totals: AttendanceCounts & { lessons: number; lessonsWithRecords: number };
  byClass: Array<AttendanceCounts & { classId: number; name: string; lessons: number; lessonsWithRecords: number }>;
  byMonth: Array<AttendanceCounts & { month: string }>;
  byStudent: Array<AttendanceCounts & { studentId: number; name: string }>;
  byStudentTotal: number;
}

/** GET /reports/finance (centavos; só o Mestre) */
export interface FinanceReport {
  period: ReportPeriod;
  basis: string;
  totals: {
    count: number;
    expectedCents: number;
    receivedCents: number;
    pendingCents: number;
    overdueCents: number;
    overdueCount: number;
    overdueRatePercent: number | null;
    receivedInPeriodCents: number;
  };
  byMonth: Array<{
    month: string;
    count: number;
    expectedCents: number;
    receivedCents: number;
    pendingCents: number;
    overdueCents: number;
    overdueCount: number;
    overdueRatePercent: number | null;
  }>;
}

/** GET /reports/students */
export interface StudentsReport {
  period: ReportPeriod;
  totals: { total: number; active: number; inactive: number; suspended: number; former: number; newInPeriod: number };
  byMonth: Array<{ month: string; newStudents: number }>;
  byUnit: Array<{ unitId: number | null; unitName: string; active: number; inactive: number; total: number }>;
  byAgeGroup: Array<{ key: string; label: string; count: number }>;
}

/** GET /reports/graduations */
export interface GraduationsReport {
  period: ReportPeriod;
  totals: { graduations: number; students: number };
  byMonth: Array<{ month: string; count: number }>;
  byLevel: Array<{
    levelId: number;
    levelName: string;
    systemName: string;
    order: number;
    color: string | null;
    count: number;
  }>;
}

export type ReportName = "attendance" | "finance" | "students" | "graduations";

/** Consulta um relatório com os filtros da tela (só sobe ao servidor o que o relatório aceita). */
export function useReport<T>(name: ReportName, filters: ReportFilters) {
  const params: QueryParams = {
    from: filters.from,
    to: filters.to,
    unitId: filters.unitId,
    ...(name === "attendance" ? { classId: filters.classId } : {}),
  };
  return useQuery({
    queryKey: ["reports", name, params],
    queryFn: () => api.get<T>(`/reports/${name}${buildQuery(params)}`),
  });
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "2026-05" -> "mai/2026". */
export function monthLabel(month: string): string {
  const [year, m] = month.split("-");
  return `${MONTHS[Number(m) - 1] ?? m}/${year}`;
}

/** "2026-05-21" -> "21/05/2026". */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function periodLabel(period: ReportPeriod): string {
  return `${dayLabel(period.from)} a ${dayLabel(period.to)}`;
}

/** 66.7 -> "66,7%"; null -> "—". */
export function percentLabel(value: number | null): string {
  return value === null ? "—" : `${String(value).replace(".", ",")}%`;
}
