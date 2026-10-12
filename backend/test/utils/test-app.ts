import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getStorageToken } from '@nestjs/throttler';
import { AppModule } from '../../src/app.module';
import { MAIL_TRANSPORT, MailEnvelope, MailTransport } from '../../src/shared/mail/mail.service';

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

export interface TestAppOptions {
  /** Desliga o rate limit global (60 req/min por IP) — só para specs que varrem centenas de
   * rotas (ex.: member-privacy.e2e-spec.ts). O throttle em si não é o que esses specs testam. */
  disableThrottle?: boolean;
  /** Transporte de e-mail em memória (stub): liga o e-mail transacional SEM SMTP e SEM enviar nada de verdade. */
  mailTransport?: MailTransport;
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
