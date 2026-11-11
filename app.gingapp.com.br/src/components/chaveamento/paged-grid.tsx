import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { itemsPerPage, paginate } from "@/lib/chaveamento/paginate";
import { useRotatingPage } from "@/lib/chaveamento/hooks";
import { useElementSize } from "./use-element-size";

export interface PagedGridProps {
  items: readonly ReactNode[];
  /** Tamanho estimado de cada item em `em` (largura mínima e altura); a medida real confere e corrige se a página transbordar. */
  minWidthEm: number;
  heightEm: number;
  tv: boolean;
  className?: string;
  /** Nome do que está paginado ("Grupos", "Rodadas") para o indicador "Grupos 1/2". */
  label: string;
}

/**
 * Grade que NUNCA corta conteúdo: fora do telão mostra tudo (a página rola); no telão mede a área, divide em páginas que cabem
 * (estimativa por `em`, conferida depois pela altura REAL renderizada: se transbordar, tira um item da página) e gira entre
 * elas, com o indicador "Grupos 1/2".
 */
export function PagedGrid({ items, minWidthEm, heightEm, tv, className, label }: PagedGridProps) {
  const [ref, area] = useElementSize<HTMLDivElement>();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const em = area.fontSize;
  const layout = itemsPerPage(area, { minWidth: minWidthEm * em, height: heightEm * em }, em * 0.9);

  // Teto corrigido pela medida real; volta a null quando a área ou a quantidade de itens muda.
  const [cap, setCap] = useState<number | null>(null);
  useEffect(() => {
    setCap(null);
  }, [area.width, area.height, items.length]);
  const perPage = cap === null ? layout.perPage : Math.max(1, Math.min(cap, layout.perPage));
  const pages = tv ? paginate(items, perPage) : [items.slice()];
  const page = useRotatingPage(pages.length, tv);
  const shown = pages[page] ?? [];

  useLayoutEffect(() => {
    if (!tv) return;
    const grid = gridRef.current;
    if (!grid || area.height <= 0 || shown.length <= 1) return;
    if (grid.scrollHeight > area.height + 2) setCap(shown.length - 1);
  }, [tv, area.height, shown.length, page, items]);

  return (
    <div ref={ref} className={`cv-paged ${className ?? ""}`.trim()} data-tv={tv ? "1" : undefined} data-pages={pages.length}>
      <div
        ref={gridRef}
        className="cv-paged-grid"
        key={page}
        style={tv ? { gridTemplateColumns: `repeat(${Math.min(layout.columns, Math.max(1, shown.length))}, minmax(0, 1fr))` } : undefined}
      >
        {shown}
      </div>
      {tv && pages.length > 1 && (
        <p className="cv-paged-indicator" data-testid="cv-paged-indicator">
          {label} {page + 1}/{pages.length}
          {pages.length <= 9 && (
            <span className="cv-pager-dots" aria-hidden="true">
              {pages.map((_, i) => (
                <i key={i} data-on={i === page ? "1" : undefined} />
              ))}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
