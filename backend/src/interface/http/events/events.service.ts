import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { CreateEventDto } from './dto/create-event.dto';
import { UpdateEventDto } from './dto/update-event.dto';
import { AddEventParticipantDto } from './dto/add-event-participant.dto';

/**
 * Eventos do grupo — CRUD completo, sempre isolado por organizationId (PLANO_PROJETO.md
 * §10.5/§10.6). Event não tem campo status (diferente de Student): "excluir" apaga de
 * verdade, em cascata com os EventParticipant do evento.
 */
@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(organizationId: number) {
    return this.prisma.event.findMany({
      where: { organizationId },
      orderBy: { id: 'desc' },
      take: 50,
    });
  }

  async findOne(organizationId: number, id: number) {
    const event = await this.prisma.event.findFirst({ where: { id, organizationId } });
    if (!event) {
      throw new NotFoundException('Evento não encontrado.');
    }
    return event;
  }

  async create(organizationId: number, dto: CreateEventDto) {
    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }

    return this.prisma.event.create({
      data: {
        organizationId,
        unitId: dto.unitId,
        title: dto.title,
        description: dto.description,
        date: new Date(dto.date),
        location: dto.location,
        isPublic: dto.isPublic ?? false,
      },
    });
  }

  async update(organizationId: number, id: number, dto: UpdateEventDto) {
    await this.findOne(organizationId, id); // 404 se não existir ou não for desta organização

    if (dto.unitId) {
      await this.assertUnitBelongsToOrganization(organizationId, dto.unitId);
    }

    return this.prisma.event.update({
      where: { id },
      data: {
        unitId: dto.unitId,
        title: dto.title,
        description: dto.description,
        date: dto.date ? new Date(dto.date) : undefined,
        location: dto.location,
        isPublic: dto.isPublic,
      },
    });
  }

  /**
   * Event não tem campo "status" no schema (diferente de Student), então não há como
   * "inativar" — excluir apaga de verdade. Primeiro remove os EventParticipant do evento
   * (senão a FK quebra), depois o Event, numa transação.
   */
  async remove(organizationId: number, id: number) {
    await this.findOne(organizationId, id);

    await this.prisma.$transaction([
      this.prisma.eventParticipant.deleteMany({ where: { eventId: id } }),
      this.prisma.event.delete({ where: { id } }),
    ]);
  }

  /** Lista os participantes de um evento, com o nome do aluno quando studentId estiver
   * preenchido. Valida que o evento pertence à organização antes (404 se não). */
  async listParticipants(organizationId: number, eventId: number) {
    await this.findOne(organizationId, eventId);

    return this.prisma.eventParticipant.findMany({
      where: { organizationId, eventId },
      include: { student: { select: { id: true, name: true } } },
      orderBy: { id: 'desc' },
    });
  }

  /**
   * Adiciona um participante ao evento — OU um aluno (studentId) OU um convidado sem
   * cadastro (guestName), nunca os dois nem nenhum dos dois.
   */
  async addParticipant(organizationId: number, eventId: number, dto: AddEventParticipantDto) {
    await this.findOne(organizationId, eventId);

    const hasStudent = dto.studentId != null;
    const hasGuest = !!dto.guestName;
    if (hasStudent === hasGuest) {
      throw new BadRequestException('Informe studentId ou guestName.');
    }

    if (hasStudent) {
      const student = await this.prisma.student.findFirst({
        where: { id: dto.studentId, organizationId },
      });
      if (!student) {
        throw new BadRequestException('Aluno inválido para esta organização.');
      }
    }

    return this.prisma.eventParticipant.create({
      data: {
        organizationId,
        eventId,
        studentId: dto.studentId,
        guestName: dto.guestName,
        status: dto.status,
      },
      include: { student: { select: { id: true, name: true } } },
    });
  }

  /** Remove um participante — valida que pertence ao evento/organização (404 se não). */
  async removeParticipant(organizationId: number, eventId: number, participantId: number) {
    await this.findOne(organizationId, eventId);

    const participant = await this.prisma.eventParticipant.findFirst({
      where: { id: participantId, eventId, organizationId },
    });
    if (!participant) {
      throw new NotFoundException('Participante não encontrado.');
    }

    await this.prisma.eventParticipant.delete({ where: { id: participantId } });
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
