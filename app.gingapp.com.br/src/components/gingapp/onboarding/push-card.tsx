import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BellOff, BellRing } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/api";
import { readNotificationPermission as readPermission, type NotificationPermissionState as PermissionState } from "@/lib/onboarding";
import { PushPermissionDeniedError, enablePush, usePushConfig } from "@/lib/push";
import { PUSH_DENIED_HINT_KEY, SNOOZE_KEYS, useSnooze, type Clock } from "@/lib/snooze";
import { OnboardingFrame } from "./install-card";

function hintAlreadyShown(): boolean {
  try {
    return localStorage.getItem(PUSH_DENIED_HINT_KEY) === "1";
  } catch {
    return false;
  }
}

function markHintShown(): void {
  try {
    localStorage.setItem(PUSH_DENIED_HINT_KEY, "1");
  } catch {
    /* sem storage: a dica pode reaparecer em outra visita, sem prejuízo */
  }
}

/**
 * Convite "Ativar notificações". As notificações NUNCA são pedidas sozinhas: a permissão só é solicitada quando o usuário
 * toca em "Ativar notificações" (enablePush da lib/push, a mesma lógica da tela de avisos). Só aparece com o servidor com
 * push ligado (GET /push/config), permissão "default" e sem dispensa recente. Se o usuário NEGAR, o próprio cartão mostra
 * uma única vez como reativar nas configurações do aparelho, sem insistir.
 */
export function PushCard({ clock }: { clock?: Clock | undefined }) {
  const config = usePushConfig().data;
  const queryClient = useQueryClient();
  const { snoozed, snooze } = useSnooze(SNOOZE_KEYS.push, clock);
  const [permission, setPermission] = useState<PermissionState>(readPermission);
  const [deniedHint, setDeniedHint] = useState(false);
  const [closed, setClosed] = useState(false);

  const activate = useMutation({
    mutationFn: () => enablePush(config!),
    onSuccess: async () => {
      setPermission("granted");
      toast.success("Notificações ativadas!");
      await queryClient.invalidateQueries({ queryKey: ["push-preferences"] });
    },
    onError: (error) => {
      if (error instanceof PushPermissionDeniedError) {
        const now = readPermission();
        setPermission(now);
        if (now === "denied") {
          // Negou de vez: mostra a dica UMA vez (a marca é gravada já, então nem um recarregamento repete).
          if (!hintAlreadyShown()) {
            markHintShown();
            setDeniedHint(true);
          }
        } else {
          // Fechou o pedido sem escolher: nada foi bloqueado; tratamos como "Agora não".
          toast.info("Tudo bem! Você pode ativar quando quiser em Perfil > Avisos no celular.");
          snooze();
        }
        return;
      }
      toast.error(errorMessage(error, "Não foi possível ativar as notificações agora."));
    },
  });

  if (closed) return null;

  if (deniedHint) {
    return (
      <OnboardingFrame>
        <section
          aria-label="Notificações bloqueadas"
          data-testid="onboarding-push-denied"
          className="rounded-lg border border-border bg-card p-3 shadow-sm"
        >
          <div className="flex items-start gap-3">
            <span className="flex size-10 flex-none items-center justify-center rounded-xl bg-secondary text-primary" aria-hidden="true">
              <BellOff className="size-5" />
            </span>
            <div className="min-w-0" role="status">
              <h2 className="text-sm font-bold leading-tight">Notificações bloqueadas</h2>
              <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                Sem problema! Se mudar de ideia, libere as notificações do GingApp nas configurações do aparelho (ou do
                navegador). Depois confira o status em Perfil &gt; Avisos no celular.
              </p>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button type="button" className="min-h-11 flex-1 sm:flex-none" onClick={() => setClosed(true)}>
              Entendi
            </Button>
            <Button asChild variant="ghost" className="min-h-11 flex-none">
              <Link to="/perfil">Abrir o Perfil</Link>
            </Button>
          </div>
        </section>
      </OnboardingFrame>
    );
  }

  if (config?.enabled !== true || permission !== "default" || snoozed) return null;

  return (
    <OnboardingFrame>
      <section
        aria-label="Ativar notificações"
        data-testid="onboarding-push-card"
        className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-sm sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="flex size-10 flex-none items-center justify-center rounded-xl bg-secondary text-primary" aria-hidden="true">
            <BellRing className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="text-sm font-bold leading-tight">Ativar notificações</h2>
            <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
              Receba aula cancelada, cobranças e recados do grupo direto no celular.
            </p>
          </div>
        </div>
        <div className="flex gap-2 sm:flex-none">
          <Button
            type="button"
            className="min-h-11 flex-1 sm:flex-none"
            disabled={activate.isPending}
            onClick={() => activate.mutate()}
          >
            Ativar notificações
          </Button>
          <Button type="button" variant="ghost" className="min-h-11 flex-none" disabled={activate.isPending} onClick={snooze}>
            Agora não
          </Button>
        </div>
      </section>
    </OnboardingFrame>
  );
}
