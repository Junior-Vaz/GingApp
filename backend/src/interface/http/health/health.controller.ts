import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { Public } from '../../../shared/decorators/public.decorator';
import { PrismaService } from '../../../shared/prisma/prisma.service';

interface HealthResponse {
  status: 'ok';
  timestamp: string;
  database: 'up';
}

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get()
  async check(): Promise<HealthResponse> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw new ServiceUnavailableException('Banco de dados indisponível.');
    }

    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'up',
    };
  }
}
