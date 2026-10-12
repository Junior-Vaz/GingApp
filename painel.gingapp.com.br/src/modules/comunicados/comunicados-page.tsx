import { useState } from "react";
import { z } from "zod";
import { Megaphone } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { DataTable, type Column } from "@/components/painel/data-table";
import { FormDialog } from "@/components/painel/form-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { UnitPicker } from "@/components/painel/unit-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { createCrud } from "@/lib/crud";
import { useListParams } from "@/lib/list-params";
import { fmt, toDate } from "@/lib/format";
import { useCan } from "@/lib/session";
import { useUnitNames } from "@/lib/unit-lookup";
import { BR_UFS } from "@/lib/br-ufs";
import { useClassSelector } from "@/modules/frequencia/frequencia-api";
import { NativeSelect } from "@/modules/rodas/native-select";

/** Contrato de GET /announcements (backend: AnnouncementsService). */
export interface Announcement {
  id: number;
  unitId: number | null;
  title: string;
  body: string;
  publishedAt: string | null;
  isActive: boolean;
  createdAt: string;
  /** Alcance extra (combina por E com unitId): só alunos matriculados na turma + responsáveis + professor dela. */
  classId?: number | null;
  /** Só quem pertence a unidades desta UF (sigla maiúscula). */
  stateUf?: string | null;
  /** Só este papel. */
  audienceRole?: AudienceRole | null;
}

export type AudienceRole = "ALUNO" | "RESPONSAVEL" | "PROFESSOR";

const AUDIENCE_LABEL: Record<AudienceRole, string> = {
  ALUNO: "Alunos",
  RESPONSAVEL: "Responsáveis",
  PROFESSOR: "Professores",
};

/** unitId null = grupo inteiro. No PATCH, null limpa a unidade/o alcance e omitir mantém. */
export interface AnnouncementInput {
  title: string;
  body: string;
  unitId: number | null;
  isActive?: boolean;
  classId?: number | null;
  stateUf?: string | null;
  audienceRole?: AudienceRole | null;
}

const announcements = createCrud<Announcement, AnnouncementInput>("/announcements", {
  created: "Comunicado publicado e distribuído como notificação.",
  updated: "Comunicado atualizado.",
  removed: "Comunicado desativado.",
});

// Regras do backend: título e texto com no mínimo 2 caracteres. `unitId` é o id da unidade como
// texto; "" = todo o grupo (vira unitId null no payload).
const schema = z.object({
  title: z.string().trim().min(2, "Informe o título (mínimo 2 caracteres)."),
  body: z.string().trim().min(2, "Informe o texto (mínimo 2 caracteres)."),
  unitId: z.string(),
  // Alcance extra (opcional): "" = sem restrição.
  classId: z.string(),
  stateUf: z.string(),
  audienceRole: z.string(),
  isActive: z.boolean(),
});
type Values = z.infer<typeof schema>;

