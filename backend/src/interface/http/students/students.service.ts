import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

/** Alunos do grupo — CRUD completo, sempre isolado por organizationId. */
@Injectable()
export class StudentsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(organizationId: number) {
    return this.prisma.student.findMany({
      where: { organizationId },
      orderBy: { id: 'desc' },
      take: 50,
    });
  }

  async findOne(organizationId: number, id: number) {
    const student = await this.prisma.student.findFirst({ where: { id, organizationId } });
    if (!student) {
      throw new NotFoundException('Aluno não encontrado.');
    }
    return student;
  }

  async create(organizationId: number, dto: CreateStudentDto) {
    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }

    return this.prisma.student.create({
      data: {
        organizationId,
        unitId: dto.unitId,
        name: dto.name,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        document: dto.document,
        phone: dto.phone,
        email: dto.email,
        photo: dto.photo,
        status: dto.status,
        joinedAt: dto.joinedAt ? new Date(dto.joinedAt) : undefined,
      },
    });
  }

  async update(organizationId: number, id: number, dto: UpdateStudentDto) {
    await this.findOne(organizationId, id); // 404 se não existir ou não for desta organização

    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }

    return this.prisma.student.update({
      where: { id },
      data: {
        unitId: dto.unitId,
        name: dto.name,
        birthDate: dto.birthDate ? new Date(dto.birthDate) : undefined,
        document: dto.document,
        phone: dto.phone,
        email: dto.email,
        photo: dto.photo,
        status: dto.status,
        joinedAt: dto.joinedAt ? new Date(dto.joinedAt) : undefined,
      },
    });
  }

  /**
   * "Remover" um aluno nunca apaga o registro — o histórico não deve ser apagado quando o
   * aluno fica inativo (projeto.txt §20). Marca status = INACTIVE.
   */
  async remove(organizationId: number, id: number) {
    await this.findOne(organizationId, id);
    return this.prisma.student.update({ where: { id }, data: { status: 'INACTIVE' } });
  }

  /** Nunca confiar em unitId vindo do corpo da requisição sem confirmar que pertence à
   * organização do usuário autenticado (PLANO_PROJETO.md §3.2 item 4). */
  private async assertUnitBelongsToOrganization(organizationId: number, unitId: number): Promise<void> {
    const unit = await this.prisma.unit.findFirst({ where: { id: unitId, organizationId } });
    if (!unit) {
      throw new BadRequestException('Unidade inválida para esta organização.');
    }
  }
}
