/** Move um item de lugar sem mutar a lista (devolve a própria lista se o movimento for inválido ou nulo). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

// Cores sugeridas para completar quando o estilo pede mais cores do que as escolhidas.
const FILL_COLORS = ["#16a34a", "#facc15", "#2563eb", "#dc2626"];

/** Ajusta a lista de cores ao nº exigido pelo estilo, preservando as já escolhidas. */
export function fitColors(colors: string[], count: number): string[] {
  const next = colors.slice(0, count);
  for (const candidate of FILL_COLORS) {
    if (next.length >= count) break;
    if (!next.includes(candidate)) next.push(candidate);
  }
  return next;
}
