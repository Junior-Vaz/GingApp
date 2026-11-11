import { computeBracketLayout, type BracketLayout, type LayoutMatch, type LayoutOptions } from "./bracket-layout";

/**
 * Chave grande no telão: em vez de encolher tudo (a letra some), a chave é dividida em PÁGINAS e o telão mostra uma por vez,
 * indo direto para a que tem luta ao vivo ("zoom automático na luta ativa"). Geometria PURA (sem DOM): cada página é um
 * `BracketLayout` normal, então nenhum cartão sobrepõe outro.
 *
 * Janela `H` = quantas rodadas (colunas) cabem numa página. As rodadas são cortadas em janelas que se SOBREPÕEM em uma coluna
 * (a raiz de cada subárvore da janela de baixo é a 1ª coluna da janela de cima, para o leitor seguir o caminho): [1..H],
 * [H..2H-1], ... até a janela que termina na final (a página "Fase final", com a disputa de 3º lugar). Cada página é uma
 * subárvore inteira recortada na janela, então tem no máximo 2^(H-1) lutas na 1ª coluna.
 */

export type BracketPageKind = "whole" | "part" | "final";

export interface BracketPage {
  id: string;
  kind: BracketPageKind;
  /** "Chave completa", "Parte superior", "Parte inferior", "Quadrante 2", "Parte 3 de 8", "Fase final"... */
  label: string;
  /** Posição da página e total (para o indicador "2/3"). */
  index: number;
  count: number;
  /** Lutas desenhadas nesta página (MAIN e a de 3º lugar, quando for o caso). */
  matchIds: number[];
  layout: BracketLayout;
}

export interface PagingPlan {
  /** Rodadas por página; null = chave inteira numa página só. */
  window: number | null;
  pages: BracketPage[];
  /** Escala de cada página na área dada (já limitada a `maxScale`), na mesma ordem de `pages`. */
  scales: number[];
  /** true quando a chave foi dividida (mais de uma página). */
  paged: boolean;
}

export interface PagingOptions {
  /** Menor escala em que a letra ainda é legível; abaixo disso a chave é dividida. */
  minScale: number;
  maxScale: number;
  layout: Partial<LayoutOptions>;
}

export const DEFAULT_PAGING: PagingOptions = { minScale: 0.8, maxScale: 2.2, layout: {} };

const rawScale = (layout: BracketLayout, area: { width: number; height: number }, maxScale: number): number => {
  if (area.width <= 0 || area.height <= 0 || layout.width <= 0 || layout.height <= 0) return 1;
  return Math.min(maxScale, area.width / layout.width, area.height / layout.height);
};

function partLabel(index: number, count: number): string {
  if (count === 2) return index === 0 ? "Parte superior" : "Parte inferior";
  if (count === 4) return `Quadrante ${index + 1}`;
  return `Parte ${index + 1} de ${count}`;
}

interface Draft {
  kind: BracketPageKind;
  group: number;
  matches: LayoutMatch[];
}

