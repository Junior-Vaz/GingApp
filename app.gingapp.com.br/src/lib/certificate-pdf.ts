import { api } from "@/lib/api";

/** Nome do arquivo baixado: certificado-<id>.pdf. */
export const certificatePdfFilename = (id: number): string => `certificado-${id}.pdf`;

/**
 * Baixa o PDF de um certificado PRÓPRIO (GET /certificates/:id/pdf, com o token do app). O blob vira um
 * link temporário clicado em memória; o backend responde 404 se o certificado não for do usuário.
 */
export async function downloadCertificatePdf(id: number): Promise<void> {
  const source = await api.getBlob(`/certificates/${id}/pdf`);
  const blob = source.type === "application/pdf" ? source : new Blob([source], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = certificatePdfFilename(id);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
