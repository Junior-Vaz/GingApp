import { useMemo, useState } from "react";
import { Ban, Pencil } from "lucide-react";
import { DataTable, type Column } from "@/components/painel/data-table";
import { FormDialog } from "@/components/painel/form-dialog";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dayOnly, fmt } from "@/lib/format";
import { NativeSelect } from "./native-select";
import {
  STATUS_LABEL,
  isoDay,
  lessons,
  timeRange,
  useClassOptions,
  useTeacherOptions,
  type Lesson,
} from "./aulas-api";
import { emptyValues, lessonSchema, toFormValues, toPayload, type LessonFormValues } from "./aulas-form";

export function AulasPage() {
  const list = lessons.useList();
  const create = lessons.useCreate();
  const update = lessons.useUpdate();
  const remove = lessons.useRemove();
  const classes = useClassOptions();
  const teachers = useTeacherOptions();

  const [editing, setEditing] = useState<Lesson | "new" | null>(null);
  const [cancelling, setCancelling] = useState<Lesson | null>(null);
  const [classFilter, setClassFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | Lesson["status"]>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const className = (id: number) => classes.data?.find((c) => c.id === id)?.name ?? "—";
  const teacherName = (id: number | null) =>
    id ? (teachers.data?.find((t) => t.user.id === id)?.user.name ?? "—") : "—";

  const filtered = useMemo(
    () =>
      list.data?.filter((l) => {
        if (classFilter && String(l.classId) !== classFilter) return false;
        if (statusFilter && l.status !== statusFilter) return false;
        const day = isoDay(l.date);
        if (from && day < from) return false;
        if (to && day > to) return false;
        return true;
      }),
    [list.data, classFilter, statusFilter, from, to],
  );

  const columns: Column<Lesson>[] = [
    { id: "class", header: "Turma", sortValue: (l) => className(l.classId), cell: (l) => <span className="font-medium">{className(l.classId)}</span> },
    { id: "date", header: "Data", sortValue: (l) => isoDay(l.date), cell: (l) => fmt(dayOnly(l.date), "dd/MM/yyyy") },
    { id: "time", header: "Horário", cell: (l) => timeRange(l) },
    { id: "teacher", header: "Professor", sortValue: (l) => teacherName(l.teacherUserId), cell: (l) => teacherName(l.teacherUserId) },
    {
      id: "status",
      header: "Status",
      sortValue: (l) => l.status,
      cell: (l) => <Badge variant={l.status === "ACTIVE" ? "default" : "secondary"}>{STATUS_LABEL[l.status]}</Badge>,
    },
  ];

  const isNew = editing === "new" || editing === null;

  return (
    <>
      <PageHeader
        title="Aulas"
        description="Aulas agendadas do grupo."
        actions={<Button onClick={() => setEditing("new")}>Nova aula</Button>}
      />
      <DataTable
        columns={columns}
        data={filtered}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        getRowId={(l) => l.id}
        searchText={(l) =>
          [className(l.classId), teacherName(l.teacherUserId), l.notes ?? "", isoDay(l.date), fmt(dayOnly(l.date), "dd/MM/yyyy")].join(" ")
        }
        searchPlaceholder="Buscar por turma, professor, data…"
        emptyMessage="Nenhuma aula cadastrada ainda."
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="Filtrar por turma" className="w-40" value={classFilter} onChange={(e) => setClassFilter(e.target.value)}>
              <option value="">Todas as turmas</option>
              {classes.data?.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Filtrar por status"
              className="w-36"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "" | Lesson["status"])}
            >
              <option value="">Todos os status</option>
              <option value="ACTIVE">Ativas</option>
              <option value="INACTIVE">Canceladas</option>
            </NativeSelect>
            <Input aria-label="Data inicial" type="date" className="w-36" value={from} onChange={(e) => setFrom(e.target.value)} />
            <Input aria-label="Data final" type="date" className="w-36" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        }
        rowActions={(l) => (
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(l)} aria-label={`Editar aula de ${className(l.classId)}`}>
              <Pencil /> Editar
            </Button>
            {l.status === "ACTIVE" && (
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setCancelling(l)} aria-label={`Cancelar aula de ${className(l.classId)}`}>
                <Ban /> Cancelar
              </Button>
            )}
          </>
        )}
      />

      <FormDialog<LessonFormValues>
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={isNew ? "Nova aula" : "Editar aula"}
        schema={lessonSchema}
        defaultValues={editing && editing !== "new" ? toFormValues(editing) : emptyValues}
        onSubmit={(values) =>
          editing && editing !== "new"
            ? update.mutateAsync({ id: editing.id, data: toPayload(values, true) })
            : create.mutateAsync(toPayload(values, false))
        }
      >
        {(form) => (
          <>
            <FormField control={form.control} name="classId" render={({ field }) => (
              <FormItem>
                <FormLabel>Turma</FormLabel>
                <FormControl>
                  <NativeSelect {...field}>
                    <option value="">Selecione…</option>
                    {classes.data?.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </NativeSelect>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-3 gap-3">
              <FormField control={form.control} name="date" render={({ field }) => (
                <FormItem><FormLabel>Data</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="startTime" render={({ field }) => (
                <FormItem><FormLabel>Início</FormLabel><FormControl><Input type="time" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="endTime" render={({ field }) => (
                <FormItem><FormLabel>Fim</FormLabel><FormControl><Input type="time" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
            </div>
            <FormField control={form.control} name="teacherUserId" render={({ field }) => (
              <FormItem>
                <FormLabel>Professor</FormLabel>
                <FormControl>
                  <NativeSelect {...field}>
                    <option value="">—</option>
                    {teachers.data?.map((t) => (
                      <option key={t.id} value={t.user.id}>{t.user.name}</option>
                    ))}
                  </NativeSelect>
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem><FormLabel>Observações</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            {!isNew && (
              <FormField control={form.control} name="status" render={({ field }) => (
                <FormItem>
                  <FormLabel>Status</FormLabel>
                  <FormControl>
                    <NativeSelect {...field}>
                      <option value="ACTIVE">{STATUS_LABEL.ACTIVE}</option>
                      <option value="INACTIVE">{STATUS_LABEL.INACTIVE}</option>
                    </NativeSelect>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            )}
          </>
        )}
      </FormDialog>

      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title="Cancelar aula?"
        description={
          cancelling
            ? `A aula de "${className(cancelling.classId)}" em ${fmt(dayOnly(cancelling.date), "dd/MM/yyyy")} ficará como cancelada. O histórico é preservado.`
            : undefined
        }
        confirmLabel="Cancelar aula"
        cancelLabel="Voltar"
        onConfirm={() => remove.mutateAsync(cancelling!.id)}
      />
    </>
  );
}
