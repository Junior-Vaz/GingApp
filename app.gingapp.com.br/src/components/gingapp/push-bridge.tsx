import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { isFcmMarkedActive, subscribeFcmActive } from "@/lib/fcm";
import { startForegroundMessages } from "@/lib/push-foreground";
import { syncFcmRegistration, usePushConfig } from "@/lib/push";

/**
 * Ponte do FCM para o app autenticado (sem UI). Só age quando o servidor usa FCM E este navegador já ativou os avisos:
 *  1. ao abrir o app, renova o token e o regrava para o usuário logado (token pode girar; aparelho compartilhado);
 *  2. com o app aberto, escuta onMessage: toast + sino atualizado na hora (o service worker cobre app fechado).
 * O SDK do Firebase só é baixado aqui, nesse caso (chunk separado, fora do bundle inicial).
 */
export function PushBridge() {
  const config = usePushConfig();
  const queryClient = useQueryClient();
  const router = useRouter();
  const active = useSyncExternalStore(subscribeFcmActive, isFcmMarkedActive, () => false);

  const data = config.data;
  const firebase = data?.provider === "fcm" ? data.firebase : null;
  const firebaseKey = firebase ? JSON.stringify(firebase) : null;

  useEffect(() => {
    if (!data || !firebase || !active) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    let cancelled = false;
    let stop: (() => void) | null = null;
    void syncFcmRegistration(data);
    startForegroundMessages(firebase, {
      refreshNotifications: () => void queryClient.invalidateQueries({ queryKey: ["notifications"] }),
      navigate: (url) => void router.navigate({ to: url }),
    })
      .then((unsubscribe) => {
        if (cancelled) unsubscribe();
        else stop = unsubscribe;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stop?.();
    };
    // firebaseKey representa a config inteira (objeto novo a cada render não deve reiniciar a escuta).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseKey, active, queryClient, router]);

  return null;
}
