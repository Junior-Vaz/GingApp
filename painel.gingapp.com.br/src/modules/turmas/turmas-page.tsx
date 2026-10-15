import { useState } from "react";
import { Building2, Ban, CalendarPlus, Eye, Layers, Pencil, Plus, Repeat, Trash2, UserRound, Users } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { StrongConfirmDialog } from "@/components/painel/strong-confirm-dialog";
import { DataTable, type Column } from "@/components/painel/data-table";
import { EntityAvatar } from "@/components/painel/entity-avatar";
import { FormDialog } from "@/components/painel/form-dialog";
import { ImageUploadField } from "@/components/painel/image-upload-field";
import { PageHeader } from "@/components/painel/page-header";
import { RowActions, type MaybeRowAction } from "@/components/painel/row-actions";
import { UnitPicker } from "@/components/painel/unit-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";
import { dayOnly, fmt } from "@/lib/format";
import { plural } from "@/lib/plural";
import { useListParams } from "@/lib/list-params";
import { useCan, useSessionUser } from "@/lib/session";
import { useUnitNames } from "@/lib/unit-lookup";
import { NativeSelect } from "@/modules/alunos/native-select";
import { OPTIONS_LIMIT, useTeacherOptions } from "@/modules/aulas/aulas-api";
import { GenerateLessonsDialog } from "./generate-lessons-dialog";
import { classes, useClassDeleteImpact, useDeleteClass, useInactivateClass } from "./turmas-api";
import { ClassStudentsDialog } from "./students-dialog";
import {
  CLASS_STATUS_LABEL,
  CONTINUOUS_AHEAD_DAYS,
  WEEKDAY_LABEL,
  classLessonDiagnostic,
  classSchema,
  classToForm,
  classToCreatePayload,
  classToUpdatePayload,
  emptyClassForm,
  scheduleLabel,
  type ClassFormValues,
  type ClassItem,
} from "./schema";

