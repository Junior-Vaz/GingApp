import { useState } from "react";
import { Archive, Copy, CopyPlus, ExternalLink, Pencil, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { DataTable, type Column } from "@/components/painel/data-table";
import { PageHeader } from "@/components/painel/page-header";
import { RowActions } from "@/components/painel/row-actions";
import { StrongConfirmDialog } from "@/components/painel/strong-confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { fmt, formatCurrency, toDate } from "@/lib/format";
import { useListParams } from "@/lib/list-params";
import { plural } from "@/lib/plural";
import { useCan } from "@/lib/session";
import { NativeSelect } from "@/modules/rodas/native-select";
import { toast } from "sonner";
import { formsErrorMessage, useDeleteForm, useEventOptions, useFormAction, useForms } from "./api";
import { NewFormDialog } from "./new-form-dialog";
import { useOpenForm } from "./navigation";
import { copyText, publicLink } from "./share";
import {
  FORM_STATUS_LABEL,
  FORM_STATUS_VARIANT,
  isLinkProvisional,
  type FormListItem,
  type FormStatus,
} from "./types";

const STATUSES = Object.keys(FORM_STATUS_LABEL) as FormStatus[];
const NO_LINK_HINT = "Publique o formulário para gerar o link";

function priceLabel(form: FormListItem): string {
  return form.paymentMode === "NONE" || !form.priceCents
    ? "Grátis"
    : formatCurrency(form.priceCents);
}

/** Lista dos formulários de inscrição do grupo (/formularios): cartões no celular, tabela no computador. */
export function FormulariosPage() {
  const lp = useListParams({ pageSize: 10, filters: { status: "", eventId: "" } });
  const list = useForms(lp.params);
  const events = useEventOptions();
  const action = useFormAction();
  const remove = useDeleteForm();
  const openForm = useOpenForm();
  const canCreate = useCan("events", "create");
  const canEdit = useCan("events", "edit");
  const canDelete = useCan("events", "delete");

  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<FormListItem | null>(null);
  const [archiving, setArchiving] = useState<FormListItem | null>(null);

  const columns: Column<FormListItem>[] = [
    {
      id: "title",
      header: "Formulário",
      sortValue: (f) => f.title,
      cell: (f) => (
        <div className="min-w-0 space-y-0.5">
          <button
            type="button"
            className="text-left font-medium underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => openForm(f.id)}
          >
            {f.title}
          </button>
          <p className="break-all text-xs text-muted-foreground">
            {publicLink(f)?.replace(/^https?:\/\//, "") ?? "Link criado ao publicar"}
          </p>
        </div>
      ),
    },
    {
      id: "event",
      header: "Evento",
      sortValue: (f) => f.eventTitle ?? "",
      cell: (f) => f.eventTitle || "Avulso",
    },
    {
      id: "status",
      header: "Situação",
      sortValue: (f) => f.status,
      cell: (f) => (
        <Badge variant={FORM_STATUS_VARIANT[f.status]}>{FORM_STATUS_LABEL[f.status]}</Badge>
      ),
    },
    {
      id: "submissions",
      header: "Inscrições",
      sortValue: (f) => f.submissionsCount,
      cell: (f) => (
        <span className="flex flex-wrap items-center justify-end gap-1.5 md:justify-start">
          <span>{plural(f.submissionsCount, "inscrição", "inscrições")}</span>
          {f.pendingCount > 0 && (
            <Badge variant="destructive" aria-label={`${plural(f.pendingCount, "pendente")}`}>
              {plural(f.pendingCount, "pendente")}
            </Badge>
          )}
        </span>
      ),
    },
    { id: "price", header: "Valor", sortValue: (f) => f.priceCents ?? 0, cell: priceLabel },
    {
      id: "created",
      header: "Criado em",
      sortValue: (f) => f.createdAt,
      cell: (f) => fmt(toDate(f.createdAt), "dd/MM/yyyy"),
    },
  ];

  return (
    <>
      <PageHeader
        title="Formulários de inscrição"
        description="Monte a inscrição de campeonatos, batizados e cursos, compartilhe o link e acompanhe tudo aqui."
        actions={
          canCreate ? (
            <Button onClick={() => setCreating(true)}>
              <Plus /> Novo formulário
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
        getRowId={(f) => String(f.id)}
        searchPlaceholder="Buscar por título…"
        emptyMessage={
          lp.filters.status || lp.filters.eventId
            ? "Nenhum formulário com esses filtros."
            : "Nenhum formulário ainda. Crie o primeiro com o botão “Novo formulário”."
        }
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <NativeSelect
              aria-label="Filtrar por situação"
              className="h-11 w-44 md:h-9"
              value={lp.filters.status}
              onChange={(e) => lp.setFilter("status", e.target.value)}
            >
              <option value="">Todas as situações</option>
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {FORM_STATUS_LABEL[status]}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              aria-label="Filtrar por evento"
              className="h-11 w-52 md:h-9"
              value={lp.filters.eventId}
              onChange={(e) => lp.setFilter("eventId", e.target.value)}
            >
              <option value="">Todos os eventos</option>
              {(events.data ?? []).map((event) => (
                <option key={String(event.id)} value={String(event.id)}>
                  {event.title}
                </option>
              ))}
            </NativeSelect>
          </div>
        }
        rowActions={(f) => (
          <RowActions
            subject={f.title}
            actions={[
              {
                key: "edit",
                label: "Abrir editor",
                ariaLabel: `Abrir editor de ${f.title}`,
                icon: Pencil,
                primary: true,
                onSelect: () => openForm(f.id),
              },
              // `publicUrl` é null até a 1ª publicação (o slug é provisório): as ações de link ficam desabilitadas.
              {
                key: "copy",
                label: "Copiar link",
                ariaLabel: `Copiar link de ${f.title}`,
                icon: Copy,
                primary: true,
                disabled: isLinkProvisional(f),
                hint: NO_LINK_HINT,
                onSelect: () => {
                  const url = publicLink(f);
                  if (url) void copyText(url);
                },
              },
              {
                key: "view",
                label: "Abrir página pública",
                icon: ExternalLink,
                disabled: isLinkProvisional(f),
                hint: NO_LINK_HINT,
                onSelect: () => {
                  const url = publicLink(f);
                  if (url) window.open(url, "_blank", "noopener,noreferrer");
                },
              },
              canCreate && {
                key: "duplicate",
                label: "Duplicar",
                ariaLabel: `Duplicar ${f.title}`,
                icon: CopyPlus,
                onSelect: () => action.mutate({ id: f.id, action: "duplicate" }),
              },
              canEdit &&
                f.status !== "ARCHIVED" && {
                  key: "archive",
                  label: "Arquivar",
                  ariaLabel: `Arquivar ${f.title}`,
                  icon: Archive,
                  onSelect: () => setArchiving(f),
                },
              canDelete && {
                key: "delete",
                label: "Excluir",
                ariaLabel: `Excluir ${f.title}`,
                icon: Trash2,
                destructive: true,
                onSelect: () => setDeleting(f),
              },
            ]}
          />
        )}
      />

      <NewFormDialog
        open={creating}
        onOpenChange={setCreating}
        onCreated={(form) => openForm(form.id)}
      />

      <ConfirmDialog
        open={archiving !== null}
        onOpenChange={(open) => !open && setArchiving(null)}
        variant="default"
        title="Arquivar formulário?"
        description={
          archiving
            ? `"${archiving.title}" deixa de aceitar inscrições e fica somente leitura. As inscrições recebidas são preservadas.`
            : undefined
        }
        confirmLabel="Arquivar"
        onConfirm={() => action.mutateAsync({ id: archiving!.id, action: "archive" })}
      />

      <StrongConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Excluir formulário?"
        description={
          deleting
            ? `"${deleting.title}" e o link público deixam de existir. Não pode ser desfeito.`
            : undefined
        }
        phrase="EXCLUIR"
        confirmLabel="Excluir definitivamente"
        onConfirm={async () => {
          const target = deleting!;
          try {
            await remove.mutateAsync(target.id);
          } catch (error) {
            // Já tem inscrições: não dá para excluir; oferece arquivar no lugar.
            if (error instanceof ApiError && error.code === "FORM_HAS_SUBMISSIONS") {
              toast.error(formsErrorMessage(error));
              setArchiving(target);
              return;
            }
            throw error;
          }
        }}
      />
    </>
  );
}
