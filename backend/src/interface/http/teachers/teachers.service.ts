import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrgRole, Prisma } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { pageArgs } from '../../../shared/pagination/pagination';
import { ListTeachersQueryDto } from './dto/list-teachers-query.dto';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { findUserIdsByEmail } from '../../../shared/security/email-lookup';
import { BCRYPT_ROUNDS, normalizeEmail } from '../../../shared/security/password-policy';
import { CreateTeacherDto } from './dto/create-teacher.dto';
import { UpdateTeacherDto } from './dto/update-teacher.dto';

const TEACHER_ROLES = [OrgRole.MESTRE, OrgRole.PROFESSOR];
const TEACHER_SELECT = {
  id: true,
  role: true,
  status: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true, phone: true, photo: true } },
} as const;

/**
 * Não existe model Teacher próprio (PLANO_PROJETO.md §2.2): "professor" é o papel MESTRE
 * ou PROFESSOR de um OrganizationUser dentro do grupo. `id` nas rotas deste controller é o
 * id do OrganizationUser (a membership), não do User.
 */
@Injectable()
export class TeachersService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(organizationId: number, query: ListTeachersQueryDto = {}) {
    // organizationId e o filtro de papel (MESTRE/PROFESSOR) sempre no where, em findMany e count.
    const where: Prisma.OrganizationUserWhereInput = {
      organizationId,
      role: query.role ? query.role : { in: TEACHER_ROLES },
    };
    if (query.status) where.status = query.status;
    const q = query.q?.trim();
    if (q) {
      where.user = {
        OR: [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.organizationUser.findMany({
        where,
        select: TEACHER_SELECT,
        orderBy: { id: 'desc' },
        ...pageArgs(query),
      }),
      this.prisma.organizationUser.count({ where }),
    ]);
    return { items, total };
  }

  async findOne(organizationId: number, id: number) {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { id, organizationId, role: { in: TEACHER_ROLES } },
      select: TEACHER_SELECT,
    });
    if (!membership) {
      throw new NotFoundException('Professor não encontrado.');
    }
    return membership;
  }

  /** Cria o User (userType MEMBER) e a membership (OrganizationUser) juntos. */
  async create(organizationId: number, dto: CreateTeacherDto) {
    // E-mail gravado em minúsculas (como em platform-team/organizations/bootstrap): o login normaliza o que
    // é digitado, e a unicidade não pode depender da caixa.
    const email = normalizeEmail(dto.email);
    const [existing] = await findUserIdsByEmail(this.prisma, email, 1);
    if (existing !== undefined) {
      throw new BadRequestException('E-mail já cadastrado.');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const membership = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email, passwordHash, name: dto.name, phone: dto.phone, status: 'ACTIVE' },
      });
      return tx.organizationUser.create({
        data: { organizationId, userId: user.id, role: dto.role, status: 'ACTIVE' },
        select: TEACHER_SELECT,
      });
    });

    return membership;
  }

  async update(organizationId: number, id: number, dto: UpdateTeacherDto) {
    const membership = await this.findOne(organizationId, id);

    if (dto.name !== undefined || dto.phone !== undefined) {
      await this.prisma.user.update({
        where: { id: membership.user.id },
        data: { name: dto.name, phone: dto.phone },
      });
    }

    if (dto.role !== undefined || dto.status !== undefined) {
      await this.prisma.organizationUser.update({
        where: { id },
        data: { role: dto.role, status: dto.status },
      });
    }

    return this.findOne(organizationId, id);
  }

  /** Nunca apaga o User (identidade compartilhada) nem a membership — marca status =
   * INACTIVE, mesmo padrão de "remoção" usado em Students (preserva histórico/auditoria). */
  async remove(organizationId: number, id: number) {
    await this.findOne(organizationId, id);
    return this.prisma.organizationUser.update({
      where: { id },
      data: { status: 'INACTIVE' },
      select: TEACHER_SELECT,
    });
  }
}
