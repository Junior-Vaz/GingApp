import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, buildQuery, type QueryParams } from "@/lib/api";
import { createCrud, notifyError } from "@/lib/crud";
import {
  generateSummaryText,
  type DelinquentRow,
  type DelinquentsSummary,
  type GenerateMonthlyResult,
  type PayFormValues,
  type Receipt,
  type StudentBilling,
  toPayPayload,
} from "./collection";
import type { FinanceRecord } from "./finance-utils";

type FinanceInput = Record<string, unknown>;

/** CRUD de /finance. Toda a cobrança (E07) fica sob o mesmo rootKey: qualquer mutação refaz lista, totais e inadimplentes. */
export const finance = createCrud<FinanceRecord, FinanceInput>("/finance", {
  created: "Lançamento criado.",
  updated: "Lançamento atualizado.",
  removed: "Lançamento excluído.",
});

/** Totais de inadimplência (aluno/valor/quantidade) sob os mesmos filtros da lista. */
export function useDelinquentsSummary(filters: QueryParams = {}, enabled = true) {
  return useQuery({
    queryKey: [...finance.rootKey, "delinquents-summary", filters],
    queryFn: () => api.get<DelinquentsSummary>(`/finance/delinquents/summary${buildQuery(filters)}`),
    placeholderData: keepPreviousData,
    enabled,
  });
}

/** Inadimplentes agrupados por aluno, paginados no servidor (total de ALUNOS em X-Total-Count). */
export function useDelinquents(params: QueryParams) {
  const query = useQuery({
    queryKey: [...finance.rootKey, "delinquents", params],
    queryFn: () => api.getPage<DelinquentRow>("/finance/delinquents", params),
    placeholderData: keepPreviousData,
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

export function useReceipt(id: number | null) {
  return useQuery({
    queryKey: [...finance.rootKey, "receipt", id],
    queryFn: () => api.get<Receipt>(`/finance/${id}/receipt`),
    enabled: id !== null,
  });
}

/** Cobranças (valor + dia) dos alunos da página. Só dispara com `enabled` (quem tem finance:view). */
export const BILLING_KEY = ["finance-billing"] as const;
export function useStudentBillings(studentIds: number[], enabled: boolean) {
  const ids = [...new Set(studentIds)].sort((a, b) => a - b);
  return useQuery({
    queryKey: [...BILLING_KEY, ids],
    queryFn: () => api.get<StudentBilling[]>(`/finance/billing?studentIds=${ids.join(",")}`),
    enabled: enabled && ids.length > 0,
    placeholderData: keepPreviousData,
  });
}

/** Ações da cobrança. Cada uma avisa por toast e refaz as consultas do financeiro. */
export function useFinanceActions() {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: finance.rootKey });
    void queryClient.invalidateQueries({ queryKey: BILLING_KEY });
  };

  const pay = useMutation({
    mutationFn: ({ id, values }: { id: number; values: PayFormValues }) =>
      api.post<FinanceRecord>(`/finance/${id}/pay`, toPayPayload(values)),
    onSuccess: () => {
      refresh();
      toast.success("Baixa registrada.");
    },
    onError: (error) => notifyError(error),
  });

  const refund = useMutation({
    mutationFn: (id: number) => api.post<FinanceRecord>(`/finance/${id}/refund`),
    onSuccess: () => {
      refresh();
      toast.success("Pagamento estornado.");
    },
    onError: (error) => notifyError(error),
  });

  const cancel = useMutation({
    mutationFn: (id: number) => api.post<FinanceRecord>(`/finance/${id}/cancel`),
    onSuccess: () => {
      refresh();
      toast.success("Lançamento cancelado.");
    },
    onError: (error) => notifyError(error),
  });

  const generate = useMutation({
    mutationFn: (month: string) => api.post<GenerateMonthlyResult>("/finance/generate-monthly", { month }),
    onSuccess: (result) => {
      refresh();
      toast.success(generateSummaryText(result));
    },
    onError: (error) => notifyError(error),
  });

  /** Reuso do FinanceOverdueService: grava OVERDUE nos vencidos e avisa aluno/responsável. */
  const markOverdue = useMutation({
    mutationFn: () => api.post<{ marked: number; notified: number; hasMore: boolean }>("/finance/mark-overdue"),
    onSuccess: (result) => {
      refresh();
      toast.success(
        result.marked === 0
          ? "Nenhum lançamento novo para marcar como atrasado."
          : `${result.marked} lançamento(s) marcado(s) como atrasado(s); ${result.notified} aviso(s) enviado(s).${result.hasMore ? " Há mais: clique de novo." : ""}`,
      );
    },
    onError: (error) => notifyError(error),
  });

  return { pay, refund, cancel, generate, markOverdue };
}
