import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { toast } from "sonner";
import { Copy, ExternalLink } from "lucide-react";
import { DataTable, type Column } from "@/components/painel/data-table";
import { FormDialog } from "@/components/painel/form-dialog";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import type { QueryParams } from "@/lib/api";
import { createCrud } from "@/lib/crud";
import { useListParams } from "@/lib/list-params";
import {
  certificateLink,
  certificateToEdit,
  editSchema,
  emptyCertificateFilters,
  emptyIssue,
  formatIssuedAt,
  issueSchema,
  toEditPayload,
  toIssuePayload,
  type Certificate,
  type CertificateFilters,
  type EditValues,
  type IssueValues,
  type StudentRef,
} from "./certificate-utils";

type CertificateInput = Record<string, unknown>;

function VerificationQr({ code }: { code: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(certificateLink(code), { margin: 1, width: 200 })
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setSrc(null));
    return () => {
      alive = false;
    };
  }, [code]);
  if (!src) return null;
  return <img src={src} alt="QR Code de verificação" width={200} height={200} className="rounded-md border" />;
}

const certificates = createCrud<Certificate, CertificateInput>("/certificates", {
  created: "Certificado emitido.",
  updated: "Certificado atualizado.",
  removed: "Certificado apagado.",
});
const students = createCrud<StudentRef>("/students");

/** Maximo aceito pelo backend em um GET paginado; usado na lista de alunos do formulario/filtro. */
const STUDENT_PICKER_LIMIT = 200;
const STUDENT_PICKER_PARAMS: QueryParams = { limit: STUDENT_PICKER_LIMIT };

const nativeSelect =
  "border-input h-9 w-full rounded-md border bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

