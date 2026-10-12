import { StudentStatus } from '@prisma/client';
import { isEmail } from 'class-validator';
import { unescapeFormulaCell } from '../../../shared/csv/csv';
import { formatCpf, isValidCpf } from '../../../shared/security/person-document';
import { normalizeGingappCode } from '../people/gingapp-code';

/**
 * Regras PURAS de validacao/normalizacao de uma linha da importacao de alunos (POST /students/import) — sem banco,
 * testaveis em unidade. A linha chega como TEXTO CRU do CSV (o painel so parseia o arquivo); aqui e que se valida.
 */

/** Rotulos em pt-BR da situacao do aluno (usados na exportacao e aceitos na importacao). */
export const STUDENT_STATUS_LABEL_BR: Record<StudentStatus, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  SUSPENDED: 'Suspenso',
  FORMER: 'Ex-aluno',
};

/** Minusculas, sem acento, espacos colapsados — comparacao tolerante de nomes de aluno/unidade/rotulos. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Celula crua -> texto limpo: apara, remove o apostrofo anti-formula da exportacao e colapsa espacos internos. */
export function cleanCell(raw: string | null | undefined): string {
  return unescapeFormulaCell((raw ?? '').trim()).replace(/\s+/g, ' ').trim();
}

/**
 * Data civil "YYYY-MM-DD" ou "DD/MM/YYYY" (tambem "DD-MM-YYYY"; dia/mes de 1 digito; ISO com hora e aceito).
 * Rejeita dia inexistente (31/02), ano < 1900. Devolve meia-noite UTC do dia (a mesma representacao do banco).
 */
export function parseCivilDate(raw: string): Date | null {
  const text = raw.trim();
  let year: number;
  let month: number;
  let day: number;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/.exec(text);
  if (m) {
    year = Number(m[1]);
    month = Number(m[2]);
    day = Number(m[3]);
  } else {
    m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
    if (!m) return null;
    day = Number(m[1]);
    month = Number(m[2]);
    year = Number(m[3]);
  }
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? date : null;
}

/** "yyyy-MM-dd" de uma data civil (meia-noite UTC). */
export function civilKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// CPF: SSOT em shared/security/person-document.ts (a ficha unica usa as mesmas regras); reexportado para os chamadores.
export { formatCpf, isValidCpf } from '../../../shared/security/person-document';

/** Telefone brasileiro: 10 a 13 digitos (DDD + numero, com ou sem 55). Devolve o texto aparado como veio. */
export function isValidPhone(text: string): boolean {
  if (!/^[\d\s()+.\-]+$/.test(text)) return false;
  const digits = text.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 13;
}

const STATUS_ALIASES: Record<string, StudentStatus> = {
  active: StudentStatus.ACTIVE,
  ativo: StudentStatus.ACTIVE,
  ativa: StudentStatus.ACTIVE,
  inactive: StudentStatus.INACTIVE,
  inativo: StudentStatus.INACTIVE,
  inativa: StudentStatus.INACTIVE,
  suspended: StudentStatus.SUSPENDED,
  suspenso: StudentStatus.SUSPENDED,
  suspensa: StudentStatus.SUSPENDED,
  former: StudentStatus.FORMER,
  'ex-aluno': StudentStatus.FORMER,
  'ex aluno': StudentStatus.FORMER,
  exaluno: StudentStatus.FORMER,
};

export function parseStudentStatus(raw: string): StudentStatus | null {
  return STATUS_ALIASES[normalizeText(raw)] ?? null;
}

/** Linha crua do arquivo (todas as chaves opcionais; `line` = numero da linha no arquivo, cabecalho = 1). */
export interface RawStudentRow {
  line?: number;
  name?: string | null;
  birthDate?: string | null;
  email?: string | null;
  phone?: string | null;
  document?: string | null;
  unit?: string | null;
  status?: string | null;
  joinedAt?: string | null;
  /** Ficha unica: CPF do responsavel (crianca sem CPF; exige nascimento) e codigo GingApp de quem ja tem ficha. */
  guardianDocument?: string | null;
  gingappCode?: string | null;
}

export interface UnitRef {
  id: number;
  name: string;
  active: boolean;
}

