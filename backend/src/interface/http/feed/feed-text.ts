/**
 * Funcoes PURAS do feed (sem banco): texto puro, palavras bloqueadas, cursor, dia civil e idade. Testadas em
 * test/feed.spec.ts.
 */

/** Caracteres invisiveis/de controle de direcao (spoofing de texto) e de controle (exceto quebra de linha). */
const INVISIBLE = /[​-‏‪-‮⁠-⁤⁦-⁩﻿]/g;
const CONTROL = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g;

/**
 * Texto do usuario SEMPRE como texto puro: nada e interpretado (HTML vira texto literal; quem exibe escapa). Aqui so
 * se normaliza: NFC, CRLF -> LF, sem controle/invisiveis, espacos/tabs repetidos -> 1 espaco, espaco no fim da linha
 * fora, no maximo 1 linha em branco seguida, trim. Vazio -> null. `multiline=false` (comentario/nota) junta as linhas.
 */
export function normalizeUserText(value: string | null | undefined, multiline = true): string | null {
  if (typeof value !== 'string') return null;
  let text = value.normalize('NFC').replace(/\r\n?/g, '\n').replace(INVISIBLE, '').replace(/\t/g, ' ').replace(CONTROL, '');
  text = text
    .split('\n')
    .map((line) => line.replace(/ {2,}/g, ' ').trimEnd())
    .join(multiline ? '\n' : ' ');
  text = multiline ? text.replace(/\n{3,}/g, '\n\n') : text.replace(/ {2,}/g, ' ');
  text = text.trim();
  return text.length > 0 ? text : null;
}

/** Forma de comparacao: sem acento, minusculas, so letras/numeros separados por 1 espaco. */
export function foldForMatch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Lista de palavras bloqueadas como o MESTRE salvou: trim, sem vazias, sem repetidas (pela forma de comparacao),
 * na ordem em que vieram. Validacao de tamanho/quantidade fica no DTO.
 */
export function cleanBlockedWords(words: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of words) {
    const word = (normalizeUserText(raw, false) ?? '').slice(0, 40);
    const folded = foldForMatch(word);
    if (!folded || seen.has(folded)) continue;
    seen.add(folded);
    out.push(word);
  }
  return out;
}

/**
 * O texto contem alguma palavra/expressao bloqueada? Comparacao por PALAVRA INTEIRA na forma sem acento/caixa
 * ("cu" nao casa "cultura"; "idiota" casa "IDIÓTA" e "idiota!"; expressao "pau mole" casa com qualquer pontuacao entre
 * as palavras). Limitacao conhecida: plural/variacao ("idiotas") e "l33t" nao casam (cadastre as variacoes).
 */
export function containsBlockedWord(text: string | null | undefined, blockedWords: readonly string[]): boolean {
  if (!text || blockedWords.length === 0) return false;
  const haystack = ` ${foldForMatch(text)} `;
  return blockedWords.some((w) => {
    const needle = foldForMatch(w);
    return needle.length > 0 && haystack.includes(` ${needle} `);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Cursor (keyset): estavel por (pinned, createdAt, id), sem OFFSET (custo nao cresce com a pagina)
// ---------------------------------------------------------------------------------------------------------------

export interface FeedCursor {
  pinned: boolean;
  createdAt: Date;
  id: number;
}

/** `p.<epochMs>.<id>` em base64url (opaco para o cliente). */
export function encodeCursor(c: FeedCursor): string {
  return Buffer.from(`${c.pinned ? 1 : 0}.${c.createdAt.getTime()}.${c.id}`, 'utf8').toString('base64url');
}

/** Cursor invalido/adulterado = null (o chamador responde 400). */
export function decodeCursor(raw: string | undefined | null): FeedCursor | null {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 80 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  const m = /^([01])\.(\d{1,15})\.(\d{1,10})$/.exec(Buffer.from(raw, 'base64url').toString('utf8'));
  if (!m) return null;
  const id = Number(m[3]);
  const ms = Number(m[2]);
  if (!Number.isSafeInteger(id) || id < 1 || id > 2_147_483_647 || !Number.isSafeInteger(ms)) return null;
  return { pinned: m[1] === '1', createdAt: new Date(ms), id };
}

// ---------------------------------------------------------------------------------------------------------------
// Datas: dia civil e idade em America/Sao_Paulo (UTC-3 fixo, mesma convencao de shared/checkin/checkin-window.ts)
// ---------------------------------------------------------------------------------------------------------------

const SP_OFFSET_MS = 3 * 60 * 60 * 1000;

/** Instante da meia-noite (Sao Paulo) do dia civil de `now`: base das cotas diarias. */
export function startOfDaySaoPaulo(now: Date = new Date()): Date {
  const local = new Date(now.getTime() - SP_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + SP_OFFSET_MS);
}

/**
 * Idade completa em `now` (Sao Paulo). `birthDate` e data civil (gravada como meia-noite UTC: usa os campos UTC).
 * 29/02 em ano nao bissexto faz aniversario em 01/03 (para a regra de menoridade, a interpretacao mais conservadora).
 */
export function ageOn(birthDate: Date, now: Date = new Date()): number {
  const local = new Date(now.getTime() - SP_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  let age = y - birthDate.getUTCFullYear();
  const bm = birthDate.getUTCMonth();
  const bd = birthDate.getUTCDate();
  if (m < bm || (m === bm && d < bd)) age -= 1;
  return age;
}
