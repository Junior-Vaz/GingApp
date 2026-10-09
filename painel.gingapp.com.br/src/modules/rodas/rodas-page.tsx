import { useMemo, useState } from "react";
import { Image as ImageIcon, Plus, Users } from "lucide-react";
import { DataTable, type Column } from "@/components/painel/data-table";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { fmt, toDate } from "@/lib/format";
import { useSessionUser } from "@/lib/session";
import { rodas } from "./api";
import { useStates } from "./reference";
import { RodaForm } from "./roda-form";
import { RodaParticipantsDialog } from "./rodas-participants-dialog";
import type { Roda } from "./types";

export function RodasPage() {
  const user = useSessionUser();
  const list = rodas.useList();
  const states = useStates();
  const create = rodas.useCreate();
  const update = rodas.useUpdate();
  const remove = rodas.useRemove();

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
        data={list.data}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        getRowId={(r) => r.id}
        searchText={(r) => `${r.title} ${r.location ?? ""}`}
        searchPlaceholder="Buscar roda…"
        emptyMessage="Nenhuma roda cadastrada ainda."
        rowActions={(r) => (
          <>
            <Button variant="ghost" size="sm" onClick={() => setViewing(r)} aria-label={`Participantes de ${r.title}`}>
              <Users /> Participantes
            </Button>
            {isOwner(r) && (
              <>
                <Button variant="ghost" size="sm" onClick={() => setEditing(r)} aria-label={`Editar ${r.title}`}>
                  Editar
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleting(r)} aria-label={`Excluir ${r.title}`}>
                  Excluir
                </Button>
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
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Excluir roda?"
        description={deleting ? `"${deleting.title}" - os participantes registrados também serão removidos.` : undefined}
        confirmLabel="Excluir"
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </>
  );
}
