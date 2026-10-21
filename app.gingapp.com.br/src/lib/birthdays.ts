import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/lib/api";
import { dayOnly } from "@/lib/format";

/* ------------------------------------------------------------------------------------------------
 * Aniversariantes da semana (docs/CONTRATO_FEED_ANIVERSARIOS_COMUNICACAO.md, secao 2).
 * GET /birthdays/week (membro) e POST /birthdays/:personId/congratulate. O servidor ja' filtra
 * menores e quem optou por nao aparecer; o app so' mostra dia e mes (a idade nunca chega aqui).
 * ---------------------------------------------------------------------------------------------- */

export interface BirthdayWeekItem {
  personId: number;
  name: string;
  nickname: string | null;
  photo: string | null;
  day: number;
  month: number;
  isToday: boolean;
  /** false para o proprio usuario (e para quem nao pode receber parabens). */
  canCongratulate: boolean;
  congratulatedByMe: boolean;
}

export interface BirthdaysWeekResponse {
  items: BirthdayWeekItem[];
}

export const BIRTHDAYS_WEEK_KEY = ["birthdays", "week"] as const;

/** Aniversariantes dos proximos 7 dias (hoje incluso). Erro (ex.: backend antigo) nao e repetido: a faixa some. */
export function useBirthdaysWeek() {
  return useQuery({
    queryKey: BIRTHDAYS_WEEK_KEY,
    queryFn: () => api.get<BirthdaysWeekResponse>("/birthdays/week"),
    retry: false,
    staleTime: 60_000,
  });
}

/** `dd/MM` de um aniversario (so' dia e mes). */
export const formatBirthdayDate = (item: Pick<BirthdayWeekItem, "day" | "month">): string =>
  `${String(item.day).padStart(2, "0")}/${String(item.month).padStart(2, "0")}`;

/** Nome curto para o cartao: apelido, senao o primeiro nome. */
export const birthdayShortName = (item: Pick<BirthdayWeekItem, "name" | "nickname">): string => {
  const nick = item.nickname?.trim();
  if (nick) return nick;
  return item.name.trim().split(/\s+/)[0] ?? item.name;
};

/** Preferência "mostrar meu aniversário ao grupo" da ficha (na raiz ou em `person`); sem o campo (backend antigo) = true. */
export const fichaBirthdayVisible = (ficha: { birthdayVisible?: boolean; person: { birthdayVisible?: boolean } }): boolean =>
  ficha.birthdayVisible ?? ficha.person.birthdayVisible ?? true;

/**
 * true quando a data de nascimento indica MENOR de 18 anos hoje. Sem data (ou inválida) devolve false:
 * sem como saber, o switch de privacidade é mantido.
 */
export function isMinorByBirthDate(birthDate: string | null | undefined, now: Date = new Date()): boolean {
  if (!birthDate) return false;
  const born = dayOnly(birthDate);
  if (Number.isNaN(born.getTime())) return false;
  let age = now.getFullYear() - born.getFullYear();
  const beforeBirthday =
    now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate());
  if (beforeBirthday) age -= 1;
  return age < 18;
}

export interface CongratulateResult {
  personId: number;
  /** true quando o servidor respondeu 409 ALREADY_CONGRATULATED (ja' parabenizou neste ano). */
  already: boolean;
}

/**
 * Parabeniza um aniversariante. O 409 ALREADY_CONGRATULATED NAO e' erro para a tela: vira
 * `{already:true}` e o cartao passa a "Parabenizado". Qualquer outro erro (403, rede) e' lancado.
 */
export function useCongratulate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (personId: number): Promise<CongratulateResult> => {
      try {
        await api.post(`/birthdays/${personId}/congratulate`);
        return { personId, already: false };
      } catch (error) {
        if (error instanceof ApiError && error.status === 409 && error.code === "ALREADY_CONGRATULATED") {
          return { personId, already: true };
        }
        throw error;
      }
    },
    onSuccess: ({ personId }) => {
      queryClient.setQueryData<BirthdaysWeekResponse>(BIRTHDAYS_WEEK_KEY, (current) =>
        current
          ? { ...current, items: current.items.map((i) => (i.personId === personId ? { ...i, congratulatedByMe: true } : i)) }
          : current,
      );
    },
    onError: () => {
      // 403 (ficou invisivel/menor) ou falha: a lista pode estar velha, busca de novo.
      void queryClient.invalidateQueries({ queryKey: BIRTHDAYS_WEEK_KEY });
    },
  });
}
