import { EventStatus, RegistrationFormStatus, RegistrationSubmissionStatus } from '@prisma/client';
import { personDocumentKey, maskPersonDocument } from '../../../shared/security/person-document';
import { aesGcmEncrypt, aesGcmDecrypt, deriveSubkey } from '../../../shared/security/aes-gcm';
import { resolveJwtSecret } from '../../../shared/config/runtime-config';
import { AnswerValue } from './answer-validation';
import { ClosedReason } from './form-codes';
import { defaultConsentText } from './form-definition';

/** Vaga ocupada = inscricao PENDING ou CONFIRMED (lista de espera, recusada e cancelada nao ocupam). */
export const OCCUPYING_SUBMISSION_STATUSES: RegistrationSubmissionStatus[] = [
  RegistrationSubmissionStatus.PENDING,
  RegistrationSubmissionStatus.CONFIRMED,
];
/** Duplicidade ignora inscricoes recusadas/canceladas (a pessoa pode se inscrever de novo). */
export const ACTIVE_SUBMISSION_STATUSES: RegistrationSubmissionStatus[] = [
  RegistrationSubmissionStatus.PENDING,
  RegistrationSubmissionStatus.CONFIRMED,
  RegistrationSubmissionStatus.WAITLIST,
];

/** Origem publica do app do aluno (links /i/<slug>). APP_URL; padrao https://app.gingapp.com.br. */
export function appUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.APP_URL?.trim() || 'https://app.gingapp.com.br').replace(/\/+$/, '');
}

export function publicFormUrl(slug: string): string {
  return `${appUrl()}/i/${slug}`;
}

export interface FormStateInput {
  status: RegistrationFormStatus;
  opensAt: Date | null;
  closesAt: Date | null;
  maxSubmissions: number | null;
  allowWaitlist: boolean;
  event?: { status: EventStatus; registrationDeadline: Date | null } | null;
}

/**
 * Teto da lista de espera de um formulario lotado: o menor entre maxSubmissions e FORMS_WAITLIST_MAX (padrao 200).
 * Sem teto, um anonimo encheria a fila de linhas (cada uma com dados pessoais) sem limite.
 */
export function waitlistCap(maxSubmissions: number | null, env: NodeJS.ProcessEnv = process.env): number {
  const n = Number(env.FORMS_WAITLIST_MAX);
  const max = Number.isInteger(n) && n > 0 ? n : 200;
  return maxSubmissions != null ? Math.min(maxSubmissions, max) : max;
}

/**
 * Motivo de o formulario NAO aceitar inscricao agora (null = aberto). Ordem: estado > ainda nao abriu > prazo > lotado.
 * Lotado com lista de espera tambem e FULL quando a fila chegou ao teto (waitlistCap).
 */
export function closedReasonOf(form: FormStateInput, occupied: number, now: Date = new Date(), waitlisted = 0): ClosedReason | null {
  if (form.status !== RegistrationFormStatus.OPEN) return 'CLOSED';
  if (form.event && (form.event.status === EventStatus.CANCELLED || form.event.status === EventStatus.CLOSED)) return 'CLOSED';
  if (form.opensAt && form.opensAt.getTime() > now.getTime()) return 'NOT_OPEN_YET';
  if (form.closesAt && form.closesAt.getTime() < now.getTime()) return 'DEADLINE';
  if (form.event?.registrationDeadline && form.event.registrationDeadline.getTime() < now.getTime()) return 'DEADLINE';
  if (isFormFull(form.maxSubmissions, occupied) && (!form.allowWaitlist || waitlisted >= waitlistCap(form.maxSubmissions))) return 'FULL';
  return null;
}

/** Banner de formulario PUBLICO: so imagem do proprio backend (/api/uploads/...) ou https (nunca http/mixed content). */
export function safeBannerUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.startsWith('/api/uploads/') || /^https:\/\//i.test(url) ? url : null;
}

export function isFormFull(maxSubmissions: number | null, occupied: number): boolean {
  return maxSubmissions != null && occupied >= maxSubmissions;
}

