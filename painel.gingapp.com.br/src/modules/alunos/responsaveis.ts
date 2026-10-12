import { z } from "zod";
import { provisionalPasswordIssue } from "@/lib/provisional-password";
import type { Guardian, GuardianInput, GuardianUpdate } from "./acesso-api";

/**
 * Formulário de responsável. `consentPublicProfile` NÃO existe aqui de propósito: o consentimento do perfil
 * público só é dado pelo próprio responsável, no fluxo do Passaporte do aplicativo (o backend recusa o campo).
 */
export const guardianSchema = z
  .object({
    name: z.string().trim().min(2, "Informe o nome do responsável (mínimo 2 letras)."),
    relationship: z.string(),
    phone: z.string(),
    email: z
      .string()
      .trim()
      .refine((v) => v === "" || z.string().email().safeParse(v).success, "E-mail inválido."),
    createAccount: z.boolean(),
    /** Convite por e-mail (só com createAccount): a pessoa define a própria senha; nenhuma senha provisória. */
    sendInvite: z.boolean(),
    password: z.string(),
    confirmPassword: z.string(),
  })
  .superRefine((values, ctx) => {
    if (!values.createAccount) return;
    if (values.email.trim() === "") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["email"], message: "Informe o e-mail para criar o acesso." });
    }
    if (values.sendInvite) return;
    const issue = values.password === "" ? null : provisionalPasswordIssue(values.password);
    if (issue) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["password"], message: issue });
    if (values.confirmPassword !== values.password) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmPassword"], message: "A confirmação não é igual à senha." });
    }
  });
export type GuardianFormValues = z.infer<typeof guardianSchema>;

export const emptyGuardianForm: GuardianFormValues = {
  name: "",
  relationship: "",
  phone: "",
  email: "",
  createAccount: false,
  sendInvite: false,
  password: "",
  confirmPassword: "",
};

export function guardianToForm(guardian: Guardian): GuardianFormValues {
  return {
    ...emptyGuardianForm,
    name: guardian.name,
    relationship: guardian.relationship ?? "",
    phone: guardian.phone ?? "",
    email: guardian.email ?? "",
  };
}

/** CRIAR (POST): campos vazios são omitidos; senha só vai junto com createAccount (e NÃO com convite por e-mail). */
export function guardianToPayload(values: GuardianFormValues): GuardianInput {
  return {
    name: values.name.trim(),
    relationship: values.relationship.trim() || undefined,
    phone: values.phone.trim() || undefined,
    email: values.email.trim() || undefined,
    createAccount: values.createAccount ? true : undefined,
    password: values.createAccount && !values.sendInvite && values.password !== "" ? values.password : undefined,
    sendInvite: values.createAccount && values.sendInvite ? true : undefined,
  };
}

/** EDITAR (PATCH): campos opcionais esvaziados vão como `null` (o backend limpa a coluna). */
export function guardianToUpdatePayload(values: GuardianFormValues): GuardianUpdate {
  return {
    name: values.name.trim(),
    relationship: values.relationship.trim() || null,
    phone: values.phone.trim() || null,
    email: values.email.trim() || null,
  };
}
