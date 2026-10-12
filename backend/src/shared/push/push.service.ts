import { Inject, Injectable, Logger, OnModuleDestroy, Optional, ServiceUnavailableException } from '@nestjs/common';
import { PushPreference } from '@prisma/client';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import { FirebaseWebConfig, isDeadFcmToken, readFirebaseAdminConfig, readFirebaseWebSettings } from './fcm.config';
import { FCM_MULTICAST_LIMIT, FCM_SENDER, FcmSender, FirebaseFcmSender } from './fcm.sender';
import {
  PUSH_CATEGORIES,
  PushCategory,
  PushPayload,
  VapidConfig,
  buildPushPayload,
  pushCategoryOf,
  readVapidConfig,
} from './push.config';

export { FCM_SENDER } from './fcm.sender';
export type { FcmSender, FcmSendResult } from './fcm.sender';

/** Alvo de um envio Web Push: os três campos que o navegador devolve em PushSubscription.toJSON(). */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Remetente de Web Push (VAPID). O real (WebPushSender) usa a lib `web-push`; os testes injetam um stub (token
 * PUSH_SENDER) que só guarda as chamadas em memória — NENHUM push real sai da suíte. `send` rejeita com um erro
 * que traz `statusCode` (404/410 = inscrição morta). O transporte principal é o FCM (FcmSender, fcm.sender.ts).
 */
export interface PushSender {
  readonly publicKey: string;
  send(target: PushTarget, payload: PushPayload): Promise<void>;
}

/** Token do remetente de teste/stub. Em produção vale `null` e o remetente vem das envs VAPID_*. */
export const PUSH_SENDER = Symbol('PUSH_SENDER');

class WebPushSender implements PushSender {
  readonly publicKey: string;

  constructor(private readonly vapid: VapidConfig) {
    this.publicKey = vapid.publicKey;
  }

  async send(target: PushTarget, payload: PushPayload): Promise<void> {
    await webpush.sendNotification(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      JSON.stringify(payload),
      {
        vapidDetails: { subject: this.vapid.subject, publicKey: this.vapid.publicKey, privateKey: this.vapid.privateKey },
        TTL: 60 * 60 * 24,
        timeout: 10_000,
        urgency: 'normal',
      },
    );
  }
}

/** Notificação já gravada que pode virar push (subconjunto de Prisma.NotificationCreateManyInput). */
export interface PushItem {
  userId: number;
  title: string;
  body: string;
  type?: string | null;
}

/** Teto de notificações processadas por disparo (broadcasts já são limitados a 2000 destinatários). */
export const PUSH_MAX_ITEMS_PER_DISPATCH = 5000;
/** Máximo de avisos por usuário num mesmo disparo (o resto é colapsado — o sino do app guarda todos). */
const MAX_ITEMS_PER_USER = 3;
/** Usuários consultados por query (limite de binds) e envios simultâneos (não abrir centenas de sockets). */
const USER_CHUNK = 200;
const SEND_CONCURRENCY = 25;
/** Dispositivos por usuário: acima disso a inscrição mais antiga é descartada. */
export const MAX_SUBSCRIPTIONS_PER_USER = 10;

export type PreferencesView = Record<PushCategory, boolean>;
export type PushProvider = 'fcm' | 'webpush';

/** Resposta de GET /push/config. `firebase` só vem com provider 'fcm' (config pública do SDK web, servida em runtime). */
export interface PushConfigView {
  enabled: boolean;
  provider: PushProvider | null;
  publicKey: string | null;
  firebase: FirebaseWebConfig | null;
}

/** Aviso do botão "Enviar aviso de teste" (POST /push/test): genérico, sem dados pessoais. */
export const TEST_PUSH_PAYLOAD: PushPayload = {
  title: 'Aviso de teste',
  body: 'Se você está vendo isto, os avisos do GingApp estão funcionando neste aparelho.',
  url: '/notificacoes',
  tag: 'gingapp-test',
};

/** Alvo de entrega: uma inscrição (webpush OU fcm) + o aviso. */
interface Delivery {
  subId: number;
  provider: string;
  endpoint: string | null;
  p256dh: string | null;
  auth: string | null;
  token: string | null;
  payload: PushPayload;
}

type SubscribeInput =
  | { provider: 'webpush'; endpoint: string; p256dh: string; auth: string; userAgent?: string }
  | { provider: 'fcm'; token: string; userAgent?: string };

