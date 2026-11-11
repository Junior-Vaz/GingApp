/** Cores de fundo das iniciais (escuras o bastante para texto branco). */
const PALETTE = ["#1b5e43", "#2f6f8f", "#8a4f9e", "#b0533a", "#6b7a1f", "#a1455f", "#46628c", "#7a5a2b", "#0f766e", "#9a3412"];

/** Cor ESTÁVEL por id do atleta: o mesmo atleta tem a mesma cor em qualquer tela e a cada atualização. */
export function colorForId(id: number): string {
  const n = Math.abs(Math.trunc(id)) || 0;
  // 7 e 10 são coprimos: ids vizinhos (os dois lados de uma luta) caem em cores diferentes.
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

/** Faixa de matizes dos grupos: verde → ciano → azul → roxo → magenta. Fica de fora o vermelho/laranja (só "AO VIVO") e o dourado (só campeão). */
const HUE_MIN = 120;
const HUE_SPAN = 210;

/** Matiz (graus) ESTÁVEL pelo nome do grupo; sem grupo = null (anel neutro). */
export function groupHue(group: string | null | undefined): number | null {
  const name = (group ?? "").trim().toLowerCase();
  if (name === "") return null;
  return HUE_MIN + (hash32(name) % HUE_SPAN);
}

/** Cor do anel do avatar na cor do grupo (clara, para o palco escuro). Sem grupo: cinza-azulado neutro. */
export function ringColorForGroup(group: string | null | undefined): string {
  const hue = groupHue(group);
  return hue === null ? "oklch(.72 .03 250)" : `oklch(.78 .15 ${hue})`;
}

/** Fundo das iniciais: gradiente do grupo (escuro o bastante para texto branco, contraste AA); sem grupo: a cor estável do atleta. */
export function initialsBackground(id: number, group: string | null | undefined): string {
  const hue = groupHue(group);
  if (hue === null) return colorForId(id);
  return `linear-gradient(145deg, oklch(.52 .13 ${hue}), oklch(.34 .09 ${(hue + 28) % 360}))`;
}
