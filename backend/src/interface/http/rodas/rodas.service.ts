import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';

/**
 * Rodas pertencem ao domínio "Comunidade" (PLANO_PROJETO.md §2.3): dados públicos,
 * organizados por estado/cidade, sem organizationId — não há isolamento multi-tenant aqui
 * por design (nenhum dado privado do grupo é exposto nesta entidade).
 */
@Injectable()
export class RodasService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.roda.findMany({
      orderBy: { date: 'asc' },
      take: 50,
    });
  }
}
