import { randomInt } from 'node:crypto';

/**
 * Gerador da SENHA PROVISÓRIA FÁCIL (cadastro rápido do aluno, "criar acesso" sem digitar senha e "redefinir senha"
 * sem digitar senha). Formato `PalavraPalavraNN`, ex.: "PraiaBarco47" (duas palavras curtas em
 * português SEM acento, capitalizadas, mais 2 dígitos).
 *
 * Por que 5-6 letras por palavra (e não 3-5): a política da senha NOVA (password-policy.ts / @IsNewPassword) exige no
 * MÍNIMO 12 caracteres; duas palavras de 5+ letras + 2 dígitos = 12..14, sempre dentro da política (máx. 72 bytes) e
 * sem maiúscula/dígito obrigatórios (a política só tem tamanho mínimo/máximo e a recusa do Dev@12345).
 *
 * ENTROPIA BAIXA DE PROPÓSITO (~19 bits: palavras^2 x 64): é uma senha PROVISÓRIA, fácil de ditar por telefone/WhatsApp
 * e digitar no celular. O risco é aceito porque ela (1) nasce com `mustChangePassword = true` (o servidor barra tudo
 * até a pessoa trocar a própria senha no 1º acesso) e (2) o login tem rate limit por IP e por e-mail. Sempre que houver
 * convite por e-mail (link de definir a própria senha) ele é preferível. Usa `crypto.randomInt` (nunca Math.random).
 *
 * Os dígitos vêm de 2..9 (sem 0 e 1, que se confundem com O e l/I ao ditar). A senha só existe na resposta HTTP da
 * criação/redefinição: nunca é logada, auditada nem gravada em claro (só o hash bcrypt, como toda senha).
 */
export const TEMPORARY_PASSWORD_WORDS: readonly string[] = [
  'Praia', 'Barco', 'Campo', 'Carro', 'Coral', 'Corda', 'Festa', 'Fruta', 'Gente', 'Grama',
  'Livro', 'Lunar', 'Manga', 'Massa', 'Menta', 'Metal', 'Milho', 'Mundo', 'Nuvem', 'Ondas',
  'Palma', 'Pedra', 'Pente', 'Pista', 'Plano', 'Ponte', 'Prato', 'Preto', 'Rosto', 'Samba',
  'Terra', 'Tigre', 'Tinta', 'Trigo', 'Vento', 'Verde', 'Vidro', 'Zebra', 'Navio', 'Banco',
  'Bravo', 'Brisa', 'Calor', 'Canto', 'Cesta', 'Chave', 'Claro', 'Cobre', 'Cravo', 'Dados',
  'Disco', 'Fonte', 'Forte', 'Globo', 'Gorro', 'Hotel', 'Lagoa', 'Leite', 'Lugar', 'Moeda',
  'Monte', 'Morro', 'Mural', 'Noite', 'Norte', 'Ordem', 'Piano', 'Pilha', 'Pomar', 'Prova',
  'Radio', 'Regua', 'Reino', 'Renda', 'Ritmo', 'Sabor', 'Salto', 'Selva', 'Sinal', 'Sitio',
  'Sorte', 'Tarde', 'Tempo', 'Tenda', 'Tocha', 'Turma', 'Valor', 'Viola', 'Vinho', 'Volta',
  'Ginga', 'Aluno', 'Jogar', 'Mestre', 'Treino', 'Angola', 'Cordao', 'Trilha', 'Brasil', 'Farol',
];

/** Dígitos usados no sufixo: sem 0 e 1 (confundem com O/l ao ditar). */
const DIGITS = '23456789';

/**
 * Termos impróprios (minúsculas, sem acento) que NUNCA podem aparecer na senha gerada, nem dentro de uma palavra nem
 * na junção das duas ("Gente"+"Tarde" -> "gentetarde" contém "teta"). Lista curada e conservadora: o gerador sorteia
 * de novo quando o resultado contém qualquer um (ver `isOffensive`).
 */
export const TEMPORARY_PASSWORD_BLOCKLIST: readonly string[] = [
  'cu', 'pau', 'teta', 'puta', 'puto', 'rola', 'pica', 'piroca', 'caralh', 'porra', 'merda', 'bosta', 'cacete',
  'foda', 'fode', 'fudi', 'foder', 'buceta', 'xota', 'xana', 'bunda', 'viado', 'bicha', 'cuzao', 'peido', 'pinto',
  'tesao', 'sexo', 'nazi', 'anus', 'cagar', 'mijo', 'gozo', 'vaca', 'burro', 'idiota', 'lixo', 'morte', 'matar',
];

/** true = a senha (em qualquer caixa) contém algum termo da lista de impróprios. */
export function isOffensive(candidate: string): boolean {
  const lowered = candidate.toLowerCase();
  return TEMPORARY_PASSWORD_BLOCKLIST.some((term) => lowered.includes(term));
}

function pickWord(): string {
  return TEMPORARY_PASSWORD_WORDS[randomInt(TEMPORARY_PASSWORD_WORDS.length)];
}

function pickDigit(): string {
  return DIGITS[randomInt(DIGITS.length)];
}

/**
 * "Senha informada ou gerada" (SSOT dos fluxos de criar acesso e redefinir senha): `given` ausente (undefined/null) =>
 * gera a provisória fácil e marca `generated`; informada => usa como veio (a política já foi validada no DTO).
 */
export function providedOrGeneratedPassword(given: string | null | undefined): { password: string; generated: boolean } {
  if (given === undefined || given === null) return { password: generateTemporaryPassword(), generated: true };
  return { password: given, generated: false };
}

/** Gera uma senha provisória fácil (`PalavraPalavraNN`), sempre dentro da política de senha nova. */
export function generateTemporaryPassword(): string {
  for (;;) {
    const first = pickWord();
    const second = pickWord();
    if (first === second) continue;
    const candidate = `${first}${second}${pickDigit()}${pickDigit()}`;
    if (!isOffensive(candidate)) return candidate;
  }
}