function pagesForWindow(matches: readonly LayoutMatch[], windowRounds: number, lastRound: number, layoutOptions: Partial<LayoutOptions>): BracketPage[] {
  const main = matches.filter((m) => m.stage === "MAIN");
  const third = matches.filter((m) => m.stage === "THIRD_PLACE");
  const meta = { lastRound };
  const mainIds = new Set(main.map((m) => m.id));
  const feeders = new Map<number, LayoutMatch[]>();
  for (const m of main) {
    if (m.nextMatchId !== null && mainIds.has(m.nextMatchId)) {
      const list = feeders.get(m.nextMatchId) ?? [];
      list.push(m);
      feeders.set(m.nextMatchId, list);
    }
  }
  const byId = new Map(main.map((m) => [m.id, m]));
  const drafts: Draft[] = [];
  let start = 1;
  let group = 0;
  while (start <= lastRound) {
    const end = Math.min(start + windowRounds - 1, lastRound);
    const roots = main.filter((m) => m.round === end).sort((a, b) => a.position - b.position || a.id - b.id);
    for (const root of roots) {
      // Subárvore da raiz, recortada na janela (só rodadas >= start).
      const picked: LayoutMatch[] = [];
      const stack = [root.id];
      while (stack.length > 0) {
        const id = stack.pop()!;
        const m = byId.get(id)!;
        picked.push(m);
        if (m.round > start) for (const f of feeders.get(id) ?? []) stack.push(f.id);
      }
      const isFinal = end === lastRound;
      drafts.push({ kind: isFinal ? "final" : "part", group, matches: isFinal ? [...picked, ...third] : picked });
    }
    if (end === lastRound) break;
    start = end;
    group += 1;
  }
  const perGroup = new Map<number, number>();
  for (const d of drafts) perGroup.set(d.group, (perGroup.get(d.group) ?? 0) + 1);
  const seen = new Map<number, number>();
  return drafts.map((d, index) => {
    const layout = computeBracketLayout(d.matches, layoutOptions, meta);
    const nth = seen.get(d.group) ?? 0;
    seen.set(d.group, nth + 1);
    const label = d.kind === "final" ? "Fase final" : partLabel(nth, perGroup.get(d.group) ?? 1);
    return { id: `${d.kind}-${index}`, kind: d.kind, label, index, count: drafts.length, matchIds: layout.cards.map((c) => c.matchId), layout };
  });
}

/**
 * Escolhe a MAIOR janela (menos páginas) em que todas as páginas cabem na área com escala >= `minScale`; se nem a menor (2
 * rodadas) serve, usa a menor (melhor esforço). Área desconhecida (0) ou menos de 3 rodadas = chave inteira.
 */
export function planBracketPages(
  matches: readonly LayoutMatch[],
  area: { width: number; height: number },
  options: Partial<PagingOptions> = {},
): PagingPlan {
  const o: PagingOptions = { ...DEFAULT_PAGING, ...options };
  const main = matches.filter((m) => m.stage === "MAIN");
  const rounds = [...new Set(main.map((m) => m.round))].sort((a, b) => a - b);
  const lastRound = rounds.length > 0 ? rounds[rounds.length - 1]! : 1;
  const layout = computeBracketLayout(matches, o.layout, { lastRound });
  const whole: BracketPage[] = [{ id: "whole", kind: "whole", label: "Chave completa", index: 0, count: 1, matchIds: layout.cards.map((c) => c.matchId), layout }];
  const wholePlan: PagingPlan = { window: null, pages: whole, scales: whole.map((p) => rawScale(p.layout, area, o.maxScale)), paged: false };
  if (area.width <= 0 || area.height <= 0 || rounds.length < 3) return wholePlan;
  if (Math.min(...wholePlan.scales) >= o.minScale) return wholePlan;

  let best: PagingPlan = wholePlan;
  for (let windowRounds = rounds.length - 1; windowRounds >= 2; windowRounds -= 1) {
    const pages = pagesForWindow(matches, windowRounds, lastRound, o.layout);
    const scales = pages.map((p) => rawScale(p.layout, area, o.maxScale));
    best = { window: windowRounds, pages, scales, paged: true };
    if (Math.min(...scales) >= o.minScale) break;
  }
  return best;
}

/**
 * Páginas em foco: as que têm luta ao vivo (sem nenhuma ao vivo = todas). Uma luta que aparece em duas páginas (a raiz de uma
 * janela é a 1ª coluna da seguinte) conta na PRIMEIRA delas. O telão fica nas páginas em foco e só gira entre elas se houver
 * mais de uma.
 */
export function focusPageIndices(pages: readonly BracketPage[], liveMatchIds: ReadonlySet<number>): number[] {
  const all = pages.map((_, i) => i);
  if (liveMatchIds.size === 0) return all;
  const picked = new Set<number>();
  for (const id of liveMatchIds) {
    const index = pages.findIndex((p) => p.matchIds.includes(id));
    if (index >= 0) picked.add(index);
  }
  return picked.size === 0 ? all : [...picked].sort((a, b) => a - b);
}
