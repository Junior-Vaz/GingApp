import { PasswordInput } from "@/components/painel/password-input";
import { FormDialog } from "@/components/painel/form-dialog";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  PROVISIONAL_PASSWORD_HINT,
  createAccountPayload,
  createAccountSchema,
  emptyResetPasswordForm,
  resetPasswordSchema,
  type CreateAccountValues,
  type ResetPasswordValues,
} from "@/lib/provisional-password";

interface BaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | undefined;
}

/** Redefinir senha de outra pessoa: senha provisória + confirmação (as sessões dela são encerradas). */
export function ResetPasswordDialog({
  onSubmit,
  ...base
}: BaseProps & { onSubmit: (newPassword: string) => Promise<unknown> }) {
  return (
    <FormDialog<ResetPasswordValues>
      {...base}
      schema={resetPasswordSchema}
      defaultValues={emptyResetPasswordForm}
      submitLabel="Redefinir senha"
      onSubmit={(values) => onSubmit(values.newPassword)}
    >
      {(form) => (
        <>
          <FormField
            control={form.control}
            name="newPassword"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Senha provisória</FormLabel>
                <FormControl>
                  <PasswordInput autoComplete="new-password" toggleLabel="senha provisória" {...field} />
                </FormControl>
                <FormDescription>{PROVISIONAL_PASSWORD_HINT}</FormDescription>
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
                  <PasswordInput autoComplete="new-password" toggleLabel="confirmação da senha provisória" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      )}
    </FormDialog>
  );
}

/** Criar o acesso (login) de um aluno/responsável: e-mail + senha provisória (opcional ao vincular um e-mail já cadastrado). */
export function CreateAccountDialog({
  defaultEmail,
  onSubmit,
  ...base
}: BaseProps & {
  defaultEmail: string;
  onSubmit: (payload: { email: string; password?: string }) => Promise<unknown>;
}) {
  return (
    <FormDialog<CreateAccountValues>
      {...base}
      schema={createAccountSchema}
      defaultValues={{ email: defaultEmail, password: "", confirmPassword: "" }}
      submitLabel="Criar acesso"
      onSubmit={(values) => onSubmit(createAccountPayload(values))}
    >
      {(form) => (
        <>
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem>
                <FormLabel>E-mail de acesso</FormLabel>
                <FormControl>
                  <Input type="email" autoComplete="off" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
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
                  {PROVISIONAL_PASSWORD_HINT} Se o e-mail já tiver cadastro no sistema, o acesso é apenas vinculado e a
                  senha dele não muda.
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
                  <PasswordInput autoComplete="new-password" toggleLabel="confirmação da senha provisória" {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      )}
    </FormDialog>
  );
}
