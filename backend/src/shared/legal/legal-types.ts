/**
 * Documentos legais servidos pela API (E10 - LGPD): Termos de Uso e Politica de Privacidade.
 *
 * O texto vive AQUI, no repositorio (versionado em git), e e servido por GET /legal/terms e
 * GET /legal/privacy - os 3 frontends (app, painel, admin) renderizam o mesmo conteudo, sem copias.
 * Estrutura em secoes (titulo + paragrafos) para os frontends renderizarem sem biblioteca de Markdown.
 */
export type LegalDocumentType = 'terms' | 'privacy';

export interface LegalSection {
  heading: string;
  paragraphs: readonly string[];
}

export interface LegalDocument {
  type: LegalDocumentType;
  title: string;
  /** Versao do conjunto de textos vigente (mesma para os dois documentos: o aceite e um so). */
  version: string;
  /** Data (AAAA-MM-DD) da ultima revisao do texto. */
  updatedAt: string;
  /** Aviso exibido no topo do documento. */
  notice: string;
  sections: readonly LegalSection[];
}

/** Resumo de versao/aceite devolvido por GET /legal e embutido em login e GET /auth/me. */
export interface TermsStatus {
  /** Versao vigente dos textos (a que o usuario precisa ter aceitado). */
  currentTermsVersion: string;
  /** Ultima versao aceita por este usuario (null = nunca aceitou). */
  acceptedTermsVersion: string | null;
  acceptedTermsAt: Date | null;
  /** true = nunca aceitou ou aceitou uma versao anterior: o frontend deve exigir o aceite. */
  termsAcceptanceRequired: boolean;
}
