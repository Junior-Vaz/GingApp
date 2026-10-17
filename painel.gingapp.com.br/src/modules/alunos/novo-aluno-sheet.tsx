import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDown } from "lucide-react";
import { CredentialsCard } from "@/components/painel/credentials-card";
import { ImageUploadField } from "@/components/painel/image-upload-field";
import { UnitPicker } from "@/components/painel/unit-picker";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { maskCpfInput } from "@/lib/cpf";
import { cn } from "@/lib/utils";
import {
  emptyStudentForm,
  isValidEmail,
  studentSchema,
  type CreateExtras,
  type StudentFormValues,
} from "./schema";
import { useActiveClasses } from "./turmas-ativas";

/** Credenciais mostradas após o cadastro com acesso criado (a senha só existe na resposta do servidor). */
export interface CreatedCredentials {
  studentName: string;
  phone: string | null;
  email: string;
  password: string;
}

/** Como o cadastro termina: "close" = "Cadastrar" (fecha); "new" = "Cadastrar e novo" (limpa e continua). */
export type CreateMode = "close" | "new";

export interface NovoAlunoHandle {
  /** Limpa nome/telefone/e-mail/nascimento/CPFs/foto, mantém turma(s), unidade e o interruptor, e foca o Nome. */
  resetForNext: () => void;
}

interface NovoAlunoSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Mensalidade/dia de vencimento só para quem tem finance:edit. */
  canEditFinance: boolean;
  /** Credenciais a mostrar no lugar do formulário (acesso CREATED); `null` = formulário. */
  created: CreatedCredentials | null;
  /** Envia o cadastro. Rejeitar = erro já notificado: o formulário continua aberto. */
  onSubmit: (values: StudentFormValues, extras: CreateExtras, mode: CreateMode) => Promise<void>;
  /** "Cadastrar outro" no cartão de credenciais: o pai descarta as credenciais. */
  onAnother: () => void;
  /** "Concluir" no cartão de credenciais: o pai fecha tudo. */
  onFinish: () => void;
  handleRef?: Ref<NovoAlunoHandle>;
}

/** Campos do bloco "Mais dados": erro em algum deles abre o bloco sozinho. */
const MORE_FIELDS = ["unitId", "document", "guardianDocument", "gingappCode", "photo", "monthlyFee", "dueDay"] as const;

/**
 * "Novo aluno" enxuto: nome, WhatsApp/telefone, e-mail, nascimento, turma(s) e o interruptor "Criar acesso ao app
 * agora" (ligado por padrão) num passo só; o que é raro fica em "Mais dados". Botões "Cadastrar" e "Cadastrar e novo".
 * Com acesso criado, mostra o cartão de credenciais antes de limpar.
 */
