import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getStorageToken } from '@nestjs/throttler';
import { AppModule } from '../../src/app.module';

export interface TestAppOptions {
  /** Desliga o rate limit global (60 req/min por IP) — só para specs que varrem centenas de
   * rotas (ex.: member-privacy.e2e-spec.ts). O throttle em si não é o que esses specs testam. */
  disableThrottle?: boolean;
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
