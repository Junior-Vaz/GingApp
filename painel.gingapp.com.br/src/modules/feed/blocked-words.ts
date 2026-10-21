import { BLOCKED_WORDS_MAX, BLOCKED_WORD_LENGTH_MAX } from "./types";

/**
 * Valida e junta palavras digitadas (separadas por vírgula ou quebra de linha) à lista. Devolve a nova lista ou o
 * motivo da recusa: máx. 50 palavras, cada uma com até 40 caracteres, sem repetir (ignora maiúsculas).
 */
export function addBlockedWords(current: string[], input: string): { words: string[]; error: string | null } {
  const typed = input
    .split(/[,\n]/)
    .map((w) => w.trim())
    .filter(Boolean);
  if (typed.length === 0) return { words: current, error: "Digite uma palavra para bloquear." };
  const words = [...current];
  for (const word of typed) {
    if (word.length > BLOCKED_WORD_LENGTH_MAX)
      return { words: current, error: `Cada palavra pode ter até ${String(BLOCKED_WORD_LENGTH_MAX)} caracteres.` };
    if (words.some((w) => w.toLowerCase() === word.toLowerCase())) continue;
    if (words.length >= BLOCKED_WORDS_MAX)
      return { words: current, error: `Limite de ${String(BLOCKED_WORDS_MAX)} palavras bloqueadas.` };
    words.push(word);
  }
  return { words, error: null };
}
