import { randomInt } from 'node:crypto';

/**
 * Codigo GingApp: identificador LEGIVEL e unico de uma pessoa (Person.gingappCode), para ditar/digitar ao entrar em
 * outro grupo. Formato `GING-XXXX-XXXX`: 7 caracteres aleatorios + 1 verificador, de um alfabeto de 32 sem os
 * ambiguos 0/O e 1/I (~35 bits aleatorios: inviavel de enumerar sob o rate limit da API).
 * Verificador = soma ponderada (pesos IMPARES 1,3,5,...) mod 32: detecta qualquer troca de UM caractere e a maioria
 * das inversoes de vizinhos.
 */
export const GINGAPP_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const PREFIX = 'GING';
const BODY_LENGTH = 7;

function checkChar(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum += GINGAPP_CODE_ALPHABET.indexOf(body[i]!) * (2 * i + 1);
  return GINGAPP_CODE_ALPHABET[sum % GINGAPP_CODE_ALPHABET.length]!;
}

function format(raw8: string): string {
  return `${PREFIX}-${raw8.slice(0, 4)}-${raw8.slice(4)}`;
}

export function generateGingappCode(random: (max: number) => number = randomInt): string {
  let body = '';
  for (let i = 0; i < BODY_LENGTH; i++) body += GINGAPP_CODE_ALPHABET[random(GINGAPP_CODE_ALPHABET.length)];
  return format(body + checkChar(body));
}

/**
 * Entrada do usuario -> forma canonica `GING-XXXX-XXXX`, ou null se invalida (caractere fora do alfabeto, tamanho
 * errado ou verificador que nao confere). Aceita minusculas, espacos/hifens e com ou sem o prefixo GING.
 */
export function normalizeGingappCode(input: string | null | undefined): string | null {
  let text = (input ?? '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (text.length === 12 && text.startsWith(PREFIX)) text = text.slice(PREFIX.length);
  if (text.length !== BODY_LENGTH + 1) return null;
  if ([...text].some((c) => !GINGAPP_CODE_ALPHABET.includes(c))) return null;
  const body = text.slice(0, BODY_LENGTH);
  return checkChar(body) === text[BODY_LENGTH] ? format(text) : null;
}
