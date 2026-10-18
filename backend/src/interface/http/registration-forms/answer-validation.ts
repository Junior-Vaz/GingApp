import { normalizeEmail } from '../../../shared/security/password-policy';
import { isValidCpf, onlyDigits } from '../../../shared/security/person-document';
import { FieldType, FieldValidation, FORM_LIMITS, ShowIf } from './form-definition';

/**
 * Validacao PURA das respostas de uma inscricao publica, campo a campo, SEMPRE no servidor (independente do que o
 * navegador validou). A condicional (showIf) e reavaliada aqui: campo oculto nao e exigido e a resposta dele e
 * descartada. Mensagens em portugues SEM ecoar o valor digitado (sem dado pessoal em erro).
 */

export interface AnswerField {
  key: string;
  type: FieldType | string;
  required: boolean;
  options: string[] | null;
  validation: FieldValidation | null;
  showIf: ShowIf | null;
}

export type AnswerValue = string | number | boolean | string[];

export interface AnswerValidationResult {
  /** Respostas normalizadas dos campos VISIVEIS (sem FILE/INFO). */
  values: Record<string, AnswerValue>;
  /** fieldKey -> token do anexo pendente (FILE visivel respondido). */
  fileTokens: Record<string, string>;
  errors: Record<string, string>;
  visible: Set<string>;
}

/** Teto de chaves no objeto `answers` (corpo maior = recusado antes de olhar campo a campo). */
export const MAX_ANSWER_KEYS = 120;
/** Teto do `answers` SERIALIZADO (bytes UTF-8): a soma dos campos cabe folgada; acima disso e abuso (400). */
export const MAX_ANSWERS_BYTES = 64 * 1024;

/**
 * Chave de DUPLICIDADE/limite do e-mail (nunca exibida nem usada para enviar): minusculas, sem "+tag" na parte local;
 * gmail.com/googlemail.com sem pontos e no mesmo dominio (o Gmail ignora pontos e entrega os dois dominios).
 */
export function emailDedupKey(email: string | null | undefined): string | null {
  if (!email) return null;
  const e = email.trim().toLowerCase();
  const at = e.lastIndexOf('@');
  if (at <= 0) return e;
  let local = e.slice(0, at);
  let domain = e.slice(at + 1);
  const plus = local.indexOf('+');
  if (plus > 0) local = local.slice(0, plus);
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    local = local.replace(/\./g, '');
    domain = 'gmail.com';
  }
  return `${local}@${domain}`;
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

const isEmpty = (v: unknown): boolean =>
  v === undefined || v === null || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);

/** Telefone BR: 10 ou 11 digitos com DDD (aceita prefixo 55). Devolve so os digitos (sem o 55) ou null. */
export function normalizeBrPhone(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  let d = onlyDigits(String(value));
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (d[0] === '0' || d[1] === '0') return null; // DDD valido nao comeca nem termina em 0
  if (d.length === 11 && d[2] !== '9') return null; // celular com 9 digitos
  return d;
}

/** Data civil "yyyy-MM-dd" valida (1900..2100) ou null. */
export function normalizeDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const m = DATE_REGEX.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1900 || y > 2100) return null;
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? value.trim() : null;
}

export function normalizeEmailAnswer(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const e = normalizeEmail(value);
  return e.length <= 254 && EMAIL_REGEX.test(e) ? e : null;
}

/** O valor (ja normalizado) do campo de referencia satisfaz a condicao? MULTI_CHOICE: "contem". */
function conditionHolds(refValue: AnswerValue | undefined, equals: ShowIf['equals']): boolean {
  if (refValue === undefined) return false;
  if (Array.isArray(refValue)) return refValue.includes(String(equals));
  if (typeof refValue === 'number' || typeof equals === 'number') return Number(refValue) === Number(equals);
  return refValue === equals;
}

