import { useState } from "react";
import { KeyRound, Pencil, Plus, Trash2, UserPlus } from "lucide-react";
import { CreateAccountDialog, ResetPasswordDialog } from "@/components/painel/account-dialogs";
import { ConfirmDialog } from "@/components/painel/confirm-dialog";
import { FormDialog } from "@/components/painel/form-dialog";
import { PasswordInput } from "@/components/painel/password-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/api";
import { useAuthCapabilities } from "@/lib/password-reset";
import { INVITE_CHECKBOX_LABEL, INVITE_HINT, PROVISIONAL_PASSWORD_HINT } from "@/lib/provisional-password";
import { useGuardians, useStudentAccessMutations, type Guardian } from "./acesso-api";
import {
  emptyGuardianForm,
  guardianSchema,
  guardianToForm,
  guardianToPayload,
  guardianToUpdatePayload,
  type GuardianFormValues,
} from "./responsaveis";
import type { Student } from "./schema";

/**
 * "Responsáveis" do aluno: listar, adicionar, editar e remover, criar o acesso (login RESPONSAVEL) e redefinir
 * a senha do responsável. O consentimento do perfil público aparece só para leitura - quem o concede é o
 * próprio responsável, no Passaporte do aplicativo.
 */
export function ResponsaveisDialog({ student, onClose }: { student: Student | null; onClose: () => void }) {
  const query = useGuardians(student?.id ?? null);
  const mutations = useStudentAccessMutations(student?.id ?? 0);
  const [editing, setEditing] = useState<Guardian | "new" | null>(null);
  const [removing, setRemoving] = useState<Guardian | null>(null);
  const [accessFor, setAccessFor] = useState<Guardian | null>(null);
  const [resetFor, setResetFor] = useState<Guardian | null>(null);

  const isNew = editing === "new";
  // E-mail ligado no servidor: habilita o convite por e-mail (consulta só ao abrir o formulário de novo responsável).
  const { passwordResetByEmail } = useAuthCapabilities(isNew);
  const guardians = query.data ?? [];

  return (
    <>
      <Dialog open={student !== null} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Responsáveis</DialogTitle>
            <DialogDescription>
              {student ? `Responsáveis legais de ${student.name}.` : "Responsáveis legais do aluno."}
            </DialogDescription>
          </DialogHeader>

          {query.isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}
          {query.error && (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(query.error, "Não foi possível carregar os responsáveis.")}
            </p>
          )}
          {query.data && guardians.length === 0 && (
            <p className="text-sm text-muted-foreground" data-testid="sem-responsaveis">
              Nenhum responsável cadastrado para este aluno.
            </p>
          )}

          <ul className="grid gap-3">
            {guardians.map((g) => (
              <li key={g.id} className="grid gap-2 rounded-md border p-3" data-testid={`responsavel-${g.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{g.name}</span>
                  {g.relationship && <Badge variant="outline">{g.relationship}</Badge>}
                  <Badge variant={g.hasAccount ? "default" : "secondary"}>
                    {g.hasAccount ? "Com acesso" : "Sem acesso"}
                  </Badge>
                  {g.account?.mustChangePassword && <Badge variant="outline">Troca de senha pendente</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">
                  {[g.phone, g.email].filter(Boolean).join(" · ") || "Sem contato informado."}
                </p>
                {g.account && <p className="text-sm text-muted-foreground">E-mail de acesso: {g.account.email}</p>}
                <p className="text-xs text-muted-foreground">
                  Consentimento do perfil público: {g.consentPublicProfile ? "concedido" : "não concedido"} (dado pelo
                  próprio responsável no aplicativo).
                </p>
                <div className="flex flex-wrap gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(g)} aria-label={`Editar ${g.name}`}>
                    <Pencil /> Editar
                  </Button>
                  {g.hasAccount ? (
                    <Button variant="ghost" size="sm" onClick={() => setResetFor(g)} aria-label={`Redefinir senha de ${g.name}`}>
                      <KeyRound /> Redefinir senha
                    </Button>
                  ) : (
                    <Button variant="ghost" size="sm" onClick={() => setAccessFor(g)} aria-label={`Criar acesso de ${g.name}`}>
                      <UserPlus /> Criar acesso
                    </Button>
                  )}
                  <Button variant="ghost" size="sm" onClick={() => setRemoving(g)} aria-label={`Remover ${g.name}`}>
                    <Trash2 /> Remover
                  </Button>
                </div>
              </li>
            ))}
          </ul>

          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Fechar
            </Button>
            <Button onClick={() => setEditing("new")}>
              <Plus /> Adicionar responsável
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <FormDialog<GuardianFormValues>
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        title={isNew ? "Novo responsável" : "Editar responsável"}
        schema={guardianSchema}
        defaultValues={editing && editing !== "new" ? guardianToForm(editing) : emptyGuardianForm}
        onSubmit={(values) =>
          editing && editing !== "new"
            ? mutations.updateGuardian.mutateAsync({ id: editing.id, data: guardianToUpdatePayload(values) })
            : mutations.createGuardian.mutateAsync(guardianToPayload(values))
        }
      >
        {(form) => (
          <>
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome</FormLabel>
                  <FormControl>
                    <Input {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="relationship"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Parentesco</FormLabel>
                  <FormControl>
                    <Input placeholder="Mãe, pai, avó…" {...field} />
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
                  <FormLabel>Telefone</FormLabel>
                  <FormControl>
                    <Input type="tel" {...field} />
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
                    <Input type="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {isNew && (
              <>
                <FormField
                  control={form.control}
                  name="createAccount"
                  render={({ field }) => (
                    <FormItem className="flex items-center gap-2 space-y-0">
                      <FormControl>
                        <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
                      </FormControl>
                      <FormLabel className="cursor-pointer">Criar acesso ao aplicativo para este responsável</FormLabel>
                    </FormItem>
                  )}
                />
                {form.watch("createAccount") && passwordResetByEmail && (
                  <FormField
                    control={form.control}
                    name="sendInvite"
                    render={({ field }) => (
                      <FormItem>
                        <div className="flex items-center gap-2">
                          <FormControl>
                            <Checkbox checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
                          </FormControl>
                          <FormLabel className="cursor-pointer">{INVITE_CHECKBOX_LABEL}</FormLabel>
                        </div>
                        {field.value && <FormDescription>{INVITE_HINT}</FormDescription>}
                      </FormItem>
                    )}
                  />
                )}
                {form.watch("createAccount") && !(passwordResetByEmail && form.watch("sendInvite")) && (
                  <>
                    <FormField
                      control={form.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Senha provisória</FormLabel>
                          <FormControl>
                            <PasswordInput autoComplete="new-password" toggleLabel="senha provisória" {...field} />
                          </FormControl>
                          <FormDescription>
                            {PROVISIONAL_PASSWORD_HINT} Se o e-mail já tiver cadastro no sistema, o acesso é apenas
                            vinculado e a senha dele não muda.
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="confirmPassword"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Confirmar senha provisória</FormLabel>
                          <FormControl>
                            <PasswordInput
                              autoComplete="new-password"
                              toggleLabel="confirmação da senha provisória"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}
              </>
            )}
          </>
        )}
      </FormDialog>

      <CreateAccountDialog
        open={accessFor !== null}
        onOpenChange={(open) => !open && setAccessFor(null)}
        title="Criar acesso do responsável"
        description={accessFor ? `Defina o e-mail e a senha provisória de ${accessFor.name}.` : undefined}
        defaultEmail={accessFor?.email ?? ""}
        onSubmit={(payload) => mutations.createGuardianAccount.mutateAsync({ id: accessFor!.id, ...payload })}
      />
      <ResetPasswordDialog
        open={resetFor !== null}
        onOpenChange={(open) => !open && setResetFor(null)}
        title="Redefinir senha do responsável"
        description="As sessões abertas dele serão encerradas e ele deverá trocar a senha no próximo acesso."
        onSubmit={(newPassword) => mutations.resetGuardianPassword.mutateAsync({ id: resetFor!.id, newPassword })}
      />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Remover responsável?"
        description={
          removing
            ? `"${removing.name}" deixará de ser responsável deste aluno. Se ele tiver autorizado o perfil público, o perfil será despublicado.`
            : undefined
        }
        confirmLabel="Remover"
        onConfirm={() => mutations.removeGuardian.mutateAsync(removing!.id)}
      />
    </>
  );
}
