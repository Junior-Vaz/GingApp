import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { PermissionsService } from '../../../shared/access/permissions.service';
import { AuthenticatedUser } from '../../../shared/interfaces/jwt-payload.interface';
import { StudentsService } from '../students/students.service';
import { CreateGraduationSystemDto } from './dto/create-graduation-system.dto';
import { CreateGraduationLevelDto } from './dto/create-graduation-level.dto';
import { CreateStudentGraduationDto } from './dto/create-student-graduation.dto';

@Injectable()
export class GraduationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: PermissionsService,
    private readonly studentsService: StudentsService,
  ) {}

  /** Sistemas de graduação configuráveis do grupo, com seus níveis (projeto.txt §26). */
  findAll(organizationId: number) {
    return this.prisma.graduationSystem.findMany({
      where: { organizationId },
      include: { levels: { orderBy: { order: 'asc' } } },
      orderBy: { id: 'desc' },
      take: 50,
    });
  }

  /** Lista os sistemas de graduação da organização, cada um com seus níveis em ordem. */
  findAllSystems(organizationId: number) {
    return this.prisma.graduationSystem.findMany({
      where: { organizationId },
      include: { levels: { orderBy: { order: 'asc' } } },
      orderBy: { id: 'asc' },
    });
  }

  createSystem(organizationId: number, dto: CreateGraduationSystemDto) {
    return this.prisma.graduationSystem.create({
      data: {
        organizationId,
        name: dto.name,
        description: dto.description,
      },
    });
  }

  async createLevel(organizationId: number, systemId: number, dto: CreateGraduationLevelDto) {
    await this.assertSystemBelongsToOrganization(organizationId, systemId);

    return this.prisma.graduationLevel.create({
      data: {
        organizationId,
        graduationSystemId: systemId,
        name: dto.name,
        order: dto.order,
        color: dto.color,
      },
    });
  }

  /**
   * Histórico de graduações de um aluno da organização (projeto.txt §27), mais recente primeiro.
   * Staff (graduations.view na matriz RolePermission, ou PLATFORM) vê qualquer aluno da
   * organização; os demais (ALUNO/RESPONSAVEL) só o próprio Student ou um dependente — aluno
   * sem vínculo dá o MESMO 404 de aluno inexistente (não vaza existência).
   */
  async findStudentHistory(organizationId: number, studentId: number, requester: AuthenticatedUser) {
    if (await this.permissions.can(requester, 'graduations', 'view')) {
      await this.assertStudentBelongsToOrganization(organizationId, studentId);
    } else {
      const link = await this.studentsService.resolveLink(organizationId, requester.id, studentId);
      if (!link?.linked) {
        throw new NotFoundException('Aluno não encontrado.');
      }
    }

    return this.prisma.studentGraduation.findMany({
      where: { studentId, organizationId },
      include: { graduationLevel: true },
      orderBy: { graduatedAt: 'desc' },
    });
  }

  /** Registra uma nova graduação para o aluno. Nunca confia em FKs vindas do corpo sem
   * confirmar que pertencem à organização do usuário autenticado. */
  async createStudentGraduation(organizationId: number, studentId: number, dto: CreateStudentGraduationDto) {
    await this.assertStudentBelongsToOrganization(organizationId, studentId);
    await this.assertLevelBelongsToOrganization(organizationId, dto.graduationLevelId);

    return this.prisma.studentGraduation.create({
      data: {
        organizationId,
        studentId,
        graduationLevelId: dto.graduationLevelId,
        graduatedAt: new Date(dto.graduatedAt),
        notes: dto.notes,
      },
      include: { graduationLevel: true },
    });
  }

  private async assertSystemBelongsToOrganization(organizationId: number, systemId: number): Promise<void> {
    const system = await this.prisma.graduationSystem.findFirst({ where: { id: systemId, organizationId } });
    if (!system) {
      throw new NotFoundException('Sistema de graduação não encontrado.');
    }
  }

  private async assertStudentBelongsToOrganization(organizationId: number, studentId: number): Promise<void> {
    const student = await this.prisma.student.findFirst({ where: { id: studentId, organizationId } });
    if (!student) {
      throw new NotFoundException('Aluno não encontrado.');
    }
  }

  private async assertLevelBelongsToOrganization(organizationId: number, levelId: number): Promise<void> {
    const level = await this.prisma.graduationLevel.findFirst({ where: { id: levelId, organizationId } });
    if (!level) {
      throw new BadRequestException('Nível de graduação inválido para esta organização.');
    }
  }
}
