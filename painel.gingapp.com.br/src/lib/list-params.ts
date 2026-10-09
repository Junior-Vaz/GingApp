import { useCallback, useEffect, useMemo, useState } from "react";
import type { QueryParam, QueryParams } from "@/lib/api";

/** Devolve `value` só depois de ficar `delay` ms sem mudar (debounce de entrada de texto). */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export interface ListParamsOptions<F extends Record<string, QueryParam>> {
  /** Tamanho da página (`limit`). Padrão 10; o backend aceita 1..200. */
  pageSize?: number;
  /** Filtros iniciais (ex.: `{ status: "", unitId: "" }`). Valores vazios não vão para a URL. */
  filters?: F;
}

/**
 * Estado de uma lista paginada no servidor: página (0-based), busca (`q`) e filtros.
 * Mudar a busca ou um filtro volta SEMPRE à página 0.
 *
 *   const lp = useListParams({ pageSize: 10, filters: { status: "" } });
 *   const page = students.usePage(lp.params);            // limit/offset/q/status
 *   <DataTable server={{ ...lp.server, total: page.total, isFetching: page.isFetching }} .../>
 *   lp.setFilter("status", "ACTIVE");                    // filtro na toolbar
 */
export function useListParams<F extends Record<string, QueryParam> = Record<string, never>>(
  options: ListParamsOptions<F> = {},
) {
  const pageSize = options.pageSize ?? 10;
  const [page, setPage] = useState(0);
  const [query, setQueryState] = useState("");
  const [filters, setFilters] = useState<F>(options.filters ?? ({} as F));

  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    setPage(0);
  }, []);

  const setFilter = useCallback(<K extends keyof F>(key: K, value: F[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0);
  }, []);

  /** Parâmetros prontos para `usePage` (vazios são ignorados na query string). */
  const params = useMemo<QueryParams>(
    () => ({ ...filters, q: query.trim(), limit: pageSize, offset: page * pageSize }),
    [filters, query, pageSize, page],
  );

  /** Props base da prop `server` do DataTable (complete com `total` e, opcional, `isFetching`). */
  const server = useMemo(
    () => ({ page, pageSize, onPageChange: setPage, query, onQueryChange: setQuery }),
    [page, pageSize, query, setQuery],
  );

  return { page, setPage, pageSize, query, setQuery, filters, setFilter, params, server };
}
