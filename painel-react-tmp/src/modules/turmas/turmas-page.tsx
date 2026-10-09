import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { DataTable, type Column } from "@/components/painel/data-table";
import { FormDialog } from "@/components/painel/form-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createCrud } from "@/lib/crud";
import { NativeSelect } from "@/modules/alunos/native-select";
import {
  CLASS_STATUS_LABEL,
  WEEKDAY_LABEL,
  classSchema,
  classToForm,
  classToCreatePayload,
  classToPayload,
  emptyClassForm,
  scheduleLabel,
  type ClassFormValues,
  type ClassInput,
  type ClassItem,
  type ClassStatus,
  type Unit,
} from "./schema";

const classes = createCrud<ClassItem, ClassInput>("/classes", {
  created: "Turma criada.",
  updated: "Turma atualizada.",
  removed: "Turma inativada.",
});
const units = createCrud<Unit>("/units");

export function TurmasPage() {
  const list = classes.useList();
  const unitList = units.useList();
  const create = classes.useCreate();
  const update = classes.useUpdate();
  const remove = classes.useRemove();
  const [editing, setEditing] = useState<ClassItem | "new" | null>(null);
  const [deleting, setDeleting] = useState<ClassItem | null>(null);
  const [statusFilter, setStatusFilter] = useState<ClassStatus | "">("");

  const unitName = useMemo(() => {
    const map = new Map((unitList.data ?? []).map((u) => [u.id, u.name]));
    return (id: number | null) => (id ? (map.get(id) ?? "—") : "—");
  }, [unitList.data]);

  const rows = useMemo(
    () => (list.data ? list.data.filter((c) => !statusFilter || c.status === statusFilter) : undefined),
    [list.data, statusFilter],
  );

  const columns: Column<ClassItem>[] = [
    { id: "name", header: "Nome", sortValue: (c) => c.name, cell: (c) => <span className="font-medium">{c.name}</span> },
    { id: "unit", header: "Unidade", sortValue: (c) => unitName(c.unitId), cell: (c) => unitName(c.unitId) },
    {
      id: "weekday",
      header: "Dia",
      sortValue: (c) => c.weekday,
      cell: (c) => (c.weekday === null || c.weekday === undefined ? "—" : (WEEKDAY_LABEL[c.weekday] ?? "—")),
    },
    { id: "schedule", header: "Horário", sortValue: (c) => c.startTime, cell: (c) => scheduleLabel(c) },
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

  return (
    <>
      <PageHeader
        title="Turmas"
        description="Turmas, dias e horários de treino."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Nova turma
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={rows}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        getRowId={(c) => c.id}
        searchText={(c) => `${c.name} ${c.description ?? ""} ${unitName(c.unitId)}`}
        searchPlaceholder="Buscar por nome, unidade…"
        emptyMessage="Nenhuma turma cadastrada ainda."
        toolbar={
          <NativeSelect
            aria-label="Filtrar por status"
            className="w-44"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ClassStatus | "")}
          >
            <option value="">Todos os status</option>
            <option value="ACTIVE">Ativa</option>
            <option value="INACTIVE">Inativa</option>
          </NativeSelect>
        }
        rowActions={(c) => (
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
              Editar
            </Button>
            {c.status === "ACTIVE" && (
              <Button variant="ghost" size="sm" onClick={() => setDeleting(c)}>
                Inativar
              </Button>
            )}
          </>
        )}
      />

      <FormDialog<ClassFormValues>
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={isEdit ? "Editar turma" : "Nova turma"}
        schema={classSchema}
        defaultValues={editing && editing !== "new" ? classToForm(editing) : emptyClassForm}
        onSubmit={(values) =>
          editing && editing !== "new"
            ? update.mutateAsync({ id: editing.id, data: classToPayload(values) })
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
            <div className="grid grid-cols-2 gap-3">
              <FormField
                control={form.control}
                name="unitId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Unidade</FormLabel>
                    <FormControl>
                      <NativeSelect {...field}>
                        <option value="">—</option>
                        {(unitList.data ?? []).map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
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
                name="weekday"
                render={({ field }) => (
                  <FormItem>
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

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Inativar turma?"
        description={deleting ? `"${deleting.name}" será marcada como inativa. O histórico é preservado.` : undefined}
        confirmLabel="Inativar"
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </>
  );
}
