import { Injectable } from '@nestjs/common';
import { OrgRole } from '@prisma/client';
import { PrismaService } from '../../../shared/prisma/prisma.service';

/**
 * Não existe model Teacher próprio (PLANO_PROJETO.md §2.2): "professor" é o papel MESTRE
 * ou PROFESSOR de um OrganizationUser dentro do grupo. Este módulo lista as memberships
 * com esses papéis, com os dados do User associado.
 */
@Injectable()
export class TeachersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(organizationId: number) {
    return this.prisma.organizationUser.findMany({
      where: {
        organizationId,
        role: { in: [OrgRole.MESTRE, OrgRole.PROFESSOR] },
      },
      include: { user: { select: { id: true, name: true, email: true, phone: true, photo: true } } },
      orderBy: { id: 'desc' },
      take: 50,
    });
  }
}