export function ComunicadosPage() {
  // Lista no servidor: busca (q em título/corpo), situação (isActive) e unidade (unitId).
  const lp = useListParams({ pageSize: 10, filters: { isActive: "", unitId: "", classId: "" } });
  const list = announcements.usePage(lp.params);
  const create = announcements.useCreate();
  const update = announcements.useUpdate();
  const remove = announcements.useRemove();
  // Espelha a matriz do seed: PROFESSOR não tem announcements:delete (o backend decide de fato).
  const canDelete = useCan("announcements", "delete");

  const [editing, setEditing] = useState<Announcement | "new" | null>(null);
  const [deleting, setDeleting] = useState<Announcement | null>(null);

  // Nomes só das unidades desta página (GET /units/:id por id distinto), sem carregar a lista inteira.
  const nameOfUnit = useUnitNames((list.items ?? []).map((a) => a.unitId));
  const unitName = (unitId: number | null) =>
    unitId === null ? "Todo o grupo" : nameOfUnit(unitId, `Unidade #${unitId}`);
  // Turmas para o alcance (GET /classes?limit=200, como na Frequência).
  const classes = useClassSelector();
  const className = (id: number) => classes.data?.items.find((c) => c.id === id)?.name ?? `Turma #${id}`;
  /** Resumo do alcance: "Matriz · Turma X · GO · Responsáveis" (sem restrição = "Todo o grupo"). */
  const scopeLabel = (a: Announcement) => {
    const parts = [
      ...(a.unitId !== null ? [unitName(a.unitId)] : []),
      ...(a.classId ? [className(a.classId)] : []),
      ...(a.stateUf ? [a.stateUf] : []),
      ...(a.audienceRole ? [AUDIENCE_LABEL[a.audienceRole]] : []),
    ];
    return parts.length ? parts.join(" · ") : "Todo o grupo";
  };

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
    { id: "scope", header: "Público", sortValue: (a) => scopeLabel(a), cell: (a) => scopeLabel(a) },
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
    unitId: current?.unitId != null ? String(current.unitId) : "",
    classId: current?.classId ? String(current.classId) : "",
    stateUf: current?.stateUf ?? "",
    audienceRole: current?.audienceRole ?? "",
    isActive: current?.isActive ?? true,
  };

  function submit(values: Values) {
    const unitId = values.unitId === "" ? null : Number(values.unitId);
    const base = { title: values.title, body: values.body, unitId };
    if (current) {
      // PATCH: alcance esvaziado vai como null (limpa a restrição); editar não re-notifica.
      return update.mutateAsync({
        id: current.id,
        data: {
          ...base,
          classId: values.classId === "" ? null : Number(values.classId),
          stateUf: values.stateUf === "" ? null : values.stateUf,
          audienceRole: values.audienceRole === "" ? null : (values.audienceRole as AudienceRole),
          isActive: values.isActive,
        },
      });
    }
    // POST: só os campos de alcance preenchidos.
    return create.mutateAsync({
      ...base,
      ...(values.classId !== "" ? { classId: Number(values.classId) } : {}),
      ...(values.stateUf !== "" ? { stateUf: values.stateUf } : {}),
      ...(values.audienceRole !== "" ? { audienceRole: values.audienceRole as AudienceRole } : {}),
    });
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
          lp.filters.isActive || lp.filters.unitId || lp.filters.classId ? "Nenhum comunicado com esses filtros." : "Nenhum comunicado publicado."
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
            <UnitPicker
              mode="filter"
              value={lp.filters.unitId ? Number(lp.filters.unitId) : null}
              onChange={(u) => lp.setFilter("unitId", u ? String(u.id) : "")}
            />
            <NativeSelect
              aria-label="Filtrar por turma"
              className="w-44"
              value={lp.filters.classId}
              onChange={(e) => lp.setFilter("classId", e.target.value)}
            >
              <option value="">Todas as turmas</option>
              {classes.data?.items.map((c) => (
                <option key={c.id} value={String(c.id)}>
                  {c.name}
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
              name="unitId"
              render={({ field }) => (
                <FormItem>
                  <UnitPicker
                    optional
                    label="Público"
                    emptyLabel="Todo o grupo"
                    value={field.value ? Number(field.value) : null}
                    onChange={(u) => field.onChange(u ? String(u.id) : "")}
                  />
                  <FormMessage />
                </FormItem>
              )}
            />
            <fieldset className="grid gap-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Alcance (opcional)</legend>
              <p className="text-xs text-muted-foreground">
                Combina com o público acima: só recebe quem atende a todas as restrições escolhidas.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <FormField
                  control={form.control}
                  name="classId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Turma</FormLabel>
                      <FormControl>
                        <NativeSelect {...field}>
                          <option value="">Todas as turmas</option>
                          {classes.data?.items.map((c) => (
                            <option key={c.id} value={String(c.id)}>
                              {c.name}
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
                  name="stateUf"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Estado (UF)</FormLabel>
                      <FormControl>
                        <NativeSelect {...field}>
                          <option value="">Todos os estados</option>
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
                <FormField
                  control={form.control}
                  name="audienceRole"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Somente para</FormLabel>
                      <FormControl>
                        <NativeSelect {...field}>
                          <option value="">Todos</option>
                          {(Object.keys(AUDIENCE_LABEL) as AudienceRole[]).map((role) => (
                            <option key={role} value={role}>
                              {AUDIENCE_LABEL[role]}
                            </option>
                          ))}
                        </NativeSelect>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </fieldset>
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
