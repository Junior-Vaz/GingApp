import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Class, Prisma } from '@prisma/client';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { ListClassesQueryDto } from './dto/list-classes-query.dto';
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

  async findAll(organizationId: number, query: ListClassesQueryDto = {}): Promise<Page<Class>> {
    const where: Prisma.ClassWhereInput = { organizationId }; // organizationId SEMPRE no where (findMany e count)
    if (query.status) where.status = query.status;
    if (query.unitId !== undefined) where.unitId = query.unitId;
    const q = query.q?.trim();
    if (q) where.name = { contains: q, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      this.prisma.class.findMany({ where, orderBy: { id: 'desc' }, ...pageArgs(query) }),
      this.prisma.class.count({ where }),
    ]);
    return { items, total };
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

  /** Alunos matriculados (ativos) na turma, com os dados básicos do aluno. */
  async listStudents(organizationId: number, classId: number) {
    await this.findOne(organizationId, classId);
    const enrollments = await this.prisma.classStudent.findMany({
      where: { organizationId, classId, status: 'ACTIVE' },
      include: { student: { select: { id: true, name: true, status: true } } },
      orderBy: { student: { name: 'asc' } },
    });
    return enrollments.map((e) => ({
      id: e.id,
      studentId: e.studentId,
      name: e.student.name,
      studentStatus: e.student.status,
      enrolledAt: e.enrolledAt,
    }));
  }

  /** Matricula um aluno na turma (idempotente: reativa uma matrícula inativa, repetir não duplica). */
  async enrollStudent(organizationId: number, classId: number, studentId: number) {
    await this.findOne(organizationId, classId);
    const student = await this.prisma.student.findFirst({ where: { id: studentId, organizationId } });
    if (!student) {
      throw new BadRequestException('Aluno inválido para esta organização.');
    }
    return this.prisma.classStudent.upsert({
      where: { classId_studentId: { classId, studentId } },
      create: { organizationId, classId, studentId },
      update: { status: 'ACTIVE' },
    });
  }

  /** Desmatricula: mantém o registro (histórico de frequência) e marca INACTIVE. */
  async unenrollStudent(organizationId: number, classId: number, studentId: number) {
    await this.findOne(organizationId, classId);
    const enrollment = await this.prisma.classStudent.findFirst({
      where: { organizationId, classId, studentId },
    });
    if (!enrollment) {
      throw new NotFoundException('Matrícula não encontrada.');
    }
    return this.prisma.classStudent.update({ where: { id: enrollment.id }, data: { status: 'INACTIVE' } });
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
