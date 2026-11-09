import { z } from "zod";
import { API_URL, ApiError } from "@/lib/api";
import { BR_UFS, type Uf } from "@/lib/br-ufs";
import { newPasswordRules } from "@/lib/password";

/**
 * Pedido público de cadastro de grupo (docs/CONTRATO_ADESAO_GRUPOS.md, seções 3 e 5).
 * Sem login: as duas chamadas NUNCA levam `Authorization` (mesmo com uma sessão aberta no navegador) e o token de
 * acompanhamento viaja só no PATH, nunca em query string.
 */

/** UFs aceitas no pedido (SSOT: `lib/br-ufs.ts`, espelho do backend). */
export const GROUP_APPLICATION_UFS: readonly Uf[] = BR_UFS;

/** Cargos que o solicitante pode informar (`claimedRole`). É só informação para a equipe: NÃO concede nenhum papel. */
export const CLAIMED_ROLES = ["MESTRE", "CONTRAMESTRE", "PROFESSOR", "INSTRUTOR", "MONITOR", "OUTRO"] as const;
export type ClaimedRole = (typeof CLAIMED_ROLES)[number];

export const CLAIMED_ROLE_LABEL: Record<ClaimedRole, string> = {
  MESTRE: "Mestre",
  CONTRAMESTRE: "Contramestre",
  PROFESSOR: "Professor",
  INSTRUTOR: "Instrutor",
  MONITOR: "Monitor",
  OUTRO: "Outro",
};

/** Mesmo formato do backend (`PHONE_PATTERN`): 8 a 30 caracteres entre dígitos, +, (), -, ponto e espaço. */
export const PHONE_PATTERN = /^\+?[0-9()\-.\s]{8,30}$/;

export const MAX_ESTIMATED_STUDENTS = 100_000;
export const MESSAGE_MAX_LENGTH = 500;

/** Requisitos da senha mostrados no formulário (a política do painel, SSOT em `lib/password.ts`; "diferente da atual" não se aplica). */
const SIGNUP_RULE_IDS = ["length", "bytes", "forbidden"] as const;
export const signupPasswordRules = (password: string) =>
  newPasswordRules(password, "").filter((rule) => (SIGNUP_RULE_IDS as readonly string[]).includes(rule.id));

/** Força da senha só como dica visual (0 vazia, 1 fraca, 2 boa, 3 forte). Quem decide é o backend. */
export function passwordStrength(password: string): { level: 0 | 1 | 2 | 3; label: string } {
  if (password === "") return { level: 0, label: "" };
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (password.length < 12 || kinds < 2) return { level: 1, label: "Fraca" };
  if (password.length >= 16 && kinds >= 3) return { level: 3, label: "Forte" };
  return { level: 2, label: "Boa" };
}

const requiredText = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(1, `Informe ${label}.`)
    .min(min, `${label.charAt(0).toUpperCase()}${label.slice(1)} precisa ter ao menos ${String(min)} letras.`)
    .max(max, `${label.charAt(0).toUpperCase()}${label.slice(1)} pode ter no máximo ${String(max)} caracteres.`);

export const groupApplicationSchema = z.object({
  applicantName: requiredText("o seu nome", 2, 120),
  email: z
    .string()
    .trim()
    .min(1, "Informe o e-mail.")
    .email("E-mail inválido.")
    .max(254, "O e-mail pode ter no máximo 254 caracteres."),
  phone: z
    .string()
    .trim()
    .refine((value) => value === "" || PHONE_PATTERN.test(value), "Telefone inválido. Use de 8 a 30 caracteres, só números, +, (), - e espaço."),
  claimedRole: z
    .string()
    .refine((value) => (CLAIMED_ROLES as readonly string[]).includes(value), "Escolha o seu cargo."),
  groupName: requiredText("o nome do grupo", 2, 120),
  city: requiredText("a cidade", 2, 80),
  state: z.string().refine((value) => (BR_UFS as readonly string[]).includes(value), "Escolha a UF."),
  estimatedStudents: z
    .string()
    .trim()
    .refine(
      (value) => value === "" || (/^\d{1,6}$/.test(value) && Number(value) <= MAX_ESTIMATED_STUDENTS),
      `Informe um número inteiro de 0 a ${String(MAX_ESTIMATED_STUDENTS)}.`,
    ),
  message: z.string().trim().max(MESSAGE_MAX_LENGTH, `Escreva no máximo ${String(MESSAGE_MAX_LENGTH)} caracteres.`),
  // Senhas NUNCA são aparadas: espaços podem fazer parte delas (mesma regra de lib/password.ts).
  password: z.string().superRefine((value, ctx) => {
    if (value === "") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Crie uma senha." });
      return;
    }
    const failed = signupPasswordRules(value).find((rule) => !rule.ok);
    if (failed) ctx.addIssue({ code: z.ZodIssueCode.custom, message: failed.error.replace("A nova senha", "A senha") });
  }),
  adult: z.boolean().refine((value) => value, "Confirme que você tem 18 anos ou mais."),
  acceptTerms: z.boolean().refine((value) => value, "É preciso aceitar os Termos de Uso e a Política de Privacidade."),
  /** Honeypot: campo fora da vista que gente de verdade nunca preenche. */
  website: z.string(),
});
export type GroupApplicationValues = z.infer<typeof groupApplicationSchema>;

