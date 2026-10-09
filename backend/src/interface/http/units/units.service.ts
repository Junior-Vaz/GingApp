import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, Unit } from '@prisma/client';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { ListUnitsQueryDto } from './dto/list-units-query.dto';

/**
 * Matriz/filiais do grupo.
 * Esqueleto do MVP (PLANO_PROJETO.md §7): CRUD completo entra nas proximas iteracoes,
 * aqui so o findAll ja funcional, sempre isolado por organizationId.
 */
@Injectable()
export class UnitsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(organizationId: number, query: ListUnitsQueryDto = {}): Promise<Page<Unit>> {
    const where: Prisma.UnitWhereInput = { organizationId }; // organizationId SEMPRE no where (findMany e count)
    const q = query.q?.trim();
    if (q) where.name = { contains: q, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      this.prisma.unit.findMany({ where, orderBy: { id: 'desc' }, ...pageArgs(query) }),
      this.prisma.unit.count({ where }),
    ]);
    return { items, total };
  }

  async findOne(organizationId: number, id: number): Promise<Unit> {
    const unit = await this.prisma.unit.findFirst({ where: { id, organizationId } });
    if (!unit) throw new NotFoundException('Unidade não encontrada.');
    return unit;
  }
}
