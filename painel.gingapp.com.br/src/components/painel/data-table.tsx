import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDebouncedValue } from "@/lib/list-params";
import { cn } from "@/lib/utils";

export interface Column<T> {
  id: string;
  header: string;
  /** Render da célula. Padrão: String(sortValue(row)). */
  cell?: (row: T) => ReactNode;
  /** Valor usado para ordenar. Sem isto a coluna não é ordenável. */
  sortValue?: (row: T) => string | number | null | undefined;
  className?: string;
}

/**
 * Modo servidor (opcional): paginação e busca vêm do backend (`limit`/`offset`/`q`).
 * Use com `useListParams` (`{ ...lp.server, total, isFetching }`) e `crud.usePage`.
 */
export interface ServerTableState {
  /** Total de registros que casam com o filtro (header `X-Total-Count`). */
  total: number;
  /** Página atual, base 0. */
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  /** Texto de busca aplicado (o do servidor). O debounce de 300ms acontece dentro da tabela. */
  query?: string;
  /** Sem esta função a caixa de busca não aparece. Chamada já com debounce; a página volta a 0. */
  onQueryChange?: (query: string) => void;
  /** Consulta em andamento (ex.: trocando de página): esmaece a tabela em vez de piscar. */
  isFetching?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[] | undefined;
  getRowId: (row: T) => string | number;
  isLoading?: boolean;
  /** Erro da consulta (mostra mensagem + "Tentar novamente"). */
  error?: unknown;
  onRetry?: () => void;
  /** Texto pesquisável da linha. Sem isto a caixa de busca não aparece. */
  searchText?: (row: T) => string;
  searchPlaceholder?: string;
  pageSize?: number;
  emptyMessage?: string;
  /** Coluna extra à direita (ex.: botões Editar/Excluir). */
  rowActions?: ((row: T) => ReactNode) | undefined;
  /** Conteúdo ao lado da busca (filtros, botão "Novo"). */
  toolbar?: ReactNode;
  /**
   * Teto de registros que o backend devolve por lista (take fixo, sem paginação no servidor).
   * Ao atingi-lo a tabela avisa que busca/filtros só enxergam esses registros. 0 desliga.
   */
  serverLimit?: number;
  /**
   * Modo servidor: a tabela NÃO filtra nem pagina localmente (`data` já é a página corrente);
   * `searchText`, `pageSize` e `serverLimit` são ignorados. A ordenação por cabeçalho continua
   * LOCAL, só entre as linhas da página corrente (o backend ainda não ordena).
   */
  server?: ServerTableState;
  /** Classe extra por linha (ex.: destacar a linha do usuário). */
  rowClassName?: ((row: T) => string | undefined) | undefined;
}

/** `take` fixo das listagens do backend; ver LACUNAS no README. */
export const SERVER_LIST_LIMIT = 50;

const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function compare(a: string | number | null | undefined, b: string | number | null | undefined) {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "pt-BR", { numeric: true, sensitivity: "base" });
}

/**
 * Tabela com busca, ordenação simples (clique no cabeçalho: asc, desc, nenhuma), paginação no
 * cliente e estados de carregando / vazio / erro.
 */
