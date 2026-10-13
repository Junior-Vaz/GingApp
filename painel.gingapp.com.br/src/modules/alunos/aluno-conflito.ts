import { ApiError } from "@/lib/api";
import type { RopeStyle } from "@/lib/rope";
import type { StudentStatus } from "./schema";

/** Pré-visualização de uma pessoa que já tem ficha (GingApp), devolvida nos 409 do cadastro de aluno. */
export interface PersonPreview {
  personId: number;
  name: string;
  nickname: string | null;
  photo: string | null;
  currentGroups: { id: number; name: string; logoUrl: string | null }[];
  currentLevel: { name: string; style: RopeStyle; colors: string[]; tipStart?: string | null; tipEnd?: string | null } | null;
}

/** 409 de POST /students: o que o painel precisa para decidir o diálogo. */
export type StudentConflict =
  | { kind: "ALREADY_IN_GROUP"; message: string; studentId: number; studentStatus: StudentStatus }
  | { kind: "EXISTS_ELSEWHERE"; message: string; person: PersonPreview; transferAvailable: boolean }
  | { kind: "POSSIBLE_DUPLICATE"; message: string; matches: PersonPreview[]; canConfirmNew: boolean };

const STATUSES: StudentStatus[] = ["ACTIVE", "INACTIVE", "SUSPENDED", "FORMER"];

function asPreview(value: unknown): PersonPreview | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  if (typeof v["personId"] !== "number" || typeof v["name"] !== "string") return null;
  const groups = Array.isArray(v["currentGroups"]) ? v["currentGroups"] : [];
  const level = v["currentLevel"] as Record<string, unknown> | null | undefined;
  return {
    personId: v["personId"],
    name: v["name"],
    nickname: typeof v["nickname"] === "string" ? v["nickname"] : null,
    photo: typeof v["photo"] === "string" ? v["photo"] : null,
    currentGroups: groups
      .filter((g): g is Record<string, unknown> => !!g && typeof g === "object")
      .map((g) => ({
        id: Number(g["id"]),
        name: String(g["name"] ?? ""),
        logoUrl: typeof g["logoUrl"] === "string" ? g["logoUrl"] : null,
      })),
    currentLevel:
      level && typeof level === "object" && typeof level["name"] === "string"
        ? {
            name: level["name"],
            style: (level["style"] as RopeStyle | undefined) ?? "SOLID",
            colors: Array.isArray(level["colors"]) ? (level["colors"] as unknown[]).map(String) : [],
            tipStart: typeof level["tipStart"] === "string" ? level["tipStart"] : null,
            tipEnd: typeof level["tipEnd"] === "string" ? level["tipEnd"] : null,
          }
        : null,
  };
}

/** Converte o erro de POST /students no conflito (409) a tratar com diálogo; qualquer outro erro devolve `null`. */
export function parseStudentConflict(error: unknown): StudentConflict | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const body = error.body ?? {};
  if (error.code === "PERSON_ALREADY_IN_GROUP") {
    const studentId = Number(body["studentId"]);
    const status = body["studentStatus"] as StudentStatus;
    if (!Number.isFinite(studentId)) return null;
    return {
      kind: "ALREADY_IN_GROUP",
      message: error.message,
      studentId,
      studentStatus: STATUSES.includes(status) ? status : "ACTIVE",
    };
  }
  if (error.code === "PERSON_EXISTS_ELSEWHERE") {
    const person = asPreview(body["person"]);
    return person
      ? { kind: "EXISTS_ELSEWHERE", message: error.message, person, transferAvailable: body["transferAvailable"] === true }
      : null;
  }
  if (error.code === "POSSIBLE_DUPLICATE") {
    const raw = Array.isArray(body["possibleMatches"]) ? body["possibleMatches"] : [];
    const matches = raw.map(asPreview).filter((p): p is PersonPreview => p !== null);
    return { kind: "POSSIBLE_DUPLICATE", message: error.message, matches, canConfirmNew: body["canConfirmNew"] !== false };
  }
  return null;
}

/** Mensagens amigáveis para os 400 do cadastro (o resto usa a mensagem do próprio servidor). */
const CREATE_ERROR_MESSAGE: Record<string, string> = {
  INVALID_CPF: "CPF inválido. Confira os números e tente de novo.",
  GINGAPP_CODE_NOT_FOUND: "Código GingApp não encontrado. Confira o código ou deixe o campo em branco.",
  BIRTHDATE_REQUIRED_FOR_GUARDIAN_DOCUMENT: "Informe a data de nascimento do aluno para usar o CPF do responsável.",
};

export function createErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return (error.code && CREATE_ERROR_MESSAGE[error.code]) || error.message || fallback;
  return fallback;
}