export function TurmasPage() {
  // Padrão de lista no servidor: params (busca/filtros/página) -> usePage -> DataTable server.
  const lp = useListParams({ pageSize: 10, filters: { status: "", unitId: "" } });
  const list = classes.usePage(lp.params);
  const create = classes.useCreate();
  const update = classes.useUpdate();
  const inactivate = useInactivateClass(); // Inativar = PATCH status INACTIVE (a turma e o histórico continuam)
  const deleteClass = useDeleteClass(); // Apagar = DELETE de verdade (só Mestre)
  const navigate = useNavigate();
  const isMestre = useSessionUser()?.role === "MESTRE";
  const canCreate = useCan("classes", "create"); // MONITOR: só leitura
  const canEdit = useCan("classes", "edit");
  const canDelete = useCan("classes", "delete"); // PROFESSOR: sem classes:delete (backend responde 403)
  const canView = useCan("classes", "view");
  const canGenerate = useCan("lessons", "create"); // POST /classes/:id/generate-lessons cria aulas (lessons:create)
  const teachers = useTeacherOptions();
  const teacherItems = teachers.data?.items ?? [];
  const teachersTruncated = (teachers.data?.total ?? 0) > OPTIONS_LIMIT;
  const teacherName = (id: number | null) =>
    id === null || id === undefined ? "—" : (teacherItems.find((t) => t.user.id === id)?.user.name ?? "—");
  const [editing, setEditing] = useState<ClassItem | "new" | null>(null);
  const [deleting, setDeleting] = useState<ClassItem | null>(null);
  const [erasing, setErasing] = useState<ClassItem | null>(null);
  const eraseImpact = useClassDeleteImpact(erasing?.id);
  const [studentsOf, setStudentsOf] = useState<ClassItem | null>(null);
  const [generatingOf, setGeneratingOf] = useState<ClassItem | null>(null);

  // Nomes só das unidades desta página (GET /units/:id por id distinto): não depende de lista com teto.
  const nameOfUnit = useUnitNames((list.items ?? []).map((c) => c.unitId));
  const unitName = (id: number | null) => (id === null ? "—" : nameOfUnit(id, `Unidade #${id}`));

  const columns: Column<ClassItem>[] = [
    {
      id: "name",
      header: "Nome",
      sticky: true,
      className: "min-w-52",
      sortValue: (c) => c.name,
      cell: (c) => (
        <span className="flex items-center gap-2 font-medium">
          <EntityAvatar name={c.name} photo={c.photo} icon={Layers} className="size-9" />
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {c.name}
            {c.autoGenerateLessons && (
              <Badge variant="outline" className="gap-1 font-normal" title={`O sistema mantém ~${CONTINUOUS_AHEAD_DAYS} dias de aulas à frente automaticamente.`}>
                <Repeat className="size-3" /> Aulas contínuas
              </Badge>
            )}
          </span>
        </span>
      ),
    },
    {
      id: "unit",
      header: "Unidade",
      sortValue: (c) => c.unit?.name ?? unitName(c.unitId),
      cell: (c) =>
        c.unitId === null && !c.unit ? (
          "—"
        ) : (
          <>
            <EntityAvatar name={c.unit?.name ?? unitName(c.unitId)} photo={c.unit?.photo} icon={Building2} className="mr-2 size-6 align-middle" />
            {c.unit?.name ?? unitName(c.unitId)}
          </>
        ),
    },
    {
      id: "weekday",
      header: "Dia",
      sortValue: (c) => c.weekday,
      cell: (c) => (c.weekday === null || c.weekday === undefined ? "—" : (WEEKDAY_LABEL[c.weekday] ?? "—")),
    },
    { id: "schedule", header: "Horário", sortValue: (c) => c.startTime, cell: (c) => scheduleLabel(c) },
    {
      id: "nextLesson",
      header: "Próxima aula",
      className: "min-w-40",
      sortValue: (c) => c.nextLesson?.date ?? "",
      cell: (c) => {
        const { next, warning } = classLessonDiagnostic(c);
        return (
          <div className="space-y-0.5">
            {next ? (
              <span data-testid="class-next-lesson">
                {fmt(dayOnly(next.day), "dd/MM")} ({next.status === "ACTIVE" ? "ativa" : "cancelada"})
              </span>
            ) : (
              "—"
            )}
            {warning === "no-weekday" && (
              <p data-testid="class-lessons-warning" className="text-xs text-amber-700 dark:text-amber-400">
                Sem dia da semana — defina para gerar aulas.
              </p>
            )}
            {warning === "no-active" &&
              (canGenerate ? (
                <button
                  type="button"
                  data-testid="class-lessons-warning"
                  className="block text-left text-xs text-amber-700 underline-offset-2 hover:underline dark:text-amber-400"
                  onClick={() => setGeneratingOf(c)}
                >
                  Nenhuma aula ativa à frente — gerar aulas
                </button>
              ) : (
                <p data-testid="class-lessons-warning" className="text-xs text-amber-700 dark:text-amber-400">
                  Nenhuma aula ativa à frente.
                </p>
              ))}
          </div>
        );
      },
    },
    {
      id: "teacher",
      header: "Professor",
      sortValue: (c) => c.teacher?.name ?? teacherName(c.teacherUserId),
      cell: (c) => {
        const name = c.teacher?.name ?? teacherName(c.teacherUserId);
        if (name === "—") return name;
        const photo = c.teacher?.photo ?? teacherItems.find((t) => t.user.id === c.teacherUserId)?.user.photo;
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
      sortValue: (c) => CLASS_STATUS_LABEL[c.status],
      cell: (c) => (
        <Badge variant={c.status === "ACTIVE" ? "default" : "secondary"}>{CLASS_STATUS_LABEL[c.status]}</Badge>
      ),
    },
  ];

  const isEdit = editing !== null && editing !== "new";

  /** Alunos e Editar ficam à vista; "Gerar aulas" e "Inativar" vão para o menu "⋯" (mesmas permissões de antes). */
  const classActions = (c: ClassItem): MaybeRowAction[] => [
    canView && { key: "students", label: "Alunos", ariaLabel: `Alunos de ${c.name}`, icon: Users, primary: true, onSelect: () => setStudentsOf(c) },
    canView && {
      key: "details",
      label: "Detalhes",
      ariaLabel: `Detalhes de ${c.name}`,
      icon: Eye,
      primary: true,
      onSelect: () => void navigate({ to: "/turmas/$classId", params: { classId: String(c.id) } }),
    },
    canEdit && { key: "edit", label: "Editar", icon: Pencil, primary: true, onSelect: () => setEditing(c) },
    canGenerate &&
      c.status === "ACTIVE" &&
      c.weekday !== null &&
      c.weekday !== undefined && {
        key: "generate",
        label: "Gerar aulas",
        ariaLabel: `Gerar aulas de ${c.name}`,
        icon: CalendarPlus,
        onSelect: () => setGeneratingOf(c),
      },
    canDelete &&
      c.status === "ACTIVE" && { key: "deactivate", label: "Inativar", icon: Ban, destructive: true, onSelect: () => setDeleting(c) },
    isMestre && { key: "erase", label: "Apagar", ariaLabel: `Apagar ${c.name}`, icon: Trash2, destructive: true, onSelect: () => setErasing(c) },
  ];

  return (
    <>
      <PageHeader
        title="Turmas"
        description="Turmas, dias e horários de treino."
        actions={
          canCreate ? (
            <Button onClick={() => setEditing("new")}>
              <Plus /> Nova turma
            </Button>
          ) : undefined
        }
      />
      <DataTable
        columns={columns}
        data={list.items}
        server={{ ...lp.server, total: list.total, isFetching: list.isFetching }}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        getRowId={(c) => c.id}
        searchPlaceholder="Buscar por nome ou descrição…"
        emptyMessage={
          lp.filters.status || lp.filters.unitId ? "Nenhuma turma com esses filtros." : "Nenhuma turma cadastrada ainda."
        }
        toolbar={
          <div className="flex flex-wrap gap-2">
            <UnitPicker
              mode="filter"
              value={lp.filters.unitId ? Number(lp.filters.unitId) : null}
              onChange={(u) => lp.setFilter("unitId", u ? String(u.id) : "")}
            />
            <NativeSelect
              aria-label="Filtrar por status"
              className="w-44"
              value={lp.filters.status}
              onChange={(e) => lp.setFilter("status", e.target.value)}
            >
              <option value="">Todos os status</option>
              <option value="ACTIVE">Ativa</option>
              <option value="INACTIVE">Inativa</option>
            </NativeSelect>
          </div>
        }
        rowActions={(c) => <RowActions actions={classActions(c)} subject={c.name} />}
      />

      <FormDialog<ClassFormValues>
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={isEdit ? "Editar turma" : "Nova turma"}
        schema={classSchema}
        defaultValues={editing && editing !== "new" ? classToForm(editing) : emptyClassForm}
        onSubmit={(values) =>
          editing && editing !== "new"
            ? update.mutateAsync({ id: editing.id, data: classToUpdatePayload(values) })
            : create.mutateAsync(classToCreatePayload(values))
        }
      >
        {(form) => (
          <>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <ImageUploadField<ClassFormValues>
              name="photo"
              label="Foto da turma (URL)"
              shape="square"
              previewAlt="Foto da turma"
              description="Opcional. Envie uma foto (JPEG, PNG ou WebP até 5 MB) ou cole o link de uma imagem."
            />
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="unitId"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <UnitPicker
                      optional
                      value={field.value ? Number(field.value) : null}
                      onChange={(u) => field.onChange(u ? String(u.id) : "")}
                    />
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="teacherUserId"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Professor responsável</FormLabel>
                    <FormControl>
                      <NativeSelect {...field}>
                        <option value="">—</option>
                        {teacherItems.map((t) => (
                          <option key={t.id} value={t.user.id}>
                            {t.user.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    {teachersTruncated && (
                      <p className="text-xs text-muted-foreground">
                        Lista parcial: {OPTIONS_LIMIT} de {teachers.data?.total} professores.
                      </p>
                    )}
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="weekday"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Dia da semana</FormLabel>
                    <FormControl>
                      <NativeSelect {...field}>
                        <option value="">—</option>
                        {Object.entries(WEEKDAY_LABEL).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="startTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Início</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="endTime"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fim</FormLabel>
                    <FormControl>
                      <Input type="time" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Descrição</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="autoGenerateLessons"
              render={({ field }) => (
                <FormItem className="rounded-md border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <FormLabel>Contínuo (sem data final)</FormLabel>
                    <FormControl>
                      <Switch checked={field.value === true} onCheckedChange={field.onChange} aria-label="Contínuo (sem data final)" />
                    </FormControl>
                  </div>
                  <FormDescription>
                    O sistema mantém ~{CONTINUOUS_AHEAD_DAYS} dias de aulas à frente automaticamente, no dia e horário da turma
                    (precisa de dia da semana). Desligue para criar as aulas só pelo botão &quot;Gerar aulas&quot;.
                  </FormDescription>
                </FormItem>
              )}
            />
            {isEdit && (
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Status</FormLabel>
                    <FormControl>
                      <NativeSelect {...field}>
                        <option value="ACTIVE">Ativa</option>
                        <option value="INACTIVE">Inativa</option>
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}
          </>
        )}
      </FormDialog>

      <ClassStudentsDialog turma={studentsOf} onClose={() => setStudentsOf(null)} />
      <GenerateLessonsDialog turma={generatingOf} onClose={() => setGeneratingOf(null)} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Inativar turma?"
        description={deleting ? `"${deleting.name}" será marcada como inativa. O histórico é preservado.` : undefined}
        confirmLabel="Inativar"
        onConfirm={() => inactivate.mutateAsync(deleting!.id)}
      />

      <StrongConfirmDialog
        open={erasing !== null}
        onOpenChange={(o) => !o && setErasing(null)}
        title="Apagar turma definitivamente?"
        description={erasing ? `A turma "${erasing.name}" será apagada do sistema, com as aulas e presenças dela. Os alunos continuam cadastrados. Para só desativar a turma, use "Inativar".` : undefined}
        impactLoading={erasing !== null && eraseImpact.isLoading}
        impactError={eraseImpact.error ? errorMessage(eraseImpact.error, "Não foi possível calcular o impacto.") : null}
        impact={
          eraseImpact.data
            ? `Isto apagará ${plural(eraseImpact.data.lessons, "aula")} e ${plural(eraseImpact.data.attendances, "presença")} (${plural(eraseImpact.data.students, "vínculo de aluno", "vínculos de alunos")} com a turma serão removidos). Não pode ser desfeito.`
            : undefined
        }
        phrase={erasing?.name ?? ""}
        onConfirm={() =>
          deleteClass.mutateAsync({
            id: erasing!.id,
            confirm: (eraseImpact.data?.lessons ?? 0) > 0 || (eraseImpact.data?.attendances ?? 0) > 0,
          })
        }
      />
    </>
  );
}