export function DataTable<T>({
  columns,
  data,
  getRowId,
  isLoading = false,
  error,
  onRetry,
  searchText,
  searchPlaceholder = "Buscar…",
  pageSize = 10,
  emptyMessage = "Nenhum registro encontrado.",
  rowActions,
  toolbar,
  serverLimit = SERVER_LIST_LIMIT,
  server,
  rowClassName,
}: DataTableProps<T>) {
  const [localQuery, setLocalQuery] = useState("");
  const [sort, setSort] = useState<{ id: string; dir: "asc" | "desc" } | null>(null);
  const [localPage, setLocalPage] = useState(0);

  // Modo servidor: o texto digitado é local; só o valor com debounce sobe para o servidor.
  const [text, setText] = useState(server?.query ?? "");
  const debouncedText = useDebouncedValue(text, 300);
  const serverRef = useRef(server);
  serverRef.current = server;
  const serverQuery = server?.query ?? "";
  useEffect(() => {
    const s = serverRef.current;
    if (!s?.onQueryChange) return;
    const next = debouncedText.trim();
    if (next === (s.query ?? "").trim()) return;
    s.onQueryChange(next);
    if (s.page !== 0) s.onPageChange(0);
  }, [debouncedText]);
  // Busca alterada de fora (ex.: limpar filtros): reflete no campo.
  useEffect(() => {
    setText((prev) => (prev.trim() === serverQuery.trim() ? prev : serverQuery));
  }, [serverQuery]);

  const query = server ? serverQuery : localQuery;
  const page = server ? server.page : localPage;
  const setPage = server ? server.onPageChange : setLocalPage;

  const rows = useMemo(() => {
    let result = data ?? [];
    const needle = normalize(query.trim());
    if (!server && searchText && needle) {
      result = result.filter((row) => normalize(searchText(row)).includes(needle));
    }
    const column = sort && columns.find((c) => c.id === sort.id);
    if (sort && column?.sortValue) {
      const getValue = column.sortValue;
      const factor = sort.dir === "asc" ? 1 : -1;
      result = [...result].sort((a, b) => factor * compare(getValue(a), getValue(b)));
    }
    return result;
  }, [data, query, sort, columns, searchText, server]);

  const totalRows = server ? server.total : rows.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / (server ? server.pageSize : pageSize)));
  const current = Math.min(page, pageCount - 1);
  const visible = server ? rows : rows.slice(current * pageSize, (current + 1) * pageSize);

  // Modo servidor: a página saiu do intervalo (ex.: excluiu o último item da última página).
  const serverPage = server?.page;
  const serverIdle = !isLoading && !server?.isFetching;
  useEffect(() => {
    if (serverPage !== undefined && serverIdle && serverPage > pageCount - 1) {
      serverRef.current?.onPageChange(pageCount - 1);
    }
  }, [serverPage, serverIdle, pageCount]);
  const showSearch = server ? !!server.onQueryChange : !!searchText;
  const colSpan = columns.length + (rowActions ? 1 : 0);

  function toggleSort(id: string) {
    if (!server) setPage(0);
    setSort((prev) => {
      if (prev?.id !== id) return { id, dir: "asc" };
      return prev.dir === "asc" ? { id, dir: "desc" } : null;
    });
  }

  function renderBody(): ReactNode {
    if (isLoading) {
      return Array.from({ length: Math.min(pageSize, 5) }, (_, index) => (
        <TableRow key={`skeleton-${index}`} data-testid="table-loading">
          <TableCell colSpan={colSpan}>
            <Skeleton className="h-5 w-full" />
          </TableCell>
        </TableRow>
      ));
    }
    if (error) {
      return (
        <TableRow data-testid="table-error">
          <TableCell colSpan={colSpan} className="py-10 text-center">
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : "Não foi possível carregar os dados."}
            </p>
            {onRetry && (
              <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
                Tentar novamente
              </Button>
            )}
          </TableCell>
        </TableRow>
      );
    }
    if (visible.length === 0) {
      return (
        <TableRow data-testid="table-empty">
          <TableCell colSpan={colSpan} className="py-10 text-center text-sm text-muted-foreground">
            {query ? "Nenhum resultado para a busca." : emptyMessage}
          </TableCell>
        </TableRow>
      );
    }
    return visible.map((row) => (
      <TableRow key={getRowId(row)} className={rowClassName?.(row)}>
        {columns.map((column) => (
          <TableCell key={column.id} className={column.className}>
            {column.cell ? column.cell(row) : String(column.sortValue?.(row) ?? "")}
          </TableCell>
        ))}
        {rowActions && <TableCell className="text-right">{rowActions(row)}</TableCell>}
      </TableRow>
    ));
  }

  return (
    <div className="space-y-3">
      {(showSearch || toolbar) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {showSearch ? (
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={server ? text : localQuery}
                onChange={(event) => {
                  if (server) {
                    setText(event.target.value);
                  } else {
                    setLocalQuery(event.target.value);
                    setLocalPage(0);
                  }
                }}
                placeholder={searchPlaceholder}
                aria-label="Buscar"
                className="pl-8"
              />
            </div>
          ) : (
            <span />
          )}
          {toolbar}
        </div>
      )}

      <div className={cn("rounded-lg border bg-card", server?.isFetching && "opacity-60 transition-opacity")}>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((column) => {
                const sortable = !!column.sortValue;
                const active = sort?.id === column.id ? sort.dir : null;
                const Icon = active === "asc" ? ArrowUp : active === "desc" ? ArrowDown : ArrowUpDown;
                return (
                  <TableHead
                    key={column.id}
                    className={column.className}
                    aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : "none"}
                  >
                    {sortable ? (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 font-medium hover:text-foreground"
                        onClick={() => toggleSort(column.id)}
                      >
                        {column.header}
                        <Icon className={cn("size-3.5", !active && "opacity-40")} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </TableHead>
                );
              })}
              {rowActions && <TableHead className="w-px text-right">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>{renderBody()}</TableBody>
        </Table>
      </div>

      {!server && !isLoading && !error && serverLimit > 0 && (data?.length ?? 0) >= serverLimit && (
        <p
          role="status"
          data-testid="table-limit-warning"
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
        >
          O servidor devolve no máximo {serverLimit} registros por lista. Pode haver registros que não
          aparecem aqui, e busca, filtros e totais consideram apenas estes {serverLimit}.
        </p>
      )}

      {!isLoading && !error && totalRows > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span data-testid="table-count">
            {totalRows} {totalRows === 1 ? "registro" : "registros"}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              aria-label="Página anterior"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              <ChevronLeft />
            </Button>
            <span>
              Página {current + 1} de {pageCount}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="size-8"
              aria-label="Próxima página"
              disabled={current >= pageCount - 1}
              onClick={() => setPage(current + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