export const emptyGroupApplicationForm: GroupApplicationValues = {
  applicantName: "",
  email: "",
  phone: "",
  claimedRole: "",
  groupName: "",
  city: "",
  state: "",
  estimatedStudents: "",
  message: "",
  password: "",
  adult: false,
  acceptTerms: false,
  website: "",
};

/** Corpo de POST /public/group-applications (contrato, seção 3). Opcionais vazios são omitidos. */
export interface GroupApplicationPayload {
  applicantName: string;
  email: string;
  phone?: string;
  password: string;
  claimedRole: ClaimedRole;
  groupName: string;
  city: string;
  state: Uf;
  estimatedStudents?: number;
  message?: string;
  acceptTerms: true;
  adult: true;
  website: string;
}

export function toGroupApplicationPayload(values: GroupApplicationValues): GroupApplicationPayload {
  const phone = values.phone.trim();
  const students = values.estimatedStudents.trim();
  const message = values.message.trim();
  return {
    applicantName: values.applicantName.trim(),
    email: values.email.trim(),
    ...(phone ? { phone } : {}),
    password: values.password,
    claimedRole: values.claimedRole as ClaimedRole,
    groupName: values.groupName.trim(),
    city: values.city.trim(),
    state: values.state as Uf,
    ...(students ? { estimatedStudents: Number(students) } : {}),
    ...(message ? { message } : {}),
    acceptTerms: true,
    adult: true,
    // Vazio para gente de verdade; o servidor descarta em silêncio qualquer valor preenchido por robô.
    website: values.website,
  };
}

export type GroupApplicationStatusName = "PENDING" | "APPROVED" | "REJECTED" | "EXPIRED";

export interface GroupApplicationSubmitted {
  statusToken: string;
  status: "PENDING";
}

/** GET /public/group-applications/:token (nunca traz e-mail, telefone, nome do solicitante nem id). */
export interface GroupApplicationStatus {
  status: GroupApplicationStatusName;
  groupName: string;
  createdAt: string;
  decidedAt: string | null;
  rejectionReason: string | null;
  loginUrl: string | null;
}

/**
 * Chamada pública SEM `Authorization` e sem cookies: o `api` do painel anexa o token da sessão quando ele existe, o que
 * não faz sentido (nem deve vazar) numa rota pública. Erros seguem o contrato de `ApiError`.
 */
async function publicRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json" },
  });
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    const raw = (body as { message?: string | string[] } | null | undefined)?.message;
    const message = Array.isArray(raw) ? raw.join(" ") : raw;
    const code = (body as { code?: unknown } | null | undefined)?.code;
    throw new ApiError(
      message ?? `Erro ${String(response.status)} ao chamar ${path}`,
      response.status,
      typeof code === "string" ? code : undefined,
      body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined,
    );
  }
  return body as T;
}

export const submitGroupApplication = (payload: GroupApplicationPayload) =>
  publicRequest<GroupApplicationSubmitted>("/public/group-applications", {
    method: "POST",
    body: JSON.stringify(payload),
  });

/** O token vai no PATH (codificado), nunca em query string. */
export const fetchGroupApplicationStatus = (token: string) =>
  publicRequest<GroupApplicationStatus>(`/public/group-applications/${encodeURIComponent(token)}`, {
    method: "GET",
    cache: "no-store",
  });

export const SUBMIT_ERROR_FALLBACK = "Não foi possível enviar o pedido. Verifique sua conexão e tente novamente.";

export function submitErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 429) return "Muitos pedidos deste dispositivo. Aguarde um pouco e tente novamente.";
    if (error.status === 400) return error.message;
    if (error.status >= 500) return "O serviço está indisponível no momento. Tente novamente em alguns minutos.";
    return error.message;
  }
  return SUBMIT_ERROR_FALLBACK;
}

/**
 * Conveniência: guarda o token do último pedido neste navegador para o link "Acompanhar meu pedido". Nunca guarda
 * e-mail nem senha. `localStorage` pode estar bloqueado/indisponível: tudo em try/catch e a página funciona sem.
 */
export const APPLICATION_TOKEN_STORAGE_KEY = "gingapp_group_application_token";
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{8,128}$/;

export function saveApplicationToken(token: string): void {
  try {
    if (TOKEN_SHAPE.test(token)) localStorage.setItem(APPLICATION_TOKEN_STORAGE_KEY, token);
  } catch {
    // armazenamento indisponível: o acompanhamento continua acessível pelo link da tela de sucesso
  }
}

export function readApplicationToken(): string | null {
  try {
    const token = localStorage.getItem(APPLICATION_TOKEN_STORAGE_KEY);
    return token !== null && TOKEN_SHAPE.test(token) ? token : null;
  } catch {
    return null;
  }
}
