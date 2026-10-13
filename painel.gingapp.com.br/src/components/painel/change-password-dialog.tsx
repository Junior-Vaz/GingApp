import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Check, Circle, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { FormDialog } from "@/components/painel/form-dialog";
import { PasswordInput } from "@/components/painel/password-input";
import { Button } from "@/components/ui/button";
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import {
  CHANGE_PASSWORD_SUCCESS,
  changePassword,
  changePasswordErrorMessage,
  changePasswordSchema,
  emptyChangePasswordForm,
  newPasswordRules,
  type ChangePasswordValues,
} from "@/lib/password";

/** Requisitos da senha nova, marcados conforme o que já foi digitado. */
function Requirements({ newPassword, currentPassword }: { newPassword: string; currentPassword: string }) {
  return (
    <ul className="grid gap-1 text-xs" aria-label="Requisitos da nova senha" data-testid="password-requirements">
      {newPasswordRules(newPassword, currentPassword).map((rule) => (
        <li
          key={rule.id}
          data-ok={rule.ok}
          className={rule.ok ? "flex items-center gap-1.5 text-foreground" : "flex items-center gap-1.5 text-muted-foreground"}
        >
          {rule.ok ? <Check className="size-3.5 text-primary" aria-hidden /> : <Circle className="size-3.5" aria-hidden />}
          {rule.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Diálogo "Alterar senha" (POST /auth/change-password). No sucesso o token novo já foi gravado por
 * `changePassword` (sem deslogar). Erros do servidor (senha atual incorreta etc.) viram toast e o
 * diálogo continua aberto; o formulário é recriado a cada fechamento (nenhuma senha fica em memória).
 */
export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [generation, setGeneration] = useState(0);
  const mutation = useMutation({
    mutationFn: (values: ChangePasswordValues) => changePassword(values.currentPassword, values.newPassword),
    onSuccess: () => toast.success(CHANGE_PASSWORD_SUCCESS),
    onError: (error) => toast.error(changePasswordErrorMessage(error)),
  });

  function handleOpenChange(next: boolean) {
    onOpenChange(next);
    if (!next) setGeneration((value) => value + 1);
  }

  return (
    <FormDialog<ChangePasswordValues>
      key={generation}
      open={open}
      onOpenChange={handleOpenChange}
      title="Alterar senha"
      description="Você continua conectado neste aparelho; as demais sessões abertas serão encerradas."
      schema={changePasswordSchema}
      defaultValues={emptyChangePasswordForm}
      submitLabel="Alterar senha"
      onSubmit={(values) => mutation.mutateAsync(values)}
    >
      {(form) => (
        <>
          <FormField
            control={form.control}
            name="currentPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Senha atual</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="current-password" toggleLabel="senha atual" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="newPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Nova senha</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="new-password" toggleLabel="nova senha" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Confirmar nova senha</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="new-password" toggleLabel="confirmação da nova senha" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Requirements newPassword={form.watch("newPassword")} currentPassword={form.watch("currentPassword")} />
        </>
      )}
    </FormDialog>
  );
}

/** Botão do topo/rodapé que abre o diálogo de troca de senha. */
export function ChangePasswordButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label="Alterar senha">
        <KeyRound />
        <span className="hidden lg:inline">Alterar senha</span>
      </Button>
      <ChangePasswordDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
