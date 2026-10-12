import { API_URL, ApiError, buildQuery, type QueryParams } from "@/lib/api";
import { getToken } from "@/lib/session";

/**
 * CSV para Excel pt-BR (espelha backend/src/shared/csv/csv.ts): UTF-8 com BOM, separador ";", CRLF, aspas nos campos
 * com ; " ou quebra de linha. Texto que começa com = + - @ (ou TAB/CR) ganha apóstrofo, contra CSV injection.
 */
export const CSV_BOM = "﻿";
export const CSV_SEPARATOR = ";";

const FORMULA_START = /^\s*[=+\-@]|^[\t\r]/;

export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text: string;
  if (typeof value === "number") text = Number.isFinite(value) ? String(value) : "";
  else if (typeof value === "boolean") text = value ? "Sim" : "Não";
  else text = FORMULA_START.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export type CsvValue = string | number | boolean | null | undefined;

export function buildCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [headers.map(csvCell).join(CSV_SEPARATOR), ...rows.map((row) => row.map(csvCell).join(CSV_SEPARATOR))];
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}

/** Número com vírgula decimal ("87,5") para planilhas pt-BR. */
export function decimalBr(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value).replace(".", ",");
}

/** Centavos como "1234,56" (sem símbolo). */
export function reais(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "";
  const abs = Math.abs(cents);
  return `${cents < 0 ? "-" : ""}${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
}

/** yyyy-MM-dd de hoje (hora local), para nomear arquivos. */
export function todayStamp(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Entrega um texto/Blob como download no navegador. */
export function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function saveCsv(filename: string, csv: string): void {
  saveBlob(filename, new Blob([csv], { type: "text/csv;charset=utf-8" }));
}

/**
 * Baixa um CSV gerado pelo servidor (GET autenticado, ex.: /students/export.csv) respeitando os filtros em `params`.
 * Erros viram `ApiError` com a mensagem do backend.
 */
export async function downloadServerCsv(path: string, params: QueryParams, filename: string): Promise<void> {
  const token = getToken();
  const response = await fetch(`${API_URL}${path}${buildQuery(params)}`, {
    method: "GET",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
    const message = Array.isArray(body?.message) ? body.message.join(" ") : body?.message;
    throw new ApiError(message ?? `Erro ${response.status} ao exportar.`, response.status);
  }
  saveBlob(filename, await response.blob());
}

/**
 * Lê um CSV (UTF-8 com ou sem BOM; separador ";" "," ou TAB detectado na 1ª linha; aspas duplas com "" escapado;
 * CRLF/LF) e devolve as linhas não vazias como matriz de textos.
 */
export function parseCsv(input: string): string[][] {
  const text = input.startsWith(CSV_BOM) ? input.slice(1) : input;
  const firstLine = text.split(/\r\n|\n|\r/, 1)[0] ?? "";
  // Conta separadores fora de aspas na 1ª linha.
  const counts: Record<string, number> = { ";": 0, ",": 0, "\t": 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch] = (counts[ch] ?? 0) + 1;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  const delimiter = best && best[1] > 0 ? best[0] : ";";

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.some((c) => c.trim() !== "")) rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) endCell();
    else if (ch === "\n") endRow();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}
