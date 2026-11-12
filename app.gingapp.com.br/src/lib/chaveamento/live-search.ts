import { parseTvSearch } from "./search";

/**
 * Links profundos do telão. Fica fora de `search.ts` de propósito: `search.ts` entra no pacote PRINCIPAL do app (a rota valida
 * `?tv=1` antes de carregar o telão); este módulo só é usado pelo componente da rota e vai junto com o pacote do telão.
 */
export interface LiveSearch {
  tv?: 1;
  /** `?categoria=<id>`: abre já nessa categoria (id que não existe no campeonato é ignorado em silêncio). */
  categoria?: number;
  /** `?q=<texto>`: pré-busca de atleta ou grupo (até 60 caracteres; a busca ainda limpa o texto antes de usar). */
  q?: string;
}

/** `tv`, `categoria` (inteiro positivo) e `q` da URL do telão; valores inválidos somem (nunca derrubam a página). */
export function parseLiveSearch(search: Record<string, unknown>): LiveSearch {
  const out: LiveSearch = { ...parseTvSearch(search) };
  const c = search["categoria"];
  const id = typeof c === "number" ? c : typeof c === "string" && /^\d{1,9}$/.test(c.trim()) ? Number(c.trim()) : 0;
  if (Number.isInteger(id) && id > 0 && id < 1e9) out.categoria = id;
  const q = search["q"];
  const text = typeof q === "string" ? q : typeof q === "number" ? String(q) : "";
  if (text.trim() !== "") out.q = text.slice(0, 60);
  return out;
}
