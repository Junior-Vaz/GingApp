/** Só os dígitos de um texto (CPF, telefone). */
export const onlyDigits = (value: string): string => value.replace(/\D/g, "");

/** Máscara progressiva do CPF: 000.000.000-00 (aceita colar com ou sem pontuação; corta em 11 dígitos). */
export function formatCpf(value: string): string {
  const d = onlyDigits(value).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** CPF válido: 11 dígitos, não todos iguais, com os dois dígitos verificadores corretos. */
export function isValidCpf(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const check = (length: number): number => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(d[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

/** Máscara progressiva do telefone BR: (61) 99999-9999 ou (61) 9999-9999 (corta em 11 dígitos). */
export function formatPhone(value: string): string {
  let digits = onlyDigits(value);
  if (digits.length > 11 && digits.startsWith("55")) digits = digits.slice(2); // colou "+55 61 ..."
  const d = digits.slice(0, 11);
  if (d.length === 0) return "";
  if (d.length <= 2) return `(${d}`;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

/** Telefone BR com DDD: 10 ou 11 dígitos (aceita o prefixo 55 colado: 12 ou 13 dígitos). */
export function isValidPhone(value: string): boolean {
  const d = onlyDigits(value);
  if (d.length >= 12 && d.startsWith("55")) return d.length <= 13;
  return d.length === 10 || d.length === 11;
}
