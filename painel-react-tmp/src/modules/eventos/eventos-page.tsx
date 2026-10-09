import { useState } from "react";
import { Image as ImageIcon, Plus, Users } from "lucide-react";
import { DataTable, type Column } from "@/components/painel/data-table";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmt, toDate } from "@/lib/format";
import { events } from "./api";
import { EventForm } from "./event-form";
import { ParticipantsDialog } from "./participants-dialog";
import { EVENT_TYPE_LABEL, type EventItem } from "./types";

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
    id: "public",
    header: "Público",
    sortValue: (e) => (e.isPublic ? 1 : 0),
    cell: (e) => <Badge variant={e.isPublic ? "default" : "secondary"}>{e.isPublic ? "Público" : "Interno"}</Badge>,
  },
];

export function EventosPage() {
  const list = events.useList();
  const create = events.useCreate();
  const update = events.useUpdate();
  const remove = events.useRemove();

  const [editing, setEditing] = useState<EventItem | "new" | null>(null);
  const [deleting, setDeleting] = useState<EventItem | null>(null);
  const [viewing, setViewing] = useState<EventItem | null>(null);

  return (
    <>
      <PageHeader
        title="Eventos"
        description="Batizados, workshops, campeonatos e demais eventos do grupo."
        actions={
          <Button onClick={() => setEditing("new")}>
            <Plus /> Novo evento
          </Button>
        }
      />
      <DataTable
        columns={columns}
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        getRowId={(e) => e.id}
        searchText={(e) => `${e.title} ${e.location ?? ""} ${EVENT_TYPE_LABEL[e.type] ?? e.type}`}
        searchPlaceholder="Buscar evento…"
        emptyMessage="Nenhum evento cadastrado ainda."
        rowActions={(e) => (
          <>
            <Button variant="ghost" size="sm" onClick={() => setViewing(e)} aria-label={`Participantes de ${e.title}`}>
              <Users /> Participantes
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(e)} aria-label={`Editar ${e.title}`}>
              Editar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDeleting(e)} aria-label={`Excluir ${e.title}`}>
              Excluir
            </Button>
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
