/**
 * Endereço atual com `?categoria=<id>`: troca/insere só esse parâmetro e preserva os demais (`tv`, `q`) e o `#`.
 * Usado com `history.replaceState` (a URL acompanha a categoria sem recarregar e sem empilhar histórico).
 */
export function withCategoryParam(href: string, categoryId: number): string {
  try {
    const url = new URL(href);
    url.searchParams.set("categoria", String(categoryId));
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}
