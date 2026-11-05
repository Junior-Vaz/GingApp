import { CircleCheck, Hand, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ApiError, errorMessage } from "@/lib/api";
import { useDailyCheckinMutation, useDailyCheckinStatus } from "@/lib/ranking-student";

/**
 * Linha fina da Home: "Check-in de hoje" + botão, só quando o Ranking responde para o aluno ativo e o check-in do dia ainda não
 * foi feito. Sem aluno ligado a consulta nem dispara (mesma chave de query do cartão de Meu progresso). Carregando, erro ou sem
 * acesso ao ranking = nada na tela. Depois do toque mostra a confirmação até sair da Home; nada de cartão grande: não compete
 * com o convite de instalar/avisos nem com o check-in por localização.
 */
export function DailyCheckinHomeRow() {
  const status = useDailyCheckinStatus();
  const checkin = useDailyCheckinMutation();
  const data = status.data;
  if (!data) return null;

  if (data.checkedInToday) {
    if (!checkin.isSuccess) return null;
    const result = checkin.data;
    const gained = result && !result.alreadyCheckedIn ? result.pointsToday : 0;
    return (
      <p
        className="mb-3 flex min-h-11 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm text-muted-foreground"
        role="status"
        data-testid="daily-checkin-home-done"
      >
        <CircleCheck size={18} className="flex-none text-primary" aria-hidden="true" />
        <span>
          <strong className="font-semibold text-foreground">Check-in feito!</strong> {gained > 0 ? `+${gained} ${gained === 1 ? "ponto" : "pontos"}` : "Hoje já valeu."}
        </span>
      </p>
    );
  }

  const failure = checkin.isError
    ? checkin.error instanceof ApiError && checkin.error.status === 429
      ? "Calma! Muitos toques seguidos. Tente de novo em um minutinho."
      : errorMessage(checkin.error, "Não foi possível fazer o check-in agora. Tente de novo.")
    : null;

  return (
    <div className="mb-3" data-testid="daily-checkin-home-row">
      <div className="flex min-h-11 items-center gap-3 rounded-lg border border-border bg-card px-3 py-1.5">
        <Hand size={18} className="flex-none text-primary" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-sm">
          <strong className="font-semibold">Check-in de hoje</strong>
          <span className="ml-2 text-xs text-muted-foreground">
            {data.weekDays} de {data.weekTarget} dias nesta semana
          </span>
        </span>
        <Button type="button" size="sm" variant="soft" className="min-h-11 flex-none px-4" disabled={checkin.isPending} aria-busy={checkin.isPending} onClick={() => checkin.mutate()}>
          {checkin.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
          {checkin.isPending ? "Registrando…" : "Salve!"}
        </Button>
      </div>
      {failure && (
        <p className="mt-1 text-xs text-destructive" role="alert" data-testid="daily-checkin-home-error">
          {failure}
        </p>
      )}
    </div>
  );
}
