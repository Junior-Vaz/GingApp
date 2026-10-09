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

export interface CertificateFilters {
  /** yyyy-MM-dd (emissao), inclusivo. */
  from: string;
  to: string;
}

export function applyCertificateFilters(list: Certificate[], filters: CertificateFilters): Certificate[] {
  return list.filter((c) => {
    const issued = c.issuedAt?.slice(0, 10) ?? "";
    if (filters.from && (!issued || issued < filters.from)) return false;
    if (filters.to && (!issued || issued > filters.to)) return false;
    return true;
  });
}

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

/** Corpo do PATCH /certificates/:id. */
export function toEditPayload(v: EditValues) {
  return {
    title: v.title.trim(),
    ...(v.issuedAt ? { issuedAt: v.issuedAt } : {}),
    ...(v.fileUrl.trim() ? { fileUrl: v.fileUrl.trim() } : {}),
  };
}
