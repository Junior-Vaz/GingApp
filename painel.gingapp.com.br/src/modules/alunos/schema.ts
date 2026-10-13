import { z } from "zod";
import { isValidCpf, onlyDigits } from "@/lib/cpf";
import type { RopeStyle } from "@/lib/rope";
import type { StaffRole } from "@/lib/staff-roles";
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
  /** Cargos ativos da equipe (todo mundo é aluno; os cargos se somam), do maior para o menor. */
  staffRoles?: StaffRole[] | undefined;
  /** Ficha única da pessoa (id e código GingApp), quando o servidor envia. */
  person?: { id: number; gingappCode: string } | null | undefined;
  /** Opcionais (exibidos no card quando o servidor os envia): turmas ativas e corda/graduação atual. */
  classNames?: string[] | undefined;
  currentCord?: string | null | undefined;
  /** Corda atual completa (estilo + cores) para desenhar a corda; opcional. */
  currentLevel?: { name: string; style?: RopeStyle | undefined; colors?: string[] | undefined; color?: string | null | undefined } | null | undefined;
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
  /** Só no cadastro (POST): CPF do responsável, para criança sem CPF (exige `birthDate`). */
  guardianDocument?: string | undefined;
  /** Só no cadastro (POST): código GingApp da pessoa, quando ela já tem ficha (ex.: `GING-7K3Q-9XPM`). */
  gingappCode?: string | undefined;
  /** Só no cadastro (POST): confirma que NÃO é a mesma pessoa de um possível duplicado. */
  confirmNew?: boolean | undefined;
}

export const STUDENT_STATUS_LABEL: Record<StudentStatus, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
  SUSPENDED: "Suspenso",
  FORMER: "Ex-aluno",
};

/** O documento do formulário é o mesmo que o aluno já tinha (ignorando a máscara de CPF)? */
export function isDocumentUnchanged(value: string, originalDocument: string | null | undefined): boolean {
  const original = (originalDocument ?? "").trim();
  const current = value.trim();
  if (original === "") return false;
  return current === original || (onlyDigits(original).length === 11 && onlyDigits(current) === onlyDigits(original));
}

/**
 * Schema do formulário de aluno. `originalDocument` só vai na EDIÇÃO: se o documento atual do aluno (legado, pode não
 * ser um CPF válido) não foi alterado, o campo não bloqueia o salvamento; se foi alterado, tem de ser um CPF válido.
 * No cadastro (sem `originalDocument`) o CPF, quando preenchido, é sempre validado pelos dígitos verificadores.
 */
export function makeStudentSchema(originalDocument?: string | null) {
  const documentUnchanged = (value: string): boolean => isDocumentUnchanged(value, originalDocument);

  return z
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
    /** Só no cadastro: CPF do responsável (criança sem CPF) e código GingApp da pessoa. */
    guardianDocument: z.string().optional(),
    gingappCode: z.string().optional(),
  })
  .superRefine((value, ctx) => {
    const error = billingFieldsError({ monthlyFee: value.monthlyFee ?? "", dueDay: value.dueDay ?? "" });
    if (error) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [error.field], message: error.message });
    const document = value.document.trim();
    if (document !== "" && !documentUnchanged(document) && !isValidCpf(document)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["document"], message: CPF_INVALID_MESSAGE });
    }
    const guardian = (value.guardianDocument ?? "").trim();
    if (guardian !== "") {
      if (!isValidCpf(guardian)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["guardianDocument"], message: CPF_INVALID_MESSAGE });
      } else if (value.birthDate.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["birthDate"],
          message: "Informe a data de nascimento para usar o CPF do responsável.",
        });
      }
    }
  });
}

export const CPF_INVALID_MESSAGE = "CPF inválido. Confira os números.";

/** Schema estrito (cadastro): CPF preenchido sempre validado. A edição usa `makeStudentSchema(documentoAtual)`. */
export const studentSchema = makeStudentSchema();
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
  guardianDocument: "",
  gingappCode: "",
};

export function studentToForm(student: Student): StudentFormValues {
  return {
    name: student.name,
    unitId: student.unitId ? String(student.unitId) : "",
    birthDate: student.birthDate ? student.birthDate.slice(0, 10) : "",
    // O servidor devolve o CPF MASCARADO (***.***.***-25): o formulário de edição começa SEMPRE vazio neste campo e só
    // envia `document` no PATCH se o usuário digitar um CPF novo (o valor mascarado é mostrado à parte, somente leitura).
    document: "",
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
    guardianDocument: (values.guardianDocument ?? "").trim() || undefined,
    gingappCode: (values.gingappCode ?? "").trim().toUpperCase() || undefined,
  };
}

/**
 * EDITAR (PATCH): campos opcionais que o usuário esvaziou vão como `null` (o backend limpa a
 * coluna). `name` e `status` são obrigatórios e nunca vão `null`.
 *
 * `document` é a exceção: o servidor devolve o CPF mascarado, então a chave só vai no corpo se o usuário digitou um CPF
 * novo. Campo vazio, ou igual ao valor atual (mascarado), NÃO envia `document` (nunca reenvia o mascarado).
 */
export function studentToUpdatePayload(values: StudentFormValues, originalDocument?: string | null): StudentInput {
  const typedDocument = values.document.trim();
  const documentChanged = typedDocument !== "" && !isDocumentUnchanged(values.document, originalDocument);
  return {
    name: values.name.trim(),
    unitId: values.unitId ? Number(values.unitId) : null,
    birthDate: values.birthDate || null,
    ...(documentChanged ? { document: typedDocument } : {}),
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
