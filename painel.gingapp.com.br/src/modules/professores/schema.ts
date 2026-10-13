import { z } from "zod";
import type { RopeStyle } from "@/lib/rope";
import { STAFF_ROLE_LABEL, type RoleBadgeData, type StaffRole } from "@/lib/staff-roles";
import { isImageRef } from "@/lib/uploads";
import type { Unit } from "@/modules/unidades/units";

/** Perfil de acesso da membership (Mestre, Professor, Instrutor ou Monitor): o do cargo de MAIOR rank da pessoa. */
export type TeacherRole = StaffRole;

/** Matrícula de aluno da pessoa da equipe (todo mundo é aluno): situação e corda atual. */
export interface TeacherStudent {
  id: number;
  status: string;
  level: { id: number; name: string; order: number; color?: string | null; style?: RopeStyle | null; colors?: string[] | null; tipStart?: string | null; tipEnd?: string | null } | null;
}

/** Item de GET /teachers: é a membership (OrganizationUser); `id` é o da membership, não do User. */
export interface Teacher {
  id: number;
  /** Papel de acesso = o perfil de acesso do cargo de maior rank. */
  role: TeacherRole;
  /** Selos de todos os cargos ativos, do maior rank para o menor. */
  roles?: RoleBadgeData[];
  /** Chaves (slugs) dos cargos ativos. */
  roleKeys?: string[];
  /** Matrícula de aluno da pessoa e a corda atual; `null` quando não há matrícula. */
  student?: TeacherStudent | null;
  status: string;
  createdAt?: string;
  /** Unidades de atuação (E08): vazio = sem restrição (vê todas). Só vem em GET /teachers e /teachers/:id. */
  unitIds?: number[];
  user: {
    id: number;
    name: string;
    email: string;
    phone: string | null;
    photo?: string | null;
    /** 2FA ativo na conta (só a flag): habilita "Redefinir 2FA" para o Mestre. */
    twoFactorEnabled?: boolean;
  };
}

/** POST /teachers exige email, password e role; PATCH /teachers/:id aceita name, phone, role e status (não o e-mail). */
export interface TeacherInput {
  name?: string | undefined;
  email?: string | undefined;
  password?: string | undefined;
  /** No PATCH, `null` LIMPA o telefone. name/role/status nunca vão `null` (400). */
  phone?: string | null | undefined;
  role?: TeacherRole | undefined;
  status?: "ACTIVE" | "INACTIVE" | undefined;
  /** Foto do professor (User.photo): URL de upload / http(s); no PATCH, `null` remove. */
  photo?: string | null | undefined;
}

export const TEACHER_ROLE_LABEL: Record<TeacherRole, string> = STAFF_ROLE_LABEL;

/** Selos dos cargos do membro para exibir (`roles` do servidor, maior rank primeiro). */
export const teacherRoles = (t: Pick<Teacher, "roles">): RoleBadgeData[] => t.roles ?? [];

export const TEACHER_STATUS_LABEL: Record<string, string> = {
  ACTIVE: "Ativo",
  INACTIVE: "Inativo",
};

/** Cadastro exige e-mail e senha (mín. 6); na edição esses campos não existem. */
export const createTeacherSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome (mínimo 2 letras)."),
  email: z.string().trim().email("Informe um e-mail válido."),
  password: z.string().min(6, "A senha inicial precisa ter pelo menos 6 caracteres."),
  phone: z.string(),
  photo: z
    .string()
    .trim()
    .refine((v) => v === "" || isImageRef(v), "Informe uma URL válida (http/https) ou envie uma imagem.")
    .optional(),
  role: z.enum(["MESTRE", "PROFESSOR", "INSTRUTOR", "MONITOR"]),
  status: z.enum(["ACTIVE", "INACTIVE"]),
});

export const editTeacherSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome (mínimo 2 letras)."),
  email: z.string(),
  password: z.string(),
  phone: z.string(),
  photo: z
    .string()
    .trim()
    .refine((v) => v === "" || isImageRef(v), "Informe uma URL válida (http/https) ou envie uma imagem.")
    .optional(),
  role: z.enum(["MESTRE", "PROFESSOR", "INSTRUTOR", "MONITOR"]),
  status: z.enum(["ACTIVE", "INACTIVE"]),
});
export type TeacherFormValues = z.infer<typeof createTeacherSchema>;

export const emptyTeacherForm: TeacherFormValues = {
  name: "",
  email: "",
  password: "",
  phone: "",
  photo: "",
  role: "PROFESSOR",
  status: "ACTIVE",
};

export function teacherToForm(teacher: Teacher): TeacherFormValues {
  return {
    name: teacher.user.name,
    email: teacher.user.email,
    password: "",
    phone: teacher.user.phone ?? "",
    photo: teacher.user.photo ?? "",
    role: teacher.role,
    status: teacher.status === "INACTIVE" ? "INACTIVE" : "ACTIVE",
  };
}

export function createPayload(values: TeacherFormValues): TeacherInput {
  return {
    name: values.name.trim(),
    email: values.email.trim(),
    password: values.password,
    phone: values.phone.trim() || undefined,
    photo: values.photo?.trim() || undefined,
    role: values.role,
  };
}

/** EDITAR (PATCH): telefone esvaziado vai como `null` (o backend limpa a coluna). */
export function editPayload(values: TeacherFormValues): TeacherInput {
  return {
    name: values.name.trim(),
    phone: values.phone.trim() || null,
    photo: values.photo?.trim() || null,
    role: values.role,
    status: values.status,
  };
}

/** Lista de unidades de atuação do professor para exibir na tabela: vazio = sem restrição (vê todas). */
export function unitsSummary(unitIds: number[] | undefined, units: Unit[]): string {
  if (!unitIds || unitIds.length === 0) return "Todas";
  const names = unitIds.map((id) => units.find((u) => u.id === id)?.name ?? `#${id}`);
  return names.length <= 2 ? names.join(", ") : `${names.slice(0, 2).join(", ")} +${names.length - 2}`;
}
