import { z } from "zod";
import { dayOnly, fmt, verificationUrl } from "@/lib/format";

/** Contrato real de GET /certificates (Certificate + student {id,name}). */
export interface Certificate {
  id: number;
  studentId: number;
  studentGraduationId: number | null;
  title: string;
  issuedAt: string | null;
  verificationCode: string;
  fileUrl: string | null;
  student: { id: number; name: string };
}

export interface StudentRef {
  id: number;
  name: string;
}

export const formatIssuedAt = (iso: string | null): string =>
  iso ? fmt(dayOnly(iso), "dd/MM/yyyy") : "—";

export const certificateLink = (code: string): string => verificationUrl(code);

/** Filtros da lista no servidor. Valor vazio = sem filtro (nao vai para a query string). */
export type CertificateFilters = {
  /** id do aluno ("" = todos). */
  studentId: string;
  /** yyyy-MM-dd (emissao), inclusivo. */
  from: string;
  to: string;
};

export const emptyCertificateFilters = (): CertificateFilters => ({ studentId: "", from: "", to: "" });
const optionalUrl = z
  .string()
  .trim()
  .refine((v) => v === "" || /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(v), "Informe uma URL válida (http/https).");

export const issueSchema = z.object({
  studentId: z.string().min(1, "Selecione o aluno."),
  title: z.string().trim().min(2, "Informe o título (mínimo 2 caracteres)."),
  issuedAt: z.string(),
  fileUrl: optionalUrl,
});
export type IssueValues = z.infer<typeof issueSchema>;

/** Edicao: aluno nunca muda num certificado emitido (UpdateCertificateDto). */
export const editSchema = z.object({
  title: z.string().trim().min(2, "Informe o título (mínimo 2 caracteres)."),
  issuedAt: z.string(),
  fileUrl: optionalUrl,
});
export type EditValues = z.infer<typeof editSchema>;

export const emptyIssue = (): IssueValues => ({ studentId: "", title: "", issuedAt: "", fileUrl: "" });

export const certificateToEdit = (c: Certificate): EditValues => ({
  title: c.title,
  issuedAt: c.issuedAt ? c.issuedAt.slice(0, 10) : "",
  fileUrl: c.fileUrl ?? "",
});

/** Corpo do POST /certificates. */
export function toIssuePayload(v: IssueValues) {
  return {
    studentId: Number(v.studentId),
    title: v.title.trim(),
    ...(v.issuedAt ? { issuedAt: v.issuedAt } : {}),
    ...(v.fileUrl.trim() ? { fileUrl: v.fileUrl.trim() } : {}),
  };
}

/**
 * Corpo do PATCH /certificates/:id. `fileUrl` esvaziado vai como `null` (limpa a coluna; '' daria
 * 400 em @IsUrl). `title` e `issuedAt` NAO sao limpaveis (null = 400): issuedAt vazio e omitido.
 */
export function toEditPayload(v: EditValues) {
  return {
    title: v.title.trim(),
    ...(v.issuedAt ? { issuedAt: v.issuedAt } : {}),
    fileUrl: v.fileUrl.trim() || null,
  };
}