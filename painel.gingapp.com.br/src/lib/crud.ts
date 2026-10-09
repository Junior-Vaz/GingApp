import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
  type UseMutationOptions,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { api, buildQuery, errorMessage, type QueryParams } from "@/lib/api";

/** Mostra o erro da API (ou o fallback) em toast. Use em qualquer mutação/consulta. */
export function notifyError(error: unknown, fallback = "Algo deu errado. Tente novamente."): void {
  toast.error(errorMessage(error, fallback));
}

export interface CrudMessages {
  created?: string;
  updated?: string;
  removed?: string;
}

/**
 * Hooks CRUD genéricos sobre um recurso REST do backend (`/students`, `/classes`...).
 *
 *   const students = createCrud<Student, StudentInput>("/students");
 *   const list = students.useList();                // GET    /students (array, teto 50 do servidor)
 *   const page = students.usePage(params);          // GET    /students?limit&offset&q... → { items, total }
 *   const create = students.useCreate();            // POST   /students
 *   const update = students.useUpdate();            // PATCH  /students/:id   ({ id, data })
 *   const remove = students.useRemove();            // DELETE /students/:id
 *
 * As mutações invalidam a lista, avisam por toast (sonner) em sucesso e em erro.
 * Passe `onSuccess`/`onError` nos `mutate(vars, { ... })` para fechar diálogos etc.
 */
export function createCrud<TItem, TInput = Partial<TItem>, TId extends string | number = number>(
  basePath: string,
  messages: CrudMessages = {},
) {
  const rootKey: QueryKey = ["crud", basePath];
  const listKey = (params?: QueryParams): QueryKey =>
    params ? [...rootKey, "list", params] : [...rootKey, "list"];
  const detailKey = (id: TId): QueryKey => [...rootKey, "detail", id];

  const withQuery = (params?: QueryParams) => `${basePath}${buildQuery(params)}`;

  function useList(params?: QueryParams, enabled = true) {
    return useQuery({
      queryKey: listKey(params),
      queryFn: () => api.get<TItem[]>(withQuery(params)),
      enabled,
    });
  }

  /**
   * Lista paginada/filtrada NO SERVIDOR (`limit`/`offset`/`q`/filtros → `{ items, total }`).
   * A queryKey inclui os params; `keepPreviousData` mantém a página anterior na tela enquanto a
   * nova carrega (a tabela não pisca). Mutações invalidam todas as páginas (rootKey).
   * Use com `useListParams` e a prop `server` do DataTable.
   */
  function usePage(params?: QueryParams, enabled = true) {
    const query = useQuery({
      queryKey: [...rootKey, "page", params ?? {}] as QueryKey,
      queryFn: () => api.getPage<TItem>(basePath, params),
      placeholderData: keepPreviousData,
      enabled,
    });
    return {
      items: query.data?.items,
      total: query.data?.total ?? 0,
      isLoading: query.isLoading,
      isFetching: query.isFetching,
      error: query.error,
      refetch: query.refetch,
    };
  }

  function useOne(id: TId | undefined) {
    return useQuery({
      queryKey: detailKey(id as TId),
      queryFn: () => api.get<TItem>(`${basePath}/${String(id)}`),
      enabled: id !== undefined,
    });
  }

  function useMutationWithToast<TVars, TResult>(
    mutationFn: (vars: TVars) => Promise<TResult>,
    successMessage: string | undefined,
    options?: Omit<UseMutationOptions<TResult, Error, TVars>, "mutationFn">,
  ) {
    const queryClient = useQueryClient();
    return useMutation<TResult, Error, TVars>({
      mutationFn,
      ...options,
      onSuccess: (...args) => {
        void queryClient.invalidateQueries({ queryKey: rootKey });
        if (successMessage) toast.success(successMessage);
        return options?.onSuccess?.(...args);
      },
      onError: (...args) => {
        notifyError(args[0]);
        return options?.onError?.(...args);
      },
    });
  }

  function useCreate() {
    return useMutationWithToast<TInput, TItem>(
      (data) => api.post<TItem>(basePath, data),
      messages.created ?? "Registro criado.",
    );
  }

  function useUpdate() {
    return useMutationWithToast<{ id: TId; data: Partial<TInput> }, TItem>(
      ({ id, data }) => api.patch<TItem>(`${basePath}/${String(id)}`, data),
      messages.updated ?? "Registro atualizado.",
    );
  }

  function useRemove() {
    return useMutationWithToast<TId, void>(
      (id) => api.delete<void>(`${basePath}/${String(id)}`),
      messages.removed ?? "Registro removido.",
    );
  }

  return { rootKey, listKey, detailKey, useList, usePage, useOne, useCreate, useUpdate, useRemove };
}
