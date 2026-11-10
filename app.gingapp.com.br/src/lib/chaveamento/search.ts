/** `?tv=1` liga o modo telão (fonte grande, sem rolagem, rodízio de categorias). Qualquer outro valor = página normal. */
export const parseTvSearch = (search: Record<string, unknown>): { tv?: 1 } => (search["tv"] === 1 || search["tv"] === "1" ? { tv: 1 } : {});
