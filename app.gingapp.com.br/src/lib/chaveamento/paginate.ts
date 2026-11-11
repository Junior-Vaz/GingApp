/** Paginação genérica do telão (grupos, rodadas): geometria pura, sem DOM. */

/** Quantos itens cabem numa página: colunas x linhas da área (nunca menos de 1). `gap` entra entre os itens. */
export function itemsPerPage(
  area: { width: number; height: number },
  item: { minWidth: number; height: number },
  gap = 0,
): { columns: number; rows: number; perPage: number } {
  if (area.width <= 0 || area.height <= 0 || item.minWidth <= 0 || item.height <= 0) return { columns: 1, rows: 1, perPage: 1 };
  const columns = Math.max(1, Math.floor((area.width + gap) / (item.minWidth + gap)));
  const rows = Math.max(1, Math.floor((area.height + gap) / (item.height + gap)));
  return { columns, rows, perPage: columns * rows };
}

/** Divide em páginas de `perPage` itens (a última pode ter menos). Lista vazia = nenhuma página. */
export function paginate<T>(items: readonly T[], perPage: number): T[][] {
  const size = Math.max(1, Math.floor(perPage));
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}