export function NovoAlunoSheet({
  open,
  onOpenChange,
  canEditFinance,
  created,
  onSubmit,
  onAnother,
  onFinish,
  handleRef,
}: NovoAlunoSheetProps) {
  const form = useForm<StudentFormValues>({ resolver: zodResolver(studentSchema), defaultValues: emptyStudentForm });
  const { isSubmitting, errors } = form.formState;
  const [wantAccess, setWantAccess] = useState(true);
  const [classIds, setClassIds] = useState<number[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const nameRef = useRef<HTMLInputElement | null>(null);
  const switchId = useId();
  const hintId = useId();
  const classesLabelId = useId();

  const classesQuery = useActiveClasses(open);
  const activeClasses = classesQuery.data?.items ?? [];

  const emailOk = isValidEmail(form.watch("email"));
  const accessOn = wantAccess && emailOk;

  // Reinicia tudo a cada abertura.
  useEffect(() => {
    if (!open) return;
    form.reset(emptyStudentForm);
    setWantAccess(true);
    setClassIds([]);
    setMoreOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- só reinicia ao abrir
  }, [open]);

  // Foco no Nome (ao abrir e depois de "Cadastrar e novo"/"Cadastrar outro").
  useEffect(() => {
    if (open && created === null) nameRef.current?.focus();
  }, [focusTick, open, created]);

  // Erro de validação num campo recolhido: abre "Mais dados" para a pessoa ver o que corrigir.
  const hiddenError = MORE_FIELDS.some((field) => errors[field] !== undefined);
  useEffect(() => {
    if (hiddenError) setMoreOpen(true);
  }, [hiddenError]);

  /** Limpa a pessoa e mantém o "lote": unidade, mensalidade/vencimento digitados, turma(s) e o interruptor. */
  function resetForNext() {
    form.reset({
      ...emptyStudentForm,
      unitId: form.getValues("unitId"),
      monthlyFee: form.getValues("monthlyFee") ?? "",
      dueDay: form.getValues("dueDay") ?? "",
    });
    setFocusTick((tick) => tick + 1);
  }
  useImperativeHandle(handleRef, () => ({ resetForNext }));

  const run = (mode: CreateMode) =>
    form.handleSubmit(async (values) => {
      try {
        await onSubmit(values, { createAccess: accessOn, classIds }, mode);
      } catch {
        // Erro já notificado pelo chamador (toast/diálogo de conflito); mantém aberto.
      }
    })();

  function toggleClass(id: number, checked: boolean) {
    setClassIds((current) => (checked ? [...current, id] : current.filter((c) => c !== id)));
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        className="overflow-y-auto sm:max-w-md max-sm:w-full max-sm:p-4"
        onOpenAutoFocus={(event) => {
          event.preventDefault(); // o foco vai para o Nome (ou para o cartão de credenciais), não para o "X"
          nameRef.current?.focus();
        }}
      >
        <SheetHeader>
          <SheetTitle>Novo aluno</SheetTitle>
          <SheetDescription>
            {created ? "Aluno cadastrado. Confira o acesso abaixo." : "Preencha o essencial: o resto pode ficar para depois."}
          </SheetDescription>
        </SheetHeader>

        <div className="pb-4 sm:px-4">
          {created ? (
            <div className="grid gap-4">
              <CredentialsCard
                title="Aluno cadastrado"
                name={created.studentName}
                email={created.email}
                password={created.password}
                phone={created.phone}
              >
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onAnother();
                    resetForNext();
                  }}
                >
                  Cadastrar outro
                </Button>
                <Button type="button" onClick={onFinish}>
                  Concluir
                </Button>
              </CredentialsCard>
            </div>
          ) : (
            <Form {...form}>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run("close");
                }}
                noValidate
                className="grid gap-4"
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nome</FormLabel>
                      <FormControl>
                        <Input
                          autoComplete="off"
                          placeholder="Nome completo"
                          {...field}
                          ref={(element) => {
                            field.ref(element);
                            nameRef.current = element;
                          }}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>WhatsApp / Telefone</FormLabel>
                      <FormControl>
                        <Input type="tel" inputMode="tel" autoComplete="off" placeholder="(11) 99999-9999" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>E-mail</FormLabel>
                      <FormControl>
                        <Input type="email" autoComplete="off" placeholder="aluno@email.com" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="birthDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Nascimento</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <div role="group" aria-labelledby={classesLabelId} className="grid gap-1.5">
                  <p id={classesLabelId} className="text-sm font-medium">
                    Turma(s) <span className="font-normal text-muted-foreground">(opcional)</span>
                  </p>
                  {classesQuery.isLoading ? (
                    <p className="text-xs text-muted-foreground">Carregando turmas…</p>
                  ) : classesQuery.error ? (
                    <p role="alert" className="text-xs text-destructive">
                      Não foi possível carregar as turmas. Você pode matricular o aluno depois.
                    </p>
                  ) : activeClasses.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhuma turma ativa cadastrada.</p>
                  ) : (
                    <ul className="max-h-44 divide-y overflow-y-auto rounded-md border" data-testid="novo-aluno-turmas">
                      {activeClasses.map((turma) => {
                        const id = `${classesLabelId}-${String(turma.id)}`;
                        return (
                          <li key={turma.id} className="flex min-h-11 items-center gap-3 px-3">
                            <Checkbox
                              id={id}
                              checked={classIds.includes(turma.id)}
                              onCheckedChange={(checked) => toggleClass(turma.id, checked === true)}
                            />
                            <Label htmlFor={id} className="flex min-h-11 flex-1 cursor-pointer items-center py-2 leading-snug">
                              {turma.name}
                              {turma.unit?.name ? (
                                <span className="ml-1 text-xs font-normal text-muted-foreground">· {turma.unit.name}</span>
                              ) : null}
                            </Label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div className="grid gap-1.5 rounded-lg border bg-muted/40 p-3">
                  <div className="flex min-h-11 items-center gap-3">
                    <Switch
                      id={switchId}
                      checked={accessOn}
                      disabled={!emailOk}
                      aria-describedby={hintId}
                      onCheckedChange={setWantAccess}
                    />
                    <Label htmlFor={switchId} className={cn("flex-1 cursor-pointer leading-snug", !emailOk && "opacity-70")}>
                      Criar acesso ao app agora (senha provisória automática)
                    </Label>
                  </div>
                  <p id={hintId} className="text-xs text-muted-foreground">
                    {emailOk
                      ? "O login é o e-mail acima. A senha provisória aparece depois do cadastro, para você copiar ou enviar por WhatsApp."
                      : "Informe um e-mail para criar o acesso."}
                  </p>
                </div>

                <Collapsible open={moreOpen} onOpenChange={setMoreOpen} className="grid gap-4">
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" className="group w-full justify-between border">
                      Mais dados
                      <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" aria-hidden />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="grid gap-4">
                    <FormField
                      control={form.control}
                      name="unitId"
                      render={({ field }) => (
                        <FormItem>
                          <UnitPicker
                            optional
                            value={field.value ? Number(field.value) : null}
                            onChange={(unit) => field.onChange(unit ? String(unit.id) : "")}
                          />
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="document"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>CPF</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="000.000.000-00"
                              autoComplete="off"
                              inputMode="numeric"
                              {...field}
                              onChange={(e) => field.onChange(maskCpfInput(e.target.value))}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="guardianDocument"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>CPF do responsável (para criança sem CPF)</FormLabel>
                          <FormControl>
                            <Input
                              placeholder="000.000.000-00"
                              autoComplete="off"
                              inputMode="numeric"
                              {...field}
                              value={field.value ?? ""}
                              onChange={(e) => field.onChange(maskCpfInput(e.target.value))}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="gingappCode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Código GingApp (se a pessoa já tem)</FormLabel>
                          <FormControl>
                            <Input placeholder="GING-XXXX-XXXX" autoComplete="off" {...field} value={field.value ?? ""} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <ImageUploadField<StudentFormValues>
                      name="photo"
                      label="Foto (URL)"
                      shape="square"
                      previewAlt="Foto do aluno"
                      description="Opcional. Envie uma foto (JPEG, PNG ou WebP até 5 MB) ou cole o link de uma imagem."
                    />
                    {canEditFinance && (
                      <div className="grid grid-cols-2 gap-3">
                        <FormField
                          control={form.control}
                          name="monthlyFee"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Mensalidade (R$)</FormLabel>
                              <FormControl>
                                <Input inputMode="decimal" placeholder="0,00" {...field} value={field.value ?? ""} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="dueDay"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>Dia do vencimento</FormLabel>
                              <FormControl>
                                <Input inputMode="numeric" placeholder="1 a 31" {...field} value={field.value ?? ""} />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </div>
                    )}
                  </CollapsibleContent>
                </Collapsible>

                <SheetFooter className="sticky bottom-0 -mx-4 flex-row justify-end gap-2 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] max-sm:[&>button]:flex-1">
                  <Button type="button" variant="outline" disabled={isSubmitting} onClick={() => void run("new")}>
                    Cadastrar e novo
                  </Button>
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting ? "Cadastrando…" : "Cadastrar"}
                  </Button>
                </SheetFooter>
              </form>
            </Form>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
