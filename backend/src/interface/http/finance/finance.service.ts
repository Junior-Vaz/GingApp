import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';

/**
 * Registros financeiros (mensalidades, cobrancas).
 * Esqueleto do MVP (PLANO_PROJETO.md §7): CRUD completo entra nas proximas iteracoes,
 * aqui so o findAll ja funcional, sempre isolado por organizationId.
 */
@Injectable()
export class FinanceService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(organizationId: number) {
    return this.prisma.financialRecord.findMany({
      where: { organizationId },
      orderBy: { id: 'desc' },
      take: 50,
    });
  }
}
