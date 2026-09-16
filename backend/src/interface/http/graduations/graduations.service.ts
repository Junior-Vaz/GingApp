import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';

@Injectable()
export class GraduationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Sistemas de graduação configuráveis do grupo, com seus níveis (projeto.txt §26). */
  findAll(organizationId: number) {
    return this.prisma.graduationSystem.findMany({
      where: { organizationId },
      include: { levels: { orderBy: { order: 'asc' } } },
      orderBy: { id: 'desc' },
      take: 50,
    });
  }
}
