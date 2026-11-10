/** Cores de fundo das iniciais (escuras o bastante para texto branco). */
const PALETTE = ["#1b5e43", "#2f6f8f", "#8a4f9e", "#b0533a", "#6b7a1f", "#a1455f", "#46628c", "#7a5a2b", "#0f766e", "#9a3412"];

/** Cor ESTÁVEL por id do atleta: o mesmo atleta tem a mesma cor em qualquer tela e a cada atualização. */
export function colorForId(id: number): string {
  const n = Math.abs(Math.trunc(id)) || 0;
  // 7 e 10 são coprimos: ids vizinhos (os dois lados de uma luta) caem em cores diferentes.
  return PALETTE[(n * 7) % PALETTE.length] ?? PALETTE[0]!;
}
