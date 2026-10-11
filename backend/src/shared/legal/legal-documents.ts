import { LegalDocument, LegalDocumentType, TermsStatus } from './legal-types';
import { PRIVACY_POLICY_SECTIONS, PRIVACY_POLICY_TITLE } from './privacy-policy';
import { TERMS_OF_USE_SECTIONS, TERMS_OF_USE_TITLE } from './terms-of-use';

/**
 * Versao vigente dos textos legais (Termos + Politica de Privacidade, aceitos juntos).
 * REGRA: ao alterar qualquer texto em terms-of-use.ts / privacy-policy.ts, atualize esta constante e
 * LEGAL_UPDATED_AT - todos os usuarios passam a ver o aceite pendente no proximo acesso.
 */
export const LEGAL_VERSION = '2026-10-11.1';
export const LEGAL_UPDATED_AT = '2026-10-11';

export const LEGAL_NOTICE =
  'MODELO — revisar com assessoria jurídica antes de publicar. Os campos entre colchetes devem ser preenchidos.';

export function getLegalDocument(type: LegalDocumentType): LegalDocument {
  const isTerms = type === 'terms';
  return {
    type,
    title: isTerms ? TERMS_OF_USE_TITLE : PRIVACY_POLICY_TITLE,
    version: LEGAL_VERSION,
    updatedAt: LEGAL_UPDATED_AT,
    notice: LEGAL_NOTICE,
    sections: isTerms ? TERMS_OF_USE_SECTIONS : PRIVACY_POLICY_SECTIONS,
  };
}

/** true quando o usuario precisa (re)aceitar: nunca aceitou ou aceitou uma versao diferente da vigente. */
export function termsAcceptanceRequired(acceptedVersion: string | null | undefined): boolean {
  return acceptedVersion !== LEGAL_VERSION;
}

export function buildTermsStatus(user: {
  acceptedTermsVersion: string | null;
  acceptedTermsAt: Date | null;
}): TermsStatus {
  return {
    currentTermsVersion: LEGAL_VERSION,
    acceptedTermsVersion: user.acceptedTermsVersion,
    acceptedTermsAt: user.acceptedTermsAt,
    termsAcceptanceRequired: termsAcceptanceRequired(user.acceptedTermsVersion),
  };
}
