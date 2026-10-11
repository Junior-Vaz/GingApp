import { api } from "@/lib/api";
import { updateSessionUser } from "@/lib/session";

/** Documentos legais (E10) servidos pela API em GET /legal/terms e /legal/privacy (públicos, sem login). */
export type LegalDocumentType = "terms" | "privacy";

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDocument {
  type: LegalDocumentType;
  title: string;
  version: string;
  updatedAt: string;
  /** "MODELO — revisar com assessoria jurídica…" (exibido no topo). */
  notice: string;
  sections: LegalSection[];
}

export const fetchLegalDocument = (type: LegalDocumentType) =>
  api.get<LegalDocument>(`/legal/${type}`, { skipAuthRedirect: true });

export const fetchLegalVersion = () =>
  api.get<{ version: string }>("/legal", { skipAuthRedirect: true }).then((data) => data.version);

interface MeResponse {
  termsAcceptanceRequired: boolean;
  currentTermsVersion: string;
  acceptedTermsVersion: string | null;
  mustChangePassword?: boolean;
}

/**
 * Atualiza na sessão o estado do aceite (a sessão guardada pode ser de antes dos termos existirem ou de uma
 * versão antiga dos textos). Silencioso: se a chamada falhar o app segue com o que já sabe.
 */
export async function refreshTermsStatus(): Promise<void> {
  try {
    const me = await api.get<MeResponse>("/auth/me", { skipAuthRedirect: true });
    updateSessionUser({
      termsAcceptanceRequired: me.termsAcceptanceRequired,
      currentTermsVersion: me.currentTermsVersion,
      acceptedTermsVersion: me.acceptedTermsVersion,
    });
  } catch {
    // sem rede / sessão inválida: o fluxo normal (401 em outra chamada) trata
  }
}

/** POST /auth/accept-terms com a versão que o usuário viu; no sucesso a sessão deixa de exigir o aceite. */
export async function acceptTerms(version: string): Promise<void> {
  await api.post("/auth/accept-terms", { version });
  updateSessionUser({ termsAcceptanceRequired: false, acceptedTermsVersion: version, currentTermsVersion: version });
}

/** Direito de acesso/portabilidade: baixa o JSON com os dados do próprio usuário (GET /auth/me/export). */
export async function exportMyData(): Promise<void> {
  const data = await api.get<unknown>("/auth/me/export");
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "gingapp-meus-dados.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Direito de eliminação/anonimização: só REGISTRA o pedido; nada é apagado automaticamente. */
export const requestDataDeletion = (reason?: string) =>
  api.post<{ id: number; status: string; alreadyRequested: boolean }>(
    "/auth/me/delete-request",
    reason?.trim() ? { reason: reason.trim() } : {},
  );
