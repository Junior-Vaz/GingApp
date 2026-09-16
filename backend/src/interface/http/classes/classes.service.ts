import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { CreateClassDto } from './dto/create-class.dto';
import { UpdateClassDto } from './dto/update-class.dto';

/** Turmas do grupo — CRUD completo, sempre isolado por organizationId. */
@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentsService: StudentsService,
  ) {}

  findAll(organizationId: number) {
    return this.prisma.class.findMany({
      where: { organizationId },
      orderBy: { id: 'desc' },
      take: 50,
    });
  }

  /** "Minhas turmas" — as turmas em que os alunos ligados ao usuário autenticado estão
   * matriculados (mesmo padrão de FinanceService.findMine). */
  async findMine(organizationId: number, userId: number) {
    const students = await this.studentsService.findMine(organizationId, userId);
    if (students.length === 0) return [];

    const enrollments = await this.prisma.classStudent.findMany({
      where: { organizationId, studentId: { in: students.map((s) => s.id) }, status: 'ACTIVE' },
      select: { classId: true },
    });
    const classIds = [...new Set(enrollments.map((e) => e.classId))];
    if (classIds.length === 0) return [];

    return this.prisma.class.findMany({ where: { id: { in: classIds } } });
  }

  async findOne(organizationId: number, id: number) {
    const classItem = await this.prisma.class.findFirst({ where: { id, organizationId } });
    if (!classItem) {
      throw new NotFoundException('Turma não encontrada.');
    }
    return classItem;
  }

  async create(organizationId: number, dto: CreateClassDto) {
    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }

    return this.prisma.class.create({
      data: {
        organizationId,
        unitId: dto.unitId,
        name: dto.name,
        description: dto.description,
        weekday: dto.weekday,
        startTime: dto.startTime,
        endTime: dto.endTime,
      },
    });
  }

  async update(organizationId: number, id: number, dto: UpdateClassDto) {
    await this.findOne(organizationId, id); // 404 se não existir ou não for desta organização

    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }

    return this.prisma.class.update({
      where: { id },
      data: {
        unitId: dto.unitId,
        name: dto.name,
        description: dto.description,
        weekday: dto.weekday,
        startTime: dto.startTime,
        endTime: dto.endTime,
        status: dto.status,
      },
    });
  }

  /**
   * "Remover" uma turma nunca apaga o registro — o histórico não deve ser apagado quando a
   * turma fica inativa (mesmo padrão do StudentsService). Marca status = INACTIVE.
   */
  async remove(organizationId: number, id: number) {
    await this.findOne(organizationId, id);
    return this.prisma.class.update({ where: { id }, data: { status: 'INACTIVE' } });
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
