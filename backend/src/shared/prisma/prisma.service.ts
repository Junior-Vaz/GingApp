import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Wrapper global do Prisma Client.
 *
 * IMPORTANTE (isolamento multi-tenant): este service NÃO faz filtragem automática por
 * organizationId. Cada service de domínio é responsável por sempre filtrar suas queries
 * pelo organizationId do usuário autenticado (via @CurrentOrganization()) — nunca confiar
 * em organizationId vindo do corpo da requisição para dados sensíveis (PLANO_PROJETO.md §3.2).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      log: [
        { level: 'warn', emit: 'stdout' },
        { level: 'error', emit: 'stdout' },
      ],
    });
  }

  /**
   * Tenta conectar no boot, mas NÃO derruba a aplicação se o Postgres estiver indisponível
   * (ex.: ambiente de desenvolvimento inicial sem banco configurado ainda). O Prisma
   * reconecta sob demanda na primeira query; GET /health reflete o estado real do banco.
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Conectado ao PostgreSQL via Prisma.');
    } catch (error) {
      this.logger.warn(
        `Não foi possível conectar ao banco no boot (app segue no ar; GET /health reportará o estado real): ${(error as Error).message}`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
