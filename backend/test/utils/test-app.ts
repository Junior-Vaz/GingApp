import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getStorageToken } from '@nestjs/throttler';
import { AppModule } from '../../src/app.module';
import { MAIL_TRANSPORT, MailEnvelope, MailTransport } from '../../src/shared/mail/mail.service';
import type { PushPayload } from '../../src/shared/push/push.config';
import { PUSH_SENDER, PushSender, PushTarget } from '../../src/shared/push/push.service';

/** Stub de transporte de e-mail para os e2e: guarda as mensagens em memória (nunca envia nada). */
export class MemoryMailTransport implements MailTransport {
  readonly sent: MailEnvelope[] = [];
  failNext = false;
  async sendMail(message: MailEnvelope): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw Object.assign(new Error('falha simulada'), { code: 'ESTUB' });
    }
    this.sent.push(message);
  }
  /** Mensagens enviadas para um endereço. */
  to(address: string): MailEnvelope[] {
    return this.sent.filter((m) => m.to.toLowerCase() === address.toLowerCase());
  }
  /** Token do último link do e-mail (query `token=`). */
  static tokenOf(message: MailEnvelope): string {
    const match = /redefinir-senha\?token=([A-Za-z0-9_-]+)/.exec(message.text);
    if (!match) throw new Error('e-mail sem link de redefinição');
    return match[1];
  }
}

/** Stub do remetente de Web Push para os e2e: guarda os envios em memória (NUNCA fala com serviço de push real). */
export class MemoryPushSender implements PushSender {
  readonly publicKey = 'BE2E-stub-public-key';
  readonly sent: { target: PushTarget; payload: PushPayload }[] = [];
  /** endpoint -> statusCode com o qual o envio deve falhar (ex.: 410 = inscrição expirada). */
  readonly failures = new Map<string, number>();
  async send(target: PushTarget, payload: PushPayload): Promise<void> {
    const statusCode = this.failures.get(target.endpoint);
    if (statusCode) throw Object.assign(new Error('falha simulada'), { statusCode });
    this.sent.push({ target, payload });
  }
  /** Envios feitos para um endpoint. */
  to(endpoint: string): PushPayload[] {
    return this.sent.filter((s) => s.target.endpoint === endpoint).map((s) => s.payload);
  }
}

export interface TestAppOptions {
  /** Desliga o rate limit global (60 req/min por IP) — só para specs que varrem centenas de
   * rotas (ex.: member-privacy.e2e-spec.ts). O throttle em si não é o que esses specs testam. */
  disableThrottle?: boolean;
  /** Transporte de e-mail em memória (stub): liga o e-mail transacional SEM SMTP e SEM enviar nada de verdade. */
  mailTransport?: MailTransport;
  /** Remetente de Web Push em memória (stub): liga o push SEM VAPID e SEM enviar nada de verdade. */
  pushSender?: PushSender;
}

/** Bootstrap da aplicação real (mesmos guards/pipes globais de `src/main.ts`) para os
 * testes e2e — nenhum mock: bate no Postgres real via PrismaService normal. */
export async function createTestApp(options: TestAppOptions = {}): Promise<INestApplication> {
  let builder = Test.createTestingModule({
    imports: [AppModule],
  });
  if (options.disableThrottle) {
    builder = builder.overrideProvider(getStorageToken()).useValue({
      increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }),
    });
  }
  if (options.mailTransport) {
    builder = builder.overrideProvider(MAIL_TRANSPORT).useValue(options.mailTransport);
  }
  if (options.pushSender) {
    builder = builder.overrideProvider(PUSH_SENDER).useValue(options.pushSender);
  }
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}
