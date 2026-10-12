import { useMemo, useState } from "react";
import { CalendarPlus, Image as ImageIcon, Plus, Users } from "lucide-react";
import { DataTable, type Column } from "@/components/painel/data-table";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmt, toDate } from "@/lib/format";
import { useListParams } from "@/lib/list-params";
import { useCan, useSessionUser } from "@/lib/session";
import { rodas, useGenerateOccurrences, useRemoveSeries } from "./api";
import { DeleteRodaDialog } from "./delete-roda-dialog";
import { NativeSelect } from "./native-select";
import { useCities, useStates } from "./reference";
import { RodaForm } from "./roda-form";
import { RodaParticipantsDialog } from "./rodas-participants-dialog";
import { isSeriesParent, RECURRENCE_LABEL, type Recurrence, type Roda } from "./types";

/** Rótulo curto para a célula da tabela (o completo fica no title e no formulário). */
const RECURRENCE_SHORT: Record<Recurrence, string> = {
  NONE: RECURRENCE_LABEL.NONE,
  WEEKLY: "Toda semana",
  MONTHLY_WEEKDAY: "Mensal (dia da semana)",
  MONTHLY_DAY: "Mensal (dia do mês)",
};

export function RodasPage() {
  const user = useSessionUser();
  // Lista PÚBLICA (todas as organizações): busca (q em título/local), estado e cidade vão ao servidor.
  const lp = useListParams({ pageSize: 10, filters: { stateId: "", cityId: "" } });
  const list = rodas.usePage(lp.params);
  const states = useStates();
  const filterCities = useCities(lp.filters.stateId ? Number(lp.filters.stateId) : undefined);
  const create = rodas.useCreate();
  const update = rodas.useUpdate();
  const remove = rodas.useRemove();
  const removeSeries = useRemoveSeries();
  const generate = useGenerateOccurrences();
  const canEdit = useCan("rodas", "edit"); // POST /rodas/:id/generate-occurrences exige rodas.edit
  const canDelete = useCan("rodas", "delete"); // PROFESSOR: sem rodas:delete (backend responde 403)

  const [editing, setEditing] = useState<Roda | "new" | null>(null);
  const [deleting, setDeleting] = useState<Roda | null>(null);
  const [viewing, setViewing] = useState<Roda | null>(null);

  const stateName = useMemo(() => {
    const map = new Map(states.data?.map((state) => [state.id, state.name]));
    return (id: number | null) => (id ? (map.get(id) ?? "—") : "—");
  }, [states.data]);

  // A lista de rodas é pública (todas as organizações); só o dono edita/exclui (regra do backend).
  const isOwner = (roda: Roda) => roda.organizationId !== null && roda.organizationId === user?.organizationId;

  const columns: Column<Roda>[] = [
    {
      id: "title",
      header: "Título",
      sortValue: (r) => r.title,
      cell: (r) => (
        <span className="flex items-center gap-2 font-medium">
          {r.title}
          {r.imageUrl && <ImageIcon className="size-3.5 text-muted-foreground" aria-label="Com imagem" />}
          {!isOwner(r) && <Badge variant="outline">Outra organização</Badge>}
        </span>
      ),
    },
    {
      id: "date",
      header: "Data",
      sortValue: (r) => r.date,
      cell: (r) => fmt(toDate(r.date), "dd/MM/yyyy HH:mm"),
    },
    { id: "location", header: "Local", sortValue: (r) => r.location, cell: (r) => r.location || "—" },
    { id: "state", header: "Estado", sortValue: (r) => stateName(r.stateId), cell: (r) => stateName(r.stateId) },
    {
      id: "recurrence",
      header: "Recorrência",
      sortValue: (r) => (r.parentRodaId ? "Ocorrência da série" : RECURRENCE_LABEL[r.recurrence ?? "NONE"]),
      cell: (r) =>
        r.parentRodaId ? (
          <Badge variant="outline">Ocorrência da série</Badge>
        ) : r.recurrence && r.recurrence !== "NONE" ? (
          <Badge variant="secondary" title={RECURRENCE_LABEL[r.recurrence]}>
            {RECURRENCE_SHORT[r.recurrence]}
          </Badge>
        ) : (
          "—"
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Rodas"
        description="Rodas organizadas pelo grupo — visíveis publicamente na comunidade."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Nova roda
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
        getRowId={(r) => r.id}
        searchPlaceholder="Buscar por título ou local…"
        emptyMessage={
          lp.filters.stateId || lp.filters.cityId ? "Nenhuma roda com esses filtros." : "Nenhuma roda cadastrada ainda."
        }
        toolbar={
          <div className="flex flex-wrap gap-2">
            <NativeSelect
              aria-label="Filtrar por estado"
              className="w-48"
              value={lp.filters.stateId}
              onChange={(e) => {
                lp.setFilter("stateId", e.target.value);
                lp.setFilter("cityId", "");
              }}
            >
              <option value="">Todos os estados</option>
              {states.data?.map((state) => (
                <option key={state.id} value={String(state.id)}>
                  {state.name} ({state.uf})
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Filtrar por cidade"
              className="w-48"
              value={lp.filters.cityId}
              disabled={!lp.filters.stateId}
              onChange={(e) => lp.setFilter("cityId", e.target.value)}
            >
              <option value="">Todas as cidades</option>
              {filterCities.data?.map((city) => (
                <option key={city.id} value={String(city.id)}>
                  {city.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        }
        rowActions={(r) => (
          <>
            <Button variant="ghost" size="sm" onClick={() => setViewing(r)} aria-label={`Participantes de ${r.title}`}>
              <Users /> Participantes
            </Button>
            {isOwner(r) && (
              <>
                {canEdit && isSeriesParent(r) && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={generate.isPending}
                    onClick={() => generate.mutate(r.id)}
                    aria-label={`Gerar próximas ocorrências de ${r.title}`}
                  >
                    <CalendarPlus /> Gerar próximas ocorrências
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setEditing(r)} aria-label={`Editar ${r.title}`}>
                  Editar
                </Button>
                {canDelete && (
                  <Button variant="ghost" size="sm" onClick={() => setDeleting(r)} aria-label={`Excluir ${r.title}`}>
                    Excluir
                  </Button>
                )}
              </>
            )}
          </>
        )}
      />

      <RodaForm
        editing={editing}
        onClose={() => setEditing(null)}
        onSubmit={(payload, id) =>
          id === null ? create.mutateAsync(payload) : update.mutateAsync({ id, data: payload })
        }
      />
      <RodaParticipantsDialog
        roda={viewing}
        canManage={viewing !== null && isOwner(viewing)}
        onClose={() => setViewing(null)}
      />
      <DeleteRodaDialog
        roda={deleting}
        onClose={() => setDeleting(null)}
        onDelete={(roda, series) => (series ? removeSeries.mutateAsync(roda.id) : remove.mutateAsync(roda.id))}
      />
    </>
  );
}