/**
 * SSOT dos avisos push (I13 + FCM). Dois transportes OPCIONAIS e independentes:
 *  - FCM (principal): firebase-admin com conta de serviço (FIREBASE_*) — funciona com o app fechado E aberto (o app
 *    recebe via onMessage no primeiro plano);
 *  - Web Push VAPID (fallback): lib web-push (VAPID_*), usado quando o FCM não está configurado.
 * Sem nenhum dos dois `isEnabled()` é false, nada é enviado e o sistema funciona como sempre. `dispatch` é
 * fire-and-forget e NUNCA lança.
 *
 * Segurança: o payload é mínimo ({title, body, url, tag}), sem dados financeiros nem ids; nada é logado além de
 * contagens e códigos de status (endpoint, token e chaves são dados do dispositivo do usuário).
 */
@Injectable()
export class PushService implements OnModuleDestroy {
  private readonly logger = new Logger(PushService.name);
  private readonly pending = new Set<Promise<void>>();
  private realSender: PushSender | null = null;
  private realKey: string | null = null;
  private realFcm: FcmSender | null = null;
  private realFcmKey: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(PUSH_SENDER) private readonly injected: PushSender | null = null,
    @Optional() @Inject(FCM_SENDER) private readonly injectedFcm: FcmSender | null = null,
  ) {}

  /** Remetente Web Push (VAPID) ou null. */
  private webSender(): PushSender | null {
    if (this.injected) return this.injected;
    const vapid = readVapidConfig();
    if (!vapid) return null;
    const key = `${vapid.publicKey}|${vapid.privateKey}|${vapid.subject}`;
    if (!this.realSender || this.realKey !== key) {
      this.realSender = new WebPushSender(vapid);
      this.realKey = key;
    }
    return this.realSender;
  }

  /** Remetente FCM (conta de serviço FIREBASE_*) ou null. */
  private fcmSender(): FcmSender | null {
    if (this.injectedFcm) return this.injectedFcm;
    const admin = readFirebaseAdminConfig();
    if (!admin) return null;
    const key = `${admin.projectId}|${admin.clientEmail}|${admin.privateKey}`;
    if (!this.realFcm || this.realFcmKey !== key) {
      this.realFcm = new FirebaseFcmSender(admin);
      this.realFcmKey = key;
    }
    return this.realFcm;
  }

  /** Transporte oferecido ao app: FCM se (conta de serviço + config web completas), senão Web Push VAPID, senão nenhum. */
  provider(): PushProvider | null {
    if (this.fcmSender() && readFirebaseWebSettings()) return 'fcm';
    if (this.webSender()) return 'webpush';
    return null;
  }

  isEnabled(): boolean {
    return this.provider() !== null;
  }

  config(): PushConfigView {
    const provider = this.provider();
    if (provider === 'fcm') {
      const web = readFirebaseWebSettings()!;
      return { enabled: true, provider, publicKey: web.vapidKey, firebase: web.firebase };
    }
    if (provider === 'webpush') {
      return { enabled: true, provider, publicKey: this.webSender()!.publicKey, firebase: null };
    }
    return { enabled: false, provider: null, publicKey: null, firebase: null };
  }

  // ---------------------------------------------------------------------------------------------
  // INSCRIÇÕES E PREFERÊNCIAS
  // ---------------------------------------------------------------------------------------------

  /** Idempotente por endpoint (webpush) ou por token (fcm): o mesmo navegador reinscrito atualiza dono/chaves
   * (aparelho compartilhado => o último usuário logado fica com ele). Transporte desligado => 503 (o app nem oferece
   * o botão). Passa de 10 aparelhos => os mais antigos são descartados. */
  async subscribe(user: { id: number; organizationId?: number }, input: SubscribeInput): Promise<{ subscribed: true }> {
    const available = input.provider === 'fcm' ? this.fcmSender() !== null : this.webSender() !== null;
    if (!available) {
      throw new ServiceUnavailableException('As notificações por push não estão habilitadas neste ambiente.');
    }
    const common = {
      userId: user.id,
      organizationId: user.organizationId ?? null,
      userAgent: input.userAgent?.slice(0, 300) || null,
    };
    let id: number;
    if (input.provider === 'fcm') {
      const data = { ...common, provider: 'fcm', endpoint: null, p256dh: null, auth: null };
      const row = await this.prisma.pushSubscription.upsert({
        where: { token: input.token },
        create: { token: input.token, ...data },
        update: data,
        select: { id: true },
      });
      id = row.id;
    } else {
      const data = { ...common, provider: 'webpush', token: null, p256dh: input.p256dh, auth: input.auth };
      const row = await this.prisma.pushSubscription.upsert({
        where: { endpoint: input.endpoint },
        create: { endpoint: input.endpoint, ...data },
        update: data,
        select: { id: true },
      });
      id = row.id;
    }
    await this.trimSubscriptions(user.id, id);
    return { subscribed: true };
  }

  /** Remove só a inscrição do PRÓPRIO usuário, por endpoint (webpush) ou token (fcm). Idempotente; funciona também
   * com o push desligado, para limpeza. */
  async unsubscribe(userId: number, target: { endpoint?: string; token?: string }): Promise<{ removed: number }> {
    const or: { endpoint?: string; token?: string }[] = [];
    if (target.endpoint) or.push({ endpoint: target.endpoint });
    if (target.token) or.push({ token: target.token });
    if (or.length === 0) return { removed: 0 };
    const result = await this.prisma.pushSubscription.deleteMany({ where: { userId, OR: or } });
    return { removed: result.count };
  }

  /** Mantém no máximo MAX_SUBSCRIPTIONS_PER_USER aparelhos por usuário (qualquer transporte); nunca apaga `keepId`. */
  private async trimSubscriptions(userId: number, keepId: number): Promise<void> {
    const extra = await this.prisma.pushSubscription.findMany({
      where: { userId, id: { not: keepId } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: MAX_SUBSCRIPTIONS_PER_USER - 1,
      select: { id: true },
    });
    if (extra.length > 0) {
      await this.prisma.pushSubscription.deleteMany({ where: { id: { in: extra.map((s) => s.id) } } });
    }
  }

  async getPreferences(userId: number): Promise<PreferencesView> {
    const row = await this.prisma.pushPreference.findUnique({ where: { userId } });
    return toView(row);
  }

  async updatePreferences(userId: number, patch: Partial<PreferencesView>): Promise<PreferencesView> {
    const data: Partial<PreferencesView> = {};
    for (const category of PUSH_CATEGORIES) {
      if (typeof patch[category] === 'boolean') data[category] = patch[category];
    }
    const row = await this.prisma.pushPreference.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
    return toView(row);
  }

  // ---------------------------------------------------------------------------------------------
  // ENVIO (segundo plano)
  // ---------------------------------------------------------------------------------------------

  /** Agenda o push das notificações recém-gravadas e devolve na hora. Nunca lança nem derruba a ação principal. */
  dispatch(items: PushItem[]): void {
    try {
      if (items.length === 0 || (!this.webSender() && !this.fcmSender())) return;
      const job: Promise<void> = this.run(items)
        .catch((error) => this.logger.warn(`Falha ao enviar push: ${errorLabel(error)}`))
        .finally(() => this.pending.delete(job));
      this.pending.add(job);
    } catch (error) {
      this.logger.warn(`Falha ao agendar push: ${errorLabel(error)}`);
    }
  }

  /**
   * Aviso de teste ao PRÓPRIO usuário (POST /push/test): vai para todos os aparelhos dele, ignorando as preferências
   * de categoria (é um pedido explícito) e SÍNCRONO, para o app saber se chegou ao FCM. Desligado => 503.
   */
  async sendTest(userId: number): Promise<{ sent: number; devices: number }> {
    if (!this.webSender() && !this.fcmSender()) {
      throw new ServiceUnavailableException('As notificações por push não estão habilitadas neste ambiente.');
    }
    const subs = await this.prisma.pushSubscription.findMany({
      where: { userId },
      select: { id: true, provider: true, endpoint: true, p256dh: true, auth: true, token: true },
    });
    const result = await this.deliver(subs.map((s) => ({ subId: s.id, ...s, payload: TEST_PUSH_PAYLOAD })));
    return { sent: result.sent, devices: subs.length };
  }

  /** Aguarda os envios em andamento (testes e desligamento ordenado). */
  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.drain();
  }

  private async run(items: PushItem[]): Promise<void> {
    const byUser = new Map<number, PushItem[]>();
    for (const item of items.slice(0, PUSH_MAX_ITEMS_PER_DISPATCH)) {
      const list = byUser.get(item.userId) ?? [];
      if (list.length < MAX_ITEMS_PER_USER) list.push(item);
      byUser.set(item.userId, list);
    }
    const userIds = [...byUser.keys()];

    let sent = 0;
    let removed = 0;
    for (let i = 0; i < userIds.length; i += USER_CHUNK) {
      const chunk = userIds.slice(i, i + USER_CHUNK);
      const subs = await this.prisma.pushSubscription.findMany({
        where: { userId: { in: chunk } },
        select: { id: true, userId: true, provider: true, endpoint: true, p256dh: true, auth: true, token: true },
      });
      if (subs.length === 0) continue;
      const prefs = await this.prisma.pushPreference.findMany({ where: { userId: { in: chunk } } });
      const prefByUser = new Map(prefs.map((p) => [p.userId, toView(p)]));

      const deliveries: Delivery[] = [];
      for (const sub of subs) {
        const allowed = prefByUser.get(sub.userId) ?? toView(null);
        for (const item of byUser.get(sub.userId) ?? []) {
          if (!allowed[pushCategoryOf(item.type)]) continue;
          deliveries.push({ subId: sub.id, ...sub, payload: buildPushPayload(item) });
        }
      }
      const result = await this.deliver(deliveries);
      sent += result.sent;
      removed += result.removed;
    }
    if (sent > 0 || removed > 0) {
      this.logger.log(`Push: ${sent} dispositivo(s) avisado(s), ${removed} inscrição(ões) expirada(s) removida(s).`);
    }
  }

  /** Envia (cada inscrição pelo seu transporte), apaga as inscrições mortas e marca `lastUsedAt` das que receberam. */
  private async deliver(deliveries: Delivery[]): Promise<{ sent: number; removed: number }> {
    const ok = new Set<number>();
    const gone = new Set<number>();
    const web = this.webSender();
    const fcm = this.fcmSender();

    // --- Web Push (VAPID): um POST por inscrição/aviso ---
    const webJobs = web
      ? deliveries.filter((d) => d.provider !== 'fcm' && d.endpoint && d.p256dh && d.auth)
      : [];
    for (let j = 0; j < webJobs.length; j += SEND_CONCURRENCY) {
      const slice = webJobs.slice(j, j + SEND_CONCURRENCY);
      const results = await Promise.allSettled(
        slice.map((job) =>
          web!.send({ endpoint: job.endpoint!, p256dh: job.p256dh!, auth: job.auth! }, job.payload),
        ),
      );
      results.forEach((result, idx) => {
        const subId = slice[idx].subId;
        if (result.status === 'fulfilled') {
          ok.add(subId);
        } else {
          const status = (result.reason as { statusCode?: unknown } | null)?.statusCode;
          if (status === 404 || status === 410) gone.add(subId);
        }
      });
    }

    // --- FCM: avisos iguais viram UM multicast (até 500 tokens por chamada) ---
    if (fcm) {
      const groups = new Map<string, { payload: PushPayload; subs: Map<string, number> }>();
      for (const d of deliveries) {
        if (d.provider !== 'fcm' || !d.token) continue;
        const key = JSON.stringify(d.payload);
        const group = groups.get(key) ?? { payload: d.payload, subs: new Map<string, number>() };
        group.subs.set(d.token, d.subId);
        groups.set(key, group);
      }
      const calls: { payload: PushPayload; tokens: string[]; subs: Map<string, number> }[] = [];
      for (const { payload, subs } of groups.values()) {
        const tokens = [...subs.keys()];
        for (let k = 0; k < tokens.length; k += FCM_MULTICAST_LIMIT) {
          calls.push({ payload, tokens: tokens.slice(k, k + FCM_MULTICAST_LIMIT), subs });
        }
      }
      for (let c = 0; c < calls.length; c += SEND_CONCURRENCY) {
        const slice = calls.slice(c, c + SEND_CONCURRENCY);
        const settled = await Promise.allSettled(slice.map((call) => fcm.sendMulticast(call.tokens, call.payload)));
        settled.forEach((outcome, idx) => {
          if (outcome.status === 'rejected') {
            // Falha do serviço inteiro (rede/credencial): não dá para saber nada sobre os tokens — mantém todos.
            this.logger.warn(`Falha no envio FCM: ${errorLabel(outcome.reason)}`);
            return;
          }
          for (const r of outcome.value) {
            const subId = slice[idx].subs.get(r.token);
            if (subId === undefined) continue;
            if (r.ok) ok.add(subId);
            else if (isDeadFcmToken(r.errorCode)) gone.add(subId);
          }
        });
      }
    }

    for (const id of gone) ok.delete(id);
    if (gone.size > 0) {
      await this.prisma.pushSubscription.deleteMany({ where: { id: { in: [...gone] } } });
    }
    if (ok.size > 0) {
      await this.prisma.pushSubscription.updateMany({ where: { id: { in: [...ok] } }, data: { lastUsedAt: new Date() } });
    }
    return { sent: ok.size, removed: gone.size };
  }
}

function toView(row: PushPreference | null): PreferencesView {
  return {
    lessons: row?.lessons ?? true,
    finance: row?.finance ?? true,
    events: row?.events ?? true,
    graduations: row?.graduations ?? true,
    announcements: row?.announcements ?? true,
  };
}

/** Só o nome/código do erro: a mensagem da lib pode conter o endpoint/token do dispositivo. */
function errorLabel(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  const name = error instanceof Error ? error.name : 'Erro';
  return `${name}${typeof code === 'string' ? ` (${code})` : ''}${typeof status === 'number' ? ` [${status}]` : ''}`;
}
