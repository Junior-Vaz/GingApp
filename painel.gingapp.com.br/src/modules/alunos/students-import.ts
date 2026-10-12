import { buildCsv, parseCsv } from "@/lib/csv";

/** Teto de linhas por importação (o backend recusa mais que isso). */
export const IMPORT_MAX_ROWS = 500;
/** Teto de tamanho do arquivo lido no navegador. */
export const IMPORT_MAX_BYTES = 1024 * 1024;

export interface ImportRow {
  /** Número da linha no arquivo (cabeçalho = 1). */
  line: number;
  name?: string;
  birthDate?: string;
  email?: string;
  phone?: string;
  document?: string;
  /** CPF do responsável (criança sem CPF; exige a data de nascimento). */
  guardianDocument?: string;
  /** Código GingApp da pessoa, quando ela já tem ficha. */
  gingappCode?: string;
  unit?: string;
  status?: string;
  joinedAt?: string;
}

/** Colunas do modelo (mesmas da exportação de alunos: o arquivo exportado pode ser reimportado). */
export const TEMPLATE_HEADERS = [
  "Nome",
  "Data de nascimento",
  "E-mail",
  "Telefone",
  "CPF",
  "Unidade",
  "Situação",
  "Data de ingresso",
  "CPF do responsável",
  "Código GingApp",
] as const;

const normalizeHeader = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Cabeçalhos aceitos (sem acento/caixa/pontuação) -> campo da linha. */
const HEADER_FIELD: Record<string, keyof Omit<ImportRow, "line">> = {
  nome: "name",
  "nome completo": "name",
  aluno: "name",
  "data de nascimento": "birthDate",
  "data nascimento": "birthDate",
  nascimento: "birthDate",
  "e mail": "email",
  email: "email",
  telefone: "phone",
  celular: "phone",
  whatsapp: "phone",
  cpf: "document",
  documento: "document",
  "cpf do responsavel": "guardianDocument",
  "cpf responsavel": "guardianDocument",
  "cpf do responsavel legal": "guardianDocument",
  "codigo gingapp": "gingappCode",
  "codigo ginga app": "gingappCode",
  unidade: "unit",
  situacao: "status",
  status: "status",
  "data de ingresso": "joinedAt",
  ingresso: "joinedAt",
  "data de matricula": "joinedAt",
};

/** Modelo para download: cabeçalho + duas linhas de exemplo (a unidade deve existir no grupo, ou ficar vazia). */
export function buildTemplateCsv(): string {
  return buildCsv(TEMPLATE_HEADERS, [
    ["Maria da Silva", "15/03/2012", "maria@exemplo.com", "(11) 91234-5678", "", "", "Ativo", "01/02/2024", "", ""],
    ["João Pereira", "22/08/1990", "", "(21) 99876-5432", "", "", "Ativo", "", "", ""],
  ]);
}

export interface ParsedImport {
  rows: ImportRow[];
  /** Colunas do arquivo que não foram reconhecidas (ignoradas). */
  ignoredColumns: string[];
  /** Erro que impede a importação (arquivo vazio, sem coluna Nome, linhas demais). */
  error: string | null;
}

/** Converte o texto do CSV em linhas para POST /students/import. */
export function parseStudentsCsv(text: string): ParsedImport {
  const records = parseCsv(text);
  const header = records[0];
  if (!header || records.length < 2) {
    return { rows: [], ignoredColumns: [], error: "O arquivo não tem linhas de alunos (só o cabeçalho ou está vazio)." };
  }
  const fields = header.map((h) => HEADER_FIELD[normalizeHeader(h)]);
  if (!fields.includes("name")) {
    return { rows: [], ignoredColumns: [], error: 'Não encontrei a coluna "Nome" no cabeçalho. Use o modelo do botão acima.' };
  }
  const ignoredColumns = header.filter((_, i) => !fields[i] && header[i]!.trim() !== "");
  const rows: ImportRow[] = records.slice(1).map((record, index) => {
    const row: ImportRow = { line: index + 2 };
    fields.forEach((field, i) => {
      const value = (record[i] ?? "").trim();
      if (field && value !== "") row[field] = value;
    });
    return row;
  });
  if (rows.length > IMPORT_MAX_ROWS) {
    return {
      rows: [],
      ignoredColumns,
      error: `O arquivo tem ${rows.length} linhas; o máximo é ${IMPORT_MAX_ROWS} por importação. Divida em arquivos menores.`,
    };
  }
  return { rows, ignoredColumns, error: null };
}

export type ImportAction = "CREATE" | "IGNORE" | "ERROR";

/** Motivo de negócio por linha (pessoa que já tem ficha no GingApp). */
export type ImportCode = "PERSON_ALREADY_IN_GROUP" | "PERSON_EXISTS_ELSEWHERE" | "POSSIBLE_DUPLICATE";

export interface ImportItem {
  line: number;
  name: string;
  action: ImportAction;
  messages: string[];
  code?: ImportCode | undefined;
}

/** Texto amigável do `code` da linha (pt-BR). */
export const IMPORT_CODE_LABEL: Record<ImportCode, string> = {
  PERSON_ALREADY_IN_GROUP: "Já está cadastrada no seu grupo",
  PERSON_EXISTS_ELSEWHERE: "Já tem ficha em outro grupo (transferência em breve)",
  POSSIBLE_DUPLICATE: "Possível duplicado: confira se é a mesma pessoa",
};

/** Contrato de POST /students/import (backend: StudentTransferService.importRows). */
export interface ImportResult {
  dryRun: boolean;
  total: number;
  created: number;
  ignored: number;
  failed: number;
  plan: { maxStudents: number; planName: string; activeStudents: number; availableSlots: number } | null;
  items: ImportItem[];
}