/** Linha validada e normalizada, pronta para gravar. */
export interface ParsedStudentRow {
  name: string;
  birthDate: Date | null;
  email: string | null;
  phone: string | null;
  document: string | null;
  unitId: number | null;
  status: StudentStatus;
  joinedAt: Date | null;
  /** Digitos do CPF do responsavel (so quando informado e valido). */
  guardianDocument: string | null;
  /** Codigo GingApp canonico (GING-XXXX-XXXX). */
  gingappCode: string | null;
}

const NAME_MIN = 2;
const NAME_MAX = 120;

/**
 * Valida uma linha. `units` = unidades do grupo indexadas por nome normalizado. Devolve a linha normalizada OU a
 * lista (nao vazia) de mensagens em pt-BR. Todas as falhas da linha sao coletadas de uma vez (nao so a primeira).
 */
export function parseStudentRow(
  raw: RawStudentRow,
  units: ReadonlyMap<string, UnitRef>,
  today: Date,
): { ok: true; row: ParsedStudentRow } | { ok: false; errors: string[] } {
  const errors: string[] = [];

  const name = cleanCell(raw.name);
  if (!name) errors.push('Nome é obrigatório.');
  else if (name.length < NAME_MIN) errors.push(`Nome deve ter ao menos ${NAME_MIN} letras.`);
  else if (name.length > NAME_MAX) errors.push(`Nome deve ter no máximo ${NAME_MAX} caracteres.`);

  let birthDate: Date | null = null;
  const birthText = cleanCell(raw.birthDate);
  if (birthText) {
    birthDate = parseCivilDate(birthText);
    if (!birthDate) errors.push('Data de nascimento inválida (use dd/mm/aaaa ou aaaa-mm-dd).');
    else if (birthDate.getTime() > today.getTime()) errors.push('Data de nascimento não pode ser futura.');
  }

  let joinedAt: Date | null = null;
  const joinedText = cleanCell(raw.joinedAt);
  if (joinedText) {
    joinedAt = parseCivilDate(joinedText);
    if (!joinedAt) errors.push('Data de ingresso inválida (use dd/mm/aaaa ou aaaa-mm-dd).');
    else if (joinedAt.getTime() > today.getTime()) errors.push('Data de ingresso não pode ser futura.');
  }

  let email: string | null = null;
  const emailText = cleanCell(raw.email);
  if (emailText) {
    if (emailText.length > 254 || !isEmail(emailText)) errors.push('E-mail inválido.');
    else email = emailText.toLowerCase();
  }

  let phone: string | null = null;
  const phoneText = cleanCell(raw.phone);
  if (phoneText) {
    if (!isValidPhone(phoneText)) errors.push('Telefone inválido (informe DDD + número).');
    else phone = phoneText;
  }

  let document: string | null = null;
  const documentText = cleanCell(raw.document);
  if (documentText) {
    const digits = documentText.replace(/\D/g, '');
    if (!isValidCpf(digits)) errors.push('CPF inválido.');
    else document = formatCpf(digits);
  }

  let unitId: number | null = null;
  const unitText = cleanCell(raw.unit);
  if (unitText) {
    const unit = units.get(normalizeText(unitText));
    if (!unit) errors.push(`Unidade "${unitText}" não encontrada neste grupo.`);
    else if (!unit.active) errors.push(`Unidade "${unit.name}" está inativa.`);
    else unitId = unit.id;
  }

  let status: StudentStatus = StudentStatus.ACTIVE;
  const statusText = cleanCell(raw.status);
  if (statusText) {
    const parsed = parseStudentStatus(statusText);
    if (!parsed) errors.push('Situação inválida (use Ativo, Inativo, Suspenso ou Ex-aluno).');
    else status = parsed;
  }

  let guardianDocument: string | null = null;
  const guardianText = cleanCell(raw.guardianDocument);
  if (guardianText) {
    const digits = guardianText.replace(/\D/g, '');
    if (!isValidCpf(digits)) errors.push('CPF do responsável inválido.');
    else if (!birthText) errors.push('Informe a data de nascimento para usar o CPF do responsável.');
    else guardianDocument = digits;
  }

  let gingappCode: string | null = null;
  const codeText = cleanCell(raw.gingappCode);
  if (codeText) {
    gingappCode = normalizeGingappCode(codeText);
    if (!gingappCode) errors.push('Código GingApp inválido.');
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, row: { name, birthDate, email, phone, document, unitId, status, joinedAt, guardianDocument, gingappCode } };
}
