/**
 * Cores de identidade do atleta no chaveamento (mesma lógica do telão público, reimplementada aqui: são projetos
 * separados). O anel do avatar leva a cor do GRUPO (matiz estável pelo nome); sem grupo, um cinza-azulado neutro.
 * A cor é só identidade: o status da luta (ao vivo, vencedor...) sempre tem texto/ícone além dela.
 */

/** Cores de fundo das iniciais para quem não tem grupo (escuras o bastante para texto branco). */
const PALETTE = ["#1b5e43", "#2f6f8f", "#8a4f9e", "#b0533a", "#6b7a1f", "#a1455f", "#46628c", "#7a5a2b", "#0f766e", "#9a3412"];

/** Cor ESTÁVEL por id do atleta (ids vizinhos caem em cores diferentes: 7 e 10 são coprimos). */
export function colorForId(id: number): string {
  const n = Math.abs(Math.trunc(id)) || 0;
  return PALETTE[(n * 7) % PALETTE.length] ?? PALETTE[0]!;
}

/** FNV-1a de 32 bits: barato e estável entre execuções (nada de Math.random). */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Faixa de matizes dos grupos: verde → ciano → azul → roxo → magenta (vermelho/laranja ficam só para "AO VIVO"). */
const HUE_MIN = 120;
const HUE_SPAN = 210;

/** Matiz (graus) estável pelo nome do grupo; sem grupo = `null`. Maiúsculas e espaços não mudam a cor. */
export function groupHue(group: string | null | undefined): number | null {
  const name = (group ?? "").trim().toLowerCase();
  if (name === "") return null;
  return HUE_MIN + (hash32(name) % HUE_SPAN);
}

/** Cor do anel (média: funciona sobre fundo claro e escuro). */
export function ringColorForGroup(group: string | null | undefined): string {
  const hue = groupHue(group);
  return hue === null ? "oklch(.7 .03 250)" : `oklch(.66 .15 ${String(hue)})`;
}

/** Fundo das iniciais: gradiente do grupo (escuro, contraste AA com texto branco); sem grupo, a cor estável do atleta. */
export function initialsBackground(id: number, group: string | null | undefined): string {
  const hue = groupHue(group);
  if (hue === null) return colorForId(id);
  return `linear-gradient(145deg, oklch(.5 .13 ${String(hue)}), oklch(.36 .09 ${String((hue + 28) % 360)}))`;
}
