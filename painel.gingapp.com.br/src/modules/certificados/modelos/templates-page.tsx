import { useState } from "react";
import { CopyPlus, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { fmt, toDate } from "@/lib/format";
import { templatesErrorMessage, useDeleteTemplate, useDuplicateTemplate, useSetDefaultTemplate, useTemplates } from "./api";
import { NewTemplateDialog } from "./new-template-dialog";
import { useCanManageTemplates } from "./permissions";
import { TemplateThumb } from "./template-thumb";
import { LIMITS, ORIENTATION_LABEL, PURPOSE_LABEL, type CertificateTemplateSummary } from "./types";

/**
 * Aba "Modelos" (/certificados/modelos): cartões com miniatura, uso, selo "Padrão" e ações.
 * `onOpen` abre o editor (a rota fornece a navegação).
 */
export function TemplatesPage({ onOpen }: { onOpen: (id: number) => void }) {
  const list = useTemplates();
  const canManage = useCanManageTemplates();
  const duplicate = useDuplicateTemplate();
  const setDefault = useSetDefaultTemplate();
  const remove = useDeleteTemplate();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<CertificateTemplateSummary | null>(null);

  const templates = list.data ?? [];
  const atLimit = templates.length >= LIMITS.maxTemplates;

  return (
    <>
      <PageHeader
        title="Modelos de certificado"
        description="Desenhe como o certificado fica: texto, imagens, cores e o QR Code de verificação."
        actions={
          canManage ? (
            <Button onClick={() => setCreating(true)} disabled={atLimit} title={atLimit ? "Limite de modelos do grupo atingido" : undefined}>
              <Plus /> Novo modelo
            </Button>
          ) : undefined
        }
      />

      {!canManage && (
        <p role="note" className="mb-4 rounded-md border bg-muted/50 p-3 text-sm">
          Somente o Mestre e o Professor criam e editam modelos. Você pode escolher qualquer modelo ao emitir um certificado.
        </p>
      )}
      {atLimit && (
        <p role="note" className="mb-4 rounded-md border bg-muted/50 p-3 text-sm">
          O grupo chegou ao limite de {LIMITS.maxTemplates} modelos. Exclua algum para criar outro.
        </p>
      )}

      {list.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-busy="true" data-testid="templates-loading">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : list.error ? (
        <div className="space-y-2 py-8 text-center" data-testid="templates-error">
          <p role="alert" className="text-sm text-destructive">
            {templatesErrorMessage(list.error, "Não foi possível carregar os modelos.")}
          </p>
          <Button variant="outline" size="sm" onClick={() => void list.refetch()}>
            Tentar de novo
          </Button>
        </div>
      ) : templates.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground" data-testid="templates-empty">
          Nenhum modelo ainda.{canManage ? " Crie o primeiro com o botão “Novo modelo”: dá para partir de um modelo pronto." : ""}
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Modelos de certificado">
          {templates.map((t) => (
            <li key={t.id} className="flex flex-col gap-3 rounded-xl border bg-card p-3" data-testid={`template-card-${String(t.id)}`}>
              {canManage ? (
                <button
                  type="button"
                  className="block rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Editar o modelo ${t.name}`}
                  onClick={() => onOpen(t.id)}
                >
                  <TemplateThumb id={t.id} orientation={t.orientation} />
                </button>
              ) : (
                <TemplateThumb id={t.id} orientation={t.orientation} />
              )}
              <div className="min-w-0 space-y-1">
                <h2 className="truncate text-base font-semibold" title={t.name}>
                  {t.name}
                </h2>
                <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  <Badge variant="secondary">{PURPOSE_LABEL[t.purpose]}</Badge>
                  {t.isDefault && <Badge data-testid="default-badge">Padrão</Badge>}
                  <span>{ORIENTATION_LABEL[t.orientation]}</span>
                  <span aria-hidden>·</span>
                  <span>Atualizado em {fmt(toDate(t.updatedAt), "dd/MM/yyyy")}</span>
                </div>
              </div>
              {canManage && (
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => onOpen(t.id)} aria-label={`Abrir editor de ${t.name}`}>
                    <Pencil /> Editar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Duplicar ${t.name}`}
                    disabled={duplicate.isPending || atLimit}
                    onClick={() => duplicate.mutate(t.id)}
                  >
                    <CopyPlus /> Duplicar
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Definir ${t.name} como padrão de ${PURPOSE_LABEL[t.purpose]}`}
                    disabled={t.isDefault || setDefault.isPending}
                    onClick={() => setDefault.mutate(t.id)}
                  >
                    <Star /> {t.isDefault ? "É o padrão" : "Definir padrão"}
                  </Button>
                  <Button variant="ghost" size="sm" aria-label={`Excluir ${t.name}`} onClick={() => setDeleting(t)}>
                    <Trash2 /> Excluir
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <NewTemplateDialog open={creating} onOpenChange={setCreating} onCreated={(created) => onOpen(created.id)} />

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Excluir modelo?"
        description={
          deleting
            ? `“${deleting.name}” será excluído. Os certificados já emitidos com ele não mudam (cada um guarda uma cópia do desenho).${
                deleting.isDefault
                  ? ` Ele é o padrão de “${PURPOSE_LABEL[deleting.purpose]}”: sem outro padrão, o grupo volta a usar o modelo clássico.`
                  : ""
              }`
            : undefined
        }
        confirmLabel="Excluir"
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </>
  );
}