export function formSpotsLeft(maxSubmissions: number | null, occupied: number): number | null {
  return maxSubmissions == null ? null : Math.max(0, maxSubmissions - occupied);
}

export function consentTextOf(form: { consentText: string | null; retentionMonths: number }): string {
  return form.consentText?.trim() || defaultConsentText(form.retentionMonths);
}

/**
 * Texto EFETIVO que a pessoa aceita ao enviar (base do snapshot RegistrationConsentVersion): o termo do formulario (ou
 * o padrao, que cita retentionMonths) + cada campo CONSENT ativo (chave, obrigatorio/opcional e rotulo), na ordem.
 */
export function effectiveConsentText(
  form: { consentText: string | null; retentionMonths: number },
  fields: Array<{ key: string; type: string; label: string; required: boolean; archived?: boolean }>,
): string {
  const parts = [consentTextOf(form)];
  for (const f of fields) {
    if (f.type !== 'CONSENT' || f.archived) continue;
    parts.push(`[${f.key}${f.required ? '' : ' (opcional)'}] ${f.label}`);
  }
  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Identificacao da inscricao (nome, e-mail, telefone, CPF) a partir das respostas
// ---------------------------------------------------------------------------------------------------------------

export interface IdentityField {
  key: string;
  type: string;
  required: boolean;
  mapsTo: string | null;
}

export interface IdentityKeys {
  name: string | null;
  email: string | null;
  phone: string | null;
  document: string | null;
  birthDate: string | null;
}

/** Campo de cada identificador: o mapeado (mapsTo) ou, na falta, o 1o campo do tipo. */
export function identityKeys(fields: IdentityField[]): IdentityKeys {
  const byMap = (m: string) => fields.find((f) => f.mapsTo === m)?.key ?? null;
  const byType = (t: string) => fields.find((f) => f.type === t)?.key ?? null;
  return {
    name: byMap('name') ?? fields.find((f) => f.type === 'SHORT_TEXT' && f.required)?.key ?? byType('SHORT_TEXT'),
    email: byMap('email') ?? byType('EMAIL'),
    phone: byMap('phone') ?? byType('PHONE'),
    document: byMap('document') ?? byType('CPF'),
    birthDate: byMap('birthDate') ?? byType('DATE'),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// CPF de campos que NAO sao o de identificacao: cifrados dentro de `answers` (AES-GCM, subchave propria)
// ---------------------------------------------------------------------------------------------------------------

const EXTRA_CPF_SALT = 'gingapp-forms-v1';
function extraCpfKey(): Buffer {
  const master = process.env.PERSON_DOC_KEY?.trim() || resolveJwtSecret(process.env.JWT_SECRET);
  return deriveSubkey(master, EXTRA_CPF_SALT, 'answer-cpf');
}

export interface EncryptedCpfAnswer {
  cpfEnc: string;
  last4: string;
}

export function encryptCpfAnswer(digits: string): EncryptedCpfAnswer {
  return { cpfEnc: aesGcmEncrypt(extraCpfKey(), digits), last4: digits.slice(-4) };
}

/** Uso interno (nunca devolvido em API). */
export function decryptCpfAnswer(value: EncryptedCpfAnswer): string {
  return aesGcmDecrypt(extraCpfKey(), value.cpfEnc, 'CPF da resposta');
}

export function isEncryptedCpf(value: unknown): value is EncryptedCpfAnswer {
  return typeof value === 'object' && value !== null && typeof (value as EncryptedCpfAnswer).cpfEnc === 'string';
}

/** CPF de identificacao: mesmo helper da ficha unica (hash HMAC + AES-GCM + 4 ultimos). */
export function identityDocument(digits: string): { documentHash: string; documentEnc: string; documentLast4: string } {
  const key = personDocumentKey('CPF', digits);
  return { documentHash: key.hash, documentEnc: key.enc, documentLast4: key.last4 };
}

export const maskDocument = maskPersonDocument;

/** Valor guardado em `answers` (o que sai do banco) - tipo largo. */
export type StoredAnswer = AnswerValue | EncryptedCpfAnswer | { fileIds: number[] };
