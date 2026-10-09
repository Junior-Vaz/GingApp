import { useState } from "react";
import { Plus } from "lucide-react";
import { DataTable, type Column } from "@/components/painel/data-table";
import { FormDialog } from "@/components/painel/form-dialog";
import { PageHeader } from "@/components/painel/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/api";
import { dayOnly, fmt } from "@/lib/format";
import { NativeSelect } from "@/modules/aulas/native-select";
import {
  levelOptions,
  systems,
  useCreateLevel,
  useRegisterGraduation,
  useStudentHistory,
  type GraduationSystem,
  type StudentGraduation,
  type StudentOption,
} from "./graduacoes-api";
import { StudentPicker } from "./student-picker";
import {
  levelSchema,
  registrationSchema,
  systemSchema,
  toLevelInput,
  toRegistrationInput,
  toSystemInput,
  type LevelFormValues,
  type RegistrationFormValues,
  type SystemFormValues,
} from "./graduacoes-forms";

function ColorDot({ color }: { color: string | null }) {
  if (!color) return null;
  return <span aria-hidden className="inline-block size-3 shrink-0 rounded-full border" style={{ backgroundColor: color }} />;
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
  const createLevel = useCreateLevel();
  const [newSystem, setNewSystem] = useState(false);
  const [levelFor, setLevelFor] = useState<GraduationSystem | null>(null);

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
          const levels = [...system.levels].sort((a, b) => a.order - b.order);
          return (
            <Card key={system.id}>
              <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
                <div className="min-w-0">
                  <CardTitle className="flex items-center gap-2 text-base">
                    {system.name}
                    {!system.isActive && <Badge variant="secondary">Inativo</Badge>}
                  </CardTitle>
                  {system.description && <CardDescription className="mt-1">{system.description}</CardDescription>}
                </div>
                <Button variant="outline" size="sm" onClick={() => setLevelFor(system)} aria-label={`Adicionar nível em ${system.name}`}>
                  <Plus /> Adicionar nível
                </Button>
              </CardHeader>
              <CardContent>
                {levels.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum nível cadastrado neste sistema ainda.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2" aria-label={`Níveis de ${system.name}`}>
                    {levels.map((level) => (
                      <li key={level.id} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium">
                        <ColorDot color={level.color} />
                        {level.order}. {level.name}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button onClick={() => setNewSystem(true)}>Novo sistema</Button>
      </div>
      {renderBody()}

      <FormDialog<SystemFormValues>
        open={newSystem}
        onOpenChange={setNewSystem}
        title="Novo sistema de graduação"
        schema={systemSchema}
        defaultValues={{ name: "", description: "" }}
        onSubmit={(values) => createSystem.mutateAsync(toSystemInput(values))}
      >
        {(form) => (
          <>
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Nome</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem><FormLabel>Descrição (opcional)</FormLabel><FormControl><Textarea rows={2} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
          </>
        )}
      </FormDialog>

      <FormDialog<LevelFormValues>
        open={levelFor !== null}
        onOpenChange={(open) => !open && setLevelFor(null)}
        title={levelFor ? `Novo nível em ${levelFor.name}` : "Novo nível"}
        schema={levelSchema}
        defaultValues={{ name: "", order: String(levelFor?.levels.length ?? 0), color: "" }}
        onSubmit={(values) => createLevel.mutateAsync({ systemId: levelFor!.id, data: toLevelInput(values) })}
      >
        {(form) => (
          <>
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem><FormLabel>Nome do nível</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="order" render={({ field }) => (
              <FormItem><FormLabel>Ordem</FormLabel><FormControl><Input type="number" min={0} {...field} /></FormControl><FormMessage /></FormItem>
            )} />
            <FormField control={form.control} name="color" render={({ field }) => (
              <FormItem>
                <FormLabel>Cor (opcional)</FormLabel>
                <div className="flex items-center gap-2">
                  <FormControl>
                    <Input
                      type="color"
                      aria-label="Cor do nível"
                      className="h-9 w-16 cursor-pointer p-1"
                      value={field.value || "#000000"}
                      onChange={(e) => field.onChange(e.target.value)}
                      onBlur={field.onBlur}
                      name={field.name}
                      ref={field.ref}
                    />
                  </FormControl>
                  <span className="text-xs text-muted-foreground">{field.value || "Sem cor"}</span>
                  {field.value && (
                    <Button type="button" variant="ghost" size="sm" onClick={() => field.onChange("")}>
                      Remover cor
                    </Button>
                  )}
                </div>
                <FormMessage />
              </FormItem>
            )} />
          </>
        )}
      </FormDialog>
    </>
  );
}

function AlunosTab() {
  const systemList = systems.useList();
  const [student, setStudent] = useState<StudentOption | undefined>();
  const selectedId = student?.id;
  const history = useStudentHistory(selectedId);
  const register = useRegisterGraduation(selectedId);
  const [registering, setRegistering] = useState(false);

  const options = levelOptions(systemList.data);
  const systemName = (systemId: number) => systemList.data?.find((s) => s.id === systemId)?.name ?? "—";

  const columns: Column<StudentGraduation>[] = [
    {
      id: "level",
      header: "Nível",
      sortValue: (g) => g.graduationLevel.name,
      cell: (g) => (
        <span className="inline-flex items-center gap-2 font-medium">
          <ColorDot color={g.graduationLevel.color} />
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
          <StudentPicker selected={student} onSelect={setStudent} />
        </div>
        <Button disabled={!selectedId} onClick={() => setRegistering(true)}>
          Registrar graduação
        </Button>
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
        {(form) => (
          <>
            <FormField control={form.control} name="graduationLevelId" render={({ field }) => (
              <FormItem>
                <FormLabel>Nível alcançado</FormLabel>
                <FormControl>
                  <NativeSelect {...field}>
                    <option value="">Selecione…</option>
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </NativeSelect>
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
        )}
      </FormDialog>
    </>
  );
}
