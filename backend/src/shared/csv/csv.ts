/**
 * CSV para Excel pt-BR (SSOT das exportacoes): UTF-8 COM BOM, separador ';' (o Excel brasileiro usa ';' porque a
 * virgula e o separador decimal), fim de linha CRLF e aspas duplas nos campos que contem ';', '"' ou quebra de linha.
 *
 * CSV injection (OWASP): um texto que comeca com '=', '+', '-' ou '@' (ou TAB/CR) vira FORMULA no Excel/LibreOffice
 * (ex.: um nome de aluno "=HYPERLINK(...)"). Toda celula de TEXTO que comece assim e prefixada com apostrofo.
 * Numeros (tipo number) nao sao tocados — o chamador controla o valor. Quem importa o CSV de volta remove esse
 * apostrofo (ver `unescapeFormulaCell`).
 */
export const CSV_BOM = '﻿';
export const CSV_SEPARATOR = ';';
export const CSV_EOL = '\r\n';
/** Teto de linhas de uma exportacao (acima disso o arquivo e cortado e o total real vai em X-Total-Count). */
export const EXPORT_MAX_ROWS = 20000;

const FORMULA_START = /^\s*[=+\-@]|^[\t\r]/;

/** Neutraliza texto que o Excel interpretaria como formula (prefixo apostrofo). */
export function neutralizeFormula(text: string): string {
  return FORMULA_START.test(text) ? `'${text}` : text;
}

/** Inverso de `neutralizeFormula` para a IMPORTACAO: "'=x" volta a "=x" (so quando o apostrofo antecede um gatilho). */
export function unescapeFormulaCell(text: string): string {
  return /^'\s*[=+\-@]/.test(text) ? text.slice(1) : text;
}

/** Uma celula pronta para o arquivo (escapada). null/undefined = vazio. */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (typeof value === 'number') {
    text = Number.isFinite(value) ? String(value) : '';
  } else if (typeof value === 'boolean') {
    text = value ? 'Sim' : 'Não';
  } else if (value instanceof Date) {
    text = Number.isNaN(value.getTime()) ? '' : value.toISOString();
  } else {
    text = neutralizeFormula(String(value));
  }
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Arquivo completo: BOM + cabecalho + linhas (CRLF). */
export function buildCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  const lines = [headers.map(csvCell).join(CSV_SEPARATOR), ...rows.map((row) => row.map(csvCell).join(CSV_SEPARATOR))];
  return CSV_BOM + lines.join(CSV_EOL) + CSV_EOL;
}

/** Valor em reais "1234,50" (pt-BR, sem simbolo) a partir de centavos — fica como TEXTO numerico para o Excel. */
export function centsToReais(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, '0')}`;
}

/** Cabecalhos de resposta de um CSV para download (`res` do Express). */
export function sendCsv(
  res: { setHeader(name: string, value: string): unknown },
  filename: string,
  csv: string,
  total?: number,
): string {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/[^\w.\-]/g, '_')}"`);
  res.setHeader('Cache-Control', 'no-store');
  if (total !== undefined) res.setHeader('X-Total-Count', String(total));
  return csv;
}

/** "yyyy-MM-dd" de hoje (America/Sao_Paulo) para nomear arquivos. */
export function fileDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}
