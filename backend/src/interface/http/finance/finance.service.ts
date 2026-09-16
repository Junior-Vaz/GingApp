import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { StudentsService } from '../students/students.service';
import { CreateFinanceRecordDto } from './dto/create-finance-record.dto';
import { UpdateFinanceRecordDto } from './dto/update-finance-record.dto';

/**
 * Registros financeiros (mensalidades, cobrancas) — CRUD completo, sempre isolado por
 * organizationId (PLANO_PROJETO.md §7 / §10.5-10.6).
 */
@Injectable()
export class FinanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentsService: StudentsService,
  ) {}

  findAll(organizationId: number) {
    return this.prisma.financialRecord.findMany({
      where: { organizationId },
      orderBy: { id: 'desc' },
      take: 50,
    });
  }

  /**
   * "Meu financeiro" — escopado aos alunos ligados ao usuário autenticado (ele mesmo ou seus
   * dependentes via StudentGuardian), NUNCA à organização inteira. Resolve a pendência
   * registrada em §10.7: GET /finance é restrito a MESTRE/PROFESSOR porque não é filtrado;
   * esta rota é o jeito seguro de um ALUNO/RESPONSAVEL ver os próprios lançamentos.
   */
  async findMine(organizationId: number, userId: number) {
    const students = await this.studentsService.findMine(organizationId, userId);
    if (students.length === 0) return [];

    return this.prisma.financialRecord.findMany({
      where: { organizationId, studentId: { in: students.map((s) => s.id) } },
      orderBy: { dueDate: 'desc' },
      take: 50,
    });
  }

  async findOne(organizationId: number, id: number) {
    const record = await this.prisma.financialRecord.findFirst({ where: { id, organizationId } });
    if (!record) {
      throw new NotFoundException('Registro financeiro não encontrado.');
    }
    return record;
  }

  async create(organizationId: number, dto: CreateFinanceRecordDto) {
    if (dto.studentId) {
      await this.assertStudentBelongsToOrganization(organizationId, dto.studentId);
    }
    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }

    return this.prisma.financialRecord.create({
      data: {
        organizationId,
        studentId: dto.studentId,
        unitId: dto.unitId,
        description: dto.description,
        amountCents: dto.amountCents,
        type: dto.type,
        dueDate: new Date(dto.dueDate),
      },
    });
  }

  async update(organizationId: number, id: number, dto: UpdateFinanceRecordDto) {
    await this.findOne(organizationId, id); // 404 se não existir ou não for desta organização

    if (dto.studentId) {
      await this.assertStudentBelongsToOrganization(organizationId, dto.studentId);
    }
    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }

    // Conveniência: quando o mestre marca como pago sem informar a data, usa o momento atual.
    // Se paidAt vier explícito no corpo, respeita (ele pode estar lançando um pagamento retroativo).
    const paidAt = dto.paidAt !== undefined ? new Date(dto.paidAt) : dto.status === 'PAID' ? new Date() : undefined;

    return this.prisma.financialRecord.update({
      where: { id },
      data: {
        studentId: dto.studentId,
        unitId: dto.unitId,
        description: dto.description,
        amountCents: dto.amountCents,
        type: dto.type,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        status: dto.status,
        paidAt,
      },
    });
  }

  /**
   * Remoção de verdade (hard delete) — diferente do padrão soft-delete dos demais módulos
   * (aluno/turma/aula inativam para preservar histórico). Um lançamento financeiro incorreto
   * (ex.: valor digitado errado) deve poder ser apagado de verdade: não existe um conceito de
   * "registro financeiro inativo" com sentido de negócio aqui.
   */
  async remove(organizationId: number, id: number) {
    await this.findOne(organizationId, id);
    return this.prisma.financialRecord.delete({ where: { id } });
  }

  /** Nunca confiar em studentId vindo do corpo da requisição sem confirmar que pertence à
   * organização do usuário autenticado (PLANO_PROJETO.md §3.2 item 4). */
  private async assertStudentBelongsToOrganization(organizationId: number, studentId: number): Promise<void> {
    const student = await this.prisma.student.findFirst({ where: { id: studentId, organizationId } });
    if (!student) {
      throw new BadRequestException('Aluno inválido para esta organização.');
    }
  }

  /** Idem para unitId. */
  private async assertUnitBelongsToOrganization(organizationId: number, unitId: number): Promise<void> {
    const unit = await this.prisma.unit.findFirst({ where: { id: unitId, organizationId } });
    if (!unit) {
      throw new BadRequestException('Unidade inválida para esta organização.');
    }
  }
}
