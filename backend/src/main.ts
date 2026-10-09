import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { parseCorsOrigins, parseTrustProxy } from './shared/config/runtime-config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Atrás de proxy reverso (nginx/Caddy), sem isto req.ip é o do proxy: a allowlist de IP da
  // plataforma e o throttling por IP passariam a valer para todos juntos. Ver TRUST_PROXY.
  const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
  if (trustProxy !== undefined) {
    app.set('trust proxy', trustProxy);
  }

  app.setGlobalPrefix('api');
  // Em produção CORS_ORIGINS é obrigatório (falha o boot); em dev vazio = qualquer origem.
  app.enableCors({ origin: parseCorsOrigins(process.env.CORS_ORIGINS) });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`GingApp backend rodando em http://localhost:${port}/api`);
}

void bootstrap();
