import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { parseCorsOrigins, parseTrustProxy } from './shared/config/runtime-config';
import { TOTAL_COUNT_HEADER } from './shared/pagination/pagination';

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
  // exposedHeaders: o navegador só deixa o JS ler X-Total-Count (paginação) se for exposto aqui.
  app.enableCors({
    origin: parseCorsOrigins(process.env.CORS_ORIGINS),
    exposedHeaders: [TOTAL_COUNT_HEADER],
  });
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
