import { toast } from "sonner";
import { listenForegroundMessages, noticeFromPayload, type FirebaseWebConfig } from "@/lib/fcm";

export interface ForegroundDeps {
  /** Recarrega o sino (contador e lista de notificações). */
  refreshNotifications: () => void;
  /** Abre uma tela do app a partir do toque no aviso (caminho interno, ex.: "/aulas"). */
  navigate: (url: string) => void;
}

/**
 * Aviso recebido com o app ABERTO (FCM onMessage): o navegador não mostra nada sozinho nesse caso, então o app exibe um
 * toast e atualiza o sino na hora. Não repete a notificação do sistema (o service worker só age com o app fechado).
 */
export async function startForegroundMessages(
  config: FirebaseWebConfig,
  deps: ForegroundDeps,
): Promise<() => void> {
  return listenForegroundMessages(config, (payload) => {
    const notice = noticeFromPayload(payload);
    const url = notice.url;
    toast(notice.title, {
      description: notice.body || undefined,
      // `tag` como id: avisos da mesma categoria em sequência substituem o toast em vez de empilhar.
      id: `push-${notice.tag}`,
      duration: 8000,
      ...(url ? { action: { label: "Abrir", onClick: () => deps.navigate(url) } } : {}),
    });
    deps.refreshNotifications();
  });
}
