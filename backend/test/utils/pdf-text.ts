import { inflateSync } from 'node:zlib';

/**
 * Texto (aproximado) de um PDF gerado pelo pdfkit, para os testes: descomprime os streams de conteúdo e junta as strings
 * hexadecimais dos operadores de texto. Vale para a Helvetica (fonte padrão, bytes WinAnsi); fontes embutidas viram ids de
 * glifo (não legíveis) — os testes que leem o texto usam Helvetica.
 */
export function pdfText(pdf: Buffer): string {
  const raw = pdf.toString('latin1');
  const parts: string[] = [];
  for (const match of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let content: string;
    try {
      content = inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
    } catch {
      continue; // stream não comprimido com Flate (ou binário de imagem): ignora
    }
    if (!content.includes('BT')) continue;
    for (const hex of content.matchAll(/<([0-9a-fA-F]+)>/g)) parts.push(Buffer.from(hex[1], 'hex').toString('latin1'));
  }
  return parts.join('');
}

/** Quantidade de páginas (objetos /Type /Page). */
export function pdfPageCount(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type \/Page\b/g) ?? []).length;
}

/** MediaBox da (primeira) página: [largura, altura] em pt. */
export function pdfMediaBox(pdf: Buffer): [number, number] | null {
  const m = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf.toString('latin1'));
  return m ? [Number(m[1]), Number(m[2])] : null;
}