export function validateAnswers(fields: AnswerField[], answers: Record<string, unknown>): AnswerValidationResult {
  const values: Record<string, AnswerValue> = {};
  const fileTokens: Record<string, string> = {};
  const errors: Record<string, string> = {};
  const visible = new Set<string>();

  for (const field of fields) {
    // Condicional: o campo de referencia precisa estar VISIVEL e com o valor esperado (cadeia de condicoes).
    if (field.showIf) {
      const refVisible = visible.has(field.showIf.fieldKey);
      const ref = Object.hasOwn(values, field.showIf.fieldKey) ? values[field.showIf.fieldKey] : undefined;
      if (!refVisible || !conditionHolds(ref, field.showIf.equals)) continue;
    }
    visible.add(field.key);
    if (field.type === 'INFO') continue;

    // Object.hasOwn: chave como "constructor"/"toString" nunca le o prototipo do objeto.
    const raw = Object.hasOwn(answers, field.key) ? answers[field.key] : undefined;
    if (field.type === 'CONSENT') {
      if (raw === true) values[field.key] = true;
      else if (field.required) errors[field.key] = 'É preciso aceitar este termo para continuar.';
      else if (raw !== undefined && raw !== null && raw !== false) errors[field.key] = 'Resposta inválida.';
      continue;
    }
    if (isEmpty(raw)) {
      if (field.required) errors[field.key] = 'Campo obrigatório.';
      continue;
    }
    const error = validateOne(field, raw, values, fileTokens);
    if (error) errors[field.key] = error;
  }
  return { values, fileTokens, errors, visible };
}

function validateOne(
  field: AnswerField,
  raw: unknown,
  values: Record<string, AnswerValue>,
  fileTokens: Record<string, string>,
): string | null {
  const v = field.validation ?? {};
  switch (field.type) {
    case 'SHORT_TEXT':
    case 'LONG_TEXT': {
      if (typeof raw !== 'string') return 'Resposta inválida.';
      const text = raw.trim();
      const max = Math.min(
        v.maxLength ?? Number.POSITIVE_INFINITY,
        field.type === 'SHORT_TEXT' ? FORM_LIMITS.shortTextDefaultMax : FORM_LIMITS.longTextDefaultMax,
      );
      if (text.length > max) return `Use no máximo ${max} caracteres.`;
      if (v.minLength !== undefined && text.length < v.minLength) return `Use pelo menos ${v.minLength} caracteres.`;
      values[field.key] = text;
      return null;
    }
    case 'NUMBER': {
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw.replace(',', '.')) : NaN;
      if (!Number.isFinite(n) || Math.abs(n) > 1e12) return 'Informe um número válido.';
      if (v.min !== undefined && n < v.min) return `O valor mínimo é ${v.min}.`;
      if (v.max !== undefined && n > v.max) return `O valor máximo é ${v.max}.`;
      values[field.key] = n;
      return null;
    }
    case 'EMAIL': {
      const e = normalizeEmailAnswer(raw);
      if (!e) return 'Informe um e-mail válido.';
      values[field.key] = e;
      return null;
    }
    case 'PHONE': {
      const p = normalizeBrPhone(raw);
      if (!p) return 'Informe um telefone válido com DDD.';
      values[field.key] = p;
      return null;
    }
    case 'CPF': {
      if (typeof raw !== 'string' && typeof raw !== 'number') return 'Informe um CPF válido.';
      const digits = onlyDigits(String(raw));
      if (!isValidCpf(digits)) return 'Informe um CPF válido.';
      values[field.key] = digits;
      return null;
    }
    case 'DATE': {
      const d = normalizeDate(raw);
      if (!d) return 'Informe uma data válida.';
      values[field.key] = d;
      return null;
    }
    case 'SINGLE_CHOICE':
    case 'SELECT': {
      if (typeof raw !== 'string' || !(field.options ?? []).includes(raw)) return 'Escolha uma das opções.';
      values[field.key] = raw;
      return null;
    }
    case 'MULTI_CHOICE': {
      if (!Array.isArray(raw) || raw.length > FORM_LIMITS.maxOptions) return 'Escolha entre as opções.';
      const opts = field.options ?? [];
      if (raw.some((o) => typeof o !== 'string' || !opts.includes(o))) return 'Escolha entre as opções.';
      values[field.key] = [...new Set(raw as string[])];
      return null;
    }
    case 'FILE': {
      const token = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as { fileToken?: unknown }).fileToken : undefined;
      if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return 'Envie o arquivo novamente.';
      fileTokens[field.key] = token;
      return null;
    }
    default:
      return 'Tipo de campo desconhecido.';
  }
}
