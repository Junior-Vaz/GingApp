import { useState } from "react";
import { Plus } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { DataTable, type Column } from "@/components/painel/data-table";
import { FormDialog } from "@/components/painel/form-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { UnitPicker } from "@/components/painel/unit-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createCrud } from "@/lib/crud";
import { useListParams } from "@/lib/list-params";
import { useUnitNames } from "@/lib/unit-lookup";
import { NativeSelect } from "@/modules/alunos/native-select";
import {
  CLASS_STATUS_LABEL,
  WEEKDAY_LABEL,
  classSchema,
  classToForm,
  classToCreatePayload,
  classToUpdatePayload,
  emptyClassForm,
  scheduleLabel,
  type ClassFormValues,
  type ClassInput,
  type ClassItem,
} from "./schema";

const classes = createCrud<ClassItem, ClassInput>("/classes", {
  created: "Turma criada.",
  updated: "Turma atualizada.",
  removed: "Turma inativada.",
});

export function TurmasPage() {
  // Padrão de lista no servidor: params (busca/filtros/página) -> usePage -> DataTable server.
  const lp = useListParams({ pageSize: 10, filters: { status: "", unitId: "" } });
  const list = classes.usePage(lp.params);
  const create = classes.useCreate();
  const update = classes.useUpdate();
  const remove = classes.useRemove();
  const [editing, setEditing] = useState<ClassItem | "new" | null>(null);
  const [deleting, setDeleting] = useState<ClassItem | null>(null);

  // Nomes só das unidades desta página (GET /units/:id por id distinto): não depende de lista com teto.
  const nameOfUnit = useUnitNames((list.items ?? []).map((c) => c.unitId));
  const unitName = (id: number | null) => (id === null ? "—" : nameOfUnit(id, `Unidade #${id}`));

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
