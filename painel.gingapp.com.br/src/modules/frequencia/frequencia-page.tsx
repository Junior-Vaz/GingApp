import { useEffect, useMemo, useState } from "react";
import { CheckCheck, Layers, UserX } from "lucide-react";
import { EntityAvatar } from "@/components/painel/entity-avatar";
import { ExportCsvButton } from "@/components/painel/export-csv-button";
import { PageHeader } from "@/components/painel/page-header";
import { StudentAvatar } from "@/components/painel/student-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { errorMessage } from "@/lib/api";
import { dayOnly, fmt } from "@/lib/format";
import { useCan } from "@/lib/session";
import { CheckinLink } from "@/modules/checkin/checkin-link";
import { NativeSelect } from "@/modules/aulas/native-select";
import { timeRange, type Lesson } from "@/modules/aulas/aulas-api";
import { SELECTOR_LIMIT, useClassSelector, useLessonSelector, useRoster, useSaveAttendance } from "./frequencia-api";
import {
  markAll,
  nextPresence,
  setJustification,
  setPresence,
  summarize,
  toRows,
  type RosterRow,
} from "./roster";

export function FrequenciaPage() {
  const canCheckin = useCan("attendance", "create"); // GET /attendance/lessons/:id/checkin-token exige attendance.create
  const [classFilter, setClassFilter] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const lessonsQuery = useLessonSelector({ classId: classFilter, from, to });
  const classes = useClassSelector();

  const [lessonId, setLessonId] = useState("");
  const [rows, setRows] = useState<RosterRow[]>([]);

  const className = (id: number) => classes.data?.items.find((c) => c.id === id)?.name ?? "Turma";

  // Filtros (turma, status ativo, período) são aplicados no servidor; aqui só ordena, mais recentes primeiro.
  const lessonItems = lessonsQuery.data?.items;
  const options = useMemo(
    () =>
      [...(lessonItems ?? [])]
        .filter((l) => l.status === "ACTIVE")
        .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id),
    [lessonItems],
  );
  const lessonsTotal = lessonsQuery.data?.total ?? 0;
  const classesTotal = classes.data?.total ?? 0;
  const selected: Lesson | undefined = lessonItems?.find((l) => String(l.id) === lessonId);

  const roster = useRoster(lessonId);

  useEffect(() => {
    setRows(roster.data ? toRows(roster.data) : []);
  }, [roster.data]);

  const save = useSaveAttendance();

  const summary = summarize(rows);
  const canSave = rows.length > 0 && summary.total - summary.undecided > 0 && !save.isPending;

  function renderRoster() {
    if (roster.isLoading) {
      return (
        <div className="space-y-2 p-4" data-testid="roster-loading">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      );
    }
    if (roster.error) {
      return (
        <div className="p-8 text-center" data-testid="roster-error">
          <p className="text-sm text-destructive">{errorMessage(roster.error, "Não foi possível carregar a chamada desta aula.")}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void roster.refetch()}>
            Tentar novamente
          </Button>
        </div>
      );
    }
    if (rows.length === 0) {
      return (
        <p className="p-8 text-center text-sm text-muted-foreground" data-testid="roster-empty">
          Esta turma não tem alunos matriculados.
        </p>
      );
    }
    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge variant="default" data-testid="count-present">{summary.present} presentes</Badge>
            <Badge variant="secondary" data-testid="count-absent">{summary.absent} faltas</Badge>
            {summary.undecided > 0 && (
              <Badge variant="outline" data-testid="count-undecided">{summary.undecided} sem chamada</Badge>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setRows((r) => markAll(r, true))}>
              <CheckCheck /> Todos presentes
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={summary.undecided === 0}
              onClick={() => setRows((r) => markAll(r, false, true))}
            >
              <UserX /> Restantes ausentes
            </Button>
          </div>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Aluno</TableHead>
              <TableHead className="w-24">Presente</TableHead>
              <TableHead>Justificativa</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.studentId}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    <StudentAvatar name={row.studentName} photo={row.photo} className="size-8" />
                    {row.studentName}
                  </span>
                </TableCell>
                <TableCell>
                  <Checkbox
                    aria-label={`Presença de ${row.studentName}`}
                    checked={row.present === null ? "indeterminate" : row.present}
                    onCheckedChange={() => setRows((r) => setPresence(r, row.studentId, nextPresence(row.present)))}
                  />
                </TableCell>
                <TableCell>
                  {row.present === false ? (
                    <Input
                      aria-label={`Justificativa de ${row.studentName}`}
                      placeholder="Motivo da falta (opcional)"
                      className="max-w-xs"
                      value={row.justification}
                      onChange={(e) => setRows((r) => setJustification(r, row.studentId, e.target.value))}
                    />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex items-center justify-end gap-3 border-t p-3">
          {summary.undecided > 0 && (
            <p className="text-xs text-muted-foreground">Alunos sem marcação não são enviados.</p>
          )}
          <Button disabled={!canSave} onClick={() => save.mutate({ lessonId, rows })}>
            {save.isPending ? "Salvando…" : "Salvar frequência"}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Frequência"
        description="Registre a chamada de uma aula. O CSV traz a frequência por aluno na turma e no período filtrados (sem datas: últimos 30 dias)."
        actions={
          <ExportCsvButton
            path="/reports/attendance/export.csv"
            filename="frequencia"
            params={{ classId: classFilter, from, to }}
          />
        }
      />

      <div className="mb-4 grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="space-y-1.5">
          <label htmlFor="freq-turma" className="text-sm font-medium">Turma</label>
          <NativeSelect
            id="freq-turma"
            value={classFilter}
            onChange={(e) => {
              setClassFilter(e.target.value);
              setLessonId("");
            }}
          >
            <option value="">Todas as turmas</option>
            {classes.data?.items.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </NativeSelect>
          {classesTotal > SELECTOR_LIMIT && (
            <p className="text-xs text-muted-foreground" data-testid="classes-truncated">
              Mostrando {SELECTOR_LIMIT} de {classesTotal} turmas.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="freq-de" className="text-sm font-medium">De</label>
          <Input
            id="freq-de"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              setLessonId("");
            }}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="freq-ate" className="text-sm font-medium">Até</label>
          <Input
            id="freq-ate"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setLessonId("");
            }}
          />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="freq-aula" className="text-sm font-medium">Aula</label>
          <NativeSelect id="freq-aula" value={lessonId} onChange={(e) => setLessonId(e.target.value)}>
            <option value="">{lessonsQuery.isLoading ? "Carregando aulas…" : "Selecione uma aula"}</option>
            {options.map((l) => (
              <option key={l.id} value={l.id}>
                {className(l.classId)} — {fmt(dayOnly(l.date), "dd/MM/yyyy")}
              </option>
            ))}
          </NativeSelect>
          {lessonsTotal > SELECTOR_LIMIT && (
            <p className="text-xs text-muted-foreground" data-testid="lessons-truncated">
              Mostrando as {SELECTOR_LIMIT} aulas mais recentes de {lessonsTotal}. Refine por turma ou período.
            </p>
          )}
          {lessonsQuery.error && (
            <p className="text-xs text-destructive" role="alert">
              {errorMessage(lessonsQuery.error, "Não foi possível carregar as aulas.")}
            </p>
          )}
        </div>
      </div>

      {!lessonId ? (
        <div className="rounded-lg border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">
          Selecione uma aula para ver a lista de chamada.
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          {selected && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <EntityAvatar name={selected.class?.name ?? className(selected.classId)} photo={selected.class?.photo} icon={Layers} className="size-7" />
                {selected.class?.name ?? className(selected.classId)} · {fmt(dayOnly(selected.date), "dd/MM/yyyy")} · {timeRange(selected)}
              </span>
              {canCheckin && (
                <CheckinLink kind="aula" id={selected.id} label="QR de presença" ariaLabel="QR de presença desta aula" />
              )}
            </div>
          )}
          {renderRoster()}
        </div>
      )}
    </>
  );
}
