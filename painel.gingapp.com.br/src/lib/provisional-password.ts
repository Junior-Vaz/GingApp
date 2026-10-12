import { z } from "zod";
import { newPasswordRules } from "@/lib/password";

/**
 * Senha PROVISÓRIA definida pelo Mestre/Professor (acesso do aluno/responsável, redefinição de senha).
 * Mesma política da senha nova (SSOT em lib/password.ts, espelho de backend/src/shared/security/password-policy.ts),
 * sem a regra "diferente da atual" (não há senha atual aqui). O backend decide de fato (400).
 */
export function provisionalPasswordIssue(password: string): string | null {
  const failed = newPasswordRules(password, "").find((rule) => !rule.ok);
  return failed ? failed.error.replace("A nova senha", "A senha") : null;
}

export const PROVISIONAL_PASSWORD_HINT =
  "No mínimo 12 caracteres (máx. 72 bytes) e diferente da senha padrão de desenvolvimento. Peça à pessoa para trocá-la no primeiro acesso.";

/** Redefinir senha: senha provisória + confirmação. */
export const resetPasswordSchema = z
  .object({
    newPassword: z.string().min(1, "Informe a senha provisória."),
    confirmPassword: z.string().min(1, "Confirme a senha provisória."),
  })
  .superRefine((values, ctx) => {
    const issue = values.newPassword === "" ? null : provisionalPasswordIssue(values.newPassword);
    if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["newPassword"], message: issue });
    if (values.confirmPassword !== "" && values.confirmPassword !== values.newPassword) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmPassword"], message: "A confirmação não é igual à senha." });
    }
  });
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
export const emptyResetPasswordForm: ResetPasswordValues = { newPassword: "", confirmPassword: "" };

/**
 * Criar acesso (aluno/responsável): e-mail de login + senha provisória. A senha é opcional na tela porque
 * um e-mail que já é usuário do sistema só é VINCULADO (a senha dele não muda e a informada é ignorada);
 * para um e-mail novo o backend exige a senha (400).
 */
export const createAccountSchema = z
  .object({
    email: z
      .string()
      .trim()
      .min(1, "Informe o e-mail de acesso.")
      .refine((v) => z.string().email().safeParse(v).success, "E-mail inválido."),
    password: z.string(),
    confirmPassword: z.string(),
    /** Convite por e-mail: a pessoa define a própria senha pelo link; nenhuma senha provisória é pedida/enviada. */
    sendInvite: z.boolean().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.sendInvite) return;
    const issue = values.password === "" ? null : provisionalPasswordIssue(values.password);
    if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["password"], message: issue });
    if (values.confirmPassword !== values.password) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmPassword"], message: "A confirmação não é igual à senha." });
    }
  });
export type CreateAccountValues = z.infer<typeof createAccountSchema>;

export interface CreateAccountPayload {
  email: string;
  password?: string;
  sendInvite?: true;
}

export function createAccountPayload(values: CreateAccountValues): CreateAccountPayload {
  const email = values.email.trim();
  if (values.sendInvite) return { email, sendInvite: true };
  return values.password === "" ? { email } : { email, password: values.password };
}

export const INVITE_CHECKBOX_LABEL = "Enviar convite por e-mail (a pessoa define a própria senha)";
export const INVITE_HINT = "A pessoa receberá um e-mail com um link para criar a própria senha. Nenhuma senha provisória é necessária.";
export const INVITE_FAILED_MESSAGE =
  "Acesso criado, mas o e-mail não pôde ser enviado; use 'Esqueci minha senha' ou defina uma senha provisória.";
export const INVITE_SENT_MESSAGE = "Convite enviado por e-mail.";
