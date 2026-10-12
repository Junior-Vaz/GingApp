import { Inject, Injectable, Logger, OnModuleDestroy, Optional, ServiceUnavailableException } from '@nestjs/common';
import { PushPreference } from '@prisma/client';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';
import {
  PUSH_CATEGORIES,
  PushCategory,
  PushPayload,
  VapidConfig,
  buildPushPayload,
  pushCategoryOf,
  readVapidConfig,
} from './push.config';

/** Alvo de um envio: os três campos que o navegador devolve em PushSubscription.toJSON(). */
export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * Remetente de push. O real (WebPushSender) usa a lib `web-push` + VAPID; os testes injetam um stub (token
 * PUSH_SENDER) que só guarda as chamadas em memória — NENHUM push real sai da suíte. `send` rejeita com um erro
 * que traz `statusCode` (404/410 = inscrição morta).
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

/**
 * SSOT do Web Push (I13). OPCIONAL: sem VAPID (e sem remetente injetado) `isEnabled()` é false, nada é enviado
 * e o restante do sistema funciona como sempre. `dispatch` é fire-and-forget e NUNCA lança.
 *
 * Segurança: o payload é mínimo ({title, body, url, tag}), sem dados financeiros nem ids; nada é logado além de
 * contagens e códigos de status (endpoint e chaves são dados do dispositivo do usuário).
 */
@Injectable()
export class PushService implements OnModuleDestroy {
  private readonly logger = new Logger(PushService.name);
  private readonly pending = new Set<Promise<void>>();
  private realSender: PushSender | null = null;
  private realKey: string | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Optional() @Inject(PUSH_SENDER) private readonly injected: PushSender | null = null,
  ) {}

  private sender(): PushSender | null {
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

  isEnabled(): boolean {
    return this.sender() !== null;
  }

  config(): { enabled: boolean; publicKey: string | null } {
    const sender = this.sender();
    return { enabled: sender !== null, publicKey: sender?.publicKey ?? null };
  }

  // ---------------------------------------------------------------------------------------------
  // INSCRIÇÕES E PREFERÊNCIAS
  // ---------------------------------------------------------------------------------------------

  /** Idempotente por endpoint: o mesmo navegador reinscrito atualiza chaves/dono (aparelho compartilhado => o último
   * usuário logado fica com ele). Desligado => 503 (o app nem oferece o botão). */
  async subscribe(
    user: { id: number; organizationId?: number },
    input: { endpoint: string; p256dh: string; auth: string; userAgent?: string },
  ): Promise<{ subscribed: true }> {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('As notificações por push não estão habilitadas neste ambiente.');
    }
    const data = {
      userId: user.id,
      organizationId: user.organizationId ?? null,
      p256dh: input.p256dh,
      auth: input.auth,
      userAgent: input.userAgent?.slice(0, 300) || null,
    };
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: { endpoint: input.endpoint, ...data },
      update: data,
    });
    await this.trimSubscriptions(user.id);
    return { subscribed: true };
  }

  /** Remove só a inscrição do PRÓPRIO usuário (idempotente; funciona também com o push desligado, para limpeza). */
  async unsubscribe(userId: number, endpoint: string): Promise<{ removed: number }> {
    const result = await this.prisma.pushSubscription.deleteMany({ where: { userId, endpoint } });
    return { removed: result.count };
  }

  private async trimSubscriptions(userId: number): Promise<void> {
    const extra = await this.prisma.pushSubscription.findMany({
      where: { userId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: MAX_SUBSCRIPTIONS_PER_USER,
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
      if (items.length === 0 || !this.isEnabled()) return;
      const job: Promise<void> = this.run(items)
        .catch((error) => this.logger.warn(`Falha ao enviar push: ${errorLabel(error)}`))
        .finally(() => this.pending.delete(job));
      this.pending.add(job);
    } catch (error) {
      this.logger.warn(`Falha ao agendar push: ${errorLabel(error)}`);
    }
  }

  /** Aguarda os envios em andamento (testes e desligamento ordenado). */
  async drain(): Promise<void> {
    while (this.pending.size > 0) await Promise.allSettled([...this.pending]);
  }

  async onModuleDestroy(): Promise<void> {
    await this.drain();
  }

  private async run(items: PushItem[]): Promise<void> {
    const sender = this.sender();
    if (!sender) return;

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
        select: { id: true, userId: true, endpoint: true, p256dh: true, auth: true },
      });
      if (subs.length === 0) continue;
      const prefs = await this.prisma.pushPreference.findMany({ where: { userId: { in: chunk } } });
      const prefByUser = new Map(prefs.map((p) => [p.userId, toView(p)]));

      const jobs: { subId: number; target: PushTarget; payload: PushPayload }[] = [];
      for (const sub of subs) {
        const allowed = prefByUser.get(sub.userId) ?? toView(null);
        for (const item of byUser.get(sub.userId) ?? []) {
          if (!allowed[pushCategoryOf(item.type)]) continue;
          jobs.push({
            subId: sub.id,
            target: { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth },
            payload: buildPushPayload(item),
          });
        }
      }

      const gone = new Set<number>();
      const ok = new Set<number>();
      for (let j = 0; j < jobs.length; j += SEND_CONCURRENCY) {
        const slice = jobs.slice(j, j + SEND_CONCURRENCY);
        const results = await Promise.allSettled(slice.map((job) => sender.send(job.target, job.payload)));
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
      for (const id of gone) ok.delete(id);
      sent += ok.size;
      if (gone.size > 0) {
        await this.prisma.pushSubscription.deleteMany({ where: { id: { in: [...gone] } } });
        removed += gone.size;
      }
      if (ok.size > 0) {
        await this.prisma.pushSubscription.updateMany({ where: { id: { in: [...ok] } }, data: { lastUsedAt: new Date() } });
      }
    }
    if (sent > 0 || removed > 0) {
      this.logger.log(`Push: ${sent} dispositivo(s) avisado(s), ${removed} inscrição(ões) expirada(s) removida(s).`);
    }
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

/** Só o nome/código do erro: a mensagem da lib pode conter o endpoint do dispositivo. */
function errorLabel(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  const status = (error as { statusCode?: unknown } | null)?.statusCode;
  const name = error instanceof Error ? error.name : 'Erro';
  return `${name}${typeof code === 'string' ? ` (${code})` : ''}${typeof status === 'number' ? ` [${status}]` : ''}`;
}
