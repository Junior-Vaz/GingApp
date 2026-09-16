import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Equipe PLATFORM (ou super admin) enxerga todas as organizações — uso do admin.gingapp.com.br. */
  findAllForPlatform() {
    return this.prisma.organization.findMany({
      orderBy: { id: 'desc' },
      take: 50,
    });
  }

  /** Mestre/professor/aluno vê apenas a própria organização (contexto do JWT). */
  findOwn(organizationId: number) {
    return this.prisma.organization.findUnique({ where: { id: organizationId } });
  }
}
