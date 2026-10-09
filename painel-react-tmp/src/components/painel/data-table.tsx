import { useMemo, useState, type ReactNode } from "react";
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
  rowActions?: (row: T) => ReactNode;
  /** Conteúdo ao lado da busca (filtros, botão "Novo"). */
  toolbar?: ReactNode;
}

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
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<{ id: string; dir: "asc" | "desc" } | null>(null);
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    let result = data ?? [];
    const needle = normalize(query.trim());
    if (searchText && needle) {
      result = result.filter((row) => normalize(searchText(row)).includes(needle));
    }
    const column = sort && columns.find((c) => c.id === sort.id);
    if (sort && column?.sortValue) {
      const getValue = column.sortValue;
      const factor = sort.dir === "asc" ? 1 : -1;
      result = [...result].sort((a, b) => factor * compare(getValue(a), getValue(b)));
    }
    return result;
  }, [data, query, sort, columns, searchText]);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const current = Math.min(page, pageCount - 1);
  const visible = rows.slice(current * pageSize, (current + 1) * pageSize);
  const colSpan = columns.length + (rowActions ? 1 : 0);

  function toggleSort(id: string) {
    setPage(0);
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
      <TableRow key={getRowId(row)}>
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
      {(searchText || toolbar) && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {searchText ? (
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
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

      <div className="rounded-lg border bg-card">
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

      {!isLoading && !error && rows.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span data-testid="table-count">
            {rows.length} {rows.length === 1 ? "registro" : "registros"}
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
