import type { App } from 'firebase-admin/app';
import type { Messaging } from 'firebase-admin/messaging';
import { FirebaseAdminConfig, buildFcmMessage } from './fcm.config';
import type { PushPayload } from './push.config';

/** Resultado do envio a UM token (a ordem do multicast é preservada pelo remetente). */
export interface FcmSendResult {
  token: string;
  ok: boolean;
  /** Código do FCM (ex.: 'messaging/registration-token-not-registered') quando ok=false. */
  errorCode?: string;
}

/**
 * Remetente FCM. O real (FirebaseFcmSender) usa o firebase-admin; os testes injetam um stub (token FCM_SENDER) que só
 * guarda as chamadas em memória — NENHUM push real sai da suíte. Nunca lança por falha de token: devolve ok=false
 * com o código. Só lança se o serviço inteiro falhar (rede/credencial) — o PushService trata e não apaga nada.
 */
export interface FcmSender {
  sendMulticast(tokens: string[], payload: PushPayload): Promise<FcmSendResult[]>;
}

/** Token do remetente FCM de teste/stub. Em produção vale `null` e o remetente vem das envs FIREBASE_*. */
export const FCM_SENDER = Symbol('FCM_SENDER');

/** Limite do FCM por chamada de sendEachForMulticast. */
export const FCM_MULTICAST_LIMIT = 500;

/** Remetente real (firebase-admin carregado sob demanda: só custa memória quando o FCM está configurado). */
export class FirebaseFcmSender implements FcmSender {
  private messaging: Promise<Messaging> | null = null;

  constructor(private readonly config: FirebaseAdminConfig) {}

  private getMessaging(): Promise<Messaging> {
    this.messaging ??= (async () => {
      const [{ initializeApp, cert, getApps }, { getMessaging }] = await Promise.all([
        import('firebase-admin/app'),
        import('firebase-admin/messaging'),
      ]);
      const name = `gingapp-push-${this.config.projectId}`;
      const app: App =
        getApps().find((a) => a.name === name) ??
        initializeApp(
          {
            credential: cert({
              projectId: this.config.projectId,
              clientEmail: this.config.clientEmail,
              privateKey: this.config.privateKey,
            }),
          },
          name,
        );
      return getMessaging(app);
    })().catch((error) => {
      this.messaging = null; // permite nova tentativa no próximo envio
      throw error;
    });
    return this.messaging;
  }

  async sendMulticast(tokens: string[], payload: PushPayload): Promise<FcmSendResult[]> {
    if (tokens.length === 0) return [];
    const messaging = await this.getMessaging();
    const response = await messaging.sendEachForMulticast(buildFcmMessage(tokens, payload));
    return response.responses.map((r, i) => ({
      token: tokens[i],
      ok: r.success,
      ...(r.success ? {} : { errorCode: r.error?.code ?? 'unknown' }),
    }));
  }
}
