import { z } from "zod";
import { isImageRef } from "@/lib/uploads";
import { billingFieldsError } from "@/modules/financeiro/collection";

export type StudentStatus = "ACTIVE" | "INACTIVE" | "SUSPENDED" | "FORMER";

export interface Student {
  id: number;
  unitId: number | null;
  /** Login do aluno (User), quando já tem acesso ao aplicativo. */
  userId?: number | null;
  name: string;
  birthDate: string | null;
  document: string | null;
  phone: string | null;
  email: string | null;
  /** Foto: caminho `/api/uploads/<arquivo>` (envio pelo painel/app) ou URL http(s). */
  photo?: string | null;
  status: StudentStatus;
  joinedAt: string | null;
  /** Opcionais (exibidos no card quando o servidor os envia): turmas ativas e corda/graduação atual. */
  classNames?: string[] | undefined;
  currentCord?: string | null | undefined;
}

/**
 * Corpo aceito por POST /students e PATCH /students/:id (CreateStudentDto / UpdateStudentDto).
 * No PATCH, ausente (`undefined`) = não mexe e `null` = LIMPA a coluna; só `name` e `status`
 * (obrigatórias) não aceitam `null`. `photo` = caminho de /uploads ou URL http(s).
 */
export interface StudentInput {
  name: string;
  unitId?: number | null | undefined;
  birthDate?: string | null | undefined;
  document?: string | null | undefined;
  phone?: string | null | undefined;
  email?: string | null | undefined;
  photo?: string | null | undefined;
  status?: StudentStatus | undefined;
}

export const STUDENT_STATUS_LABEL: Record<StudentStatus, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  SUSPENDED: "Suspenso",
  FORMER: "Ex-aluno",
};

export const studentSchema = z
  .object({
    name: z.string().trim().min(2, "Informe o nome do aluno (mínimo 2 letras)."),
    unitId: z.string(),
    birthDate: z.string(),
    document: z.string(),
    phone: z.string(),
    email: z
      .string()
      .trim()
      .refine((v) => v === "" || z.string().email().safeParse(v).success, "E-mail inválido."),
    status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "FORMER"]),
    photo: z
      .string()
      .trim()
      .refine((v) => v === "" || isImageRef(v), "Informe uma URL válida (http/https) ou envie uma imagem.")
      .optional(),
    /** Cobrança mensal (E07; só quem tem finance:edit vê os campos): valor em reais e dia 1..31, juntos ou ambos vazios. */
    monthlyFee: z.string().optional(),
    dueDay: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const error = billingFieldsError({ monthlyFee: value.monthlyFee ?? "", dueDay: value.dueDay ?? "" });
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [error.field], message: error.message });
  });
export type StudentFormValues = z.infer<typeof studentSchema>;

export const emptyStudentForm: StudentFormValues = {
  name: "",
  unitId: "",
  birthDate: "",
  document: "",
  phone: "",
  email: "",
  status: "ACTIVE",
  photo: "",
  monthlyFee: "",
  dueDay: "",
};

export function studentToForm(student: Student): StudentFormValues {
  return {
    name: student.name,
    unitId: student.unitId ? String(student.unitId) : "",
    birthDate: student.birthDate ? student.birthDate.slice(0, 10) : "",
    document: student.document ?? "",
    phone: student.phone ?? "",
    email: student.email ?? "",
    status: student.status,
    photo: student.photo ?? "",
  };
}

/** CRIAR (POST): campos vazios são omitidos. Para editar use `studentToUpdatePayload`. */
export function studentToPayload(values: StudentFormValues): StudentInput {
  return {
    name: values.name.trim(),
    unitId: values.unitId ? Number(values.unitId) : undefined,
    birthDate: values.birthDate || undefined,
    document: values.document.trim() || undefined,
    phone: values.phone.trim() || undefined,
    email: values.email.trim() || undefined,
    photo: (values.photo ?? "").trim() || undefined,
    status: values.status,
  };
}

/**
 * EDITAR (PATCH): campos opcionais que o usuário esvaziou vão como `null` (o backend limpa a
 * coluna). `name` e `status` são obrigatórios e nunca vão `null`.
 */
export function studentToUpdatePayload(values: StudentFormValues): StudentInput {
  return {
    name: values.name.trim(),
    unitId: values.unitId ? Number(values.unitId) : null,
    birthDate: values.birthDate || null,
    document: values.document.trim() || null,
    phone: values.phone.trim() || null,
    email: values.email.trim() || null,
    photo: (values.photo ?? "").trim() || null,
    status: values.status,
  };
}

/** Menor de 18 anos pela data de nascimento (só informativo; os responsáveis são geridos em "Responsáveis"). */
export function isMinor(birthDate: string | null, today: Date = new Date()): boolean {
  if (!birthDate) return false;
  const [y, m, d] = birthDate.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return false;
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age -= 1;
  return age < 18;
}
