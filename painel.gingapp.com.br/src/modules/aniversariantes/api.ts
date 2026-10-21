import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api, buildQuery, errorMessage } from "@/lib/api";
import type { BirthdayList, BirthdaySettings, BirthdaySummary, GreetResult } from "./types";

const ROOT = ["birthdays"] as const;

export const birthdayKeys = {
  root: ROOT,
  list: (month: number, unitId: string, classId: string) => [...ROOT, "list", month, unitId, classId] as const,
  summary: () => [...ROOT, "summary"] as const,
  settings: () => [...ROOT, "settings"] as const,
};

/** Mensagem amigável por status HTTP; o resto vem do servidor ou do texto de reserva. */
export function birthdayErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return "Você não tem permissão para esta ação.";
    if (error.status === 429) return "Muitas tentativas seguidas. Aguarde um instante e tente de novo.";
    return error.message || fallback;
  }
  if (error instanceof TypeError) return "Sem conexão com o servidor. Verifique a internet e tente de novo.";
  return errorMessage(error, fallback);
}

/** GET /birthdays?month&unitId&classId (a lista do mês, ordenada por dia e nome). */
export function useBirthdays(month: number, unitId: string, classId: string) {
  return useQuery({
    queryKey: birthdayKeys.list(month, unitId, classId),
    queryFn: () => api.get<BirthdayList>(`/birthdays${buildQuery({ month, unitId, classId })}`),
    placeholderData: keepPreviousData,
  });
}

/** GET /birthdays/summary: aniversariantes de hoje e dos próximos 7 dias (cartão do painel inicial). */
export function useBirthdaySummary() {
  return useQuery({
    queryKey: birthdayKeys.summary(),
    queryFn: () => api.get<BirthdaySummary>("/birthdays/summary"),
    staleTime: 60_000,
  });
}

/** POST /birthdays/:personId/greet. Depois do envio refaz a lista e o resumo (o selo "Já enviado este ano"). */
export function useGreet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ personId, message }: { personId: number; message: string }) =>
      api.post<GreetResult>(`/birthdays/${String(personId)}/greet`, { message }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ROOT }),
  });
}

/** GET /birthdays/settings (só MESTRE; `enabled` evita a chamada para os demais papéis). */
export function useBirthdaySettings(enabled: boolean) {
  return useQuery({
    queryKey: birthdayKeys.settings(),
    queryFn: () => api.get<BirthdaySettings>("/birthdays/settings"),
    enabled,
  });
}

/** PUT /birthdays/settings (só MESTRE). */
export function useSaveBirthdaySettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BirthdaySettings) => api.put<BirthdaySettings>("/birthdays/settings", input),
    onSuccess: (saved, input) => {
      // Se o servidor devolver o objeto salvo, vale ele; senão (corpo vazio ou outro formato) vale o que foi enviado.
      queryClient.setQueryData(birthdayKeys.settings(), typeof saved?.dailyDigest === "boolean" ? saved : input);
    },
  });
}
