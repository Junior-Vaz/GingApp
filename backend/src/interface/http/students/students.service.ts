import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { SubscriptionsService } from '../subscriptions/subscriptions.service';
import { CreateStudentDto } from './dto/create-student.dto';
import { UpdateStudentDto } from './dto/update-student.dto';

/** Alunos do grupo — CRUD completo, sempre isolado por organizationId. */
@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly subscriptionsService: SubscriptionsService,
  ) {}

  findAll(organizationId: number) {
    return this.prisma.student.findMany({
      where: { organizationId },
      orderBy: { id: 'desc' },
      take: 50,
    });
  }

  /**
   * Alunos ligados ao usuário autenticado: ele mesmo (se for ALUNO com Student.userId
   * próprio) e/ou os alunos dos quais é responsável (StudentGuardian.userId) — cobre tanto
   * o PWA do próprio capoeirista quanto o de um responsável acompanhando os filhos.
   */
  async findMine(organizationId: number, userId: number) {
    const [ownRecord, guardianLinks] = await Promise.all([
      this.prisma.student.findFirst({ where: { organizationId, userId } }),
      this.prisma.studentGuardian.findMany({
        where: { organizationId, userId },
        include: { student: true },
      }),
    ]);

    const students = ownRecord ? [ownRecord] : [];
    for (const link of guardianLinks) {
      if (!students.some((s) => s.id === link.student.id)) {
        students.push(link.student);
      }
    }
    return students;
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
    await this.assertWithinStudentLimit(organizationId);

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

  /**
   * Aplica Plan.maxStudents (Fase 2 — PLANO_PROJETO.md §10.13). Sem assinatura em aberto
   * (TRIALING/ACTIVE/PAST_DUE) ou sem limite definido no plano, não bloqueia nada — isso
   * mantém orgs de teste/seed sem assinatura funcionando como antes. Conta só alunos ACTIVE:
   * um aluno INACTIVE (soft-delete) não deve ocupar vaga do limite do plano.
   */
  private async assertWithinStudentLimit(organizationId: number): Promise<void> {
    const subscription = await this.subscriptionsService.findOpenForOrganization(organizationId);
    const maxStudents = subscription?.plan.maxStudents;
    if (!maxStudents) {
      return;
    }

    const activeCount = await this.prisma.student.count({
      where: { organizationId, status: 'ACTIVE' },
    });
    if (activeCount >= maxStudents) {
      throw new BadRequestException(
        `Limite de ${maxStudents} alunos do plano "${subscription!.plan.name}" atingido. Faça upgrade do plano para adicionar mais alunos.`,
      );
    }
  }
}
