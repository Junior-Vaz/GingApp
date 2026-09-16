import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';

/**
 * Aulas do grupo.
 * Esqueleto do MVP (PLANO_PROJETO.md §7): CRUD completo entra nas proximas iteracoes,
 * aqui so o findAll ja funcional, sempre isolado por organizationId.
 */
@Injectable()
export class LessonsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(organizationId: number) {
    return this.prisma.lesson.findMany({
      where: { organizationId },
      orderBy: { id: 'desc' },
      take: 50,
    });
  }
}
