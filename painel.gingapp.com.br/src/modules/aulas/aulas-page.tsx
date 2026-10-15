import { useMemo, useState } from "react";
import { Ban, Layers, Pencil, RotateCcw, Trash2, UserRound } from "lucide-react";
import { DataTable, type Column } from "@/components/painel/data-table";
import { EntityAvatar } from "@/components/painel/entity-avatar";
import { FormDialog } from "@/components/painel/form-dialog";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { StrongConfirmDialog } from "@/components/painel/strong-confirm-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dayOnly, fmt } from "@/lib/format";
import { plural } from "@/lib/plural";
import { currentLessonWindow } from "@/lib/lesson-window";
import { useListParams } from "@/lib/list-params";
import { errorMessage } from "@/lib/api";
import { useCan, useSessionUser } from "@/lib/session";
import { NativeSelect } from "./native-select";
import {
  OPTIONS_LIMIT,
  STATUS_LABEL,
  isoDay,
  lessons,
  readLessonStatusFilter,
  saveLessonStatusFilter,
  timeRange,
  useBulkDeleteCancelled,
  useCancelLesson,
  useCancelledDeleteImpact,
  useClassOptions,
  useDeleteLesson,
  useLessonCounts,
  useLessonDeleteImpact,
  useReactivateLessons,
  useTeacherOptions,
  type Lesson,
  type LessonStatusFilter,
} from "./aulas-api";
import { emptyValues, lessonSchema, toFormValues, toPayload, type LessonFormValues } from "./aulas-form";

