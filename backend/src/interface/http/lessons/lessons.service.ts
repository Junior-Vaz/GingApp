import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Lesson, OrgRole, Prisma } from '@prisma/client';
import { Page, pageArgs } from '../../../shared/pagination/pagination';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { ListLessonsQueryDto } from './dto/list-lessons-query.dto';
import { ClassesService } from '../classes/classes.service';
import { CreateLessonDto } from './dto/create-lesson.dto';
import { UpdateLessonDto } from './dto/update-lesson.dto';

const TEACHER_ROLES: OrgRole[] = [OrgRole.MESTRE, OrgRole.PROFESSOR];

/** Aulas do grupo — CRUD completo, sempre isolado por organizationId. */
@Injectable()
export class LessonsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classesService: ClassesService,
  ) {}

  async findAll(organizationId: number, query: ListLessonsQueryDto = {}): Promise<Page<Lesson>> {
    const where: Prisma.LessonWhereInput = { organizationId }; // organizationId SEMPRE no where (findMany e count)
    if (query.classId !== undefined) where.classId = query.classId;
    if (query.status) where.status = query.status;
    if (query.from || query.to) {
      where.date = {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        // `to` so com data (YYYY-MM-DD) inclui o dia inteiro, nao so a meia-noite.
        ...(query.to ? { lte: new Date(/^\d{4}-\d{2}-\d{2}$/.test(query.to) ? `${query.to}T23:59:59.999Z` : query.to) } : {}),
      };
    }
    const q = query.q?.trim();
    if (q) where.notes = { contains: q, mode: 'insensitive' };

    const [items, total] = await Promise.all([
      this.prisma.lesson.findMany({ where, orderBy: { id: 'desc' }, ...pageArgs(query) }),
      this.prisma.lesson.count({ where }),
    ]);
    return { items, total };
  }

  /** "Minhas aulas" — aulas das turmas em que os alunos ligados ao usuário autenticado estão
   * matriculados (mesmo padrão de ClassesService.findMine/FinanceService.findMine). Ordenado
   * por data crescente para "próxima aula" ficar sempre no topo. */
  async findMine(organizationId: number, userId: number) {
    const myClasses = await this.classesService.findMine(organizationId, userId);
    if (myClasses.length === 0) return [];

    return this.prisma.lesson.findMany({
      where: { organizationId, classId: { in: myClasses.map((c) => c.id) } },
      orderBy: { date: 'asc' },
      take: 50,
    });
  }

  async findOne(organizationId: number, id: number) {
    const lesson = await this.prisma.lesson.findFirst({ where: { id, organizationId } });
    if (!lesson) {
      throw new NotFoundException('Aula não encontrada.');
    }
    return lesson;
  }

  async create(organizationId: number, dto: CreateLessonDto) {
    await this.assertClassBelongsToOrganization(organizationId, dto.classId);
    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }
    if (dto.teacherUserId) {
      await this.assertTeacherBelongsToOrganization(organizationId, dto.teacherUserId);
    }

    return this.prisma.lesson.create({
      data: {
        organizationId,
        classId: dto.classId,
        unitId: dto.unitId,
        teacherUserId: dto.teacherUserId,
        date: new Date(dto.date),
        startTime: dto.startTime,
        endTime: dto.endTime,
        notes: dto.notes,
      },
    });
  }

  async update(organizationId: number, id: number, dto: UpdateLessonDto) {
    await this.findOne(organizationId, id); // 404 se não existir ou não for desta organização

    if (dto.classId) {
      await this.assertClassBelongsToOrganization(organizationId, dto.classId);
    }
    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }
    if (dto.teacherUserId) {
      await this.assertTeacherBelongsToOrganization(organizationId, dto.teacherUserId);
    }

    return this.prisma.lesson.update({
      where: { id },
      data: {
        classId: dto.classId,
        unitId: dto.unitId,
        teacherUserId: dto.teacherUserId,
        date: dto.date ? new Date(dto.date) : undefined, // date e obrigatoria: null ja barrado no DTO
        startTime: dto.startTime,
        endTime: dto.endTime,
        notes: dto.notes,
        status: dto.status,
      },
    });
  }

  /**
   * "Remover" uma aula nunca apaga o registro — o histórico não deve ser apagado quando a
   * aula fica cancelada (mesmo padrão de Students/Teachers: PLANO_PROJETO.md §10.5). Marca
   * status = INACTIVE (= "cancelada" para Lesson).
   */
  async remove(organizationId: number, id: number) {
    await this.findOne(organizationId, id);
    return this.prisma.lesson.update({ where: { id }, data: { status: 'INACTIVE' } });
  }

  /** Nunca confiar em classId vindo do corpo da requisição sem confirmar que pertence à
   * organização do usuário autenticado (mesmo padrão de unitId em StudentsService). */
  private async assertClassBelongsToOrganization(organizationId: number, classId: number): Promise<void> {
    const klass = await this.prisma.class.findFirst({ where: { id: classId, organizationId } });
    if (!klass) {
      throw new BadRequestException('Turma inválida para esta organização.');
    }
  }

  /** Nunca confiar em unitId vindo do corpo da requisição sem confirmar que pertence à
   * organização do usuário autenticado (PLANO_PROJETO.md §3.2 item 4). */
  private async assertUnitBelongsToOrganization(organizationId: number, unitId: number): Promise<void> {
    const unit = await this.prisma.unit.findFirst({ where: { id: unitId, organizationId } });
    if (!unit) {
      throw new BadRequestException('Unidade inválida para esta organização.');
    }
  }

  /** teacherUserId não é uma FK Prisma direta para um model Teacher (não existe): é o User.id
   * de alguém com membership (OrganizationUser) na organização com role MESTRE ou PROFESSOR
   * (mesmo padrão de "professor" descrito em TeachersService). */
  private async assertTeacherBelongsToOrganization(organizationId: number, teacherUserId: number): Promise<void> {
    const membership = await this.prisma.organizationUser.findFirst({
      where: { organizationId, userId: teacherUserId, role: { in: TEACHER_ROLES } },
    });
    if (!membership) {
      throw new BadRequestException('Professor inválido para esta organização.');
    }
  }
}