export function CertificadosPage() {
  // Lista no servidor (padrao Alunos): useListParams -> usePage -> DataTable server.
  const lp = useListParams<CertificateFilters>({ pageSize: 10, filters: emptyCertificateFilters() });
  const list = certificates.usePage(lp.params);
  const studentList = students.usePage(STUDENT_PICKER_PARAMS);
  const create = certificates.useCreate();
  const update = certificates.useUpdate();
  const remove = certificates.useRemove();

  const [issuing, setIssuing] = useState(false);
  const [editing, setEditing] = useState<Certificate | null>(null);
  const [deleting, setDeleting] = useState<Certificate | null>(null);
  const [viewing, setViewing] = useState<Certificate | null>(null);

  const { filters } = lp;
  const hasFilter = !!(filters.studentId || filters.from || filters.to);
  const studentsTruncated = studentList.total > STUDENT_PICKER_LIMIT;

  async function copyLink(code: string) {
    try {
      await navigator.clipboard.writeText(certificateLink(code));
      toast.success("Link de verificação copiado.");
    } catch {
      toast.error("Não foi possível copiar o link.");
    }
  }

  const columns: Column<Certificate>[] = [
    { id: "student", header: "Aluno", sortValue: (c) => c.student.name, cell: (c) => <span className="font-medium">{c.student.name}</span> },
    { id: "title", header: "Título", sortValue: (c) => c.title },
    { id: "issuedAt", header: "Emitido em", sortValue: (c) => c.issuedAt, cell: (c) => formatIssuedAt(c.issuedAt) },
    {
      id: "code",
      header: "Código",
      sortValue: (c) => c.verificationCode,
      cell: (c) => <code className="text-xs text-muted-foreground">{c.verificationCode}</code>,
    },
  ];

  return (
    <>
      <PageHeader
        title="Certificados"
        description="Emita certificados para os alunos — cada um ganha um código de verificação."
        actions={<Button onClick={() => setIssuing(true)}>Emitir certificado</Button>}
      />

      <DataTable
        columns={columns}
        data={list.items}
        server={{ ...lp.server, total: list.total, isFetching: list.isFetching }}
        isLoading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        getRowId={(c) => c.id}
        searchPlaceholder="Buscar aluno, título ou código…"
        emptyMessage={hasFilter ? "Nenhum certificado para os filtros." : "Nenhum certificado emitido ainda."}
        toolbar={
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Filtrar por aluno"
              className={cn(nativeSelect, "w-44")}
              value={filters.studentId}
              onChange={(e) => lp.setFilter("studentId", e.target.value)}
            >
              <option value="">Todos os alunos</option>
              {(studentList.items ?? []).map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.name}
                </option>
              ))}
            </select>
            <Input
              type="date"
              aria-label="Emitido de"
              className="w-40"
              value={filters.from}
              onChange={(e) => lp.setFilter("from", e.target.value)}
            />
            <Input
              type="date"
              aria-label="Emitido até"
              className="w-40"
              value={filters.to}
              onChange={(e) => lp.setFilter("to", e.target.value)}
            />
            {hasFilter && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  const empty = emptyCertificateFilters();
                  for (const key of Object.keys(empty) as (keyof CertificateFilters)[]) lp.setFilter(key, empty[key]);
                }}
              >
                Limpar
              </Button>
            )}
          </div>
        }
        rowActions={(c) => (
          <>
            <Button variant="ghost" size="sm" onClick={() => setViewing(c)}>
              Verificação
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>
              Editar
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setDeleting(c)}>
              Apagar
            </Button>
          </>
        )}
      />

      <FormDialog<IssueValues>
        open={issuing}
        onOpenChange={setIssuing}
        title="Emitir certificado"
        schema={issueSchema}
        defaultValues={emptyIssue()}
        submitLabel="Emitir"
        onSubmit={(v) => create.mutateAsync(toIssuePayload(v))}
      >
        {(form) => (
          <>
            <FormField
              control={form.control}
              name="studentId"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Aluno</FormLabel>
                  <FormControl>
                    <select {...field} className={nativeSelect}>
                      <option value="">Selecione…</option>
                      {(studentList.items ?? []).map((s) => (
                        <option key={s.id} value={String(s.id)}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </FormControl>
                  {studentsTruncated && (
                    <p data-testid="students-truncated" className="text-xs text-muted-foreground">
                      Mostrando os primeiros {STUDENT_PICKER_LIMIT} de {studentList.total} alunos.
                    </p>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Título</FormLabel>
                  <FormControl>
                    <Input placeholder="ex.: Participação no Workshop de Capoeira Angola" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="issuedAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Data de emissão (opcional)</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="fileUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Link do arquivo (opcional)</FormLabel>
                  <FormControl>
                    <Input placeholder="https://…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}
      </FormDialog>

      <FormDialog<EditValues>
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title="Editar certificado"
        description={editing ? `Aluno: ${editing.student.name} (não pode ser alterado).` : "Edite os dados."}
        schema={editSchema}
        defaultValues={editing ? certificateToEdit(editing) : { title: "", issuedAt: "", fileUrl: "" }}
        onSubmit={(v) => update.mutateAsync({ id: editing!.id, data: toEditPayload(v) })}
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
              name="issuedAt"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Data de emissão</FormLabel>
                  <FormControl>
                    <Input type="date" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="fileUrl"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Link do arquivo</FormLabel>
                  <FormControl>
                    <Input placeholder="https://…" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
          </>
        )}
      </FormDialog>

      <Dialog open={viewing !== null} onOpenChange={(open) => !open && setViewing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Verificação do certificado</DialogTitle>
            <DialogDescription>
              {viewing ? `${viewing.title} — ${viewing.student.name}` : ""}
            </DialogDescription>
          </DialogHeader>
          {viewing && (
            <div className="grid gap-3 text-sm">
              <VerificationQr code={viewing.verificationCode} />
              <div>
                <p className="text-xs font-medium text-muted-foreground">Código</p>
                <code data-testid="cert-code">{viewing.verificationCode}</code>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">Link público (aberto pelo QR Code)</p>
                <p className="break-all" data-testid="cert-link">
                  {certificateLink(viewing.verificationCode)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void copyLink(viewing.verificationCode)}>
                  <Copy /> Copiar link
                </Button>
                <Button variant="outline" size="sm" asChild>
                  <a href={certificateLink(viewing.verificationCode)} target="_blank" rel="noreferrer">
                    <ExternalLink /> Abrir verificação
                  </a>
                </Button>
                {viewing.fileUrl && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={viewing.fileUrl} target="_blank" rel="noreferrer">
                      <ExternalLink /> Arquivo
                    </a>
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Apagar certificado?"
        description={
          deleting
            ? `"${deleting.title}" de ${deleting.student.name} será apagado e o código de verificação deixa de validar.`
            : undefined
        }
        confirmLabel="Apagar"
        onConfirm={() => remove.mutateAsync(deleting!.id)}
      />
    </>
  );
}