export function AulasPage() {
  // Padrão de lista no servidor: params (busca/filtros/página) -> usePage -> DataTable server.
  // `from`/`to` são datas (YYYY-MM-DD); o backend inclui o dia inteiro de `to`.
  const lp = useListParams({ pageSize: 10, filters: { classId: "", status: readLessonStatusFilter() as string, from: "", to: "" } });
  // Período: "Atual" = de hoje-7 a hoje+30 dias; "Todas" = sem from/to. Sempre order=nearest (hoje e futuras primeiro,
  // depois as passadas da mais recente à mais antiga). Datas escolhidas à mão (De/Até) têm prioridade sobre o período.
  const [period, setPeriod] = useState<"current" | "all">("current");
  const customDates = !!(lp.filters.from || lp.filters.to);
  const { params: baseParams } = lp;
  const windowFrom = currentLessonWindow().from;
  const params = useMemo(
    () => ({
      ...baseParams,
      order: "nearest",
      ...(period === "current" && !customDates ? currentLessonWindow() : {}),
    }),
    // windowFrom muda quando vira o dia: a janela é recalculada.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [baseParams, period, customDates, windowFrom],
  );
  const list = lessons.usePage(params);
  // Totais por status com os mesmos filtros da lista (sem o status): "N ativas · M canceladas".
  const counts = useLessonCounts({ classId: lp.filters.classId, from: params.from, to: params.to, q: baseParams["q"] });
  const reactivateAll = useReactivateLessons();
  const [reactivating, setReactivating] = useState(false);
  const create = lessons.useCreate();
  const update = lessons.useUpdate();
  const cancelLesson = useCancelLesson();
  const deleteLesson = useDeleteLesson();
  const bulkDelete = useBulkDeleteCancelled();
  const isMestre = useSessionUser()?.role === "MESTRE"; // apagar de verdade: só o Mestre (backend: MestreOnlyGuard, 403)
  const canCreate = useCan("lessons", "create"); // MONITOR: só leitura (sem "Nova aula")
  const canEdit = useCan("lessons", "edit");
  const canDelete = useCan("lessons", "delete"); // cancelar aula = DELETE; PROFESSOR sem lessons:delete (403)
  const classes = useClassOptions();
  const teachers = useTeacherOptions();

  const [editing, setEditing] = useState<Lesson | "new" | null>(null);
  const [cancelling, setCancelling] = useState<Lesson | null>(null);
  const [deleting, setDeleting] = useState<Lesson | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const deleteImpact = useLessonDeleteImpact(deleting?.id);
  const bulkClassId = lp.filters.classId ? Number(lp.filters.classId) : undefined;
  const bulkImpact = useCancelledDeleteImpact(bulkClassId, bulkOpen);
  const classItems = classes.data?.items ?? [];
  const teacherItems = teachers.data?.items ?? [];
  const classesTruncated = (classes.data?.total ?? 0) > OPTIONS_LIMIT;
  const teachersTruncated = (teachers.data?.total ?? 0) > OPTIONS_LIMIT;

  const className = (id: number) => classItems.find((c) => c.id === id)?.name ?? "—";
  /** Nome da turma da aula: o do servidor (`class`) tem prioridade; senão o da lista de opções. */
  const lessonClassName = (l: Lesson) => l.class?.name ?? className(l.classId);
  const lessonClassPhoto = (l: Lesson) => l.class?.photo ?? classItems.find((c) => c.id === l.classId)?.photo;
  const nameOfTeacher = (id: number | null | undefined) =>
    id ? (teacherItems.find((t) => t.user.id === id)?.user.name ?? "—") : "—";
  /** Professor da aula; sem professor próprio, mostra o responsável da turma (rótulo "(turma)"). */
  const teacherName = (l: Lesson) => {
    if (l.teacherUserId) return nameOfTeacher(l.teacherUserId);
    const fromClass = classItems.find((c) => c.id === l.classId)?.teacherUserId;
    return fromClass ? `${nameOfTeacher(fromClass)} (turma)` : "—";
  };
  // Ativas é o padrão: só conta como filtro "ligado" o que foge dele.
  const hasFilters = Object.entries(lp.filters).some(([key, value]) => (key === "status" ? value !== "ACTIVE" : Boolean(value)));
  const statusFilter = lp.filters.status as LessonStatusFilter;
  function changeStatus(value: string) {
    const next: LessonStatusFilter = value === "INACTIVE" ? "INACTIVE" : value === "ACTIVE" ? "ACTIVE" : "";
    saveLessonStatusFilter(next);
    lp.setFilter("status", next);
  }
  /** Período efetivo da lista (o que a reativação em massa vai cobrir). Ponta aberta = sem limite. */
  const rangeFrom = params.from ?? "";
  const rangeTo = params.to ?? "";
  const rangeLabel =
    rangeFrom || rangeTo
      ? `${rangeFrom ? fmt(dayOnly(rangeFrom), "dd/MM/yyyy") : "sem início"} a ${rangeTo ? fmt(dayOnly(rangeTo), "dd/MM/yyyy") : "sem fim"}`
      : "todas as datas";
  const classFilterLabel = lp.filters.classId ? className(Number(lp.filters.classId)) : "todas as turmas";
  const cancelledTotal = list.total;

  const columns: Column<Lesson>[] = [
    {
      id: "class",
      header: "Turma",
      sortValue: (l) => lessonClassName(l),
      cell: (l) => (
        <span className="flex items-center gap-2 font-medium">
          <EntityAvatar name={lessonClassName(l)} photo={lessonClassPhoto(l)} icon={Layers} className="size-8" />
          {lessonClassName(l)}
        </span>
      ),
    },
    { id: "date", header: "Data", sortValue: (l) => isoDay(l.date), cell: (l) => fmt(dayOnly(l.date), "dd/MM/yyyy") },
    { id: "time", header: "Horário", cell: (l) => timeRange(l) },
    {
      id: "teacher",
      header: "Professor",
      sortValue: (l) => l.teacher?.name ?? teacherName(l),
      cell: (l) => {
        const name = l.teacher?.name ?? teacherName(l);
        if (name === "—") return name;
        const photo = l.teacher?.photo ?? teacherItems.find((t) => t.user.id === l.teacherUserId)?.user.photo;
        return (
          <>
            <EntityAvatar name={name} photo={photo} icon={UserRound} className="mr-2 size-6 align-middle" />
            {name}
          </>
        );
      },
    },
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
        description="Aulas agendadas do grupo. As aulas contínuas aparecem aqui assim que são geradas; turmas com “Aulas contínuas” ligado geram sozinhas ~60 dias à frente."
        actions={canCreate ? <Button onClick={() => setEditing("new")}>Nova aula</Button> : undefined}
      />
      {counts.data && (
        <p data-testid="aulas-counts" className="mb-2 text-sm text-muted-foreground">
          <span className="font-semibold text-foreground">{plural(counts.data.active, "ativa")}</span> ·{" "}
          {plural(counts.data.cancelled, "cancelada")}
        </p>
      )}
      <DataTable
        columns={columns}
        data={list.items}
        server={{ ...lp.server, total: list.total, isFetching: list.isFetching }}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        getRowId={(l) => l.id}
        searchPlaceholder="Buscar nas observações…"
        emptyMessage={
          hasFilters
            ? "Nenhuma aula com esses filtros."
            : period === "current"
              ? "Nenhuma aula entre 7 dias atrás e 30 dias à frente. Escolha o período \"Todas\" para ver as demais."
              : "Nenhuma aula cadastrada ainda."
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect aria-label="Filtrar por turma" className="w-40" value={lp.filters.classId} onChange={(e) => lp.setFilter("classId", e.target.value)}>
              <option value="">Todas as turmas</option>
              {classItems.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Filtrar por status"
              className="w-36"
              value={lp.filters.status}
              onChange={(e) => changeStatus(e.target.value)}
            >
              <option value="ACTIVE">Ativas</option>
              <option value="INACTIVE">Canceladas</option>
              <option value="">Todas</option>
            </NativeSelect>
            {canEdit && statusFilter === "INACTIVE" && cancelledTotal > 0 && (
              <Button variant="outline" size="sm" onClick={() => setReactivating(true)}>
                <RotateCcw /> Reativar todas ({cancelledTotal})
              </Button>
            )}
            {isMestre && ((counts.data?.cancelled ?? 0) > 0 || statusFilter === "INACTIVE") && (
              <Button variant="outline" size="sm" className="text-destructive" onClick={() => setBulkOpen(true)}>
                <Trash2 /> Apagar canceladas
              </Button>
            )}
            <NativeSelect
              aria-label="Período"
              className="w-44"
              value={period}
              onChange={(e) => {
                setPeriod(e.target.value === "all" ? "all" : "current");
                lp.setPage(0);
              }}
            >
              <option value="current">Atual (−7 a +30 dias)</option>
              <option value="all">Todas</option>
            </NativeSelect>
            <Input aria-label="Data inicial" type="date" className="w-36" value={lp.filters.from} onChange={(e) => lp.setFilter("from", e.target.value)} />
            <Input aria-label="Data final" type="date" className="w-36" value={lp.filters.to} onChange={(e) => lp.setFilter("to", e.target.value)} />
            {classesTruncated && (
              <p data-testid="classes-limit-warning" className="text-xs text-muted-foreground">
                Mostrando as primeiras {OPTIONS_LIMIT} de {classes.data?.total} turmas.
              </p>
            )}
          </div>
        }
        rowActions={(l) => (
          <>
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(l)} aria-label={`Editar aula de ${className(l.classId)}`}>
                <Pencil /> Editar
              </Button>
            )}
            {canEdit && l.status === "INACTIVE" && (
              <Button
                variant="ghost"
                size="sm"
                disabled={update.isPending}
                onClick={() => update.mutate({ id: l.id, data: { status: "ACTIVE" } })}
                aria-label={`Reativar aula de ${className(l.classId)}`}
              >
                <RotateCcw /> Reativar
              </Button>
            )}
            {canDelete && l.status === "ACTIVE" && (
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setCancelling(l)} aria-label={`Cancelar aula de ${className(l.classId)}`}>
                <Ban /> Cancelar
              </Button>
            )}
            {isMestre && (
              <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleting(l)} aria-label={`Apagar aula de ${className(l.classId)}`}>
                <Trash2 /> Apagar
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
                    {classItems.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </NativeSelect>
                </FormControl>
                {classesTruncated && (
                  <p className="text-xs text-muted-foreground">Lista parcial: {OPTIONS_LIMIT} de {classes.data?.total} turmas.</p>
                )}
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
                    {teacherItems.map((t) => (
                      <option key={t.id} value={t.user.id}>{t.user.name}</option>
                    ))}
                  </NativeSelect>
                </FormControl>
                {teachersTruncated && (
                  <p className="text-xs text-muted-foreground">Lista parcial: {OPTIONS_LIMIT} de {teachers.data?.total} professores.</p>
                )}
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
        open={reactivating}
        onOpenChange={setReactivating}
        title="Reativar aulas canceladas?"
        variant="default"
        description={
          <>
            Vão voltar a ficar ativas {plural(cancelledTotal, "aula cancelada", "aulas canceladas")}.{" "}
            <span data-testid="reactivate-scope">
              Turma: {classFilterLabel} · Período: {rangeLabel}.
            </span>{" "}
            Os alunos não serão avisados (o aviso só sai ao reativar uma aula por vez).
          </>
        }
        confirmLabel={`Reativar ${plural(cancelledTotal, "aula")}`}
        cancelLabel="Voltar"
        onConfirm={() =>
          reactivateAll.mutateAsync({
            ...(lp.filters.classId ? { classId: Number(lp.filters.classId) } : {}),
            from: rangeFrom || "1970-01-01",
            to: rangeTo || "2100-12-31",
          })
        }
      />

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
        onConfirm={() => cancelLesson.mutateAsync(cancelling!.id)}
      />

      <StrongConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Apagar aula definitivamente?"
        description={
          deleting
            ? `A aula de "${lessonClassName(deleting)}" em ${fmt(dayOnly(deleting.date), "dd/MM/yyyy")} será apagada do sistema. Para só tirar a aula da agenda, use "Cancelar".`
            : undefined
        }
        impactLoading={deleting !== null && deleteImpact.isLoading}
        impactError={deleteImpact.error ? errorMessage(deleteImpact.error, "Não foi possível calcular o impacto.") : null}
        impact={
          deleteImpact.data
            ? `Isto apagará 1 aula e ${plural(deleteImpact.data.attendances, "presença")}. Não pode ser desfeito.`
            : undefined
        }
        phrase="APAGAR"
        onConfirm={() => deleteLesson.mutateAsync({ id: deleting!.id, confirm: (deleteImpact.data?.attendances ?? 0) > 0 })}
      />

      <StrongConfirmDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        title="Apagar aulas canceladas?"
        description={`Escopo: ${classFilterLabel}, de qualquer data (o período da lista não limita). Só aulas CANCELADAS são apagadas; as ativas ficam.`}
        impactLoading={bulkOpen && bulkImpact.isLoading}
        impactError={bulkImpact.error ? errorMessage(bulkImpact.error, "Não foi possível calcular o impacto.") : null}
        impact={
          bulkImpact.data
            ? `Isto apagará ${plural(bulkImpact.data.lessons, "aula cancelada", "aulas canceladas")} e ${plural(bulkImpact.data.attendances, "presença")}. Não pode ser desfeito.`
            : undefined
        }
        phrase="APAGAR"
        confirmLabel="Apagar canceladas"
        onConfirm={() =>
          bulkDelete.mutateAsync({
            ...(bulkClassId !== undefined ? { classId: bulkClassId } : {}),
            confirm: (bulkImpact.data?.attendances ?? 0) > 0,
          })
        }
      />
    </>
  );
}
