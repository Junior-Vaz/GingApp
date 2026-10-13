import { useState } from "react";
import type { UseFormReturn } from "react-hook-form";
import { LayoutTemplate, Pencil, Plus, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { DataTable, type Column } from "@/components/painel/data-table";
import { ExportRowsButton } from "@/components/painel/export-csv-button";
import { FormDialog } from "@/components/painel/form-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { RopeSwatch } from "@/components/painel/rope-swatch";
import { StudentPicker, type StudentOption } from "@/components/painel/student-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";
import { ropeOf } from "@/lib/rope";
import { useCan, useSessionUser } from "@/lib/session";
import { dayOnly, fmt } from "@/lib/format";
import { CargosPorCorda } from "./cargos-por-corda";
import {
  levelOptions,
  systems,
  useCreateFromTemplate,
  useCreateLevel,
  useDuplicateLevel,
  useRegisterGraduation,
  useRemoveGraduation,
  useRemoveLevel,
  useRemoveSystem,
  useReorderLevels,
  useStudentHistory,
  useUpdateGraduation,
  useUpdateLevel,
  type GraduationLevel,
  type GraduationSystem,
  type LevelOption,
  type StudentGraduation,
} from "./graduacoes-api";
import {
  levelDefaults,
  levelSchema,
  registrationSchema,
  systemSchema,
  templateSchema,
  toLevelInput,
  toLevelUpdate,
  toRegistrationInput,
  toRegistrationUpdate,
  toSystemInput,
  toSystemUpdate,
  type LevelFormValues,
  type RegistrationFormValues,
  type SystemFormValues,
  type TemplateFormValues,
} from "./graduacoes-forms";
import { LevelFields } from "./level-editor";
import { LevelRuler } from "./level-ruler";
import { LevelSelect } from "./level-select";
import { TemplateFields } from "./template-dialog";

function SystemFields({ form }: { form: UseFormReturn<SystemFormValues> }) {
  return (
      <>
        <FormField control={form.control} name="name" render={({ field }) => (
          <FormItem><FormLabel>Nome</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="description" render={({ field }) => (
          <FormItem><FormLabel>Descrição (opcional)</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl><FormMessage /></FormItem>
        )} />
      </>
  );
}

export function GraduacoesPage() {
  return (
    <>
      <PageHeader
        title="Graduações"
        description="Configure o sistema de graduação do grupo e registre a evolução dos alunos."
      />
      <Tabs defaultValue="sistemas">
        <TabsList>
          <TabsTrigger value="sistemas">Sistemas e níveis</TabsTrigger>
          <TabsTrigger value="alunos">Graduação de alunos</TabsTrigger>
        </TabsList>
        <TabsContent value="sistemas" className="mt-4">
          <SistemasTab />
        </TabsContent>
        <TabsContent value="alunos" className="mt-4">
          <AlunosTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

function SistemasTab() {
  const list = systems.useList();
  const createSystem = systems.useCreate();
  const updateSystem = systems.useUpdate();
  const removeSystem = useRemoveSystem();
  const createLevel = useCreateLevel();
  const updateLevel = useUpdateLevel();
  const removeLevel = useRemoveLevel();
  const duplicateLevel = useDuplicateLevel();
  const reorderLevels = useReorderLevels();
  const fromTemplate = useCreateFromTemplate();
  // A ESTRUTURA do sistema (sistemas, níveis, duplicar, reordenar, modelo, regras de cargo, equivalências) é só do
  // Mestre: o backend responde 403 ao Professor em POST/PATCH/DELETE. Quem não é Mestre só vê (e gradua alunos na
  // outra aba). Cada permissão da matriz continua valendo por cima do papel.
  const isMestre = useSessionUser()?.role === "MESTRE";
  const canEdit = useCan("graduations", "edit") && isMestre;
  const canCreate = useCan("graduations", "create") && isMestre;
  const canDelete = useCan("graduations", "delete") && isMestre;
  const [newSystem, setNewSystem] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [levelFor, setLevelFor] = useState<GraduationSystem | null>(null);
  const [editingSystem, setEditingSystem] = useState<GraduationSystem | null>(null);
  const [removingSystem, setRemovingSystem] = useState<GraduationSystem | null>(null);
  const [editingLevel, setEditingLevel] = useState<GraduationLevel | null>(null);
  const [removingLevel, setRemovingLevel] = useState<GraduationLevel | null>(null);

  function renderBody() {
    if (list.isLoading) {
      return (
        <div className="space-y-3" data-testid="systems-loading">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      );
    }
    if (list.error) {
      return (
        <div className="rounded-lg border bg-card p-8 text-center" data-testid="systems-error">
          <p className="text-sm text-destructive">{errorMessage(list.error, "Não foi possível carregar os sistemas de graduação.")}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void list.refetch()}>
            Tentar novamente
          </Button>
        </div>
      );
    }
    if (!list.data || list.data.length === 0) {
      return (
        <div className="rounded-lg border border-dashed bg-card p-8 text-center text-sm text-muted-foreground" data-testid="systems-empty">
          Nenhum sistema de graduação cadastrado ainda.
        </div>
      );
    }
    return (
      <div className="space-y-4">
        {list.data.map((system) => {
          return (
            <Card key={system.id}>
              <CardHeader className="flex-row items-start justify-between gap-3 space-y-0 max-sm:flex-col">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {system.name}
                    {!system.isActive && <Badge variant="secondary">Inativo</Badge>}
                  </CardTitle>
                  {system.description && <CardDescription className="mt-1">{system.description}</CardDescription>}
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1 max-sm:w-full max-sm:justify-start">
                  {canCreate && (
                    <Button variant="outline" size="sm" onClick={() => setLevelFor(system)} aria-label={`Novo nível em ${system.name}`}>
                      <Plus /> Novo nível
                    </Button>
                  )}
                  {canEdit && (
                    <Button variant="ghost" size="sm" onClick={() => setEditingSystem(system)} aria-label={`Editar sistema ${system.name}`}>
                      <Pencil /> Editar
                    </Button>
                  )}
                  {canEdit && !system.isActive && (
                    <Button variant="ghost" size="sm" onClick={() => updateSystem.mutate({ id: system.id, data: { isActive: true } })} aria-label={`Reativar sistema ${system.name}`}>
                      Reativar
                    </Button>
                  )}
                  {canDelete && system.isActive && (
                    <Button variant="ghost" size="sm" onClick={() => setRemovingSystem(system)} aria-label={`Remover sistema ${system.name}`}>
                      <Trash2 /> Remover
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {system.levels.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum nível cadastrado neste sistema ainda.</p>
                ) : (
                  <LevelRuler
                    system={system}
                    canCreate={canCreate}
                    canEdit={canEdit}
                    canDelete={canDelete}
                    busy={reorderLevels.isPending || duplicateLevel.isPending}
                    onEdit={setEditingLevel}
                    onRemove={setRemovingLevel}
                    onDuplicate={(level) => duplicateLevel.mutate(level.id)}
                    onReorder={(systemId, order) => reorderLevels.mutate({ systemId, order })}
                  />
                )}
                <CargosPorCorda system={system} canEdit={isMestre} />
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  }

  return (
    <>
      {canCreate && (
        <div className="mb-4 flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => setTemplateOpen(true)}>
            <LayoutTemplate /> Criar a partir de um modelo
          </Button>
          <Button onClick={() => setNewSystem(true)}>Novo sistema</Button>
        </div>
      )}
      {renderBody()}

      <FormDialog<SystemFormValues>
        open={newSystem}
        onOpenChange={setNewSystem}
        title="Novo sistema de graduação"
        schema={systemSchema}
        defaultValues={{ name: "", description: "" }}
        onSubmit={(values) => createSystem.mutateAsync(toSystemInput(values))}
      >
        {(form) => <SystemFields form={form} />}
      </FormDialog>

      <FormDialog<TemplateFormValues>
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        title="Criar a partir de um modelo"
        description="Escolha um modelo pronto: o sistema é criado já com todos os níveis e cordas, e você pode ajustar depois."
        schema={templateSchema}
        defaultValues={{ code: "", name: "" }}
        submitLabel="Criar sistema"
        className="sm:max-w-2xl"
        onSubmit={(values) => fromTemplate.mutateAsync({ code: values.code, name: values.name.trim() })}
      >
        {(form) => <TemplateFields form={form} />}
      </FormDialog>

      <FormDialog<LevelFormValues>
        open={levelFor !== null}
        onOpenChange={(open) => !open && setLevelFor(null)}
        title={levelFor ? `Novo nível em ${levelFor.name}` : "Novo nível"}
        schema={levelSchema}
        className="sm:max-w-2xl"
        defaultValues={levelDefaults(null, levelFor?.levels.length ?? 0)}
        onSubmit={(values) => createLevel.mutateAsync({ systemId: levelFor!.id, data: toLevelInput(values) })}
      >
        {(form) => <LevelFields form={form} />}
      </FormDialog>

      <FormDialog<SystemFormValues>
        open={editingSystem !== null}
        onOpenChange={(open) => !open && setEditingSystem(null)}
        title="Editar sistema de graduação"
        schema={systemSchema}
        defaultValues={{ name: editingSystem?.name ?? "", description: editingSystem?.description ?? "" }}
        onSubmit={(values) => updateSystem.mutateAsync({ id: editingSystem!.id, data: toSystemUpdate(values) })}
      >
        {(form) => <SystemFields form={form} />}
      </FormDialog>

      <FormDialog<LevelFormValues>
        open={editingLevel !== null}
        onOpenChange={(open) => !open && setEditingLevel(null)}
        title={editingLevel ? `Editar nível ${editingLevel.name}` : "Editar nível"}
        schema={levelSchema}
        className="sm:max-w-2xl"
        defaultValues={levelDefaults(editingLevel, 0)}
        onSubmit={(values) => updateLevel.mutateAsync({ id: editingLevel!.id, data: toLevelUpdate(values) })}
      >
        {(form) => <LevelFields form={form} />}
      </FormDialog>

      <ConfirmDialog
        open={removingSystem !== null}
        onOpenChange={(o) => !o && setRemovingSystem(null)}
        title="Remover sistema de graduação?"
        description={
          removingSystem
            ? `"${removingSystem.name}" e seus níveis serão apagados. Se algum aluno já foi graduado nele, o sistema apenas fica inativo e o histórico é preservado.`
            : undefined
        }
        confirmLabel="Remover"
        onConfirm={() => removeSystem.mutateAsync(removingSystem!.id)}
      />

      <ConfirmDialog
        open={removingLevel !== null}
        onOpenChange={(o) => !o && setRemovingLevel(null)}
        title="Remover nível?"
        description={
          removingLevel
            ? `O nível "${removingLevel.name}" será apagado. Níveis já concedidos a alunos não podem ser removidos.`
            : undefined
        }
        confirmLabel="Remover"
        onConfirm={() => removeLevel.mutateAsync(removingLevel!.id)}
      />
    </>
  );
}

function RegistrationFields({
  form,
  options,
}: {
  form: UseFormReturn<RegistrationFormValues>;
  options: LevelOption[];
}) {
  return (
      <>
        <FormField control={form.control} name="graduationLevelId" render={({ field }) => (
          <FormItem>
            <FormLabel>Nível alcançado</FormLabel>
            <FormControl>
              <LevelSelect aria-label="Nível alcançado" options={options} value={field.value} onChange={field.onChange} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )} />
        <FormField control={form.control} name="graduatedAt" render={({ field }) => (
          <FormItem><FormLabel>Data</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="notes" render={({ field }) => (
          <FormItem><FormLabel>Observação (opcional)</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
        )} />
      </>
  );
}

function AlunosTab() {
  const systemList = systems.useList();
  const [student, setStudent] = useState<StudentOption | null>(null);
  const selectedId = student?.id; // undefined = nenhum aluno
  const history = useStudentHistory(selectedId);
  const register = useRegisterGraduation(selectedId);
  const updateGraduation = useUpdateGraduation(selectedId);
  const removeGraduation = useRemoveGraduation(selectedId);
  const canEdit = useCan("graduations", "edit");
  const canCreate = useCan("graduations", "create"); // MONITOR/INSTRUTOR: só leitura (sem registrar graduação)
  const canDelete = useCan("graduations", "delete");
  const [registering, setRegistering] = useState(false);
  const [editing, setEditing] = useState<StudentGraduation | null>(null);
  const [removing, setRemoving] = useState<StudentGraduation | null>(null);

  const options = levelOptions(systemList.data);
  const systemName = (systemId: number) => systemList.data?.find((s) => s.id === systemId)?.name ?? "—";
  // Na edição, o nível atual segue selecionável mesmo que o sistema dele esteja inativo.
  const editOptions: LevelOption[] =
    editing && !options.some((o) => o.id === editing.graduationLevelId)
      ? [
          ...options,
          {
            id: editing.graduationLevelId,
            label: `${systemName(editing.graduationLevel.graduationSystemId)} — ${editing.graduationLevel.name}`,
            systemName: systemName(editing.graduationLevel.graduationSystemId),
            level: editing.graduationLevel,
          },
        ]
      : options;

  const columns: Column<StudentGraduation>[] = [
    {
      id: "level",
      header: "Nível",
      sortValue: (g) => g.graduationLevel.name,
      cell: (g) => (
        <span className="inline-flex items-center gap-2 font-medium">
          <RopeSwatch {...ropeOf(g.graduationLevel)} size="sm" orientation="horizontal" />
          {g.graduationLevel.name}
        </span>
      ),
    },
    {
      id: "system",
      header: "Sistema",
      sortValue: (g) => systemName(g.graduationLevel.graduationSystemId),
      cell: (g) => systemName(g.graduationLevel.graduationSystemId),
    },
    { id: "date", header: "Data", sortValue: (g) => g.graduatedAt, cell: (g) => fmt(dayOnly(g.graduatedAt), "dd/MM/yyyy") },
    { id: "notes", header: "Observação", cell: (g) => g.notes ?? "—" },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-card p-4">
        <div className="w-full max-w-sm">
          <StudentPicker value={selectedId ?? null} onChange={setStudent} />
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportRowsButton
            filename="graduacoes-aluno"
            disabled={!selectedId || !history.data || history.data.length === 0}
            build={() => ({
              headers: ["Aluno", "Nível", "Sistema", "Data", "Observação"],
              rows: (history.data ?? []).map((g) => [
                student?.name ?? "",
                g.graduationLevel.name,
                systemName(g.graduationLevel.graduationSystemId),
                fmt(dayOnly(g.graduatedAt), "dd/MM/yyyy"),
                g.notes ?? "",
              ]),
            })}
          />
          {canCreate && (
            <Button disabled={!selectedId} onClick={() => setRegistering(true)}>
              Registrar graduação
            </Button>
          )}
        </div>
      </div>

      {!selectedId ? (
        <div className="rounded-lg border border-dashed bg-card p-10 text-center text-sm text-muted-foreground">
          Selecione um aluno para ver o histórico e registrar uma graduação.
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={history.data}
          isLoading={history.isLoading}
          error={history.error}
          onRetry={() => void history.refetch()}
          getRowId={(g) => g.id}
          searchText={(g) => `${g.graduationLevel.name} ${systemName(g.graduationLevel.graduationSystemId)} ${g.notes ?? ""}`}
          searchPlaceholder="Buscar no histórico…"
          emptyMessage="Este aluno ainda não tem graduações registradas."
          rowActions={
            canEdit || canDelete
              ? (g) => (
                  <>
                    {canEdit && (
                      <Button variant="ghost" size="sm" onClick={() => setEditing(g)} aria-label={`Editar graduação ${g.graduationLevel.name}`}>
                        Editar
                      </Button>
                    )}
                    {canDelete && (
                      <Button variant="ghost" size="sm" onClick={() => setRemoving(g)} aria-label={`Remover graduação ${g.graduationLevel.name}`}>
                        Remover
                      </Button>
                    )}
                  </>
                )
              : undefined
          }
        />
      )}

      <FormDialog<RegistrationFormValues>
        open={registering}
        onOpenChange={setRegistering}
        title="Registrar graduação"
        description={student?.name ?? "Preencha os dados abaixo."}
        schema={registrationSchema}
        defaultValues={{ graduationLevelId: "", graduatedAt: "", notes: "" }}
        onSubmit={(values) => register.mutateAsync(toRegistrationInput(values))}
      >
        {(form) => <RegistrationFields form={form} options={options} />}
      </FormDialog>

      <FormDialog<RegistrationFormValues>
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title="Editar graduação"
        description={student?.name ?? "Corrija os dados abaixo."}
        schema={registrationSchema}
        defaultValues={{
          graduationLevelId: editing ? String(editing.graduationLevelId) : "",
          graduatedAt: editing ? editing.graduatedAt.slice(0, 10) : "",
          notes: editing?.notes ?? "",
        }}
        onSubmit={(values) => updateGraduation.mutateAsync({ id: editing!.id, data: toRegistrationUpdate(values) })}
      >
        {(form) => <RegistrationFields form={form} options={editOptions} />}
      </FormDialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Remover graduação?"
        description={
          removing
            ? `O registro de "${removing.graduationLevel.name}" (${fmt(dayOnly(removing.graduatedAt), "dd/MM/yyyy")}) será apagado do histórico do aluno. Use apenas para um lançamento feito por engano.`
            : undefined
        }
        confirmLabel="Remover"
        onConfirm={() => removeGraduation.mutateAsync(removing!.id)}
      />
    </>
  );
}
