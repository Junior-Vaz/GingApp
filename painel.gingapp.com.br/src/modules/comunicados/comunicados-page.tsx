import { useState } from "react";
import { z } from "zod";
import { Megaphone } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { DataTable, type Column } from "@/components/painel/data-table";
import { FormDialog } from "@/components/painel/form-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createCrud } from "@/lib/crud";
import { useListParams } from "@/lib/list-params";
import { fmt, toDate } from "@/lib/format";
import { useSessionUser } from "@/lib/session";
import { AuxLimitNotice } from "@/modules/rodas/aux-limit-notice";
import { NativeSelect } from "@/modules/rodas/native-select";
import { useAuxList } from "@/modules/rodas/reference";

/** Contrato de GET /announcements (backend: AnnouncementsService). */
export interface Announcement {
  id: number;
  unitId: number | null;
  title: string;
  body: string;
  publishedAt: string | null;
  isActive: boolean;
  createdAt: string;
}

/** unitId null = grupo inteiro. No PATCH, null limpa a unidade e omitir mantem. */
export interface AnnouncementInput {
  title: string;
  body: string;
  unitId: number | null;
  isActive?: boolean;
}

const announcements = createCrud<Announcement, AnnouncementInput>("/announcements", {
  created: "Comunicado publicado e distribuído como notificação.",
  updated: "Comunicado atualizado.",
  removed: "Comunicado desativado.",
});

const GROUP = "group";

/** Unidade para escolha de escopo/filtro (GET /units?limit=200). */
interface UnitOption {
  id: number;
  name: string;
}

// Regras do backend: título e texto com no mínimo 2 caracteres.
const schema = z.object({
  title: z.string().trim().min(2, "Informe o título (mínimo 2 caracteres)."),
  body: z.string().trim().min(2, "Informe o texto (mínimo 2 caracteres)."),
  scope: z.string(),
  isActive: z.boolean(),
});
type Values = z.infer<typeof schema>;

export function ComunicadosPage() {
  // Lista no servidor: busca (q em título/corpo), situação (isActive) e unidade (unitId).
  const lp = useListParams({ pageSize: 10, filters: { isActive: "", unitId: "" } });
  const list = announcements.usePage(lp.params);
  const units = useAuxList<UnitOption>("/units");
  const create = announcements.useCreate();
  const update = announcements.useUpdate();
  const remove = announcements.useRemove();
  const user = useSessionUser();
  // Espelha a matriz do seed: PROFESSOR não tem announcements:delete (o backend decide de fato).
  const canDelete = user?.role === "MESTRE";

  const [editing, setEditing] = useState<Announcement | "new" | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);

  const unitName = (unitId: number | null) =>
    unitId === null
      ? "Todo o grupo"
      : (units.items?.find((u) => u.id === unitId)?.name ?? `Unidade #${unitId}`);

  const columns: Column<Announcement>[] = [
    {
      id: "title",
      header: "Comunicado",
      sortValue: (a) => a.title,
      cell: (a) => (
        <div className="max-w-md">
          <p className="font-semibold">{a.title}</p>
          <p className="line-clamp-2 text-xs text-muted-foreground">{a.body}</p>
        </div>
      ),
    },
    { id: "scope", header: "Público", sortValue: (a) => unitName(a.unitId), cell: (a) => unitName(a.unitId) },
    {
      id: "publishedAt",
      header: "Publicado em",
      sortValue: (a) => a.publishedAt ?? a.createdAt,
      cell: (a) => fmt(toDate(a.publishedAt ?? a.createdAt), "dd/MM/yyyy HH:mm"),
    },
    {
      id: "status",
      header: "Situação",
      sortValue: (a) => (a.isActive ? 0 : 1),
      cell: (a) => (a.isActive ? <Badge>Ativo</Badge> : <Badge variant="outline">Inativo</Badge>),
    },
  ];

  const current = editing && editing !== "new" ? editing : null;
  const defaultValues: Values = {
    title: current?.title ?? "",
    body: current?.body ?? "",
    scope: current?.unitId != null ? String(current.unitId) : GROUP,
    isActive: current?.isActive ?? true,
  };

  function submit(values: Values) {
    const unitId = values.scope === GROUP ? null : Number(values.scope);
    const base = { title: values.title, body: values.body, unitId };
    return current
      ? update.mutateAsync({ id: current.id, data: { ...base, isActive: values.isActive } })
      : create.mutateAsync(base);
  }

  return (
    <>
      <PageHeader
        title="Comunicados"
        description="Avisos internos do grupo. Ao publicar, cada pessoa do público recebe uma notificação."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Megaphone /> Novo comunicado
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
        getRowId={(a) => a.id}
        searchPlaceholder="Buscar por título ou texto…"
        emptyMessage={
          lp.filters.isActive || lp.filters.unitId ? "Nenhum comunicado com esses filtros." : "Nenhum comunicado publicado."
        }
        toolbar={
          <div className="flex flex-wrap gap-2">
            <NativeSelect
              aria-label="Filtrar por situação"
              className="w-44"
              value={lp.filters.isActive}
              onChange={(e) => lp.setFilter("isActive", e.target.value)}
            >
              <option value="">Todas as situações</option>
              <option value="true">Ativos</option>
              <option value="false">Inativos</option>
            </NativeSelect>
            <NativeSelect
              aria-label="Filtrar por unidade"
              className="w-44"
              value={lp.filters.unitId}
              onChange={(e) => lp.setFilter("unitId", e.target.value)}
            >
              <option value="">Todas as unidades</option>
              {(units.items ?? []).map((u) => (
                <option key={u.id} value={String(u.id)}>
                  {u.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        }
        rowActions={(a) => (
          <>
            <Button variant="ghost" size="sm" onClick={() => setEditing(a)}>
              Editar
            </Button>
            {canDelete && a.isActive && (
              <Button variant="ghost" size="sm" onClick={() => setDeleting(a)}>
                Desativar
              </Button>
            )}
          </>
        )}
      />

      <FormDialog<Values>
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={current ? "Editar comunicado" : "Novo comunicado"}
        description={
          current
            ? "Editar não notifica as pessoas novamente."
            : "Ao publicar, o público escolhido recebe uma notificação."
        }
        schema={schema}
        defaultValues={defaultValues}
        onSubmit={submit}
      >
        {(form) => (
          <>
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Título</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="body"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Texto</FormLabel>
                  <FormControl>
                    <Textarea rows={5} {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="scope"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Público</FormLabel>
                  <Select value={field.value} onValueChange={field.onChange}>
                    <FormControl>
                      <SelectTrigger aria-label="Público">
                        <SelectValue />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value={GROUP}>Todo o grupo</SelectItem>
                      {(units.items ?? []).map((u) => (
                        <SelectItem key={u.id} value={String(u.id)}>
                          Somente {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <AuxLimitNotice truncated={units.truncated} total={units.total} label="unidades" />
                  <FormMessage />
                </FormItem>
              )}
            />
            {current && (
              <FormField
                control={form.control}
                name="isActive"
                render={({ field }) => (
                  <FormItem className="flex items-center justify-between rounded-md border p-3">
                    <FormLabel>Comunicado ativo</FormLabel>
                    <FormControl>
                      <Switch checked={field.value} onCheckedChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )}
              />
            )}
          </>
        )}
      </FormDialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Desativar comunicado?"
        description={`"${deleting?.title ?? ""}" não sera apagado: fica inativo, como registro de comunicação.`}
        confirmLabel="Desativar"
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </>
  );
}
