import { createHmac } from 'node:crypto';
import { resolveJwtSecret } from '../config/runtime-config';
import { aesGcmDecrypt, aesGcmEncrypt, deriveSubkey } from './aes-gcm';

/**
 * Documento da FICHA UNICA (Person, docs/FICHA_UNICA.md). Regra de ouro: o CPF NUNCA fica em claro na Person e NUNCA
 * sai inteiro pela API.
 *  - documentEnc  = AES-256-GCM (aes-gcm.ts) com subchave de PERSON_DOC_KEY (ou, na falta, do JWT_SECRET);
 *  - documentHash = HMAC-SHA256 da forma canonica com subchave de PERSON_DOC_PEPPER (ou do JWT_SECRET) - permite a
 *    busca EXATA ("esse CPF ja tem ficha?") sem guardar o CPF; sem o pepper o hash nao e reproduzivel por quem so tem
 *    o banco (CPF tem so ~10^9 combinacoes validas: um SHA puro seria quebrado por forca bruta).
 *  - documentLast4 = 4 ultimos digitos, so para a mascara.
 * ATENCAO: trocar PERSON_DOC_PEPPER (ou o JWT_SECRET sem PERSON_DOC_PEPPER definido) faz TODA busca por CPF parar de
 * achar as fichas existentes (= duplicatas). Trocar PERSON_DOC_KEY torna os documentEnc ilegiveis. Fixe as duas em
 * producao e nunca as troque sem um re-hash planejado (ver docs/EASYPANEL.md).
 */
const HKDF_SALT = 'gingapp-person-doc-v1';

function encryptionKey(): Buffer {
  const master = process.env.PERSON_DOC_KEY?.trim() || resolveJwtSecret(process.env.JWT_SECRET);
  return deriveSubkey(master, HKDF_SALT, 'document-encryption');
}

function hmacKey(): Buffer {
  const master = process.env.PERSON_DOC_PEPPER?.trim() || resolveJwtSecret(process.env.JWT_SECRET);
  return deriveSubkey(master, HKDF_SALT, 'document-hmac');
}

/** So os digitos. */
export function onlyDigits(text: string | null | undefined): string {
  return (text ?? '').replace(/\D/g, '');
}

/** CPF valido (11 digitos, digitos verificadores corretos, nao todos iguais). Recebe so digitos. */
export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  const check = (length: number): number => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

export function formatCpf(digits: string): string {
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
}

/** Texto livre -> digitos do CPF, ou null se nao for um CPF valido. */
export function parseCpf(text: string | null | undefined): string | null {
  const digits = onlyDigits(text);
  return isValidCpf(digits) ? digits : null;
}

export type PersonDocumentKindCode = 'CPF' | 'GUARDIAN_CPF';

export interface PersonDocumentKey {
  kind: PersonDocumentKindCode;
  hash: string;
  enc: string;
  last4: string;
}

/**
 * Forma canonica da chave: `CPF:<11 digitos>` ou, para crianca sem CPF, `GUARDIAN_CPF:<cpf do responsavel>:<yyyy-mm-dd>`
 * (irmaos com o mesmo responsavel se distinguem pela data de nascimento; gemeos colidem - ver FICHA_UNICA.md).
 */
export function canonicalDocument(kind: PersonDocumentKindCode, cpfDigits: string, birthDate?: Date | null): string {
  if (kind === 'CPF') return `CPF:${cpfDigits}`;
  if (!birthDate) throw new Error('GUARDIAN_CPF exige a data de nascimento.');
  return `GUARDIAN_CPF:${cpfDigits}:${birthDate.toISOString().slice(0, 10)}`;
}

export function hashPersonDocument(canonical: string): string {
  return createHmac('sha256', hmacKey()).update(canonical).digest('hex');
}

/** Monta a chave completa (hash para busca + cifra + 4 ultimos digitos). `cpfDigits` ja validado. */
export function personDocumentKey(kind: PersonDocumentKindCode, cpfDigits: string, birthDate?: Date | null): PersonDocumentKey {
  const canonical = canonicalDocument(kind, cpfDigits, birthDate);
  return { kind, hash: hashPersonDocument(canonical), enc: aesGcmEncrypt(encryptionKey(), canonical), last4: cpfDigits.slice(-4) };
}

/** Le a forma canonica de volta (uso interno/suporte; NUNCA devolver em API). */
export function decryptPersonDocument(stored: string): string {
  return aesGcmDecrypt(encryptionKey(), stored, 'documento da ficha');
}

/**
 * Documento LEGADO da matricula (Student.document, texto livre) como sai pela API (Fase 2): CPF valido vira
 * `***.***.***-XX`; outro texto vira `***` + os 2 ultimos caracteres. null/vazio = null.
 */
export function maskStudentDocument(document: string | null | undefined): string | null {
  if (!document || !document.trim()) return null;
  const cpf = parseCpf(document);
  if (cpf) return `***.***.***-${cpf.slice(-2)}`;
  const text = document.trim();
  return text.length <= 2 ? '***' : `***${text.slice(-2)}`;
}

/** Aplica maskStudentDocument a um aluno (ou lista/pagina) devolvido pela API, sem mexer no resto. */
export function withMaskedDocument<T extends { document?: string | null }>(student: T): T {
  return student && 'document' in student ? { ...student, document: maskStudentDocument(student.document) } : student;
}

/** Unica forma do documento que sai pela API: `***.***.***-XX` (2 ultimos digitos), ou null. */
export function maskPersonDocument(last4: string | null | undefined): string | null {
  if (!last4 || !/^\d{2,4}$/.test(last4)) return null;
  return `***.***.***-${last4.slice(-2)}`;
}
