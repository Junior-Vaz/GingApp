import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { CoordinatesFields } from "@/components/painel/coordinates-fields";
import { DataTable, type Column } from "@/components/painel/data-table";
import { FormDialog } from "@/components/painel/form-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { BR_UFS } from "@/lib/br-ufs";
import { useListParams } from "@/lib/list-params";
import { useCan } from "@/lib/session";
import { NativeSelect } from "@/modules/alunos/native-select";
import {
  UNIT_STATUS_LABEL,
  emptyUnitForm,
  locationOf,
  unitSchema,
  unitToCreatePayload,
  unitToForm,
  unitToUpdatePayload,
  units,
  type Unit,
  type UnitFormValues,
} from "./units";

export function UnidadesPage() {
  // Padrão de lista no servidor: params (busca/filtro/página) -> usePage -> DataTable server.
  const lp = useListParams({ pageSize: 10, filters: { status: "" } });
  const list = units.usePage(lp.params);
  const create = units.useCreate();
  const update = units.useUpdate();
  const remove = units.useRemove();
  const queryClient = useQueryClient();
  // RBAC do backend (recurso `units`): MESTRE tudo; PROFESSOR só visualiza.
  const canCreate = useCan("units", "create");
  const canEdit = useCan("units", "edit");
  const canDelete = useCan("units", "delete");
  const [editing, setEditing] = useState<Unit | "new" | null>(null);
  const [deleting, setDeleting] = useState<Unit | null>(null);
  const [promoting, setPromoting] = useState<Unit | null>(null);

  // Os seletores de unidade (Alunos, Turmas, Aulas...) usam outra chave de cache: refaz depois de qualquer mudança.
  const refreshPickers = () => void queryClient.invalidateQueries({ queryKey: ["units"] });

  const columns: Column<Unit>[] = [
    {
      id: "name",
      header: "Unidade",
      sortValue: (u) => u.name,
      cell: (u) => (
        <span className="flex items-center gap-2 font-semibold">
          {u.name}
          {u.isMain && <Badge variant="secondary">Matriz</Badge>}
        </span>
      ),
    },
    { id: "address", header: "Endereço", sortValue: (u) => u.address, cell: (u) => u.address ?? "-" },
    { id: "location", header: "Cidade / UF", sortValue: locationOf, cell: locationOf },
    {
      id: "status",
      header: "Situação",
      sortValue: (u) => u.status,
      cell: (u) =>
        u.status === "ACTIVE" ? <Badge>{UNIT_STATUS_LABEL.ACTIVE}</Badge> : <Badge variant="outline">{UNIT_STATUS_LABEL.INACTIVE}</Badge>,
    },
  ];

  const isEdit = editing !== null && editing !== "new";
  const current = isEdit ? editing : null;

  return (
    <>
      <PageHeader
        title="Unidades"
        description="Matriz e filiais do grupo. O grupo tem uma única matriz; unidades inativas ficam no histórico."
        actions={
          canCreate ? (
            <Button onClick={() => setEditing("new")}>
              <Plus /> Nova unidade
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
        getRowId={(u) => u.id}
        searchPlaceholder="Buscar unidade pelo nome..."
        emptyMessage={lp.filters.status ? "Nenhuma unidade com esse filtro." : "Nenhuma unidade cadastrada."}
        toolbar={
          <NativeSelect
            aria-label="Filtrar por situação"
            className="w-44"
            value={lp.filters.status}
            onChange={(e) => lp.setFilter("status", e.target.value)}
          >
            <option value="">Todas as situações</option>
            <option value="ACTIVE">Ativas</option>
            <option value="INACTIVE">Inativas</option>
          </NativeSelect>
        }
        rowActions={(u) => (
          <>
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(u)}>
                Editar
              </Button>
            )}
            {canEdit && u.status === "ACTIVE" && !u.isMain && (
              <Button variant="ghost" size="sm" onClick={() => setPromoting(u)}>
                Definir como matriz
              </Button>
            )}
            {canDelete && u.status === "ACTIVE" && !u.isMain && (
              <Button variant="ghost" size="sm" onClick={() => setDeleting(u)}>
                Inativar
              </Button>
            )}
            {canEdit && u.status === "INACTIVE" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  update.mutate({ id: u.id, data: { status: "ACTIVE" } }, { onSuccess: refreshPickers })
                }
              >
                Reativar
              </Button>
            )}
          </>
        )}
      />

      <FormDialog<UnitFormValues>
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={isEdit ? "Editar unidade" : "Nova unidade"}
        schema={unitSchema}
        defaultValues={current ? unitToForm(current) : emptyUnitForm}
        onSubmit={async (values) => {
          await (current
            ? update.mutateAsync({ id: current.id, data: unitToUpdatePayload(values, current) })
            : create.mutateAsync(unitToCreatePayload(values)));
          refreshPickers();
        }}
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
            <FormField
              control={form.control}
              name="address"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Endereço</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <div className="grid grid-cols-3 gap-3">
              <FormField
                control={form.control}
                name="city"
                render={({ field }) => (
                  <FormItem className="col-span-2">
                    <FormLabel>Cidade</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="state"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>UF</FormLabel>
                    <FormControl>
                      <NativeSelect {...field}>
                        <option value="">—</option>
                        {BR_UFS.map((uf) => (
                          <option key={uf} value={uf}>
                            {uf}
                          </option>
                        ))}
                      </NativeSelect>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            <CoordinatesFields
              buildQuery={() => {
                const { address, city, state } = form.getValues();
                return [address.trim(), city.trim(), state].filter(Boolean).join(", ");
              }}
            />
            <FormField
              control={form.control}
              name="isMain"
              render={({ field }) => (
                <FormItem className="rounded-md border p-3">
                  <div className="flex items-center justify-between">
                    <FormLabel>Unidade matriz</FormLabel>
                    <FormControl>
                      <Switch
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        disabled={current?.isMain === true || current?.status === "INACTIVE"}
                      />
                    </FormControl>
                  </div>
                  <FormDescription>
                    {current?.isMain
                      ? "Esta é a matriz do grupo. Para trocar, marque OUTRA unidade como matriz."
                      : "Ao marcar, a matriz atual passa a ser filial (só pode haver uma matriz)."}
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
                    <FormLabel>Situação</FormLabel>
                    <FormControl>
                      <NativeSelect {...field} disabled={current?.isMain === true}>
                        <option value="ACTIVE">{UNIT_STATUS_LABEL.ACTIVE}</option>
                        <option value="INACTIVE">{UNIT_STATUS_LABEL.INACTIVE}</option>
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
        title="Inativar unidade?"
        description={
          deleting
            ? `"${deleting.name}" será marcada como inativa e deixa de contar no limite do plano. O histórico (alunos, turmas, aulas) é preservado.`
            : undefined
        }
        confirmLabel="Inativar"
        onConfirm={async () => {
          await remove.mutateAsync(deleting!.id);
          refreshPickers();
        }}
      />

      <ConfirmDialog
        open={promoting !== null}
        onOpenChange={(o) => !o && setPromoting(null)}
        title="Definir como matriz?"
        variant="default"
        description={
          promoting ? `"${promoting.name}" passa a ser a matriz do grupo e a matriz atual vira filial.` : undefined
        }
        confirmLabel="Definir como matriz"
        onConfirm={async () => {
          await update.mutateAsync({ id: promoting!.id, data: { isMain: true } });
          refreshPickers();
        }}
      />
    </>
  );
}
