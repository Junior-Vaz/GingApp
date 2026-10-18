import { useState } from "react";
import { Image as ImageIcon, Plus, Users } from "lucide-react";
import { DataTable, type Column } from "@/components/painel/data-table";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmt, formatCurrency, toDate } from "@/lib/format";
import { useListParams } from "@/lib/list-params";
import { useCan } from "@/lib/session";
import { NativeSelect } from "@/modules/rodas/native-select";
import { events } from "./api";
import { EventForm } from "./event-form";
import { ParticipantsDialog } from "./participants-dialog";
import { CheckinLink } from "@/modules/checkin/checkin-link";
import { EventFormLink } from "@/modules/formularios/event-form-link";
import { EVENT_STATUS_LABEL, EVENT_TYPE_LABEL, EVENT_TYPES, type EventItem, type EventStatus } from "./types";

const STATUS_VARIANT: Record<EventStatus, "default" | "secondary" | "outline" | "destructive"> = {
  DRAFT: "outline",
  PUBLISHED: "default",
  CANCELLED: "destructive",
  CLOSED: "secondary",
};

/** "12/30" (confirmados/vagas), "12 (sem limite)" e "+3 na espera" quando há fila. */
function spotsLabel(e: EventItem): string {
  const confirmed = e.confirmedCount ?? 0;
  const base = e.capacity ? `${String(confirmed)}/${String(e.capacity)}` : `${String(confirmed)} (sem limite)`;
  return e.waitlistCount ? `${base} · +${String(e.waitlistCount)} na espera` : base;
}

const columns: Column<EventItem>[] = [
  {
    id: "title",
    header: "Título",
    sortValue: (e) => e.title,
    cell: (e) => (
      <span className="flex items-center gap-2 font-medium">
        {e.title}
        {e.imageUrl && <ImageIcon className="size-3.5 text-muted-foreground" aria-label="Com imagem" />}
      </span>
    ),
  },
  {
    id: "type",
    header: "Tipo",
    sortValue: (e) => EVENT_TYPE_LABEL[e.type] ?? e.type,
    cell: (e) => EVENT_TYPE_LABEL[e.type] ?? e.type,
  },
  {
    id: "date",
    header: "Data",
    sortValue: (e) => e.date,
    cell: (e) => fmt(toDate(e.date), "dd/MM/yyyy HH:mm"),
  },
  { id: "location", header: "Local", sortValue: (e) => e.location, cell: (e) => e.location || "—" },
  {
    id: "spots",
    header: "Vagas",
    sortValue: (e) => e.confirmedCount ?? 0,
    cell: (e) => spotsLabel(e),
  },
  {
    id: "price",
    header: "Valor",
    sortValue: (e) => e.priceCents ?? 0,
    cell: (e) => (e.priceCents ? formatCurrency(e.priceCents) : "—"),
  },
  {
    id: "status",
    header: "Situação",
    sortValue: (e) => e.status ?? "PUBLISHED",
    cell: (e) => {
      const status = e.status ?? "PUBLISHED";
      return <Badge variant={STATUS_VARIANT[status]}>{EVENT_STATUS_LABEL[status]}</Badge>;
    },
  },
  {
    id: "public",
    header: "Público",
    sortValue: (e) => (e.isPublic ? 1 : 0),
    cell: (e) => <Badge variant={e.isPublic ? "default" : "secondary"}>{e.isPublic ? "Público" : "Interno"}</Badge>,
  },
];

export function EventosPage() {
  // Lista no servidor: busca (q em título/local), tipo e intervalo de datas (from/to) vão como query.
  const lp = useListParams({ pageSize: 10, filters: { type: "", status: "", from: "", to: "" } });
  const list = events.usePage(lp.params);
  const create = events.useCreate();
  const update = events.useUpdate();
  const remove = events.useRemove();
  const canDelete = useCan("events", "delete"); // PROFESSOR: sem events:delete (backend responde 403)
  const canCreate = useCan("events", "create"); // MONITOR: só leitura
  const canEdit = useCan("events", "edit"); // GET /events/:id/checkin-token exige events.edit

  const [editing, setEditing] = useState<EventItem | "new" | null>(null);
  const [deleting, setDeleting] = useState<EventItem | null>(null);
  const [viewing, setViewing] = useState<EventItem | null>(null);

  return (
    <>
      <PageHeader
        title="Eventos"
        description="Batizados, workshops, campeonatos e demais eventos do grupo."
        actions={
          canCreate ? (
            <Button onClick={() => setEditing("new")}>
              <Plus /> Novo evento
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
        getRowId={(e) => e.id}
        searchPlaceholder="Buscar por título ou local…"
        emptyMessage={
          lp.filters.type || lp.filters.status || lp.filters.from || lp.filters.to
            ? "Nenhum evento com esses filtros."
            : "Nenhum evento cadastrado ainda."
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label="Filtrar por tipo"
              className="w-44"
              value={lp.filters.type}
              onChange={(e) => lp.setFilter("type", e.target.value)}
            >
              <option value="">Todos os tipos</option>
              {EVENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {EVENT_TYPE_LABEL[type]}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Filtrar por situação"
              className="w-44"
              value={lp.filters.status}
              onChange={(e) => lp.setFilter("status", e.target.value)}
            >
              <option value="">Todas as situações</option>
              {(Object.keys(EVENT_STATUS_LABEL) as EventStatus[]).map((status) => (
                <option key={status} value={status}>
                  {EVENT_STATUS_LABEL[status]}
                </option>
              ))}
            </NativeSelect>
            <Input
              type="date"
              aria-label="Data inicial"
              className="w-40"
              value={lp.filters.from}
              onChange={(e) => lp.setFilter("from", e.target.value)}
            />
            <Input
              type="date"
              aria-label="Data final"
              className="w-40"
              value={lp.filters.to}
              onChange={(e) => lp.setFilter("to", e.target.value)}
            />
          </div>
        }
        rowActions={(e) => (
          <>
            <Button variant="ghost" size="sm" onClick={() => setViewing(e)} aria-label={`Participantes de ${e.title}`}>
              <Users /> Participantes
            </Button>
            {canEdit && <CheckinLink kind="evento" id={e.id} label="QR de check-in" ariaLabel={`QR de check-in de ${e.title}`} />}
            {canEdit && <EventFormLink event={{ id: e.id, title: e.title }} />}
            {canEdit && (
              <Button variant="ghost" size="sm" onClick={() => setEditing(e)} aria-label={`Editar ${e.title}`}>
                Editar
              </Button>
            )}
            {canDelete && (
              <Button variant="ghost" size="sm" onClick={() => setDeleting(e)} aria-label={`Excluir ${e.title}`}>
                Excluir
              </Button>
            )}
          </>
        )}
      />

      <EventForm
        editing={editing}
        onClose={() => setEditing(null)}
        onSubmit={(payload, id) =>
          id === null ? create.mutateAsync(payload) : update.mutateAsync({ id, data: payload })
        }
      />
      <ParticipantsDialog event={viewing} onClose={() => setViewing(null)} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Excluir evento?"
        description={deleting ? `"${deleting.title}" - os participantes cadastrados também serão removidos.` : undefined}
        confirmLabel="Excluir"
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </>
  );
}
