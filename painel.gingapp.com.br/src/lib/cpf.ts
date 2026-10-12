// CPF: apenas dígitos, máscara 000.000.000-00 e validação dos dígitos verificadores.

export const onlyDigits = (value: string): string => value.replace(/\D/g, "");

/** Valida o CPF (com ou sem máscara) pelos dígitos verificadores; rejeita sequências repetidas (111.111.111-11...). */
export function isValidCpf(value: string): boolean {
  const digits = onlyDigits(value);
  if (digits.length !== 11 || /^(\d)\1{10}$/.test(digits)) return false;
  const check = (length: number): number => {
    let sum = 0;
    for (let i = 0; i < length; i += 1) sum += Number(digits[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

/** Aplica a máscara 000.000.000-00 (parcial enquanto digita; no máximo 11 dígitos). */
export function formatCpf(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/**
 * Máscara de digitação: só reformata quando o texto parece um CPF (dígitos, ponto, traço, espaço). Se tiver letras
 * (documento legado, ex.: passaporte), devolve o texto como está para não destruir o dado.
 */
export function maskCpfInput(value: string): string {
  return /^[\d.\-\s]*$/.test(value) ? formatCpf(value) : value;
}
